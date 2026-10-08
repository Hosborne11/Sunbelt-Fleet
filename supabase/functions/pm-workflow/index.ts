// pm-workflow — PM scheduling with the service vendor (James River Equipment)
// Single file: paste into the Supabase dashboard editor as a function named "pm-workflow".
// Turn OFF "Verify JWT" for this function; it checks staff sign-in, vendor links and the cron key itself.
//
// Flow: requested -> proposed (dealer picks a date) -> scheduled (Sunbelt accepts)
//       -> 24h before: dealer re-confirms + foreman notice -> 24h after: dealer confirms, work order required
//       Any dealer date change returns to "proposed" and notifies foremen + app users.
//
// POST { action, ... }
//   staff (signed in):  request | accept | decline | resend | cancel | test_email
//   dealer (link):      portal_get | portal_propose | portal_reconfirm | portal_upload_url | portal_complete
//   cron:               cron   (header x-fleet-cron-key)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, any, any>;

const TZ = "America/New_York";
const OPEN = ["requested", "proposed", "scheduled", "awaiting_confirmation"];
const FILES_BUCKET = "asset-files"; // machine files (work orders land here)
const MAX_FOLLOWUPS = 3;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fleet-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const env = (k: string) => Deno.env.get(k) ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class HttpErr extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// =====================================================================
// PURE HELPERS — Eastern-time scheduling math (unit-tested)
// =====================================================================
export function etParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

const utcFromParts = (date: string, h: number, m: number) => {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h, m);
};

// Wall-clock Eastern date + "HH:MM" -> UTC instant (handles daylight saving)
export function etToUtc(date: string, time = "00:00"): Date {
  const [hh, mm] = time.split(":").map(Number);
  const guess = utcFromParts(date, hh, mm);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(t));
    const offset = utcFromParts(p.date, p.hour, p.minute) - t; // ET minus UTC
    t = guess - offset;
  }
  return new Date(t);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
export function nextWeekday(date: string) {
  let d = addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
export function addWeekdays(date: string, n: number) {
  let d = date;
  for (let i = 0; i < n; i++) d = nextWeekday(d);
  return d;
}

// When each message is due
//  * 24h before the service (start time, or 7:00 AM the day before if no time):
//      dealer re-confirm request + foreman notice
//  * 6:00 AM the morning of: foreman reminder (optional, PM Workflow settings)
//  * 24h after the service (8:00 AM next day if no time): dealer completion request,
//    repeated every 2 weekdays at 8:00 AM until confirmed (3 max)
export function scheduleTimes(r: Any) {
  const time = r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : null;
  const start = etToUtc(r.scheduled_date, time ?? "08:00");
  const dayStart = etToUtc(r.scheduled_date, "00:00");
  const before24 = time ? new Date(start.getTime() - 24 * 3600_000) : etToUtc(addDays(r.scheduled_date, -1), "07:00");
  const morning = etToUtc(r.scheduled_date, "06:00");
  const completion = r.followup_count > 0 && r.last_followup_at
    ? etToUtc(addWeekdays(etParts(new Date(r.last_followup_at)).date, 2), "08:00")
    : new Date(start.getTime() + 24 * 3600_000);
  return { start, dayStart, before24, morning, completion };
}

export function dueActions(r: Any, now: Date, opts: { morningReminder?: boolean } = {}): string[] {
  const out: string[] = [];
  const age = (ts: string | null) => (ts ? now.getTime() - new Date(ts).getTime() : 0);
  if (r.status === "requested") {
    if (!r.request_resent_at && age(r.requested_at) >= 48 * 3600_000) out.push("request_reminder");
    return out;
  }
  if (r.status === "proposed") {
    if (!r.proposal_reminder_sent_at && age(r.proposed_at) >= 24 * 3600_000) out.push("proposal_reminder");
    return out;
  }
  if (!r.scheduled_date || !["scheduled", "awaiting_confirmation"].includes(r.status)) return out;
  const t = scheduleTimes(r);
  if (r.status === "scheduled" && now >= t.before24 && now < t.dayStart) {
    if (!r.reconfirm_sent_at && !r.reconfirmed_at) out.push("reconfirm");
    if (!r.reminder_24h_sent_at) out.push("foreman_notice");
  }
  if (r.status === "scheduled" && opts.morningReminder !== false && !r.reminder_day_sent_at
      && now >= t.morning && etParts(now).date === r.scheduled_date) {
    out.push("reminder_day");
  }
  if ((r.followup_count ?? 0) < MAX_FOLLOWUPS && now >= t.completion) out.push("followup");
  return out;
}

export function fmtDateLong(date: string | null) {
  if (!date) return "";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}
export function fmtTime(time: string | null) {
  if (!time) return "";
  const [h, m] = String(time).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const fmtHrs = (v: Any) => (v == null ? "—" : `${Math.round(Number(v)).toLocaleString("en-US")} hrs`);
const esc = (s: Any) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.map((x) => (x || "").trim().toLowerCase()).filter((x) => /.+@.+\..+/.test(x)))];

