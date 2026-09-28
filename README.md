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

## What's in the app

- **Assets** (`/`): registry table with a live "Last report" column, and a Map tab showing jobsite
  geofences plus every linked machine's current position.
- **Asset detail** (`/assets/:id`): telematics panel (current jobsite, hours today / 7 days, idle,
  fuel, DEF, open fault codes, recent trail map, daily usage), plus work orders, alerts, inspections,
  maintenance plans (due by hours now uses the live hour meter), rentals, leases, downtime, hour history.
- **Jobsites**: list plus a satellite map. Find the job by address, draw its boundary (or drop a
  pin with a radius), and see which machines are inside it right now. Saving re-credits past
  machine hours to the new boundary within 5 minutes.
- Work Orders, Alerts, Inspections, Maintenance Plans, Reservations, Rentals, Leases, Reports, Contacts.
