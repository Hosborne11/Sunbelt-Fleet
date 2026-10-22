-- =====================================================================
-- 015 · Truck names you change in Fleet stay changed
--   The OneStep sync used to rename every truck to its OneStep name every 30 minutes. Now Fleet
--   remembers the OneStep name it last took for each truck (assets.source_name) and only renames
--   a truck when its OneStep name changes. Whichever was renamed most recently wins.
-- Run after 013. Safe to re-run.
-- =====================================================================

alter table public.assets add column if not exists source_name text;

-- trucks already in Fleet: their current names count as already taken from OneStep
update public.assets a set source_name = coalesce(f.oem_equipment_name, f.external_id)
  from fleet.assets f
 where f.source_code = 'onestep' and a.telematics_asset_id = f.id and a.source_name is null;

create or replace function public.sync_onestep_vehicles() returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare
  truck uuid;
  n_new int := 0; n_upd int := 0;
begin
  insert into public.equipment_categories (name, icon, sort_order) values ('Truck', 'truck', 9)
  on conflict (name) do nothing;
  select id into truck from public.equipment_categories where name = 'Truck';

  -- every OneStep truck, the Fleet asset it already has (linked, or same VIN), and the number it should get
  drop table if exists _osv;
  create temp table _osv as
  with base as (
    select f.id as fleet_id, f.pin as vin,
           coalesce(replace(substring(f.oem_equipment_name from '^\s*(#\s*\d+)'), ' ', ''),
                    nullif(btrim(f.oem_equipment_name), ''), f.external_id) as want_number,
           nullif(btrim(regexp_replace(coalesce(f.oem_equipment_name, ''), '^\s*#\s*\d+\s*[-:]?\s*', '')), '') as want_model,
           coalesce(f.oem_equipment_name, f.external_id) as onestep_name
      from fleet.assets f
     where f.source_code = 'onestep'
  ), linked as (
    select b.*,
           (select a.id from public.assets a
             where a.status <> 'retired'
               and (a.telematics_asset_id = b.fleet_id
                    or (b.vin is not null and public.norm_serial(a.serial_number) = public.norm_serial(b.vin)))
             order by (a.telematics_asset_id = b.fleet_id) desc nulls last
             limit 1) as asset_id
      from base b
  ), flagged as (
    -- rename only new trucks and trucks whose OneStep name changed since Fleet last took it;
    -- a name changed in Fleet stays until the truck is renamed in OneStep
    select l.*,
           (l.asset_id is null or (select a.source_name from public.assets a where a.id = l.asset_id)
                                  is distinct from l.onestep_name) as rename
      from linked l
  ), ranked as (
    -- two OneStep trucks with the same number: the one already in Fleet (else the first) keeps it
    select f.*, row_number() over (partition by f.rename, f.want_number order by (f.asset_id is null), f.fleet_id) as rn
      from flagged f
  )
  select r.*,
         case when r.rn > 1 then r.want_number || ' (' || right(r.fleet_id::text, 4) || ')' else r.want_number end
           as final_number
    from ranked r;

  -- a number already used by another machine (or a truck keeping its Fleet name): add the tracker's last 4
  update _osv v set final_number = v.final_number || ' (' || right(v.fleet_id::text, 4) || ')'
   where v.rename
     and exists (select 1 from public.assets o
                  where o.status <> 'retired' and o.asset_number = v.final_number
                    and o.id not in (select asset_id from _osv where asset_id is not null and rename));

  -- trucks being renamed: park them on a temporary number first (lets two trucks swap numbers)
  update public.assets a set asset_number = '~onestep~' || a.id::text
    from _osv v
   where a.id = v.asset_id and v.rename and a.asset_number is distinct from v.final_number;

  -- renamed in OneStep: take the OneStep name
  update public.assets a set
         asset_number = v.final_number,
         model = coalesce(v.want_model, a.model),
         source_name = v.onestep_name,
         serial_number = coalesce(nullif(a.serial_number, ''), v.vin),
         category_id = coalesce(a.category_id, truck),
         telematics_asset_id = v.fleet_id
    from _osv v
   where a.id = v.asset_id and v.rename;
  get diagnostics n_upd = row_count;

  -- everyone else keeps their Fleet name; just make sure the link and category are right
  update public.assets a set
         category_id = coalesce(a.category_id, truck),
         telematics_asset_id = v.fleet_id
    from _osv v
   where a.id = v.asset_id and not v.rename
     and (a.telematics_asset_id is distinct from v.fleet_id or a.category_id is null);

  -- new trucks
  insert into public.assets (asset_number, model, serial_number, category_id, status, telematics_asset_id, source_name)
  select v.final_number, v.want_model, v.vin, truck, 'active', v.fleet_id, v.onestep_name
    from _osv v
   where v.asset_id is null;
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

select public.sync_onestep_vehicles() as onestep_trucks;
