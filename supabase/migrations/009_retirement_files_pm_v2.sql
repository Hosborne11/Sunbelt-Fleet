-- =====================================================================
-- 009
--  A) Retiring a machine: history is kept up to the retired date and nothing is deleted.
--     Asset numbers can be reused by the replacement once the old machine is retired.
--  B) Machine files: documents and work orders stored per machine (bucket "asset-files").
--  C) PM workflow v2 with the dealer:
--       requested -> proposed (dealer picks a date) -> scheduled (Sunbelt accepts)
--       24h before: dealer re-confirms (or proposes a new date) + foreman notice
--       24h after:  dealer confirms completion; work order upload required
--       any date change by the dealer goes back to "proposed" and notifies foremen + app users
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Retirement
-- ---------------------------------------------------------------------
alter table public.assets add column if not exists retired_on date;
alter table public.assets add column if not exists disposal_method text;
alter table public.assets add column if not exists disposal_value numeric;
alter table public.assets add column if not exists disposal_notes text;
alter table public.assets add column if not exists replaced_by_asset_id uuid references public.assets(id) on delete set null;
alter table public.assets drop constraint if exists assets_disposal_method_check;
alter table public.assets add constraint assets_disposal_method_check
  check (disposal_method is null or disposal_method in ('sold','traded_in','scrapped','returned','transferred','other'));

-- Asset numbers only need to be unique among machines still in the fleet
drop index if exists public.assets_asset_number_key;
create unique index if not exists assets_asset_number_active_uq on public.assets (asset_number) where status <> 'retired';

create or replace function public.assets_retirement_before() returns trigger
language plpgsql as $$
begin
  if new.status = 'retired' then
    new.retired_on := coalesce(new.retired_on, (now() at time zone 'America/New_York')::date);
  elsif tg_op = 'UPDATE' and old.status = 'retired' then
    -- back in service: clear the retirement details
    new.retired_on := null;
    new.disposal_method := null;
    new.disposal_value := null;
  end if;
  return new;
end $$;
drop trigger if exists assets_retirement_before on public.assets;
create trigger assets_retirement_before before insert or update of status, retired_on on public.assets
  for each row execute function public.assets_retirement_before();

-- Retiring stops PM tracking and live telematics for the machine (its history stays)
create or replace function public.assets_retirement_after() returns trigger
language plpgsql security definer set search_path = public, fleet as $$
begin
  if new.status = 'retired' and old.status is distinct from 'retired' then
    update public.maintenance_plans set active = false where asset_id = new.id and active;
    update public.pm_requests set status = 'cancelled', cancelled_at = now()
     where asset_id = new.id and status in ('requested','proposed','scheduled','awaiting_confirmation');
    if new.telematics_asset_id is not null then
      update fleet.assets set status = 'sold' where id = new.telematics_asset_id;
    end if;
  elsif old.status = 'retired' and new.status <> 'retired' then
    update public.maintenance_plans set active = true where asset_id = new.id and is_default;
    if new.telematics_asset_id is not null then
      update fleet.assets set status = 'active' where id = new.telematics_asset_id and status = 'sold';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists assets_retirement_after on public.assets;
create trigger assets_retirement_after after update of status on public.assets
  for each row execute function public.assets_retirement_after();

-- Usage, location and job-costing views stop at the retired date
create or replace view public.asset_daily_usage with (security_invoker = true) as
select a.id as asset_id, m.reading_date, m.closing_hours, m.hours_used, m.idle_hours_used, m.idle_pct,
       m.fuel_used, m.fuel_units, m.fuel_used_gal, m.loads,
       m.project_id, m.project_name,
       a.crew_id, c.name as crew_name
  from public.assets a
  join fleet.v_daily_metrics m on m.asset_id = a.telematics_asset_id
  left join public.crews c on c.id = a.crew_id
 where a.retired_on is null or m.reading_date <= a.retired_on;

create or replace view public.asset_location_history with (security_invoker = true) as
select a.id as asset_id, p.recorded_at, p.lat, p.lng, p.project_id, p.project_name
  from public.assets a
  join fleet.v_location_recent p on p.asset_id = a.telematics_asset_id
 where a.retired_on is null
    or p.recorded_at < ((a.retired_on + 1)::timestamp at time zone 'America/New_York');

