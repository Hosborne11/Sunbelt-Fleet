-- =====================================================================
-- 016 · Sprint 2 (PM workflow)
--   A. Site contact: on each jobsite, with an optional override on each PM request.
--   B. Location tracking for open requests (the last location the vendor was told about),
--      so pm-workflow can email the vendor when a machine moves.
--   C. Vendor view: one private link per vendor (pm_vendors.portal_token).
--   D. public.pm_calendar: PM services by date for the calendar.
-- Run after 015. Safe to re-run.
-- =====================================================================

-- A. Site contact
alter table public.jobsites add column if not exists site_contact_name  text;
alter table public.jobsites add column if not exists site_contact_phone text;
alter table public.jobsites add column if not exists site_contact_email text;

alter table public.pm_requests add column if not exists site_contact_name  text;
alter table public.pm_requests add column if not exists site_contact_phone text;
alter table public.pm_requests add column if not exists site_contact_email text;

-- B. Where the vendor was last told the machine is
alter table public.pm_requests add column if not exists notified_project_id    uuid;
alter table public.pm_requests add column if not exists notified_lat           float8;
alter table public.pm_requests add column if not exists notified_lng           float8;
alter table public.pm_requests add column if not exists notified_at            timestamptz;
alter table public.pm_requests add column if not exists last_location_notice_at timestamptz;
alter table public.pm_requests add column if not exists location_notice_count  int not null default 0;

-- C. Vendor view link (64 hex characters; regenerate if a link is shared by mistake)
alter table public.pm_vendors add column if not exists portal_token text;
update public.pm_vendors
   set portal_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where portal_token is null;
alter table public.pm_vendors alter column portal_token
  set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table public.pm_vendors alter column portal_token set not null;
create unique index if not exists pm_vendors_portal_token_uq on public.pm_vendors (portal_token);

create or replace function public.rotate_vendor_portal_link(p_vendor uuid) returns text
language sql security invoker set search_path = public as $$
  update public.pm_vendors
     set portal_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where id = p_vendor
  returning portal_token
$$;
grant execute on function public.rotate_vendor_portal_link(uuid) to authenticated;

-- D. Calendar: one row per open or recently completed PM service, on its scheduled (or proposed) date
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
       coalesce(r.site_contact_phone, j.site_contact_phone)               as site_contact_phone
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
revoke all on public.pm_calendar from anon;
