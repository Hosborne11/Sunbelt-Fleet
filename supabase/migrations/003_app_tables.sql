-- =====================================================================
-- Sunbelt Fleet GUI — all app tables (run AFTER schema.sql and 002)
-- Rebuilt from what the front end reads and writes. Safe to re-run.
-- Access: logged-in users only (Supabase Auth). The anon key alone can't read anything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Assets: columns the asset form uses beyond schema.sql
-- ---------------------------------------------------------------------
alter table public.assets add column if not exists purchase_price      numeric;
alter table public.assets add column if not exists salvage_value       numeric;
alter table public.assets add column if not exists useful_life_years   int;
alter table public.assets add column if not exists warranty_expiration date;

-- ---------------------------------------------------------------------
-- Jobsites: geofence radius (used by telematics to decide which job a machine is on)
-- ---------------------------------------------------------------------
alter table public.jobsites add column if not exists radius_m int not null default 400;

-- ---------------------------------------------------------------------
-- Module tables
-- ---------------------------------------------------------------------
create table if not exists public.work_orders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  type        text not null default 'maintenance' check (type in ('maintenance','repair')),
  status      text not null default 'open'        check (status in ('open','in_progress','closed')),
  priority    text not null default 'normal'      check (priority in ('low','normal','high')),
  asset_id    uuid references public.assets(id) on delete set null,
  assigned_to text,
  due_date    date,
  cost        numeric,
  notes       text,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  message      text not null,
  asset_id     uuid references public.assets(id) on delete set null,
  severity     text not null default 'medium' check (severity in ('low','medium','high')),
  status       text not null default 'open'   check (status in ('open','acknowledged','resolved')),
  source       text not null default 'manual',          -- 'manual' | 'telematics'
  external_key text unique,                              -- dedupe key for machine-generated alerts
  notes        text,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid references public.assets(id) on delete set null,
  inspection_type text not null default 'daily' check (inspection_type in ('daily','periodic','dot','safety')),
  result          text not null default 'pass'  check (result in ('pass','fail','needs_attention')),
  inspector       text,
  inspected_at    date not null default current_date,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.maintenance_plans (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references public.assets(id) on delete cascade,
  name               text not null,
  interval_hours     numeric,
  interval_days      int,
  last_service_hours numeric,
  last_service_date  date,
  active             boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now()
);

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid references public.assets(id) on delete set null,
  category_id uuid references public.equipment_categories(id) on delete set null,
  from_date   date not null default current_date,
  to_date     date,
  location    text,
  requester   text,
  status      text not null default 'confirmed' check (status in ('pending','confirmed','cancelled')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.rentals (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid references public.assets(id) on delete set null,
  renter      text not null,
  rate        numeric,
  rate_period text not null default 'daily' check (rate_period in ('daily','weekly','monthly')),
  start_date  date not null default current_date,
  end_date    date,
  status      text not null default 'active' check (status in ('active','returned')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.leases (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid references public.assets(id) on delete set null,
  lessee       text not null,
  monthly_rate numeric,
  start_date   date not null default current_date,
  end_date     date,
  status       text not null default 'active' check (status in ('active','expired','terminated')),
  notes        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.contacts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  preferred_method text,
  work_email       text,
  work_cell        text,
  work_phone       text,
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.downtime_events (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references public.assets(id) on delete cascade,
  reason     text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hour_meter_readings (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.assets(id) on delete cascade,
  hours        numeric not null,
  reading_date date not null default current_date,
  source       text not null default 'manual',   -- 'manual' | 'telematics'
  created_at   timestamptz not null default now()
);
-- one telematics reading per machine per day
create unique index if not exists hour_meter_readings_telematics_uq
  on public.hour_meter_readings (asset_id, reading_date) where source = 'telematics';

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists work_orders_asset_idx       on public.work_orders (asset_id);
create index if not exists alerts_asset_idx            on public.alerts (asset_id, created_at desc);
create index if not exists inspections_asset_idx       on public.inspections (asset_id, inspected_at desc);
create index if not exists maintenance_plans_asset_idx on public.maintenance_plans (asset_id);
create index if not exists reservations_asset_idx      on public.reservations (asset_id);
create index if not exists rentals_asset_idx           on public.rentals (asset_id);
create index if not exists leases_asset_idx            on public.leases (asset_id);
create index if not exists downtime_asset_idx          on public.downtime_events (asset_id, started_at desc);
create index if not exists hour_readings_asset_idx     on public.hour_meter_readings (asset_id, reading_date desc);

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at before update on public.work_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Security: logged-in users read/write; anonymous visitors get nothing
-- ---------------------------------------------------------------------
drop policy if exists "internal read/write - jobsites"   on public.jobsites;
drop policy if exists "internal read/write - categories" on public.equipment_categories;
drop policy if exists "internal read/write - assets"     on public.assets;

do $$
declare t text;
begin
  foreach t in array array['jobsites','equipment_categories','assets','work_orders','alerts','inspections',
                           'maintenance_plans','reservations','rentals','leases','contacts',
                           'downtime_events','hour_meter_readings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
