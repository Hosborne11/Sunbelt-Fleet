# Sunbelt Fleet

Internal machine/asset registry for Sunbelt Utilities Corp, connected to live telematics
(John Deere Operations Center and Hitachi Global e-Service) running in the same Supabase project.

Stack: React + Vite + Tailwind + Supabase (Postgres + Auth), deployed on Vercel.

## How the pieces fit

- **`public` schema**: this app's tables: assets, jobsites, categories, work orders, alerts,
  inspections, maintenance plans, reservations, rentals, leases, contacts, downtime, hour readings.
- **`fleet` schema**: the telematics backend (Edge Functions + cron) that pulls Deere and Hitachi data.
- **The link**: a registry asset links to a telematics unit when the **serial numbers match**,
  either the full 17-character PIN or just the last digits (e.g. `712264`).
- **Jobsites are the geofences**: every jobsite with coordinates plus a radius becomes a geofence.
  Machines reporting inside it are assigned to that jobsite, and their daily hours are credited to it.
- **Hourly sync** (`fleet-registry-sync`, :05 and :35): updates each linked machine's hour meter,
  logs daily hour-meter readings, sets the jobsite from its position, and turns machine fault codes
  into Alerts (source = telematics). Resolving one of those alerts acknowledges the fault.

## 1. Database (Supabase SQL editor, in this order)

1. `supabase/schema.sql`
2. `supabase/migrations/002_add_jobsite_coordinates.sql`
3. `supabase/migrations/003_app_tables.sql`: every module table, locked to signed-in users
4. `supabase/migrations/004_telematics_link.sql`: serial linking, geofences, sync, views
5. `supabase/migrations/005_jobsite_geofences.sql`: drawn boundaries, job numbers, save fix
6. `supabase/migrations/006_hours_yesterday.sql`: today / yesterday / 7-day machine hours
7. `supabase/migrations/007_pm_plans.sql`: default 500-hour PM plans, PM service log, scheduling
8. `supabase/migrations/008_crews_pm_workflow.sql`: Pipe/Site crews, PM requests with the vendor, work order storage
9. `supabase/migrations/009_retirement_files_pm_v2.sql`: retiring machines (history kept), machine files, dealer-proposes workflow

Then fill the registry:

```sql
-- If the registry is empty: create an asset for every telematics unit
select public.seed_assets_from_telematics();

-- If assets were entered by hand: link them by serial number instead
select public.link_telematics();

-- Load hour meters + the full daily hour history into the registry (once)
select public.sync_telematics_to_registry(5000);

-- Anything that still isn't linked
select * from public.unlinked_telematics;
```

## 2. Sign-in (Supabase Auth)

The app requires a signed-in user; the anon key alone can't read any data.

1. **Authentication → Sign In / Providers**: leave **Email** on; turn **off** "Allow new users to sign up".
2. **Authentication → URL Configuration**: set **Site URL** to the Vercel URL, and add
   `http://localhost:5173` and the Vercel URL under **Redirect URLs**.
3. **Authentication → Users → Invite user** for each person who should have access.
   They sign in with a one-time email link.

## 3. Local setup

```bash
npm install
cp .env.example .env.local   # paste the anon (publishable) key from Project Settings -> API Keys
npm run dev
```

## 4. Deploy to Vercel

1. Push this repo to GitHub, then in Vercel: New Project, then import the repo.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Project Settings → Environment Variables.
3. Deploy (`npm run build` → `dist`, no extra config).

## PM workflow with the dealer (James River Equipment)

1. **Request**: in a PM plan, *Request service from James River Equipment*. The dealer gets an email
   with a link (no login) to **propose** a date and optional start time.
2. **Accept**: app users get an email; open the plan in Fleet and *Accept date* or *Ask for another date*.
   Accepting emails the dealer a confirmation and puts the date on the plan.
3. **24 hours before** (7:00 AM the day before if no time): the dealer is asked to confirm it's still on
   (or propose a new date), and the foreman distro gets a notice. Optional 6:00 AM morning-of reminder.
4. **Date changes**: any new date from the dealer goes back to *Accept date?* and notifies foremen and
   app users; the same steps repeat for the new date.
5. **24 hours after**: the dealer confirms the date done and hour meter, and **must attach the work order**.
   Repeats every 2 weekdays, up to 3 times, until answered.
6. **Completed**: the next PM moves to that hour meter + 500; the work order is saved to the machine's
   **Files**. Logging a service by hand also closes the request.

Set it up:

1. Run `008_crews_pm_workflow.sql`.
2. Deploy `supabase/functions/pm-workflow/index.ts` as a function named **pm-workflow**, with JWT
   verification **off**.
3. Edge Function secrets:
   - `APP_BASE_URL` = the app's public URL (e.g. `https://sunbelt-fleet.vercel.app`). Vendor links use it,
     so that URL must open without a Vercel login (the app's own sign-in protects everything else).
   - Email through **Microsoft 365** (`EMAIL_PROVIDER=graph`): `MS_TENANT_ID`, `MS_CLIENT_ID`,
     `MS_CLIENT_SECRET`, `MS_SENDER` (e.g. a shared mailbox `fleet@sunbeltutilities.com`). The Entra app
     registration needs the Microsoft Graph **Mail.Send** application permission with admin consent.
   - or **Resend** (`EMAIL_PROVIDER=resend`): `RESEND_API_KEY`, `EMAIL_FROM`.
4. In the app: **Setup → PM Workflow**: vendor contact, foreman distro, then *Send me a test email*.

## What's in the app

- **Assets** (`/`): split screen. The table (sortable; machine hours today, yesterday, and last
  7 days with totals) sits beside a live map of every linked machine and jobsite geofence. Click a
  row to find the machine on the map, or a machine to find its row. Drag the divider to resize.
- **Asset detail** (`/assets/:id`): telematics panel (current jobsite, hours today / 7 days, idle,
  fuel, DEF, open fault codes, recent trail map, daily usage), plus work orders, alerts, inspections,
  maintenance plans (due by hours now uses the live hour meter), rentals, leases, downtime, hour history.
- **Retiring a machine**: set Status to *retired* in the asset form (retired date, how it left the fleet,
  sale/trade value, replacement). History through that date is kept; live tracking and PM reminders stop,
  and the replacement can reuse the asset #. Deleting an asset removes its history, so retire instead.
- **Files**: every machine has a Files section (documents, invoices, photos, work orders).
- **Crews**: every asset can be designated Pipe or Site crew (asset form, Assets table filter).
  `daily_hours_by_crew` rolls machine hours up by day, crew and jobsite for job costing.
- **Jobsites**: list plus a satellite map. Find the job by address, draw its boundary (or drop a
  pin with a radius), and see which machines are inside it right now. Saving re-credits past
  machine hours to the new boundary within 5 minutes.
- **Preventive maintenance**: every asset gets a default 500-hour PM plan (new assets too). Until
  the last PM is entered, the next due point is the next 500-hour mark. PMs within 75 hours (or
  overdue) are flagged "Schedule" on the Assets table until a date is booked in the plan. Logging a
  completed service sets the next PM to that reading + 500 and clears the booking.
- Work Orders, Alerts, Inspections, Maintenance Plans, Reservations, Rentals, Leases, Reports, Contacts.