-- Registry sync skips retired machines (and never writes readings after the retired date)
create or replace function public.sync_telematics_to_registry(p_history_days int default 7) returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare n_link int; n_hours int; n_readings int; n_jobsite int; n_alerts int;
begin
  n_link := public.link_telematics();

  update public.assets a set hour_meter = s.operating_hours
    from fleet.asset_status s
   where s.asset_id = a.telematics_asset_id
     and a.status <> 'retired'
     and s.operating_hours is not null
     and a.hour_meter is distinct from s.operating_hours;
  get diagnostics n_hours = row_count;

  insert into public.hour_meter_readings as h (asset_id, hours, reading_date, source)
  select a.id, r.operating_hours, r.reading_date, 'telematics'
    from public.assets a
    join fleet.daily_readings r on r.asset_id = a.telematics_asset_id
   where r.operating_hours is not null
     and r.reading_date >= (now() at time zone 'America/New_York')::date - p_history_days
     and (a.retired_on is null or r.reading_date <= a.retired_on)
  on conflict (asset_id, reading_date) where source = 'telematics'
  do update set hours = excluded.hours
   where h.hours is distinct from excluded.hours;
  get diagnostics n_readings = row_count;

  update public.assets a set jobsite_id = t.current_project_id
    from fleet.v_fleet_today t
    join public.jobsites j on j.id = t.current_project_id
   where t.asset_id = a.telematics_asset_id
     and a.status <> 'retired'
     and a.jobsite_id is distinct from t.current_project_id;
  get diagnostics n_jobsite = row_count;

  insert into public.alerts (message, asset_id, severity, status, source, external_key, created_at)
  select left('Fault ' || fe.code || coalesce(': ' || fe.description, ''), 500),
         a.id,
         case when lower(coalesce(fe.severity, '')) in ('high', 'red', 'critical', 'stop', '3') then 'high'
              when lower(coalesce(fe.severity, '')) in ('low', 'info', 'information', '1') then 'low'
              else 'medium' end,
         'open', 'telematics', 'fault:' || fe.id, fe.recorded_at
    from fleet.fault_events fe
    join public.assets a on a.telematics_asset_id = fe.asset_id
   where fe.recorded_at > now() - interval '14 days'
     and fe.acknowledged_at is null
     and a.status <> 'retired'
  on conflict (external_key) do nothing;
  get diagnostics n_alerts = row_count;

  return jsonb_build_object('linked', n_link, 'hour_meters', n_hours, 'hour_readings', n_readings,
                            'jobsites', n_jobsite, 'alerts', n_alerts);
end $$;

-- Seeding new machines respects the "unique among active machines" rule
create or replace function public.seed_assets_from_telematics() returns int
language plpgsql security definer set search_path = public, fleet as $$
declare n int;
begin
  with src as (
    select f.*, coalesce(nullif(f.unit_number, ''), nullif(f.oem_equipment_name, ''),
                         concat_ws(' ', f.model, right(f.pin, 6))) as base_no
      from fleet.assets f
     where f.status <> 'sold'
       and not exists (select 1 from public.assets a where a.telematics_asset_id = f.id)
  ), named as (
    select s.*,
           case when count(*) over (partition by base_no) > 1
                  or exists (select 1 from public.assets a where a.asset_number = s.base_no and a.status <> 'retired')
                then s.base_no || ' / ' || right(coalesce(s.pin, s.external_id), 6)
                else s.base_no end as asset_no
      from src s
  )
  insert into public.assets (asset_number, make, model, serial_number, status, hour_meter,
                             category_id, telematics_asset_id)
  select n.asset_no, initcap(n.oem_name), n.model, coalesce(n.pin, n.serial_number), 'active',
         st.operating_hours,
         (select c.id from public.equipment_categories c where lower(c.name) = lower(n.asset_class) limit 1),
         n.id
    from named n
    left join fleet.asset_status st on st.asset_id = n.id
  on conflict (asset_number) where status <> 'retired' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.seed_assets_from_telematics() from public, anon, authenticated;
