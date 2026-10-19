-- =====================================================================
-- 014 · Report: machine hours at each project over a date range
--   report_hours_by_project(assets, from, to): one row per machine per project
--     engine hours (each day's hours go to the jobsite the machine was at most that day,
--     "No jobsite" when it wasn't inside one), days worked, idle hours, T&M amount,
--     and time on site inside the jobsite boundary.
--   report_hours_daily(assets, from, to): the same engine hours per day, for the download.
-- Runs with the signed-in user's access. Safe to re-run.
-- =====================================================================

create or replace function public.report_hours_by_project(p_assets uuid[], p_from date, p_to date)
returns table (asset_id uuid, project_id uuid, jobsite text, job_number text, days int,
               engine_hours numeric, idle_hours numeric, tm_amount numeric, hours_on_site numeric)
language sql stable security invoker set search_path = public as $$
  with u as (
    select d.asset_id, d.project_id,
           coalesce(d.project_name, 'No jobsite') as jobsite, d.job_number,
           count(*) filter (where d.hours_used > 0)  as days,
           sum(d.hours_used)                         as engine_hours,
           sum(d.idle_hours_used)                    as idle_hours,
           sum(d.hours_used * d.tm_rate)             as tm_amount
      from public.asset_daily_usage d
     where d.asset_id = any(p_assets) and d.reading_date between p_from and p_to
     group by d.asset_id, d.project_id, coalesce(d.project_name, 'No jobsite'), d.job_number
  ), s as (
    select st.asset_id, st.project_id, max(st.jobsite) as jobsite, max(st.job_number) as job_number,
           sum(st.hours_on_site) as hours_on_site
      from public.asset_site_time st
     where st.asset_id = any(p_assets) and st.reading_date between p_from and p_to
     group by st.asset_id, st.project_id
  )
  select coalesce(u.asset_id, s.asset_id), coalesce(u.project_id, s.project_id),
         coalesce(u.jobsite, s.jobsite, 'No jobsite'), coalesce(u.job_number, s.job_number),
         coalesce(u.days, 0)::int,
         round(coalesce(u.engine_hours, 0), 1), round(coalesce(u.idle_hours, 0), 1),
         round(u.tm_amount, 2), round(s.hours_on_site, 2)
    from u
    full join s on s.asset_id = u.asset_id and s.project_id = u.project_id
   where coalesce(u.engine_hours, 0) > 0 or coalesce(s.hours_on_site, 0) > 0
$$;

-- daily engine hours (one JSON array, so long ranges aren't cut off by the API's row limit)
create or replace function public.report_hours_daily(p_assets uuid[], p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'asset_id', d.asset_id, 'date', d.reading_date,
           'jobsite', coalesce(d.project_name, 'No jobsite'), 'job_number', d.job_number,
           'hours', round(d.hours_used, 2))
         order by d.asset_id, d.reading_date), '[]'::jsonb)
    from public.asset_daily_usage d
   where d.asset_id = any(p_assets) and d.reading_date between p_from and p_to and d.hours_used > 0
$$;

revoke all on function public.report_hours_by_project(uuid[], date, date) from public, anon;
revoke all on function public.report_hours_daily(uuid[], date, date) from public, anon;
grant execute on function public.report_hours_by_project(uuid[], date, date) to authenticated;
grant execute on function public.report_hours_daily(uuid[], date, date) to authenticated;
