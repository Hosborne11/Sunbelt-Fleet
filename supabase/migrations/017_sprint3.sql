-- =====================================================================
-- 017 · Sprint 3
--   A. PM views: serial number on the PM calendar (the Maintenance Plans list reads it from assets).
--   B. Utilization: public.utilization_settings (thresholds) and public.asset_utilization:
--      last day used, days unused (running count), idle share of engine hours over a window,
--      and the High idle / Unused flags shown on the Assets screen.
--   C. Reports: public.report_daily_rows() feeds the custom report builder (one row per machine per
--      day); public.saved_reports keeps report definitions.
-- Run after 016. Safe to re-run.
-- =====================================================================

-- A. PM calendar: serial number (column added at the end)
create or replace view public.pm_calendar with (security_invoker = true) as
select r.id as request_id, r.asset_id, r.plan_id, r.status,
       case when r.status = 'proposed' then r.proposed_date
            when r.status = 'completed' then coalesce(r.completed_on, r.scheduled_date)
            else r.scheduled_date end                                   as service_date,
       case when r.status = 'proposed' then r.proposed_time else r.scheduled_time end as service_time,
       (r.status in ('scheduled', 'awaiting_confirmation', 'completed'))  as confirmed,
       r.vendor_id, coalesce(v.name, r.vendor_name)                     as vendor_name,
       a.asset_number, a.make, a.model, a.crew_id, c.name                 as crew_name,
       p.name                                                             as plan_name,
       t.current_project                                                  as jobsite,
       coalesce(r.site_contact_name, j.site_contact_name)                 as site_contact_name,
       coalesce(r.site_contact_phone, j.site_contact_phone)               as site_contact_phone,
       a.serial_number
  from public.pm_requests r
  join public.assets a on a.id = r.asset_id
  left join public.pm_vendors v on v.id = r.vendor_id
  left join public.crews c on c.id = a.crew_id
  left join public.maintenance_plans p on p.id = r.plan_id
  left join public.asset_telematics t on t.asset_id = r.asset_id
  left join public.jobsites j on j.id = t.current_project_id
 where (r.status in ('proposed', 'scheduled', 'awaiting_confirmation') and
        (case when r.status = 'proposed' then r.proposed_date else r.scheduled_date end) is not null)
    or (r.status = 'completed' and coalesce(r.completed_on, r.scheduled_date) >= current_date - 120);
grant select on public.pm_calendar to authenticated;

-- B. Utilization
create table if not exists public.utilization_settings (
  id                boolean primary key default true check (id),
  idle_alert_pct    numeric not null default 35,   -- flag when idle is at least this share of engine hours
  idle_window_days  int     not null default 14,   -- ... over this many days
  idle_min_hours    numeric not null default 2,    -- ... with at least this many engine hours (avoids noise)
  unused_alert_days int     not null default 7,    -- flag when unused for this many days or more
  updated_at        timestamptz not null default now()
);
insert into public.utilization_settings (id) values (true) on conflict (id) do nothing;
alter table public.utilization_settings enable row level security;
drop policy if exists staff_all on public.utilization_settings;
create policy staff_all on public.utilization_settings for all to authenticated using (true) with check (true);
grant select, update on public.utilization_settings to authenticated;

