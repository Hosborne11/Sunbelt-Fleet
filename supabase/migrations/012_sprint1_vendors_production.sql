-- =====================================================================
-- 012 · Sprint 1 (app)
--   A. PM vendors: several service vendors, each with its own contacts; every machine is
--      assigned to one (the default vendor unless set). Requests and all follow-up emails go
--      to the machine's vendor. Seeded: James River Equipment (default, from the existing
--      settings) and National Equipment Dealers (Bell trucks).
--   B. Truck production: daily loads + US tons on asset_daily_usage and the crew rollup, and
--      public.pbi_daily_usage for Power BI.
--   (Rolling 3-year history is enforced by the telematics backend's nightly retention job.)
-- Run after 011. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. PM vendors
-- ---------------------------------------------------------------------
create table if not exists public.pm_vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_name  text,
  contact_email text,
  cc            text[] not null default '{}',
  is_default    boolean not null default false,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists pm_vendors_one_default on public.pm_vendors (is_default) where is_default;
drop trigger if exists trg_pm_vendors_updated on public.pm_vendors;
create trigger trg_pm_vendors_updated before update on public.pm_vendors
  for each row execute function public.set_updated_at();

-- the default vendor can't be deleted (make another one the default first)
create or replace function public.pm_vendors_guard_delete() returns trigger
language plpgsql as $$
begin
  if old.is_default then
    raise exception 'Make another vendor the default before deleting %.', old.name;
  end if;
  return old;
end $$;
drop trigger if exists trg_pm_vendors_guard_delete on public.pm_vendors;
create trigger trg_pm_vendors_guard_delete before delete on public.pm_vendors
  for each row execute function public.pm_vendors_guard_delete();

-- Switch the default vendor (the one new or unassigned machines use). Machines keep the vendor they
-- have now: ones on the old default are pinned to it, ones already on the new default follow it.
create or replace function public.set_default_pm_vendor(p_vendor uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare old_default uuid;
begin
  if not exists (select 1 from public.pm_vendors where id = p_vendor) then
    raise exception 'Vendor not found';
  end if;
  select id into old_default from public.pm_vendors where is_default;
  if old_default = p_vendor then return; end if;
  if old_default is not null then
    update public.assets set pm_vendor_id = old_default where pm_vendor_id is null;
  end if;
  update public.assets set pm_vendor_id = null where pm_vendor_id = p_vendor;
  update public.pm_vendors set is_default = false where is_default;
  update public.pm_vendors set is_default = true, active = true where id = p_vendor;
end $$;

alter table public.assets      add column if not exists pm_vendor_id uuid references public.pm_vendors(id) on delete set null;
alter table public.pm_requests add column if not exists vendor_id    uuid references public.pm_vendors(id) on delete set null;
create index if not exists assets_pm_vendor_idx on public.assets (pm_vendor_id);

-- seed: the current dealer becomes the default vendor; National Equipment Dealers for the Bell trucks
insert into public.pm_vendors (name, contact_name, contact_email, cc, is_default, sort_order)
select coalesce(nullif(trim(s.vendor_name), ''), 'James River Equipment'), s.vendor_contact_name,
       s.vendor_contact_email, coalesce(s.vendor_cc, '{}'), true, 1
  from public.pm_settings s
 where s.id and not exists (select 1 from public.pm_vendors where is_default)
on conflict (name) do nothing;
insert into public.pm_vendors (name, sort_order) values ('National Equipment Dealers', 2)
on conflict (name) do nothing;

update public.assets a set pm_vendor_id = v.id
  from public.pm_vendors v
 where v.name = 'National Equipment Dealers'
   and a.pm_vendor_id is null and a.status <> 'retired'
   and (a.make ilike 'bell%' or a.model ilike 'B30%' or a.serial_number ilike 'B93A%');

-- existing requests: tie to their vendor by name
update public.pm_requests r set vendor_id = v.id
  from public.pm_vendors v
 where r.vendor_id is null and lower(v.name) = lower(r.vendor_name);

-- each machine's vendor (its own, else the default)
create or replace view public.asset_pm_vendor with (security_invoker = true) as
select a.id as asset_id, v.id as vendor_id, v.name as vendor_name, v.contact_email,
       (a.pm_vendor_id is null) as uses_default
  from public.assets a
  left join public.pm_vendors v
    on v.id = coalesce(a.pm_vendor_id, (select d.id from public.pm_vendors d where d.is_default limit 1));

alter table public.pm_vendors enable row level security;
drop policy if exists staff_all on public.pm_vendors;
create policy staff_all on public.pm_vendors for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.pm_vendors to authenticated;
grant select on public.asset_pm_vendor to authenticated;
grant execute on function public.set_default_pm_vendor(uuid) to authenticated;
revoke all on public.pm_vendors, public.asset_pm_vendor from anon;

-- ---------------------------------------------------------------------
-- B. Truck production (loads + tons)
-- ---------------------------------------------------------------------
-- same columns as before, with tons and job number added at the end
create or replace view public.asset_daily_usage with (security_invoker = true) as
select a.id as asset_id, m.reading_date, m.closing_hours, m.hours_used, m.idle_hours_used, m.idle_pct,
       m.fuel_used, m.fuel_units, m.fuel_used_gal, m.loads,
       m.project_id, m.project_name,
       a.crew_id, c.name as crew_name,
       a.tm_rate,
       m.payload_tons, m.job_number
  from public.assets a
  join fleet.v_daily_metrics m on m.asset_id = a.telematics_asset_id
  left join public.crews c on c.id = a.crew_id
 where a.retired_on is null or m.reading_date <= a.retired_on;

create or replace view public.daily_hours_by_crew with (security_invoker = true) as
select u.reading_date,
       coalesce(u.crew_name, 'Unassigned') as crew,
       u.project_id, coalesce(u.project_name, 'No jobsite') as jobsite,
       count(distinct u.asset_id)          as machines,
       round(sum(u.hours_used), 1)         as machine_hours,
       round(sum(u.idle_hours_used), 1)    as idle_hours,
       round(sum(u.fuel_used_gal), 1)      as fuel_gal,
       round(sum(u.hours_used * u.tm_rate), 2) as tm_amount,
       sum(u.loads)                        as loads,
       round(sum(u.payload_tons), 1)       as tons
  from public.asset_daily_usage u
 group by 1, 2, 3, 4;
grant select on public.asset_daily_usage, public.daily_hours_by_crew to authenticated;

-- Power BI: one row per machine per day (rolling 3 years), including truck loads and tons
create or replace view public.pbi_daily_usage as
select u.reading_date,
       a.asset_number,
       a.serial_number,
       concat_ws(' ', a.make, a.model)                     as machine,
       cat.name                                             as category,
       u.crew_name                                          as crew,
       u.project_name                                       as jobsite,
       u.job_number,
       u.closing_hours                                      as hour_meter,
       u.hours_used,
       u.idle_hours_used,
       u.fuel_used_gal,
       u.loads,
       u.payload_tons                                       as tons,
       case when u.loads > 0 then round(u.payload_tons / u.loads, 2) end as tons_per_load,
       a.tm_rate,
       round(u.hours_used * a.tm_rate, 2)                   as tm_amount,
       a.status
  from public.asset_daily_usage u
  join public.assets a on a.id = u.asset_id
  left join public.equipment_categories cat on cat.id = a.category_id;
revoke all on public.pbi_daily_usage from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    execute 'grant select on public.pbi_daily_usage to powerbi_reader';
  end if;
end $$;
