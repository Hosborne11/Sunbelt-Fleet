-- Sunbelt Fleet — core asset registry schema
-- Run this in the Supabase SQL editor for a new project.

create extension if not exists "pgcrypto";

-- Jobsites / properties assets can be assigned to
create table if not exists jobsites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude numeric,
  longitude numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Equipment categories (excavator, dozer, skid steer, truck, trailer, etc.)
create table if not exists equipment_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text not null default 'truck',   -- lucide-react icon name
  sort_order int not null default 0
);

-- Core machine / asset registry
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  asset_number text not null,           -- internal fleet number, e.g. "001" or "008 - 325G"
  category_id uuid references equipment_categories(id) on delete set null,
  make text,
  model text,
  year int,
  serial_number text,
  jobsite_id uuid references jobsites(id) on delete set null,
  status text not null default 'active' check (status in ('active','down','maintenance','retired')),
  hour_meter numeric,
  odometer numeric,
  purchase_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assets_jobsite_idx on assets(jobsite_id);
create index if not exists assets_category_idx on assets(category_id);
create unique index if not exists assets_asset_number_key on assets(asset_number);

-- keep updated_at current
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists assets_set_updated_at on assets;
create trigger assets_set_updated_at
  before update on assets
  for each row execute function set_updated_at();

-- Starter categories matching common Sunbelt fleet types
insert into equipment_categories (name, icon, sort_order) values
  ('Excavator', 'construction', 1),
  ('Dozer', 'truck', 2),
  ('Skid Steer', 'truck', 3),
  ('Compactor', 'circle-dot', 4),
  ('Dump Truck', 'truck', 5),
  ('Trailer', 'container', 6),
  ('Attachment', 'wrench', 7)
on conflict (name) do nothing;

-- Row Level Security — open for now (internal tool behind Vercel auth/allowlist).
-- Tighten this once logins are added.
alter table jobsites enable row level security;
alter table equipment_categories enable row level security;
alter table assets enable row level security;

create policy "internal read/write - jobsites" on jobsites for all using (true) with check (true);
create policy "internal read/write - categories" on equipment_categories for all using (true) with check (true);
create policy "internal read/write - assets" on assets for all using (true) with check (true);

-- Future modules (work orders, alerts, inspections, rentals, leases) will each
-- get their own table referencing assets(id) — not created in this v1 pass.