// =====================================================================
// EMAIL — Microsoft 365 (Graph) or Resend, chosen by EMAIL_PROVIDER
// =====================================================================
interface Mail { to: string[]; cc?: string[]; subject: string; html: string; text: string; replyTo?: string | null }

let graphToken: { value: string; exp: number } | null = null;
async function graphAccessToken() {
  if (graphToken && graphToken.exp > Date.now() + 60_000) return graphToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const raw = await res.text();
  let body: Any = {};
  try { body = JSON.parse(raw); } catch { /* not JSON: fall through to the status code */ }
  if (!res.ok || !body.access_token) {
    throw new Error(`Microsoft sign-in failed (${res.status}): ${body.error_description || raw.slice(0, 200) || "empty response — check MS_TENANT_ID"}`);
  }
  graphToken = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return graphToken.value;
}

async function sendMail(m: Mail): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!m.to.length) return { ok: false, error: "no recipients" };
    const provider = (env("EMAIL_PROVIDER") || "graph").toLowerCase();
    const required = provider === "resend"
      ? ["RESEND_API_KEY", "EMAIL_FROM"]
      : ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER"];
    const missing = required.filter((k) => !env(k).trim());
    if (missing.length) {
      return { ok: false, error: `Email isn't set up yet. Missing Edge Function secret${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` };
    }
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env("EMAIL_FROM"), to: m.to, cc: m.cc?.length ? m.cc : undefined,
          subject: m.subject, html: m.html, text: m.text, reply_to: m.replyTo || undefined,
        }),
      });
      if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
      return { ok: true };
    }
    const sender = env("MS_SENDER");
    const addr = (a: string) => ({ emailAddress: { address: a } });
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await graphAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: m.subject,
          body: { contentType: "HTML", content: m.html },
          toRecipients: m.to.map(addr),
          ccRecipients: (m.cc || []).map(addr),
          replyTo: m.replyTo ? [addr(m.replyTo)] : [],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) return { ok: false, error: `Microsoft 365 ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// One simple, client-safe layout for every message
function layout(o: { heading: string; intro: string; rows: [string, string][]; button?: { label: string; url: string }; footer?: string }) {
  const rows = o.rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
    `<td style="padding:6px 0;color:#111827;font-size:14px">${v}</td></tr>`).join("");
  const button = o.button
    ? `<p style="margin:24px 0"><a href="${esc(o.button.url)}" style="background:#F2A93B;color:#101316;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:4px;display:inline-block">${esc(o.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:6px;overflow:hidden">
<tr><td style="background:#101316;padding:14px 24px;color:#F2A93B;font-size:12px;letter-spacing:2px;font-weight:600">SUNBELT UTILITIES FLEET</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 8px;font-size:20px;color:#111827">${esc(o.heading)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151">${o.intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
${button}
${o.footer ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${o.footer}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const text = [o.heading, "", strip(o.intro), "", ...o.rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${strip(v)}`),
    o.button ? `\n${o.button.label}: ${o.button.url}` : "", o.footer ? `\n${strip(o.footer)}` : ""].join("\n");
  return { html, text };
}

// =====================================================================
// DATA
// =====================================================================
async function loadContext(db: Db, r: Any) {
  const [assetRes, planRes, telRes, settingsRes] = await Promise.all([
    db.from("assets").select("id, asset_number, make, model, serial_number, hour_meter, telematics_asset_id, jobsite:jobsites(name, address, latitude, longitude)")
      .eq("id", r.asset_id).single(),
    db.from("maintenance_plans").select("name, interval_hours, next_due_hours, last_service_hours").eq("id", r.plan_id).single(),
    db.from("asset_telematics").select("lat, lng, current_project").eq("asset_id", r.asset_id).maybeSingle(),
    db.from("pm_settings").select("*").eq("id", true).single(),
  ]);
  const asset: Any = assetRes.data ?? {};
  const plan: Any = planRes.data ?? {};
  const tel: Any = telRes.data;
  const s: Any = settingsRes.data ?? {};
  const lat = tel?.lat ?? asset.jobsite?.latitude;
  const lng = tel?.lng ?? asset.jobsite?.longitude;
  const label = `${asset.asset_number ?? "Machine"}${asset.make || asset.model ? ` (${[asset.make, asset.model].filter(Boolean).join(" ")})` : ""}`;
  return {
    asset, plan, settings: s, label,
    jobsite: tel?.current_project || asset.jobsite?.name || null,
    address: asset.jobsite?.address || null,
    mapUrl: lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null,
    lat, lng,
  };
}

const appUrl = (path: string) => `${env("APP_BASE_URL").replace(/\/$/, "")}${path}`;
const portalUrl = (r: Any) => appUrl(`/pm/r/${r.token}`);
const fleetUrl = (r: Any) => appUrl(`/assets/${r.asset_id}`);
const when = (date: string | null, time: string | null) =>
  `${fmtDateLong(date)}${time ? `, ${fmtTime(time)}` : ""}`;
const whenScheduled = (r: Any) => when(r.scheduled_date, r.scheduled_time);
const whenProposed = (r: Any) => when(r.proposed_date, r.proposed_time);

function machineRows(c: Any): [string, string][] {
  return [
    ["Machine", esc(c.label)],
    ["Serial / PIN", esc(c.asset.serial_number || "")],
    ["Hour meter", esc(fmtHrs(c.asset.hour_meter))],
    ["PM due at", esc(fmtHrs(c.plan.next_due_hours))],
    ["Jobsite", esc([c.jobsite, c.address].filter(Boolean).join(", "))],
    ["Machine location", c.mapUrl ? `<a href="${esc(c.mapUrl)}">Open in Google Maps</a>` : ""],
  ];
}

async function deliver(db: Db, r: Any, kind: string, mail: Mail) {
  const res = await sendMail(mail);
  await db.from("pm_email_log").insert({
    request_id: r.id, kind, recipients: [...mail.to, ...(mail.cc || [])], subject: mail.subject, ok: res.ok, error: res.error ?? null,
  });
  return res;
}

// Builds and sends one kind of message for a request
async function notify(db: Db, r: Any, kind: string) {
  const c = await loadContext(db, r);
  const s = c.settings;
  const vendor = r.vendor_name || s.vendor_name || "the dealer";
  const appUsers = uniq([r.requested_by, ...(s.notify_recipients || [])]);
  const foremen = uniq(s.reminder_recipients || []);
  const dealerTo = uniq([r.vendor_email || s.vendor_contact_email]);
  const dealerCc = uniq(s.vendor_cc || []).filter((x) => !dealerTo.includes(x));
  const hello = s.vendor_contact_name ? `Hi ${esc(String(s.vendor_contact_name).trim().split(/\s+/)[0])}, ` : "";
  const lead = (sentence: string, keepCase = false) =>
    hello ? hello + (keepCase ? sentence : sentence[0].toLowerCase() + sentence.slice(1)) : sentence;
  const toDealer = (subject: string, m: { html: string; text: string }) =>
    deliver(db, r, kind, { to: dealerTo, cc: dealerCc, subject, ...m, replyTo: r.requested_by });

  switch (kind) {
    // ---------- to the dealer ----------
    case "request":
    case "request_reminder": {
      const m = layout({
        heading: kind === "request_reminder" ? "Reminder: PM service request" : "PM service request",
        intro: lead(`Sunbelt Utilities is requesting a ${esc(c.plan.name || "PM service")} for the machine below. ` +
                    `Please propose the date that works best with your schedule; we'll confirm it.`, true),
        rows: [...machineRows(c), ["Preferred date", esc(fmtDateLong(r.preferred_date))],
               ["Notes", esc(r.requested_notes || "")], ["Requested by", esc(r.requested_by || "")]],
        button: { label: "Propose a service date", url: portalUrl(r) },
        footer: r.requested_by ? `Questions? Reply to this email to reach ${esc(r.requested_by)}.` : undefined,
      });
      return toDealer(`${kind === "request_reminder" ? "Reminder: " : ""}PM service request: ${c.label}`, m);
    }
    case "declined": {
      const m = layout({
        heading: "Please propose a different date",
        intro: lead(`Sunbelt Utilities can't make ${esc(when(r.declined_date, null))} work for this PM service. ` +
                    `Please propose another date.`, true),
        rows: [["Note from Sunbelt", esc(r.declined_note || "")], ...machineRows(c)],
        button: { label: "Propose another date", url: portalUrl(r) },
      });
      return toDealer(`New date needed: PM service for ${c.label}`, m);
    }
    case "accepted": {
      const m = layout({
        heading: "PM service confirmed",
        intro: lead(`Sunbelt Utilities confirmed the PM service for ${esc(whenScheduled(r))}. ` +
                    `We'll check in 24 hours before to make sure it's still on.`),
        rows: [["When", esc(whenScheduled(r))], ...machineRows(c)],
        button: { label: "View or change the date", url: portalUrl(r) },
      });
      return toDealer(`Confirmed: PM service for ${c.label} on ${fmtDateLong(r.scheduled_date)}`, m);
    }
    case "reconfirm": {
      const m = layout({
        heading: "Is this service still on?",
        intro: lead(`The PM service for this machine is scheduled for ${esc(whenScheduled(r))}. ` +
                    `Please confirm it's still on, or pick a new date.`),
        rows: [["When", esc(whenScheduled(r))], ...machineRows(c)],
        button: { label: "Confirm or change the date", url: portalUrl(r) },
      });
      return toDealer(`Still on? PM service for ${c.label} on ${fmtDateLong(r.scheduled_date)}`, m);
    }
    case "followup": {
      const m = layout({
        heading: "Please confirm the completed service",
        intro: lead(`Our records show the PM service for this machine was scheduled for ${esc(whenScheduled(r))}. ` +
                    `Please confirm it was completed, enter the hour meter reading at the time of service, ` +
                    `and attach the work order (required).`),
        rows: machineRows(c),
        button: { label: "Confirm the service", url: portalUrl(r) },
        footer: "If the service didn't happen, use the same link to propose a new date.",
      });
      return toDealer(`Please confirm: PM service for ${c.label} on ${fmtDateLong(r.scheduled_date)}`, m);
    }
    case "cancelled": {
      const m = layout({
        heading: "PM service request cancelled",
        intro: lead(`Sunbelt Utilities has cancelled this PM service request` +
                    `${r.scheduled_date ? ` (scheduled for ${esc(whenScheduled(r))})` : ""}. No action is needed.`, true),
        rows: machineRows(c),
        footer: r.requested_by ? `Questions? Reply to reach ${esc(r.requested_by)}.` : undefined,
      });
      return toDealer(`Cancelled: PM service request for ${c.label}`, m);
    }

    // ---------- to Sunbelt app users ----------
    case "proposed":
    case "proposal_reminder": {
      const m = layout({
        heading: kind === "proposal_reminder" ? "Still waiting: accept the proposed date" : `${vendor} proposed a date`,
        intro: `${esc(vendor)} proposed ${esc(whenProposed(r))} for this PM service. Accept it, or ask for another date, in Fleet.`,
        rows: [["Proposed", esc(whenProposed(r))], ["Dealer notes", esc(r.proposed_notes || "")], ...machineRows(c)],
        button: { label: "Review in Fleet", url: fleetUrl(r) },
      });
      const subject = `${kind === "proposal_reminder" ? "Reminder: " : ""}Accept ${vendor}'s date for ${c.label}: ${fmtDateLong(r.proposed_date)}`;
      return deliver(db, r, kind, { to: appUsers, subject, ...m });
    }
    case "date_changed": {
      // dealer moved an accepted date: tell app users and foremen
      const m = layout({
        heading: `${vendor} changed the service date`,
        intro: `${esc(vendor)} moved the PM service for this machine from ${esc(fmtDateLong(r.previous_date))} to ` +
               `${esc(whenProposed(r))}. The new date needs to be accepted in Fleet before it's confirmed.`,
        rows: [["Was", esc(fmtDateLong(r.previous_date))], ["Proposed", esc(whenProposed(r))],
               ["Dealer notes", esc(r.proposed_notes || "")], ...machineRows(c)],
        button: { label: "Review in Fleet", url: fleetUrl(r) },
      });
      const subject = `Date change: PM service for ${c.label} moved to ${fmtDateLong(r.proposed_date)}`;
      return deliver(db, r, kind, { to: uniq([...appUsers, ...foremen]), subject, ...m });
    }
    case "completed": {
      const m = layout({
        heading: "PM service completed",
        intro: `${esc(vendor)} confirmed the PM service. The next PM is now due at ${esc(fmtHrs(c.plan.next_due_hours))}.`,
        rows: [["Done on", esc(fmtDateLong(r.completed_on))], ["Hour meter at service", esc(fmtHrs(r.completed_hours))],
               ["Next PM due at", esc(fmtHrs(c.plan.next_due_hours))], ["Notes", esc(r.completed_notes || "")],
               ["Work order", r.work_order_path ? "Saved to the machine's files in Fleet" : "Not attached"], ["Machine", esc(c.label)]],
        button: { label: "Open in Fleet", url: fleetUrl(r) },
      });
      return deliver(db, r, kind, { to: appUsers, subject: `PM completed: ${c.label} at ${fmtHrs(r.completed_hours)}`, ...m });
    }

    // ---------- to foremen ----------
    case "foreman_notice":
    case "reminder_day": {
      const today = etParts(new Date()).date;
      const rel = r.scheduled_date === today ? "Today" : r.scheduled_date === addDays(today, 1) ? "Tomorrow" : fmtDateLong(r.scheduled_date);
      const m = layout({
        heading: `${rel}: PM service`,
        intro: `${esc(vendor)} is scheduled to service this machine ${rel === "Today" || rel === "Tomorrow" ? rel.toLowerCase() : `on ${esc(rel)}`}` +
               `${r.scheduled_time ? ` at ${esc(fmtTime(r.scheduled_time))}` : ""}. Please make sure it's available and accessible.`,
        rows: [["When", esc(whenScheduled(r))], ["Dealer notes", esc(r.scheduled_notes || "")], ...machineRows(c),
               ["Request notes", esc(r.requested_notes || "")]],
      });
      return deliver(db, r, kind, { to: foremen, subject: `${rel}: PM service for ${c.label}`, ...m });
    }
  }
  return { ok: false, error: `unknown email kind ${kind}` };
}

