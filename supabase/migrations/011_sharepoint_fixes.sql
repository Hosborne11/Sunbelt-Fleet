-- =====================================================================
-- 011: corrections to the SharePoint asset list, then reconcile Fleet
--   Run AFTER 010. Safe to re-run (also re-run it whenever 010 is re-run).
--
--   * skid steers use 3-digit asset numbers (001-010), like Operations Center
--   * T&M rates: every 331P = $115, 85P (#221) = $115, Hyundai HX350 (#222) = $350, 317G (#001) = $115
--   * not tracked in Fleet: the 300E loader and all trench rollers
--   * machines SharePoint shows as disposed are retired in Fleet as of their disposal date
--     (frees their asset numbers for the replacements; history is kept)
-- =====================================================================

alter table public.sharepoint_assets_import add column if not exists excluded boolean not null default false;

create or replace function public.sharepoint_import_corrections() returns void
language sql security definer set search_path = public as $$
  -- 3-digit skid steer numbers
  update public.sharepoint_assets_import set machine_number = lpad(machine_number, 3, '0')
   where equipment_type = 'Skid steers' and machine_number ~ '^\d{1,2}$';

  -- T&M rate corrections
  update public.sharepoint_assets_import set tm_rate = 115
   where active and equipment_type = 'Skid steers'
     and (replace(upper(coalesce(model, '')), ' ', '') = '331P' or upper(title) like '%331P%');
  update public.sharepoint_assets_import set tm_rate = 115 where active and machine_number = '221';   -- JD 85P
  update public.sharepoint_assets_import set tm_rate = 350 where active and machine_number = '222';   -- Hyundai HX350
  update public.sharepoint_assets_import set tm_rate = 115
   where active and equipment_type = 'Skid steers' and machine_number = '001'
     and replace(upper(coalesce(model, '')), ' ', '') = '317G';                                       -- JD 317G

  -- not tracked in Fleet
  update public.sharepoint_assets_import set excluded = true
   where upper(title) like '%300E%'
      or upper(title) like '%TRENCH%'
      or replace(upper(coalesce(model, '')), ' ', '') in ('BMP8500', 'D.ONE', 'RTSC3');
$$;
revoke all on function public.sharepoint_import_corrections() from public, anon, authenticated;

create or replace function public.sharepoint_matches()
returns table (asset_id uuid, sp_row int)
language sql stable security definer set search_path = public, fleet as $$
  with sp as (
    select row_no, serial_norm, lower(left(regexp_replace(coalesce(make, ''), '[^A-Za-z]', '', 'g'), 4)) as mk
      from public.sharepoint_assets_import
     where active and not rpo_duplicate and not excluded and serial_norm is not null
       and serial_norm !~ '^(.)\1+$'                                   -- 000000, 111111 ...
       and serial_norm not in ('123456', '1234567', '12345678', '123456789')
  ), fa as (
    select a.id, public.norm_serial(a.serial_number) as s1, public.norm_serial(f.pin) as s2,
           lower(left(regexp_replace(coalesce(a.make, f.oem_name, ''), '[^A-Za-z]', '', 'g'), 4)) as mk
      from public.assets a
      left join fleet.assets f on f.id = a.telematics_asset_id
     where a.status <> 'retired'
  ), cand as (
    select distinct fa.id as asset_id, sp.row_no
      from fa join sp on exists (
        select 1 from unnest(array[fa.s1, fa.s2]) x(s)
         where x.s is not null and (
               x.s = sp.serial_norm
            or ((sp.mk = '' or fa.mk = '' or sp.mk = fa.mk) and (
                   (length(sp.serial_norm) >= 6 and x.s like '%' || sp.serial_norm)
                or (length(x.s) >= 6 and sp.serial_norm like '%' || x.s)))))
  ), one_sp as (
    select asset_id, (array_agg(row_no))[1] as row_no from cand group by asset_id having count(*) = 1
  )
  select o.asset_id, o.row_no from one_sp o
   where (select count(*) from cand c where c.row_no = o.row_no) = 1;
$$;

create or replace view public.sharepoint_reconcile_preview with (security_invoker = true) as
with m as (select * from public.sharepoint_matches()),
     sp as (select * from public.sharepoint_assets_import)
-- matched machines and what will change
select 'match'::text as result,
       a.asset_number as fleet_asset_no,
       coalesce(nullif(sp.machine_number, ''), a.asset_number) as new_asset_no,
       concat_ws(' ', a.make, a.model) as fleet_machine,
       sp.title as sharepoint_machine,
       coalesce(a.serial_number, '') as fleet_serial,
       sp.serial_raw as sharepoint_serial,
       cr.name as fleet_crew, sp.crew as new_crew,
       a.tm_rate as fleet_rate, sp.tm_rate as new_rate,
       case when sp.machine_number is null then 'SharePoint has no machine number'
            when sp.tm_rate is null then 'SharePoint has no T&M rate'
            when sp.crew is null then 'SharePoint has no crew' end as note
  from m join public.assets a on a.id = m.asset_id
  join sp on sp.row_no = m.sp_row
  left join public.crews cr on cr.id = a.crew_id
union all
-- in service in Fleet, not matched to an active SharePoint machine
select case when di.row_no is not null then 'fleet_only_disposed_in_sharepoint' else 'fleet_only' end,
       a.asset_number, null, concat_ws(' ', a.make, a.model), di.title,
       coalesce(a.serial_number, ''), di.serial_raw, cr.name, null, a.tm_rate, null,
       case when di.row_no is not null then 'SharePoint shows it inactive' || coalesce(', disposed ' || di.disposal_date, '') end
  from public.assets a
  left join fleet.assets f on f.id = a.telematics_asset_id
  left join public.crews cr on cr.id = a.crew_id
  left join lateral (
    select s.* from sp s
     where not s.active and s.serial_norm is not null
       and s.serial_norm in (public.norm_serial(a.serial_number), public.norm_serial(f.pin))
     limit 1) di on true
 where a.status <> 'retired' and a.id not in (select asset_id from m)
union all
-- active in SharePoint, not in Fleet (not added; listed for reference)
select 'sharepoint_only', null, sp.machine_number, null, sp.title, null, sp.serial_raw, null, sp.crew, null, sp.tm_rate,
       coalesce(sp.serial_note, sp.equipment_type)
  from sp
 where sp.active and not sp.rpo_duplicate and not sp.excluded and sp.row_no not in (select sp_row from m);
revoke all on public.sharepoint_reconcile_preview from anon, authenticated;   -- run from the SQL editor
revoke all on function public.sharepoint_matches() from public, anon, authenticated;

-- Machines SharePoint shows as inactive/disposed but still in service in Fleet: retire them
-- as of their SharePoint disposal date (history up to that date is kept). Exact serial/PIN matches only.
create or replace function public.retire_disposed_from_sharepoint() returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare retired jsonb;
begin
  with gone as (
    update public.assets a
       set status = 'retired',
           retired_on = coalesce(sp.disposal_date, (now() at time zone 'America/New_York')::date),
           disposal_notes = coalesce(a.disposal_notes, 'Inactive in the SharePoint asset list')
      from public.sharepoint_assets_import sp, public.assets a2
      left join fleet.assets f on f.id = a2.telematics_asset_id
     where a2.id = a.id
       and a.status <> 'retired'
       and not sp.active and not sp.rpo_duplicate and sp.serial_norm is not null
       and sp.serial_norm in (public.norm_serial(a.serial_number), public.norm_serial(f.pin))
       and not exists (select 1 from public.sharepoint_assets_import x
                        where x.active and x.serial_norm = sp.serial_norm)
    returning a.asset_number, a.model, a.retired_on
  )
  select coalesce(jsonb_agg(jsonb_build_object('asset', asset_number, 'model', model, 'retired_on', retired_on)
                            order by asset_number), '[]'::jsonb)
    into retired from gone;
  return retired;
end $$;
revoke all on function public.retire_disposed_from_sharepoint() from public, anon, authenticated;

-- One call: corrections -> retire disposed -> reconcile
create or replace function public.run_sharepoint_sync() returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare retired jsonb;
begin
  perform public.sharepoint_import_corrections();
  retired := public.retire_disposed_from_sharepoint();
  return jsonb_build_object('retired_as_disposed_in_sharepoint', retired) || public.apply_sharepoint_reconcile();
end $$;
revoke all on function public.run_sharepoint_sync() from public, anon, authenticated;

select public.run_sharepoint_sync() as result;
