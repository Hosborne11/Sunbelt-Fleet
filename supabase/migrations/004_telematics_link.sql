-- =====================================================================
-- Sunbelt Fleet GUI <-> telematics (fleet schema)
--  * registry assets link to telematics units by serial number (full PIN or short serial)
--  * jobsites ARE the geofences: every jobsite is mirrored into fleet.projects
--  * hourly sync: hour meter, daily hour-meter history, jobsite from geofence, fault alerts
--  * read-only views the GUI uses for live location, today's metrics and daily usage
-- Requires the fleet schema (telematics backend) in the same Supabase project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Link column
-- ---------------------------------------------------------------------
alter table public.assets
  add column if not exists telematics_asset_id uuid unique references fleet.assets(id) on delete set null;

-- Normalize a serial for matching: uppercase, letters/digits only
create or replace function public.norm_serial(s text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(s, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

-- Link every unlinked registry asset whose serial matches exactly one telematics unit
-- (exact PIN/serial, or a 5–8 character short serial matching the end of the PIN).
create or replace function public.link_telematics() returns int
language plpgsql security definer set search_path = public, fleet as $$
declare n int;
begin
  with cand as (
    select a.id as asset_id, f.id as fleet_id
      from public.assets a
      join fleet.assets f
        on public.norm_serial(a.serial_number) in (public.norm_serial(f.pin), public.norm_serial(f.serial_number))
        or (length(public.norm_serial(a.serial_number)) between 5 and 8
            and public.norm_serial(f.pin) like '%' || public.norm_serial(a.serial_number))
     where a.telematics_asset_id is null
       and public.norm_serial(a.serial_number) is not null
       and not exists (select 1 from public.assets x where x.telematics_asset_id = f.id)
  ), one_per_asset as (
    select asset_id, (array_agg(fleet_id))[1] as fleet_id
      from cand group by asset_id having count(distinct fleet_id) = 1
  ), one_per_unit as (
    select fleet_id, (array_agg(asset_id))[1] as asset_id
      from one_per_asset group by fleet_id having count(*) = 1
  )
  update public.assets a set telematics_asset_id = u.fleet_id
    from one_per_unit u where a.id = u.asset_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Re-link automatically when a serial number is added or changed in the GUI
create or replace function public.assets_relink() returns trigger
language plpgsql security definer set search_path = public, fleet as $$
begin
  perform public.link_telematics();
  return null;
end $$;
drop trigger if exists assets_relink on public.assets;
create trigger assets_relink after insert or update of serial_number on public.assets
  for each statement execute function public.assets_relink();

-- Review helper: telematics units not linked to any registry asset
create or replace view public.unlinked_telematics with (security_invoker = true) as
select f.id as telematics_asset_id, f.source_code, f.unit_number, f.oem_equipment_name,
       f.oem_name, f.model, f.pin, f.serial_number, f.last_seen_at
  from fleet.assets f
 where not exists (select 1 from public.assets a where a.telematics_asset_id = f.id);

-- One-time helper: create registry assets for every unlinked telematics unit
-- (asset # = unit number, else the OEM machine name, else model + last 6 of PIN)
create or replace function public.seed_assets_from_telematics() returns int
language plpgsql security definer set search_path = public, fleet as $$
declare n int;
begin
  with src as (
    select f.*, coalesce(nullif(f.unit_number, ''), nullif(f.oem_equipment_name, ''),
                         concat_ws(' ', f.model, right(f.pin, 6))) as base_no
      from fleet.assets f
     where not exists (select 1 from public.assets a where a.telematics_asset_id = f.id)
  ), named as (
    select s.*,
           case when count(*) over (partition by base_no) > 1
                  or exists (select 1 from public.assets a where a.asset_number = s.base_no)
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
  on conflict (asset_number) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 2) Jobsites are the geofences: mirror public.jobsites -> fleet.projects (same id)
-- ---------------------------------------------------------------------
create or replace function public.jobsite_to_project() returns trigger
language plpgsql security definer set search_path = public, fleet as $$
begin
  if tg_op = 'DELETE' then
    delete from fleet.projects where id = old.id;
    return old;
  end if;
  insert into fleet.projects (id, name, status, center_lat, center_lng, radius_m)
  values (new.id, new.name, case when new.active then 'active' else 'complete' end,
          new.latitude::float8, new.longitude::float8, new.radius_m)
  on conflict (id) do update
     set name = excluded.name, status = excluded.status,
         center_lat = excluded.center_lat, center_lng = excluded.center_lng, radius_m = excluded.radius_m;
  return new;
end $$;
drop trigger if exists jobsites_to_projects on public.jobsites;
create trigger jobsites_to_projects after insert or update or delete on public.jobsites
  for each row execute function public.jobsite_to_project();

-- Geofence edits re-tag history in the background (every 5 min) so saving a jobsite stays instant
alter table fleet.settings add column if not exists retag_pending boolean not null default false;

create or replace function fleet.projects_changed() returns trigger
language plpgsql security definer set search_path = fleet, public as $$
begin
  update fleet.settings set retag_pending = true;
  return null;
end $$;

create or replace function fleet.run_pending_retag() returns int
language plpgsql security definer set search_path = fleet, extensions, public as $$
begin
  if not (select retag_pending from fleet.settings) then return 0; end if;
  update fleet.settings set retag_pending = false;
  perform fleet.retag_pings(now() - interval '400 days');
  perform fleet.refresh_daily_location_and_project(null, date '2000-01-01',
                                                   (now() at time zone 'America/New_York')::date);
  return 1;
end $$;

-- Mirror existing jobsites now
insert into fleet.projects (id, name, status, center_lat, center_lng, radius_m)
select j.id, j.name, case when j.active then 'active' else 'complete' end,
       j.latitude::float8, j.longitude::float8, j.radius_m
  from public.jobsites j
on conflict (id) do update
   set name = excluded.name, status = excluded.status,
       center_lat = excluded.center_lat, center_lng = excluded.center_lng, radius_m = excluded.radius_m;

-- ---------------------------------------------------------------------
-- 3) Registry sync (hourly): hour meter, hour history, jobsite, fault alerts
-- ---------------------------------------------------------------------
create or replace function public.sync_telematics_to_registry(p_history_days int default 7) returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare n_link int; n_hours int; n_readings int; n_jobsite int; n_alerts int;
begin
  n_link := public.link_telematics();

  -- live hour meter
  update public.assets a set hour_meter = s.operating_hours
    from fleet.asset_status s
   where s.asset_id = a.telematics_asset_id
     and s.operating_hours is not null
     and a.hour_meter is distinct from s.operating_hours;
  get diagnostics n_hours = row_count;

  -- daily hour-meter history (closing reading per day)
  insert into public.hour_meter_readings as h (asset_id, hours, reading_date, source)
  select a.id, r.operating_hours, r.reading_date, 'telematics'
    from public.assets a
    join fleet.daily_readings r on r.asset_id = a.telematics_asset_id
   where r.operating_hours is not null
     and r.reading_date >= (now() at time zone 'America/New_York')::date - p_history_days
  on conflict (asset_id, reading_date) where source = 'telematics'
  do update set hours = excluded.hours
   where h.hours is distinct from excluded.hours;
  get diagnostics n_readings = row_count;

  -- jobsite from geofence (only when the machine's latest position is inside a jobsite)
  update public.assets a set jobsite_id = t.current_project_id
    from fleet.v_fleet_today t
    join public.jobsites j on j.id = t.current_project_id
   where t.asset_id = a.telematics_asset_id
     and a.jobsite_id is distinct from t.current_project_id;
  get diagnostics n_jobsite = row_count;

  -- machine fault codes -> Alerts
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
  on conflict (external_key) do nothing;
  get diagnostics n_alerts = row_count;

  return jsonb_build_object('linked', n_link, 'hour_meters', n_hours, 'hour_readings', n_readings,
                            'jobsites', n_jobsite, 'alerts', n_alerts);
end $$;

-- Resolving/acknowledging a fault alert in the GUI acknowledges the fault in telematics
create or replace function public.alerts_ack_fault() returns trigger
language plpgsql security definer set search_path = public, fleet as $$
begin
  if new.source = 'telematics' and new.external_key like 'fault:%'
     and new.status in ('acknowledged', 'resolved') and old.status = 'open' then
    update fleet.fault_events
       set acknowledged_at = now(),
           acknowledged_by = coalesce(auth.jwt() ->> 'email', 'staff')
     where id = substring(new.external_key from 7)::bigint and acknowledged_at is null;
  end if;
  return new;
end $$;
drop trigger if exists alerts_ack_fault on public.alerts;
create trigger alerts_ack_fault after update of status on public.alerts
  for each row execute function public.alerts_ack_fault();

-- ---------------------------------------------------------------------
-- 4) Read-only views for the GUI (logged-in users only)
-- ---------------------------------------------------------------------
create or replace view public.asset_telematics with (security_invoker = true) as
select a.id as asset_id,
       t.asset_id as telematics_asset_id, t.source_code,
       t.lat, t.lng, t.location_at,
       t.current_project_id, t.current_project,
       t.last_report_at, t.reporting_status,
       t.operating_hours, t.hours_today, t.idle_hours_today, t.hours_7d,
       t.fuel_remaining_pct, t.def_remaining_pct, t.engine_running,
       t.open_faults_7d, t.last_fault_at
  from public.assets a
  join fleet.v_fleet_today t on t.asset_id = a.telematics_asset_id;

create or replace view public.asset_daily_usage with (security_invoker = true) as
select a.id as asset_id, m.reading_date, m.closing_hours, m.hours_used, m.idle_hours_used, m.idle_pct,
       m.fuel_used, m.fuel_units, m.fuel_used_gal, m.loads,
       m.project_id, m.project_name
  from public.assets a
  join fleet.v_daily_metrics m on m.asset_id = a.telematics_asset_id;

create or replace view public.asset_location_history with (security_invoker = true) as
select a.id as asset_id, p.recorded_at, p.lat, p.lng, p.project_id, p.project_name
  from public.assets a
  join fleet.v_location_recent p on p.asset_id = a.telematics_asset_id;

revoke all on public.asset_telematics, public.asset_daily_usage, public.asset_location_history,
              public.unlinked_telematics from anon;
grant select on public.asset_telematics, public.asset_daily_usage, public.asset_location_history,
                public.unlinked_telematics to authenticated;

revoke all on function public.link_telematics() from public, anon, authenticated;
revoke all on function public.seed_assets_from_telematics() from public, anon, authenticated;
revoke all on function public.sync_telematics_to_registry(int) from public, anon, authenticated;
revoke all on function fleet.run_pending_retag() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Schedules
-- ---------------------------------------------------------------------
select cron.unschedule(jobname) from cron.job where jobname in ('fleet-registry-sync', 'fleet-retag');
select cron.schedule('fleet-registry-sync', '5,35 * * * *', $$ select public.sync_telematics_to_registry(7) $$);
select cron.schedule('fleet-retag', '*/5 * * * *', $$ select fleet.run_pending_retag() $$);
