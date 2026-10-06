// pm-workflow — PM scheduling with the service vendor (James River Equipment)
// Single file: paste into the Supabase dashboard editor as a function named "pm-workflow".
// Turn OFF "Verify JWT" for this function; it checks staff sign-in, vendor links and the cron key itself.
//
// POST { action, ... }
//   staff (signed in):  request | resend | cancel | test_email
//   vendor (link):      portal_get | portal_schedule | portal_upload_url | portal_complete
//   cron:               cron   (header x-fleet-cron-key)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, any, any>;

const TZ = "America/New_York";
const OPEN = ["requested", "scheduled", "awaiting_confirmation"];
const BUCKET = "pm-workorders";
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

// When each message for a scheduled request is due
//  * 24-hour reminder: 24h before the start time, or 7:00 AM the day before if no time was given
//  * morning-of reminder: 6:00 AM on the service day
//  * vendor follow-up: 8:00 AM the next weekday after the service, then every 2 weekdays (3 max)
export function scheduleTimes(r: Any) {
  const time = r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : null;
  const dayStart = etToUtc(r.scheduled_date, "00:00");
  const reminder24h = time
    ? new Date(etToUtc(r.scheduled_date, time).getTime() - 24 * 3600_000)
    : etToUtc(addDays(r.scheduled_date, -1), "07:00");
  const reminderDay = etToUtc(r.scheduled_date, "06:00");
  const followup = r.followup_count > 0 && r.last_followup_at
    ? etToUtc(addWeekdays(etParts(new Date(r.last_followup_at)).date, 2), "08:00")
    : etToUtc(nextWeekday(r.scheduled_date), "08:00");
  return { dayStart, reminder24h, reminderDay, followup };
}