// =====================================================================
// ACTIONS
// =====================================================================
async function staffUser(req: Request, db: Db) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  return error ? null : data.user;
}

async function byToken(db: Db, token: unknown) {
  if (typeof token !== "string" || token.length < 32) throw new HttpErr(404, "This link isn't valid.");
  const { data } = await db.from("pm_requests").select("*").eq("token", token).maybeSingle();
  if (!data) throw new HttpErr(404, "This link isn't valid or has been replaced.");
  return data;
}

const todayEt = () => etParts(new Date()).date;
const validDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const validTime = (t: unknown) => t == null || t === "" || (typeof t === "string" && /^\d{2}:\d{2}$/.test(t));
const cleanNote = (n: unknown, max = 1000) => (typeof n === "string" && n.trim() ? n.trim().slice(0, max) : null);
const fail = (status: number, msg: string): never => { throw new HttpErr(status, msg); };

async function update(db: Db, id: string, patch: Any) {
  const { data, error } = await db.from("pm_requests").update(patch).eq("id", id).select("*").single();
  if (error) throw new HttpErr(500, error.message);
  return data;
}

// Dealer proposes a date (first time, or moving a date). Always needs Sunbelt's acceptance.
async function propose(db: Db, r: Any, date: unknown, time: unknown, notes: unknown) {
  if (!OPEN.includes(r.status)) fail(409, "This request is already closed.");
  if (!validDate(date)) fail(400, "Pick a service date.");
  if ((date as string) < todayEt()) fail(400, "The service date can't be in the past.");
  if (!validTime(time)) fail(400, "Enter the time as HH:MM.");
  const moving = ["scheduled", "awaiting_confirmation"].includes(r.status);
  const data = await update(db, r.id, {
    status: "proposed",
    proposed_date: date, proposed_time: time ? `${time}:00` : null, proposed_notes: cleanNote(notes),
    proposed_at: new Date().toISOString(), proposal_reminder_sent_at: null,
    previous_date: moving ? r.scheduled_date : r.previous_date ?? null,
  });
  const mail = await notify(db, data, moving ? "date_changed" : "proposed");
  return { status: data.status, proposed_date: data.proposed_date, email_ok: mail.ok };
}