revoke all on function public.sync_telematics_to_registry(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B) Machine files
-- ---------------------------------------------------------------------
create table if not exists public.asset_files (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.assets(id) on delete cascade,
  bucket       text not null default 'asset-files',
  path         text not null,
  file_name    text not null,
  content_type text,
  size_bytes   bigint,
  category     text not null default 'document'
                 check (category in ('work_order','document','photo','invoice','other')),
  request_id   uuid references public.pm_requests(id) on delete set null,
  uploaded_by  text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists asset_files_asset_idx on public.asset_files (asset_id, created_at desc);
alter table public.maintenance_services add column if not exists file_id uuid references public.asset_files(id) on delete set null;

alter table public.asset_files enable row level security;
drop policy if exists staff_all on public.asset_files;
create policy staff_all on public.asset_files for all to authenticated using (true) with check (true);
revoke all on public.asset_files from anon;
grant select, insert, update, delete on public.asset_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asset-files', 'asset-files', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'text/plain', 'text/csv'])
on conflict (id) do nothing;

drop policy if exists "staff read asset files" on storage.objects;
create policy "staff read asset files" on storage.objects for select to authenticated using (bucket_id = 'asset-files');
drop policy if exists "staff upload asset files" on storage.objects;
create policy "staff upload asset files" on storage.objects for insert to authenticated with check (bucket_id = 'asset-files');
drop policy if exists "staff delete asset files" on storage.objects;
create policy "staff delete asset files" on storage.objects for delete to authenticated using (bucket_id = 'asset-files');

-- ---------------------------------------------------------------------
-- C) PM workflow v2
-- ---------------------------------------------------------------------
alter table public.pm_requests drop constraint if exists pm_requests_status_check;
alter table public.pm_requests add constraint pm_requests_status_check
  check (status in ('requested','proposed','scheduled','awaiting_confirmation','completed','cancelled'));

alter table public.pm_requests add column if not exists proposed_date date;
alter table public.pm_requests add column if not exists proposed_time time;
alter table public.pm_requests add column if not exists proposed_notes text;
alter table public.pm_requests add column if not exists proposed_at timestamptz;
alter table public.pm_requests add column if not exists previous_date date;          -- set when the dealer moves an accepted date
alter table public.pm_requests add column if not exists proposal_reminder_sent_at timestamptz;
alter table public.pm_requests add column if not exists accepted_at timestamptz;
alter table public.pm_requests add column if not exists accepted_by text;
alter table public.pm_requests add column if not exists declined_note text;
alter table public.pm_requests add column if not exists reconfirm_sent_at timestamptz;
alter table public.pm_requests add column if not exists reconfirmed_at timestamptz;

drop index if exists public.pm_requests_one_open;
create unique index pm_requests_one_open on public.pm_requests (plan_id)
  where status in ('requested','proposed','scheduled','awaiting_confirmation');

alter table public.pm_settings add column if not exists morning_reminder boolean not null default true;

-- The plan only carries a date once Sunbelt has accepted it
create or replace function public.pm_requests_sync_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'scheduled' and new.scheduled_date is not null then
    update public.maintenance_plans
       set scheduled_for  = new.scheduled_date,
           scheduled_note = coalesce(new.vendor_name, 'Vendor')
                            || coalesce(', ' || to_char(new.scheduled_time, 'FMHH12:MI AM'), '')
     where id = new.plan_id;
  elsif tg_op = 'UPDATE' and old.status in ('scheduled','awaiting_confirmation')
        and new.status in ('requested','proposed','cancelled') then
    update public.maintenance_plans
       set scheduled_for = null, scheduled_note = null
     where id = new.plan_id and scheduled_for is not distinct from old.scheduled_date;
  end if;
  return new;
end $$;

create or replace function public.maintenance_services_close_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.request_id is null then
    update public.pm_requests
       set status = 'completed', completed_on = new.performed_on, completed_hours = new.hours,
           completed_notes = coalesce(new.notes, 'Logged in Fleet'), work_order_path = new.attachment_path,
           completed_at = now()
     where plan_id = new.plan_id and status in ('requested','proposed','scheduled','awaiting_confirmation');
  end if;
  return null;
end $$;

-- Assets table: open request now includes a proposal waiting on Sunbelt (columns appended)
create or replace view public.asset_next_pm with (security_invoker = true) as
select n.*,
       r.id             as request_id,
       r.status         as request_status,
       r.scheduled_date as request_scheduled_date,
       r.scheduled_time as request_scheduled_time,
       r.proposed_date  as request_proposed_date
  from (select distinct on (asset_id) * from public.pm_status
         order by asset_id, hours_until_due asc nulls last) n
  left join public.pm_requests r
    on r.plan_id = n.plan_id and r.status in ('requested','proposed','scheduled','awaiting_confirmation');
grant select on public.asset_next_pm to authenticated;

create or replace function public.invoke_pm_cron() returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'fleet_project_url') || '/functions/v1/pm-workflow',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-fleet-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'fleet_cron_key')),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )
   where exists (select 1 from public.pm_requests
                  where status in ('requested','proposed','scheduled','awaiting_confirmation'));
$$;
revoke all on function public.invoke_pm_cron() from public, anon, authenticated;
