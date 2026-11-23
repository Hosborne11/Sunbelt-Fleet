-- =====================================================================
-- 018 · Sprint 4: GoAardvark-style daily reports
--   * assets.ownership (Owned / Rental / Leased / RPO) for the reports' Status column
--     ("Active - Owned"); machines GoAardvark listed as rentals start as Rental.
--   * public.report_settings: daily email list, send hour, thresholds, which reports.
--   * public.report_maintenance_due(): GoAardvark "Maintenance Due" layout.
--   * public.report_daily_utilization(): GoAardvark "DailyUtilization" layout (prior day).
--   pm-workflow v5 builds the two Excel files and emails them each morning.
-- Run after 017. Safe to re-run.
-- =====================================================================

alter table public.assets add column if not exists ownership text not null default 'Owned';
alter table public.assets drop constraint if exists assets_ownership_check;
alter table public.assets add constraint assets_ownership_check check (ownership in ('Owned', 'Rental', 'Leased', 'RPO'));
update public.assets set ownership = 'Rental'
 where status <> 'retired' and ownership = 'Owned'
   and public.norm_serial(serial_number) in (public.norm_serial('1T0650PALRLX09474'));

create table if not exists public.report_settings (
  id                     boolean primary key default true check (id),
  enabled                boolean not null default false,
  recipients             text[]  not null default '{}',
  send_hour              int     not null default 7 check (send_hour between 0 and 23),   -- Eastern
  workday_hours          numeric not null default 8 check (workday_hours > 0),           -- Util Hrs % = hours / this
  pm_due_within_hours    numeric not null default 100,                                   -- Maintenance Due window
  send_maintenance_due   boolean not null default true,
  send_daily_utilization boolean not null default true,
  last_sent_on           date,
  last_error             text,
  updated_at             timestamptz not null default now()
);
insert into public.report_settings (id) values (true) on conflict (id) do nothing;
alter table public.report_settings enable row level security;
drop policy if exists staff_all on public.report_settings;
create policy staff_all on public.report_settings for all to authenticated using (true) with check (true);
grant select, update on public.report_settings to authenticated;

-- Maintenance Due: active PM plans within the window (overdue included), closest first
create or replace function public.report_maintenance_due(p_within numeric default null)
returns table (machine_name text, make text, model text, serno text, status text, hrs_mi numeric, job text,
               work_order_status text, plan text, report_date date, due_hrs_mil numeric,
               hrs_mi_to_service numeric, scheduled_date timestamp)
language sql stable security invoker set search_path = public as $$
  with s as (
    select coalesce(p_within, pm_due_within_hours) as within from public.report_settings where id
  ), req as (
    select distinct on (r.plan_id) r.plan_id, r.status, r.scheduled_date, r.scheduled_time
      from public.pm_requests r
     where r.status in ('requested', 'proposed', 'scheduled', 'awaiting_confirmation')
     order by r.plan_id, r.created_at desc
  )
  select a.asset_number, upper(a.make), a.model, a.serial_number,
         'Active - ' || a.ownership,
         round(a.hour_meter, 2),
         coalesce(t.current_project, j.name),
         case req.status when 'requested' then 'Requested' when 'proposed' then 'Date Proposed'
                         when 'scheduled' then 'Schedule Confirmed'
                         when 'awaiting_confirmation' then 'Awaiting Completion'
                         else 'Not Requested' end,
         p.name,
         (now() at time zone 'America/New_York')::date,
         p.next_due_hours,
         round(p.next_due_hours - a.hour_meter, 2),
         case when req.status in ('scheduled', 'awaiting_confirmation') and req.scheduled_date is not null
              then (req.scheduled_date + coalesce(req.scheduled_time, time '00:00'))::timestamp end
    from public.maintenance_plans p
    join public.assets a on a.id = p.asset_id
    cross join s
    left join req on req.plan_id = p.id
    left join public.asset_telematics t on t.asset_id = a.id
    left join public.jobsites j on j.id = a.jobsite_id
   where p.active and a.status <> 'retired'
     and a.hour_meter is not null and p.next_due_hours is not null
     and p.next_due_hours - a.hour_meter <= s.within
   order by p.next_due_hours - a.hour_meter, a.asset_number
$$;

-- Daily Utilization: every machine (OneStep pickups excluded), for the prior day
create or replace function public.report_daily_utilization(p_day date default null)
returns table (for_date timestamp, machine_name text, make text, model text, serno text, hours numeric, job text,
               status text, days_since_used int, prior_day_inspection_completed text,
               fuel_used_prior_day numeric, hours_od_prior_day numeric, idle_hours_prior_day numeric,
               util_hrs_pct_prior_day numeric)
language sql stable security invoker set search_path = public, fleet as $$
  with s as (
    select workday_hours from public.report_settings where id
  ), d as (
    select coalesce(p_day, (now() at time zone 'America/New_York')::date - 1) as prior
  )
  select (now() at time zone 'America/New_York'),
         a.asset_number, upper(a.make), a.model, coalesce(f.pin, a.serial_number),
         round(a.hour_meter, 2),
         coalesce(t.current_project, j.name),
         'Active - ' || a.ownership,
         ut.days_unused,
         case when exists (select 1 from public.inspections i
                            where i.asset_id = a.id and i.inspection_type = 'daily' and i.inspected_at = d.prior)
              then 'YES' else 'NO' end,
         round(u.fuel_used_gal, 2),
         round(u.hours_used, 2),
         round(u.idle_hours_used, 2),
         round(coalesce(u.hours_used, 0) / s.workday_hours, 4)
    from public.assets a
    cross join s cross join d
    join fleet.assets f on f.id = a.telematics_asset_id
    left join public.asset_daily_usage u on u.asset_id = a.id and u.reading_date = d.prior
    left join public.asset_telematics t on t.asset_id = a.id
    left join public.jobsites j on j.id = a.jobsite_id
    left join public.asset_utilization ut on ut.asset_id = a.id
   where a.status <> 'retired' and f.source_code <> 'onestep'
   order by a.asset_number
$$;

grant execute on function public.report_maintenance_due(numeric) to authenticated;
grant execute on function public.report_daily_utilization(date) to authenticated;
