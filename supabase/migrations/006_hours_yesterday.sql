-- 006: machine hours for the Assets table (today / yesterday / last 7 days)
--  * "unknown" now shows as blank instead of 0 when there's no earlier reading to compare against
--  * last 7 days falls back to the first reading in the window for machines with less history
create or replace view fleet.v_fleet_today with (security_invoker = true) as
select a.id as asset_id, a.unit_number,
       coalesce(a.display_name, a.oem_equipment_name, concat_ws(' ', a.oem_name, a.model)) as name,
       a.asset_class, a.oem_name, a.model, a.serial_number, a.status, a.source_code,
       -- location + project
       s.lat, s.lng, s.location_at,
       lp.project_id as current_project_id, pr.name as current_project, pr.job_number as current_job_number,
       -- reporting health
       greatest(s.location_at, s.operating_hours_at, s.engine_status_at) as last_report_at,
       case
         when greatest(s.location_at, s.operating_hours_at) is null                         then 'no_data'
         when greatest(s.location_at, s.operating_hours_at) > now() - interval '2 hours'    then 'live'
         when greatest(s.location_at, s.operating_hours_at) > now() - interval '24 hours'   then 'recent'
         when greatest(s.location_at, s.operating_hours_at) > now() - interval '7 days'     then 'stale'
         else 'offline'
       end as reporting_status,
       -- metrics
       s.operating_hours,
       case when lc.operating_hours is not null
            then greatest(s.operating_hours - lc.operating_hours, 0) end as hours_today,
       case when lc.idle_hours is not null
            then greatest(s.idle_hours - lc.idle_hours, 0) end           as idle_hours_today,
       case when wk.operating_hours is not null
            then greatest(s.operating_hours - wk.operating_hours, 0) end as hours_7d,
       s.fuel_remaining_pct, s.def_remaining_pct, s.engine_running,
       s.odometer, s.odometer_units, s.load_count,
       coalesce(f.open_faults, 0) as open_faults_7d, f.last_fault_at
  from fleet.assets a
  left join fleet.asset_status s on s.asset_id = a.id
  left join lateral (
    select project_id from fleet.location_pings p
     where p.asset_id = a.id order by p.recorded_at desc limit 1
  ) lp on true
  left join fleet.projects pr on pr.id = lp.project_id
  left join lateral (
    select operating_hours, idle_hours from fleet.daily_readings r
     where r.asset_id = a.id and r.reading_date < (now() at time zone 'America/New_York')::date
     order by r.reading_date desc limit 1
  ) lc on true
  left join lateral (
    select coalesce(
      (select operating_hours from fleet.daily_readings r
        where r.asset_id = a.id and r.operating_hours is not null
          and r.reading_date <= (now() at time zone 'America/New_York')::date - 7
        order by r.reading_date desc limit 1),
      (select operating_hours from fleet.daily_readings r
        where r.asset_id = a.id and r.operating_hours is not null
          and r.reading_date >  (now() at time zone 'America/New_York')::date - 7
          and r.reading_date <  (now() at time zone 'America/New_York')::date
        order by r.reading_date asc limit 1)) as operating_hours
  ) wk on true
  left join lateral (
    select count(*) as open_faults, max(recorded_at) as last_fault_at from fleet.fault_events fe
     where fe.asset_id = a.id and fe.acknowledged_at is null and fe.recorded_at > now() - interval '7 days'
  ) f on true
 where a.status <> 'sold';;

-- "Yesterday" = yesterday's closing hour meter minus the previous day's close (Eastern time).
create or replace view public.asset_telematics with (security_invoker = true) as
select a.id as asset_id,
       t.asset_id as telematics_asset_id, t.source_code,
       t.lat, t.lng, t.location_at,
       t.current_project_id, t.current_project,
       t.last_report_at, t.reporting_status,
       t.operating_hours, t.hours_today, t.idle_hours_today, t.hours_7d,
       t.fuel_remaining_pct, t.def_remaining_pct, t.engine_running,
       t.open_faults_7d, t.last_fault_at,
       y.hours_yesterday
  from public.assets a
  join fleet.v_fleet_today t on t.asset_id = a.telematics_asset_id
  left join lateral (
    select greatest(r1.operating_hours - prev.operating_hours, 0) as hours_yesterday
      from fleet.daily_readings r1
      left join lateral (
        select r0.operating_hours from fleet.daily_readings r0
         where r0.asset_id = r1.asset_id and r0.reading_date < r1.reading_date
         order by r0.reading_date desc limit 1
      ) prev on true
     where r1.asset_id = t.asset_id
       and r1.reading_date = (now() at time zone 'America/New_York')::date - 1
  ) y on true;

grant select on public.asset_telematics to authenticated;
revoke all on public.asset_telematics from anon;