create or replace view public.asset_utilization with (security_invoker = true) as
with s as (
  select * from public.utilization_settings where id
), d as (
  select (now() at time zone 'America/New_York')::date as today
), hist as (
  select u.asset_id,
         max(u.reading_date) filter (where u.hours_used >= 0.1) as last_used_date,
         min(u.reading_date)                                    as first_data_date
    from public.asset_daily_usage u
   group by u.asset_id
), win as (
  select u.asset_id,
         sum(u.hours_used)                                as engine_hours,
         sum(u.idle_hours_used)                           as idle_hours,
         count(*) filter (where u.hours_used >= 0.1)      as days_used
    from public.asset_daily_usage u, s, d
   where u.reading_date > d.today - s.idle_window_days
   group by u.asset_id
), base as (
  select a.id as asset_id, h.last_used_date, w.engine_hours, w.idle_hours, w.days_used, s.*,
         case when coalesce(t.hours_today, 0) >= 0.1 then 0
              when h.last_used_date is not null then d.today - h.last_used_date
              when h.first_data_date is not null then d.today - h.first_data_date
         end as days_unused,
         case when w.engine_hours >= s.idle_min_hours and w.idle_hours is not null
              then 100 * w.idle_hours / w.engine_hours end as idle_pct
    from public.assets a
    cross join s cross join d
    left join hist h on h.asset_id = a.id
    left join win w on w.asset_id = a.id
    left join public.asset_telematics t on t.asset_id = a.id
   where a.status <> 'retired' and a.telematics_asset_id is not null
)
select asset_id, last_used_date, days_unused,
       round(engine_hours, 1)              as engine_hours_window,
       round(idle_hours, 1)                as idle_hours_window,
       round(idle_pct)                     as idle_pct_window,
       coalesce(days_used, 0)::int         as days_used_window,
       idle_window_days,
       coalesce(idle_pct >= idle_alert_pct, false)              as high_idle,
       coalesce(days_unused >= unused_alert_days, false)        as unused_alert
  from base;
grant select on public.asset_utilization to authenticated;
revoke all on public.asset_utilization from anon;

-- C. Custom reports: one row per machine per day (engine hours, idle, fuel, loads, tons, T&M, time on site)
create or replace function public.report_daily_rows(p_from date, p_to date, p_assets uuid[] default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with u as (
    select d.asset_id, d.reading_date, d.hours_used, d.idle_hours_used, d.fuel_used_gal, d.loads,
           d.payload_tons, d.project_name, d.job_number, d.tm_rate
      from public.asset_daily_usage d
     where d.reading_date between p_from and p_to and (p_assets is null or d.asset_id = any(p_assets))
  ), s as (
    select st.asset_id, st.reading_date, sum(st.hours_on_site) as site_hours
      from public.asset_site_time st
     where st.reading_date between p_from and p_to and (p_assets is null or st.asset_id = any(p_assets))
     group by st.asset_id, st.reading_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', coalesce(u.reading_date, s.reading_date), 'asset_id', a.id,
           'asset_number', a.asset_number, 'machine', concat_ws(' ', a.make, a.model), 'serial', a.serial_number,
           'category', cat.name, 'crew', cr.name,
           'jobsite', coalesce(u.project_name, 'No jobsite'), 'job_number', u.job_number,
           'hours', round(coalesce(u.hours_used, 0), 2), 'idle_hours', round(u.idle_hours_used, 2),
           'fuel_gal', round(u.fuel_used_gal, 2), 'loads', u.loads, 'tons', u.payload_tons,
           'tm_amount', round(u.hours_used * u.tm_rate, 2), 'site_hours', round(s.site_hours, 2))
         order by a.asset_number, coalesce(u.reading_date, s.reading_date)), '[]'::jsonb)
    from u
    full join s on s.asset_id = u.asset_id and s.reading_date = u.reading_date
    join public.assets a on a.id = coalesce(u.asset_id, s.asset_id)
    left join public.equipment_categories cat on cat.id = a.category_id
    left join public.crews cr on cr.id = a.crew_id
   where coalesce(u.hours_used, 0) > 0 or coalesce(s.site_hours, 0) > 0 or coalesce(u.loads, 0) > 0
$$;
revoke all on function public.report_daily_rows(date, date, uuid[]) from public, anon;
grant execute on function public.report_daily_rows(date, date, uuid[]) to authenticated;

create table if not exists public.saved_reports (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  definition jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_saved_reports_updated on public.saved_reports;
create trigger trg_saved_reports_updated before update on public.saved_reports
  for each row execute function public.set_updated_at();
alter table public.saved_reports enable row level security;
drop policy if exists staff_all on public.saved_reports;
create policy staff_all on public.saved_reports for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.saved_reports to authenticated;
