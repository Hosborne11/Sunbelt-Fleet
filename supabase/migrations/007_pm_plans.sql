-- =====================================================================
-- 007: 500-hour preventive maintenance (PM)
--  * every asset gets a default "500-hour PM" plan (existing assets now, new assets automatically)
--  * next_due_hours is stored, so a missed PM shows as overdue instead of silently rolling forward
--      - no service recorded yet  -> next 500-hour mark above the current hour meter (assumed)
--      - service recorded         -> service hours + 500
--  * maintenance_services logs every completed PM; logging one updates the plan and clears its schedule
--  * scheduled_for / scheduled_note hold the date a PM is booked
--  * due soon = within 75 hours
-- =====================================================================

alter table public.maintenance_plans add column if not exists is_default     boolean not null default false;
alter table public.maintenance_plans add column if not exists next_due_hours numeric;
alter table public.maintenance_plans add column if not exists scheduled_for  date;
alter table public.maintenance_plans add column if not exists scheduled_note text;
create unique index if not exists maintenance_plans_one_default
  on public.maintenance_plans (asset_id) where is_default;

-- ---------------------------------------------------------------------
-- Completed service log
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_services (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.maintenance_plans(id) on delete cascade,
  asset_id      uuid not null references public.assets(id) on delete cascade,
  performed_on  date not null default current_date,
  hours         numeric,
  performed_by  text,
  cost          numeric,
  work_order_id uuid references public.work_orders(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists maintenance_services_plan_idx  on public.maintenance_services (plan_id, performed_on desc);
create index if not exists maintenance_services_asset_idx on public.maintenance_services (asset_id, performed_on desc);

alter table public.maintenance_services enable row level security;
drop policy if exists staff_all on public.maintenance_services;
create policy staff_all on public.maintenance_services for all to authenticated using (true) with check (true);
revoke all on public.maintenance_services from anon;
grant select, insert, update, delete on public.maintenance_services to authenticated;

-- ---------------------------------------------------------------------
-- Next-due math lives in the database
-- ---------------------------------------------------------------------
create or replace function public.pm_next_mark(p_hours numeric, p_interval numeric) returns numeric
language sql immutable as $$
  select case when p_hours is null or coalesce(p_interval, 0) <= 0 then null
              else floor(p_hours / p_interval) * p_interval + p_interval end
$$;

create or replace function public.maintenance_plans_calc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.interval_hours is null or new.interval_hours <= 0 then
    return new;
  end if;
  if new.last_service_hours is not null
     and (tg_op = 'INSERT'
          or new.last_service_hours is distinct from old.last_service_hours
          or new.interval_hours     is distinct from old.interval_hours) then
    new.next_due_hours := new.last_service_hours + new.interval_hours;
  elsif new.next_due_hours is null then
    new.next_due_hours := public.pm_next_mark(
      (select hour_meter from public.assets where id = new.asset_id), new.interval_hours);
  end if;
  return new;
end $$;
drop trigger if exists maintenance_plans_calc on public.maintenance_plans;
create trigger maintenance_plans_calc before insert or update on public.maintenance_plans
  for each row execute function public.maintenance_plans_calc();

-- Logging / editing / removing a service keeps the plan's "last service" in step
create or replace function public.maintenance_services_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.plan_id, old.plan_id);
declare latest record;
begin
  select performed_on, hours into latest
    from public.maintenance_services
   where plan_id = pid
   order by hours desc nulls last, performed_on desc
   limit 1;

  if found then
    update public.maintenance_plans
       set last_service_hours = coalesce(latest.hours, last_service_hours),
           last_service_date  = latest.performed_on,
           scheduled_for      = case when tg_op = 'INSERT' then null else scheduled_for end,
           scheduled_note     = case when tg_op = 'INSERT' then null else scheduled_note end
     where id = pid;
  end if;
  return null;
end $$;
drop trigger if exists maintenance_services_sync on public.maintenance_services;
create trigger maintenance_services_sync after insert or update or delete on public.maintenance_services
  for each row execute function public.maintenance_services_sync();

-- ---------------------------------------------------------------------
-- Every asset gets a default 500-hour PM plan
-- ---------------------------------------------------------------------
create or replace function public.assets_default_pm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.maintenance_plans (asset_id, name, interval_hours, is_default, active)
  values (new.id, '500-hour PM', 500, true, true)
  on conflict (asset_id) where is_default do nothing;
  return null;
end $$;
drop trigger if exists assets_default_pm on public.assets;
create trigger assets_default_pm after insert on public.assets
  for each row execute function public.assets_default_pm();

-- Fill the assumed next-due mark once an hour meter first appears
create or replace function public.assets_pm_baseline() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hour_meter is not null and old.hour_meter is null then
    update public.maintenance_plans
       set next_due_hours = public.pm_next_mark(new.hour_meter, interval_hours)
     where asset_id = new.id and next_due_hours is null and last_service_hours is null
       and interval_hours > 0;
  end if;
  return null;
end $$;
drop trigger if exists assets_pm_baseline on public.assets;
create trigger assets_pm_baseline after update of hour_meter on public.assets
  for each row execute function public.assets_pm_baseline();

-- Existing assets: add the default plan (skip any asset that already has an active 500-hour plan)
insert into public.maintenance_plans (asset_id, name, interval_hours, is_default, active)
select a.id, '500-hour PM', 500, true, true
  from public.assets a
 where not exists (
   select 1 from public.maintenance_plans p
    where p.asset_id = a.id and (p.is_default or (p.active and p.interval_hours = 500)));

-- Existing hour-based plans: fill next_due_hours
update public.maintenance_plans p
   set next_due_hours = coalesce(p.last_service_hours + p.interval_hours,
                                 public.pm_next_mark(a.hour_meter, p.interval_hours))
  from public.assets a
 where a.id = p.asset_id and p.next_due_hours is null and p.interval_hours > 0;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create or replace view public.pm_status with (security_invoker = true) as
select p.id as plan_id, p.asset_id, p.name, p.is_default, p.interval_hours,
       p.last_service_hours, p.last_service_date,
       (p.last_service_hours is null) as last_service_assumed,
       p.next_due_hours, a.hour_meter,
       round(p.next_due_hours - a.hour_meter, 1) as hours_until_due,
       p.scheduled_for, p.scheduled_note,
       case
         when p.next_due_hours is null or a.hour_meter is null then 'unknown'
         when p.next_due_hours - a.hour_meter <= 0  then 'overdue'
         when p.next_due_hours - a.hour_meter <= 75 then 'due_soon'
         else 'ok'
       end as status
  from public.maintenance_plans p
  join public.assets a on a.id = p.asset_id
 where p.active and p.interval_hours > 0;

-- The soonest hour-based PM for each asset (drives the Assets table column)
create or replace view public.asset_next_pm with (security_invoker = true) as
select distinct on (asset_id) *
  from public.pm_status
 order by asset_id, hours_until_due asc nulls last;

revoke all on public.pm_status, public.asset_next_pm from anon;
grant select on public.pm_status, public.asset_next_pm to authenticated;