export function dueActions(r: Any, now: Date): string[] {
  const out: string[] = [];
  if (r.status === "requested") {
    if (!r.request_resent_at && now.getTime() - new Date(r.requested_at).getTime() >= 48 * 3600_000) {
      out.push("request_reminder");
    }
    return out;
  }
  if (!r.scheduled_date || !["scheduled", "awaiting_confirmation"].includes(r.status)) return out;
  const t = scheduleTimes(r);
  if (r.status === "scheduled" && !r.reminder_24h_sent_at && now >= t.reminder24h && now < t.dayStart) {
    out.push("reminder_24h");
  }
  if (r.status === "scheduled" && !r.reminder_day_sent_at && now >= t.reminderDay
      && etParts(now).date === r.scheduled_date) {
    out.push("reminder_day");
  }
  if ((r.followup_count ?? 0) < MAX_FOLLOWUPS && now >= t.followup) out.push("followup");
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
  const body = await res.json();
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${body.error_description || res.status}`);
  graphToken = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return graphToken.value;
}

async function sendMail(m: Mail): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!m.to.length) return { ok: false, error: "no recipients" };
    const provider = (env("EMAIL_PROVIDER") || "graph").toLowerCase();
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
const whenText = (r: Any) => `${fmtDateLong(r.scheduled_date)}${r.scheduled_time ? `, ${fmtTime(r.scheduled_time)}` : ""}`;

function machineRows(c: Any, r: Any): [string, string][] {
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
  const vendor = r.vendor_name || s.vendor_name || "the service vendor";
  const internal = uniq([r.requested_by, ...(s.notify_recipients || [])]);
  const vendorTo = uniq([r.vendor_email || s.vendor_contact_email]);
  const vendorCc = uniq(s.vendor_cc || []).filter((x) => !vendorTo.includes(x));
  // "Hi Mike, ..." when a contact name is set; sentences read correctly either way
  const hello = s.vendor_contact_name ? `Hi ${esc(String(s.vendor_contact_name).trim().split(/\s+/)[0])}, ` : "";
  const lead = (sentence: string, keepCase = false) =>
    hello ? hello + (keepCase ? sentence : sentence[0].toLowerCase() + sentence.slice(1)) : sentence;

  switch (kind) {
    case "request":
    case "request_reminder": {
      const subject = `${kind === "request_reminder" ? "Reminder: " : ""}PM service request: ${c.label}`;
      const m = layout({
        heading: kind === "request_reminder" ? "Reminder: PM service request" : "PM service request",
        intro: lead(`Sunbelt Utilities is requesting a ${esc(c.plan.name || "PM service")} for the machine below. ` +
                    `Please choose the date that works best with your schedule.`, true),
        rows: [
          ...machineRows(c, r),
          ["Preferred date", esc(fmtDateLong(r.preferred_date))],
          ["Notes", esc(r.requested_notes || "")],
          ["Requested by", esc(r.requested_by || "")],
        ],
        button: { label: r.status === "requested" ? "Choose a service date" : "View or change the date", url: portalUrl(r) },
        footer: r.requested_by ? `Questions? Reply to this email to reach ${esc(r.requested_by)}.` : undefined,
      });
      return deliver(db, r, kind, { to: vendorTo, cc: vendorCc, subject, ...m, replyTo: r.requested_by });
    }
    case "scheduled": {
      const subject = `${vendor} scheduled ${c.label} for ${fmtDateLong(r.scheduled_date)}`;
      const m = layout({
        heading: "PM service scheduled",
        intro: `${esc(vendor)} picked a date for this PM service.`,
        rows: [["When", esc(whenText(r))], ["Vendor notes", esc(r.scheduled_notes || "")], ...machineRows(c, r)],
        button: { label: "Open in Fleet", url: appUrl(`/assets/${r.asset_id}`) },
      });
      return deliver(db, r, kind, { to: internal, subject, ...m });
    }
    case "reminder_24h":
    case "reminder_day": {
      const today = etParts(new Date()).date;
      const rel = r.scheduled_date === today ? "Today" : r.scheduled_date === addDays(today, 1) ? "Tomorrow" : fmtDateLong(r.scheduled_date);
      const subject = `${rel}: PM service for ${c.label}`;
      const m = layout({
        heading: `${rel}: PM service`,
        intro: `${esc(vendor)} is scheduled to service this machine ${rel === "Today" || rel === "Tomorrow" ? rel.toLowerCase() : `on ${esc(rel)}`}` +
               `${r.scheduled_time ? ` at ${esc(fmtTime(r.scheduled_time))}` : ""}. Please make sure it's available and accessible.`,
        rows: [["When", esc(whenText(r))], ["Vendor notes", esc(r.scheduled_notes || "")], ...machineRows(c, r),
               ["Request notes", esc(r.requested_notes || "")]],
      });
      return deliver(db, r, kind, { to: uniq(s.reminder_recipients || []), subject, ...m });
    }
    case "followup": {
      const subject = `Please confirm: PM service for ${c.label} on ${fmtDateLong(r.scheduled_date)}`;
      const m = layout({
        heading: "Please confirm the PM service",
        intro: lead(`Our records show this service was scheduled for ${esc(whenText(r))}. Please confirm it was completed ` +
                    `and enter the hour meter reading at the time of service. You can attach the work order too.`),
        rows: machineRows(c, r),
        button: { label: "Confirm the service", url: portalUrl(r) },
        footer: "If the service didn't happen, use the same link to pick a new date.",
      });
      return deliver(db, r, kind, { to: vendorTo, cc: vendorCc, subject, ...m, replyTo: r.requested_by });
    }
    case "completed": {
      const subject = `PM completed: ${c.label} at ${fmtHrs(r.completed_hours)}`;
      const m = layout({
        heading: "PM service completed",
        intro: `${esc(vendor)} confirmed the PM service. The next PM is now due at ${esc(fmtHrs(c.plan.next_due_hours))}.`,
        rows: [["Done on", esc(fmtDateLong(r.completed_on))], ["Hour meter at service", esc(fmtHrs(r.completed_hours))],
               ["Next PM due at", esc(fmtHrs(c.plan.next_due_hours))], ["Notes", esc(r.completed_notes || "")],
               ["Work order", r.work_order_path ? "Attached (open it in Fleet)" : "Not attached"], ["Machine", esc(c.label)]],
        button: { label: "Open in Fleet", url: appUrl(`/assets/${r.asset_id}`) },
      });
      return deliver(db, r, kind, { to: internal, subject, ...m });
    }
    case "cancelled": {
      const subject = `Cancelled: PM service request for ${c.label}`;
      const m = layout({
        heading: "PM service request cancelled",
        intro: lead(`Sunbelt Utilities has cancelled this PM service request${r.scheduled_date ? ` (scheduled for ${esc(whenText(r))})` : ""}. No action is needed.`, true),
        rows: machineRows(c, r),
        footer: r.requested_by ? `Questions? Reply to reach ${esc(r.requested_by)}.` : undefined,
      });
      return deliver(db, r, kind, { to: vendorTo, cc: vendorCc, subject, ...m, replyTo: r.requested_by });
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

async function setSchedule(db: Db, r: Any, date: unknown, time: unknown, notes: unknown) {
  if (!OPEN.includes(r.status)) throw new HttpErr(409, "This request is already closed.");
  if (!validDate(date)) throw new HttpErr(400, "Pick a service date.");
  if ((date as string) < todayEt()) throw new HttpErr(400, "The service date can't be in the past.");
  if (!validTime(time)) throw new HttpErr(400, "Enter the time as HH:MM.");
  const t = time ? `${time}:00` : null;
  const changed = r.scheduled_date !== date || (r.scheduled_time || null) !== t;
  const patch: Any = {
    status: "scheduled", scheduled_date: date, scheduled_time: t,
    scheduled_notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : null,
    scheduled_at: new Date().toISOString(),
  };
  if (changed) Object.assign(patch, { reminder_24h_sent_at: null, reminder_day_sent_at: null, followup_count: 0, last_followup_at: null });
  const { data, error } = await db.from("pm_requests").update(patch).eq("id", r.id).select("*").single();
  if (error) throw new HttpErr(500, error.message);
  const mail = changed ? await notify(db, data, "scheduled") : { ok: true };
  return { request: data, email_ok: mail.ok };
}

async function handle(req: Request, db: Db, body: Any) {
  const action = String(body.action || "");

  // ---------------- cron ----------------
  if (action === "cron") {
    if (req.headers.get("x-fleet-cron-key") !== env("FLEET_CRON_KEY")) throw new HttpErr(401, "unauthorized");
    const { data: open } = await db.from("pm_requests").select("*").in("status", OPEN);
    const { data: s } = await db.from("pm_settings").select("reminder_recipients").eq("id", true).single();
    const noReminderList = !(s?.reminder_recipients || []).length;
    const now = new Date();
    const sent: string[] = [];
    for (const r of open || []) {
      for (const kind of dueActions(r, now)) {
        const isReminder = kind === "reminder_24h" || kind === "reminder_day";
        const res = isReminder && noReminderList ? { ok: false, error: "no reminder recipients set" } : await notify(db, r, kind);
        // Reminders are marked done when sent, or when there's nobody to send them to (logged once)
        const settle = res.ok || (isReminder && noReminderList);
        if (isReminder && noReminderList) {
          await db.from("pm_email_log").insert({ request_id: r.id, kind, ok: false, error: res.error });
        }
        if (!settle) continue;
        const stamp = now.toISOString();
        const patch: Any =
          kind === "reminder_24h" ? { reminder_24h_sent_at: stamp }
          : kind === "reminder_day" ? { reminder_day_sent_at: stamp }
          : kind === "request_reminder" ? { request_resent_at: stamp }
          : { followup_count: (r.followup_count ?? 0) + 1, last_followup_at: stamp, status: "awaiting_confirmation" };
        await db.from("pm_requests").update(patch).eq("id", r.id);
        Object.assign(r, patch);
        sent.push(`${kind}:${r.id}`);
      }
    }
    return { checked: open?.length ?? 0, sent };
  }

  // ---------------- vendor link ----------------
  if (action === "portal_get") {
    const r = await byToken(db, body.token);
    const c = await loadContext(db, r);
    return {
      status: r.status, today: todayEt(),
      vendor_name: r.vendor_name || c.settings.vendor_name,
      machine: { asset_number: c.asset.asset_number, make: c.asset.make, model: c.asset.model,
                 serial_number: c.asset.serial_number, hour_meter: c.asset.hour_meter },
      plan: { name: c.plan.name, interval_hours: c.plan.interval_hours, next_due_hours: c.plan.next_due_hours,
              last_service_hours: c.plan.last_service_hours },
      location: { jobsite: c.jobsite, address: c.address, map_url: c.mapUrl },
      requested_by: r.requested_by, requested_notes: r.requested_notes, preferred_date: r.preferred_date,
      scheduled_date: r.scheduled_date, scheduled_time: r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : null,
      scheduled_notes: r.scheduled_notes, completed_on: r.completed_on, completed_hours: r.completed_hours,
    };
  }

  if (action === "portal_schedule") {
    const r = await byToken(db, body.token);
    const res = await setSchedule(db, r, body.date, body.time, body.notes);
    return { status: res.request.status, scheduled_date: res.request.scheduled_date };
  }

  if (action === "portal_upload_url") {
    const r = await byToken(db, body.token);
    if (!OPEN.includes(r.status)) throw new HttpErr(409, "This request is already closed.");
    const name = String(body.filename || "work-order").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    if (!/\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(name)) throw new HttpErr(400, "Attach a PDF or a photo (JPG, PNG, HEIC).");
    const path = `${r.id}/${Date.now()}-${name}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new HttpErr(500, error.message);
    return { path, upload_token: data.token };
  }

  if (action === "portal_complete") {
    const r = await byToken(db, body.token);
    if (!OPEN.includes(r.status)) throw new HttpErr(409, "This service has already been confirmed.");
    if (body.completed === false) {
      const res = await setSchedule(db, r, body.new_date, body.new_time, body.notes);
      return { status: res.request.status, scheduled_date: res.request.scheduled_date };
    }
    if (!validDate(body.performed_on)) throw new HttpErr(400, "Enter the date the service was done.");
    if (body.performed_on > todayEt()) throw new HttpErr(400, "The service date can't be in the future.");
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) throw new HttpErr(400, "Enter the hour meter reading at the time of service.");
    const c = await loadContext(db, r);
    if (c.plan.last_service_hours != null && hours < Number(c.plan.last_service_hours)) {
      throw new HttpErr(400, `That's lower than the last PM (${fmtHrs(c.plan.last_service_hours)}). Please check the reading.`);
    }
    if (c.asset.telematics_asset_id && c.asset.hour_meter != null && hours > Number(c.asset.hour_meter) + 50) {
      throw new HttpErr(400, `That's higher than the machine's current meter (${fmtHrs(c.asset.hour_meter)}). Please check the reading.`);
    }
    const wo = typeof body.work_order_path === "string" && body.work_order_path ? body.work_order_path : null;
    if (wo && !wo.startsWith(`${r.id}/`)) throw new HttpErr(400, "Invalid attachment.");
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    const vendor = r.vendor_name || c.settings.vendor_name;

    const { error: svcErr } = await db.from("maintenance_services").insert({
      plan_id: r.plan_id, asset_id: r.asset_id, performed_on: body.performed_on, hours,
      performed_by: vendor, notes, attachment_path: wo, request_id: r.id,
    });
    if (svcErr) throw new HttpErr(500, svcErr.message);
    const { data: done, error } = await db.from("pm_requests").update({
      status: "completed", completed_on: body.performed_on, completed_hours: hours, completed_notes: notes,
      work_order_path: wo, completed_at: new Date().toISOString(),
    }).eq("id", r.id).select("*").single();
    if (error) throw new HttpErr(500, error.message);
    await notify(db, done, "completed");
    const { data: plan } = await db.from("maintenance_plans").select("next_due_hours").eq("id", r.plan_id).single();
    return { status: "completed", next_due_hours: plan?.next_due_hours ?? null };
  }

  // ---------------- staff ----------------
  const user = await staffUser(req, db);
  if (!user) throw new HttpErr(401, "Sign in to Fleet to do this.");

  if (action === "test_email") {
    const m = layout({
      heading: "Fleet email test",
      intro: "If you can read this, PM workflow emails are set up correctly.",
      rows: [["Provider", esc((env("EMAIL_PROVIDER") || "graph").toLowerCase())], ["Sent to", esc(user.email)]],
    });
    const res = await sendMail({ to: uniq([user.email]), subject: "Fleet email test", ...m });
    return { email_ok: res.ok, email_error: res.error ?? null };
  }

  if (action === "request") {
    const { data: plan } = await db.from("maintenance_plans").select("id, asset_id, active").eq("id", body.plan_id).maybeSingle();
    if (!plan) throw new HttpErr(404, "Maintenance plan not found.");
    const { data: s } = await db.from("pm_settings").select("*").eq("id", true).single();
    if (!s?.vendor_contact_email) throw new HttpErr(400, "Add the vendor contact's email on the PM workflow settings page first.");
    if (body.preferred_date && !validDate(body.preferred_date)) throw new HttpErr(400, "Preferred date isn't valid.");
    const { data: r, error } = await db.from("pm_requests").insert({
      plan_id: plan.id, asset_id: plan.asset_id, vendor_name: s.vendor_name, vendor_email: s.vendor_contact_email,
      requested_by: user.email, requested_notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null,
      preferred_date: body.preferred_date || null,
    }).select("*").single();
    if (error) {
      if (error.code === "23505") throw new HttpErr(409, "This machine already has an open service request.");
      throw new HttpErr(500, error.message);
    }
    const mail = await notify(db, r, "request");
    return { request_id: r.id, email_ok: mail.ok, email_error: mail.error ?? null };
  }

  if (action === "resend") {
    const { data: r } = await db.from("pm_requests").select("*").eq("id", body.request_id).maybeSingle();
    if (!r || !OPEN.includes(r.status)) throw new HttpErr(404, "No open request to resend.");
    const mail = await notify(db, r, r.status === "awaiting_confirmation" ? "followup" : "request");
    return { email_ok: mail.ok, email_error: mail.error ?? null };
  }

  if (action === "cancel") {
    const { data: r } = await db.from("pm_requests").select("*").eq("id", body.request_id).maybeSingle();
    if (!r || !OPEN.includes(r.status)) throw new HttpErr(404, "No open request to cancel.");
    const { data: c } = await db.from("pm_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", r.id).select("*").single();
    const mail = await notify(db, c, "cancelled");
    return { status: "cancelled", email_ok: mail.ok };
  }

  throw new HttpErr(400, `Unknown action "${action}".`);
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