async function handle(req: Request, db: Db, body: Any) {
  const action = String(body.action || "");

  // ---------------- cron ----------------
  if (action === "cron") {
    if (req.headers.get("x-fleet-cron-key") !== env("FLEET_CRON_KEY")) fail(401, "unauthorized");
    const { data: open } = await db.from("pm_requests").select("*").in("status", OPEN);
    const { data: s } = await db.from("pm_settings").select("reminder_recipients, morning_reminder").eq("id", true).single();
    const noForemen = !(s?.reminder_recipients || []).length;
    const now = new Date();
    const sent: string[] = [];
    for (const r of open || []) {
      for (const kind of dueActions(r, now, { morningReminder: s?.morning_reminder !== false })) {
        const toForemen = kind === "foreman_notice" || kind === "reminder_day";
        let res: { ok: boolean; error?: string };
        if (toForemen && noForemen) {
          res = { ok: false, error: "no foreman recipients set" };
          await db.from("pm_email_log").insert({ request_id: r.id, kind, ok: false, error: res.error });
        } else {
          res = await notify(db, r, kind);
        }
        // Foreman emails are settled when sent or when nobody is set up to receive them (logged once)
        if (!res.ok && !(toForemen && noForemen)) continue;
        const stamp = now.toISOString();
        const patch: Any =
          kind === "reconfirm" ? { reconfirm_sent_at: stamp }
          : kind === "foreman_notice" ? { reminder_24h_sent_at: stamp }
          : kind === "reminder_day" ? { reminder_day_sent_at: stamp }
          : kind === "request_reminder" ? { request_resent_at: stamp }
          : kind === "proposal_reminder" ? { proposal_reminder_sent_at: stamp }
          : { followup_count: (r.followup_count ?? 0) + 1, last_followup_at: stamp, status: "awaiting_confirmation" };
        await db.from("pm_requests").update(patch).eq("id", r.id);
        Object.assign(r, patch);
        sent.push(`${kind}:${r.id}`);
      }
    }
    return { checked: open?.length ?? 0, sent };
  }

  // ---------------- dealer link ----------------
  if (action === "portal_get") {
    const r = await byToken(db, body.token);
    const c = await loadContext(db, r);
    const today = todayEt();
    return {
      status: r.status, today,
      vendor_name: r.vendor_name || c.settings.vendor_name,
      machine: { asset_number: c.asset.asset_number, make: c.asset.make, model: c.asset.model,
                 serial_number: c.asset.serial_number, hour_meter: c.asset.hour_meter },
      plan: { name: c.plan.name, interval_hours: c.plan.interval_hours, next_due_hours: c.plan.next_due_hours,
              last_service_hours: c.plan.last_service_hours },
      location: { jobsite: c.jobsite, address: c.address, map_url: c.mapUrl },
      requested_by: r.requested_by, requested_notes: r.requested_notes, preferred_date: r.preferred_date,
      declined_note: r.declined_note,
      proposed_date: r.proposed_date, proposed_time: r.proposed_time ? String(r.proposed_time).slice(0, 5) : null,
      proposed_notes: r.proposed_notes,
      scheduled_date: r.scheduled_date, scheduled_time: r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : null,
      scheduled_notes: r.scheduled_notes,
      reconfirm_open: r.status === "scheduled" && !!r.reconfirm_sent_at && !r.reconfirmed_at && r.scheduled_date >= today,
      reconfirmed_at: r.reconfirmed_at,
      completed_on: r.completed_on, completed_hours: r.completed_hours,
    };
  }

  if (action === "portal_propose" || action === "portal_schedule") {
    const r = await byToken(db, body.token);
    return await propose(db, r, body.date, body.time, body.notes);
  }

  if (action === "portal_reconfirm") {
    const r = await byToken(db, body.token);
    if (r.status !== "scheduled") fail(409, "This service isn't waiting for confirmation.");
    if (body.still_on === false) return await propose(db, r, body.new_date, body.new_time, body.notes);
    const data = await update(db, r.id, { reconfirmed_at: new Date().toISOString() });
    return { status: data.status, reconfirmed: true };
  }

  if (action === "portal_upload_url") {
    const r = await byToken(db, body.token);
    if (!OPEN.includes(r.status)) fail(409, "This request is already closed.");
    const name = String(body.filename || "work-order").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    if (!/\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(name)) fail(400, "Attach the work order as a PDF or a photo (JPG, PNG, HEIC).");
    const path = `${r.asset_id}/work-orders/${r.id}-${Date.now()}-${name}`;
    const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
    if (error) fail(500, error.message);
    return { path, upload_token: data!.token };
  }

  if (action === "portal_complete") {
    const r = await byToken(db, body.token);
    if (!OPEN.includes(r.status)) fail(409, "This service has already been confirmed.");
    if (body.completed === false) return await propose(db, r, body.new_date, body.new_time, body.notes);

    if (!validDate(body.performed_on)) fail(400, "Enter the date the service was done.");
    if (body.performed_on > todayEt()) fail(400, "The service date can't be in the future.");
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) fail(400, "Enter the hour meter reading at the time of service.");
    const c = await loadContext(db, r);
    if (c.plan.last_service_hours != null && hours < Number(c.plan.last_service_hours)) {
      fail(400, `That's lower than the last PM (${fmtHrs(c.plan.last_service_hours)}). Please check the reading.`);
    }
    if (c.asset.telematics_asset_id && c.asset.hour_meter != null && hours > Number(c.asset.hour_meter) + 50) {
      fail(400, `That's higher than the machine's current meter (${fmtHrs(c.asset.hour_meter)}). Please check the reading.`);
    }

    // Work order is required and must be the file uploaded for this request
    const wo = typeof body.work_order_path === "string" ? body.work_order_path : "";
    if (!wo) fail(400, "Attach the work order before confirming.");
    if (!wo.startsWith(`${r.asset_id}/work-orders/${r.id}-`)) fail(400, "Invalid attachment.");
    const { error: missing } = await db.storage.from(FILES_BUCKET).createSignedUrl(wo, 60);
    if (missing) fail(400, "The work order upload didn't finish. Please attach it again.");

    const notes = cleanNote(body.notes, 2000);
    const vendor = r.vendor_name || c.settings.vendor_name;
    const fileName = String(body.file_name || wo.split("/").pop()).slice(0, 200);
    const { data: file, error: fileErr } = await db.from("asset_files").insert({
      asset_id: r.asset_id, bucket: FILES_BUCKET, path: wo, file_name: fileName,
      content_type: typeof body.content_type === "string" ? body.content_type : null,
      size_bytes: Number(body.size_bytes) || null, category: "work_order", request_id: r.id,
      uploaded_by: vendor, notes: `PM service ${body.performed_on} at ${hours} hrs`,
    }).select("id").single();
    if (fileErr) fail(500, fileErr.message);

    const { error: svcErr } = await db.from("maintenance_services").insert({
      plan_id: r.plan_id, asset_id: r.asset_id, performed_on: body.performed_on, hours,
      performed_by: vendor, notes, request_id: r.id, file_id: file!.id,
    });
    if (svcErr) fail(500, svcErr.message);
    const done = await update(db, r.id, {
      status: "completed", completed_on: body.performed_on, completed_hours: hours, completed_notes: notes,
      work_order_path: wo, completed_at: new Date().toISOString(),
    });
    await notify(db, done, "completed");
    const { data: plan } = await db.from("maintenance_plans").select("next_due_hours").eq("id", r.plan_id).single();
    return { status: "completed", next_due_hours: plan?.next_due_hours ?? null };
  }

  // ---------------- staff (signed in to Fleet) ----------------
  const user = await staffUser(req, db);
  if (!user) fail(401, "Sign in to Fleet to do this.");

  if (action === "test_email") {
    const m = layout({
      heading: "Fleet email test",
      intro: "If you can read this, PM workflow emails are set up correctly.",
      rows: [["Provider", esc((env("EMAIL_PROVIDER") || "graph").toLowerCase())], ["Sent to", esc(user!.email)],
             ["Link base", esc(env("APP_BASE_URL") || "APP_BASE_URL is not set — email buttons won't work")]],
    });
    const res = await sendMail({ to: uniq([user!.email]), subject: "Fleet email test", ...m });
    return { email_ok: res.ok, email_error: res.error ?? (env("APP_BASE_URL") ? null : "Sent, but APP_BASE_URL isn't set, so links in emails won't work.") };
  }

  if (action === "request") {
    if (!env("APP_BASE_URL")) fail(400, "Set the APP_BASE_URL Edge Function secret first, so the dealer's link works.");
    const { data: plan } = await db.from("maintenance_plans").select("id, asset_id, active").eq("id", body.plan_id).maybeSingle();
    if (!plan) fail(404, "Maintenance plan not found.");
    const { data: s } = await db.from("pm_settings").select("*").eq("id", true).single();
    if (!s?.vendor_contact_email) fail(400, "Add the dealer contact's email on the PM Workflow settings page first.");
    if (body.preferred_date && !validDate(body.preferred_date)) fail(400, "Preferred date isn't valid.");
    const { data: r, error } = await db.from("pm_requests").insert({
      plan_id: plan!.id, asset_id: plan!.asset_id, vendor_name: s.vendor_name, vendor_email: s.vendor_contact_email,
      requested_by: user!.email, requested_notes: cleanNote(body.notes), preferred_date: body.preferred_date || null,
    }).select("*").single();
    if (error) fail(error.code === "23505" ? 409 : 500,
                    error.code === "23505" ? "This machine already has an open service request." : error.message);
    const mail = await notify(db, r, "request");
    return { request_id: r.id, email_ok: mail.ok, email_error: mail.error ?? null };
  }

  const { data: r } = await db.from("pm_requests").select("*").eq("id", body.request_id).maybeSingle();
  if (!r || !OPEN.includes(r.status)) fail(404, "No open request found.");

  if (action === "accept") {
    if (r.status !== "proposed") fail(409, "There's no proposed date to accept.");
    if (r.proposed_date < todayEt()) fail(400, "That date has passed. Ask the dealer for another date.");
    const data = await update(db, r.id, {
      status: "scheduled", scheduled_date: r.proposed_date, scheduled_time: r.proposed_time,
      scheduled_notes: r.proposed_notes, scheduled_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(), accepted_by: user!.email,
      proposed_date: null, proposed_time: null, proposed_notes: null, previous_date: null,
      reconfirm_sent_at: null, reconfirmed_at: null, reminder_24h_sent_at: null, reminder_day_sent_at: null,
      followup_count: 0, last_followup_at: null, proposal_reminder_sent_at: null,
    });
    const mail = await notify(db, data, "accepted");
    return { status: data.status, email_ok: mail.ok, email_error: mail.error ?? null };
  }

  if (action === "decline") {
    if (r.status !== "proposed") fail(409, "There's no proposed date to turn down.");
    const data = await update(db, r.id, {
      status: "requested", declined_note: cleanNote(body.note), proposed_date: null, proposed_time: null,
      proposed_notes: null, request_resent_at: null,
    });
    const mail = await notify(db, { ...data, declined_date: r.proposed_date }, "declined");
    return { status: data.status, email_ok: mail.ok, email_error: mail.error ?? null };
  }

  if (action === "resend") {
    const kind = r.status === "awaiting_confirmation" ? "followup" : r.status === "scheduled" ? "accepted" : "request";
    const mail = await notify(db, r, kind);
    return { email_ok: mail.ok, email_error: mail.error ?? null };
  }

  if (action === "cancel") {
    const data = await update(db, r.id, { status: "cancelled", cancelled_at: new Date().toISOString() });
    const mail = await notify(db, data, "cancelled");
    return { status: "cancelled", email_ok: mail.ok };
  }

  fail(400, `Unknown action "${action}".`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    return json(await handle(req, db, body));
  } catch (e) {
    const status = e instanceof HttpErr ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
