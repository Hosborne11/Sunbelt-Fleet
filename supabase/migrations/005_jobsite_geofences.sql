-- =====================================================================
-- 005: drawn jobsite geofences
--  * fixes "UPDATE requires a WHERE clause" when saving a jobsite from the app
--    (Supabase blocks WHERE-less updates coming through the API; the settings row now has an explicit WHERE)
--  * jobsites get a drawn boundary (GeoJSON polygon) and a job number
--  * the boundary is mirrored into fleet.projects, where it takes priority over the radius circle
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) WHERE-safe background re-tag flag
-- ---------------------------------------------------------------------
create or replace function fleet.projects_changed() returns trigger
language plpgsql security definer set search_path = fleet, public as $$
begin
  update fleet.settings set retag_pending = true where id = true;
  return null;
end $$;

create or replace function fleet.run_pending_retag() returns int
language plpgsql security definer set search_path = fleet, extensions, public as $$
begin
  if not (select retag_pending from fleet.settings where id = true) then return 0; end if;
  update fleet.settings set retag_pending = false where id = true;
  perform fleet.retag_pings(now() - interval '400 days');
  perform fleet.refresh_daily_location_and_project(null, date '2000-01-01',
                                                   (now() at time zone 'America/New_York')::date);
  return 1;
end $$;

-- ---------------------------------------------------------------------
-- 2) Jobsite columns
-- ---------------------------------------------------------------------
alter table public.jobsites add column if not exists boundary   jsonb;   -- GeoJSON Polygon/MultiPolygon geometry
alter table public.jobsites add column if not exists job_number text;
create unique index if not exists jobsites_job_number_uq on public.jobsites (job_number) where job_number is not null;

-- GeoJSON -> clean MultiPolygon geography (repairs self-intersections from hand drawing)
create or replace function public.geojson_to_boundary(g jsonb) returns extensions.geography
language sql immutable set search_path = public, extensions as $$
  select case when g is null then null else
    extensions.ST_Multi(
      extensions.ST_CollectionExtract(
        extensions.ST_MakeValid(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(g::text), 4326)), 3)
    )::extensions.geography(MultiPolygon, 4326)
  end
$$;

-- ---------------------------------------------------------------------
-- 3) Mirror jobsite -> fleet.projects (boundary + job number now included)
-- ---------------------------------------------------------------------
create or replace function public.jobsite_to_project() returns trigger
language plpgsql security definer set search_path = public, fleet, extensions as $$
begin
  if tg_op = 'DELETE' then
    delete from fleet.projects where id = old.id;
    return old;
  end if;
  insert into fleet.projects (id, name, job_number, status, center_lat, center_lng, radius_m, boundary)
  values (new.id, new.name, new.job_number, case when new.active then 'active' else 'complete' end,
          new.latitude::float8, new.longitude::float8, new.radius_m, public.geojson_to_boundary(new.boundary))
  on conflict (id) do update
     set name = excluded.name, job_number = excluded.job_number, status = excluded.status,
         center_lat = excluded.center_lat, center_lng = excluded.center_lng,
         radius_m = excluded.radius_m, boundary = excluded.boundary;
  return new;
end $$;

-- re-mirror everything once
update public.jobsites set name = name where id is not null;
