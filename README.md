# Sunbelt Fleet

Internal machine/asset registry for Sunbelt Utilities Corp — v1 of a GoAardvark-style
tool. This pass builds the core data model: **Assets**, **Jobsites**, and
**Equipment Categories**. The sidebar has placeholders for Work Orders, Alerts,
Inspections, Rentals, Leases, and Reports so those modules can slot in later
against the same asset table.

Stack: React + Vite + Tailwind + Supabase (Postgres), deployed on Vercel —
same as your other internal tools.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's up, open the **SQL Editor** and run everything in
   `supabase/schema.sql`. That creates the `assets`, `jobsites`, and
   `equipment_categories` tables and seeds a starter category list.
3. Go to Project Settings → API and copy the **Project URL** and
   **anon public key**.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
# paste your Supabase URL + anon key into .env.local
npm run dev
```

## 3. Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: New Project → import the repo.
3. Add the two environment variables from `.env.local`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under Project Settings →
   Environment Variables.
4. Deploy. Vite's default build command/output (`npm run build` → `dist`)
   works with no extra config.

## What's in this pass

- **Assets page** (`/`) — the registry table: category icon, asset #, make,
  model, serial #, jobsite, status, hour meter. Filter by jobsite, category,
  status, or free-text search. Click a row to edit; "Add asset" opens the
  same form empty.
- **Jobsites** (`/jobsites`) and **Categories** (`/categories`) — simple
  management lists so you're not stuck editing rows directly in the
  Supabase dashboard.
- `supabase/schema.sql` — the full table definitions, indexes, and starter
  category seed data. Comments at the bottom note that Work Orders, Alerts,
  Inspections, Rentals, and Leases will each get their own table referencing
  `assets(id)` when those modules get built.

## Notes on scope

Row-level security is enabled but currently open (`using (true)`) since
there's no login yet — it's meant to be tightened once you add
authentication (Supabase Auth works well if you want per-user logins later).
