-- =====================================================================
-- 013 · Work trucks from OneStep GPS + time on site
--   A. public.sync_onestep_vehicles(): every OneStep truck is in the Fleet registry exactly as named
--      in OneStep ("#1 -F650 Flatbed" -> asset #1, "F650 Flatbed"), added automatically and renamed
--      when it's renamed in OneStep. Truck category; no 500-hour PM plan. Runs every 30 minutes.
--   B. public.asset_site_time: hours at each jobsite per machine per day (with arrival / departure);
--      public.pbi_site_time for Power BI.
-- Needs the telematics backend migration 20261019001400 first. Safe to re-run.
-- =====================================================================

create or replace function public.sync_onestep_vehicles() returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare
  truck uuid;
  n_new int := 0; n_upd int := 0;
begin
  insert into public.equipment_categories (name, icon, sort_order) values ('Truck', 'truck', 9)
  on conflict (name) do nothing;
  select id into truck from public.equipment_categories where name = 'Truck';

  drop table if exists _osv;
  create temp table _osv as
  select f.id as fleet_id, f.pin as vin,
         coalesce(replace(substring(f.oem_equipment_name from '^\s*(#\s*\d+)'), ' ', ''),
                  nullif(btrim(f.oem_equipment_name), ''), f.external_id) as want_number,
         nullif(btrim(regexp_replace(coalesce(f.oem_equipment_name, ''), '^\s*#\s*\d+\s*[-:]?\s*', '')), '') as want_model
    from fleet.assets f
   where f.source_code = 'onestep';

  -- names follow OneStep (a number another machine already uses gets the tracker's last 4 added)
  with m as (
    select v.*, a.id as asset_id
      from _osv v
      join public.assets a
        on a.status <> 'retired'
       and (a.telematics_asset_id = v.fleet_id
            or (v.vin is not null and public.norm_serial(a.serial_number) = public.norm_serial(v.vin)))
  )
  update public.assets a set
         asset_number = case when exists (select 1 from public.assets o
                                           where o.asset_number = m.want_number and o.status <> 'retired' and o.id <> a.id)
                             then m.want_number || ' (' || right(m.fleet_id::text, 4) || ')' else m.want_number end,
         model = coalesce(m.want_model, a.model),
         serial_number = coalesce(nullif(a.serial_number, ''), m.vin),
         category_id = coalesce(a.category_id, truck),
         telematics_asset_id = m.fleet_id
    from m
   where a.id = m.asset_id
     and (a.asset_number is distinct from m.want_number or a.model is distinct from coalesce(m.want_model, a.model)
          or a.telematics_asset_id is distinct from m.fleet_id or a.category_id is null);
  get diagnostics n_upd = row_count;

  insert into public.assets (asset_number, model, serial_number, category_id, status, telematics_asset_id)
  select case when exists (select 1 from public.assets o where o.asset_number = v.want_number and o.status <> 'retired')
              then v.want_number || ' (' || right(v.fleet_id::text, 4) || ')' else v.want_number end,
         v.want_model, v.vin, truck, 'active', v.fleet_id
    from _osv v
   where not exists (select 1 from public.assets a
                      where a.status <> 'retired'
                        and (a.telematics_asset_id = v.fleet_id
                             or (v.vin is not null and public.norm_serial(a.serial_number) = public.norm_serial(v.vin))));
  get diagnostics n_new = row_count;

  -- road trucks are serviced by mileage: no 500-hour PM plan
  update public.maintenance_plans p set active = false
    from public.assets a
   where p.asset_id = a.id and a.category_id = truck and p.is_default and p.active;

  -- same numbers on the telematics side
  update fleet.assets f set unit_number = null
   where f.source_code = 'onestep' and f.unit_number is not null
     and not exists (select 1 from public.assets a where a.telematics_asset_id = f.id and a.asset_number = f.unit_number);
  update fleet.assets f set unit_number = a.asset_number
    from public.assets a
   where f.source_code = 'onestep' and a.telematics_asset_id = f.id and a.status <> 'retired'
     and f.unit_number is distinct from a.asset_number;

  drop table if exists _osv;
  return jsonb_build_object('added', n_new, 'updated', n_upd);
end $$;
revoke all on function public.sync_onestep_vehicles() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'onestep-vehicle-registry';
select cron.schedule('onestep-vehicle-registry', '2,32 * * * *', $$
  select public.sync_onestep_vehicles();
  select public.sync_telematics_to_registry(5000);
$$);

-- ---------------------------------------------------------------------
-- B. Time on site
-- ---------------------------------------------------------------------
create or replace view public.asset_site_time with (security_invoker = true) as
select a.id as asset_id, t.reading_date, t.project_id,
       coalesce(p.name, 'Jobsite') as jobsite, p.job_number,
       t.minutes, round(t.minutes / 60.0, 2) as hours_on_site,
       t.first_in, t.last_out, t.points
  from public.assets a
  join fleet.daily_site_time t on t.asset_id = a.telematics_asset_id
  left join fleet.projects p on p.id = t.project_id
 where a.retired_on is null or t.reading_date <= a.retired_on;
grant select on public.asset_site_time to authenticated;
revoke all on public.asset_site_time from anon;

-- Power BI: hours at each jobsite per machine per day (times in Eastern)
create or replace view public.pbi_site_time as
select s.reading_date,
       a.asset_number,
       concat_ws(' ', a.make, a.model)                                as machine,
       cat.name                                                        as category,
       cr.name                                                         as crew,
       s.jobsite,
       s.job_number,
       s.hours_on_site,
       (s.first_in at time zone 'America/New_York')                    as first_arrival_et,
       (s.last_out at time zone 'America/New_York')                    as last_departure_et,
       a.serial_number
  from public.asset_site_time s
  join public.assets a on a.id = s.asset_id
  left join public.equipment_categories cat on cat.id = a.category_id
  left join public.crews cr on cr.id = a.crew_id;
revoke all on public.pbi_site_time from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    execute 'grant select on public.pbi_site_time to powerbi_reader';
  end if;
end $$;

select public.sync_onestep_vehicles() as onestep_trucks;
