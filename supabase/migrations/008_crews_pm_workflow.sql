-- =====================================================================
-- 008: crews + PM scheduling workflow with the service vendor (James River Equipment)
--
--  Crews
--   * every asset can be designated Pipe or Site crew (more crews can be added to public.crews)
--   * daily usage carries the crew, and daily_hours_by_crew rolls hours up for job costing
--
--  PM workflow  (emails are sent by the pm-workflow Edge Function)
--   requested  -> staff click "Request service"; the vendor contact gets an email with a link
--   scheduled  -> the vendor picks the date (and optional time); it shows on the PM plan in the app
--                 * reminder to the foreman distro ~24 hours before, and again the morning of
--   awaiting_confirmation -> the morning after the service date, the vendor is asked to confirm:
--                 date done, hour meter at service, optional work order upload
--   completed  -> a maintenance_services row is logged; next PM = that hour meter + 500
--   cancelled
-- =====================================================================

-- ---------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------
create table if not exists public.crews (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  cost_code  text,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.crews (name, sort_order) values ('Pipe', 1), ('Site', 2) on conflict (name) do nothing;

alter table public.assets add column if not exists crew_id uuid references public.crews(id) on delete set null;
create index if not exists assets_crew_idx on public.assets (crew_id);

-- Daily usage now carries the crew (columns appended to the existing view)
create or replace view public.asset_daily_usage with (security_invoker = true) as
select a.id as asset_id, m.reading_date, m.closing_hours, m.hours_used, m.idle_hours_used, m.idle_pct,
       m.fuel_used, m.fuel_units, m.fuel_used_gal, m.loads,
       m.project_id, m.project_name,
       a.crew_id, c.name as crew_name
  from public.assets a
  join fleet.v_daily_metrics m on m.asset_id = a.telematics_asset_id
  left join public.crews c on c.id = a.crew_id;

-- Job costing rollup: machine hours per day, crew and jobsite
create or replace view public.daily_hours_by_crew with (security_invoker = true) as
select u.reading_date,
       coalesce(u.crew_name, 'Unassigned') as crew,
       u.project_id, coalesce(u.project_name, 'No jobsite') as jobsite,
       count(distinct u.asset_id)          as machines,
       round(sum(u.hours_used), 1)         as machine_hours,
       round(sum(u.idle_hours_used), 1)    as idle_hours,
       round(sum(u.fuel_used_gal), 1)      as fuel_gal
  from public.asset_daily_usage u
 group by 1, 2, 3, 4;

-- ---------------------------------------------------------------------
-- Workflow settings (single row) — edited on the PM workflow settings page
-- ---------------------------------------------------------------------
create table if not exists public.pm_settings (
  id                   boolean primary key default true check (id),
  vendor_name          text not null default 'James River Equipment',
  vendor_contact_name  text,
  vendor_contact_email text,
  vendor_cc            text[] not null default '{}',
  reminder_recipients  text[] not null default '{}',  -- foreman distro: 24-hour and morning-of reminders
  notify_recipients    text[] not null default '{}',  -- extra people told when JRE schedules / completes
  updated_at           timestamptz not null default now()
);
insert into public.pm_settings default values on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------
create table if not exists public.pm_requests (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references public.maintenance_plans(id) on delete cascade,
  asset_id             uuid not null references public.assets(id) on delete cascade,
  status               text not null default 'requested'
                         check (status in ('requested','scheduled','awaiting_confirmation','completed','cancelled')),
  token                text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  vendor_name          text,
  vendor_email         text,
  requested_by         text,
  requested_notes      text,
  preferred_date       date,
  requested_at         timestamptz not null default now(),
  request_resent_at    timestamptz,
  scheduled_date       date,
  scheduled_time       time,
  scheduled_notes      text,
  scheduled_at         timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_day_sent_at timestamptz,
  followup_count       int not null default 0,
  last_followup_at     timestamptz,
  completed_on         date,
  completed_hours      numeric,
  completed_notes      text,
  work_order_path      text,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists pm_requests_one_open
  on public.pm_requests (plan_id) where status in ('requested','scheduled','awaiting_confirmation');
create index if not exists pm_requests_open_idx on public.pm_requests (status) where status not in ('completed','cancelled');
drop trigger if exists pm_requests_touch on public.pm_requests;
create trigger pm_requests_touch before update on public.pm_requests
  for each row execute function public.set_updated_at();

create table if not exists public.pm_email_log (
  id         bigint generated always as identity primary key,
  request_id uuid references public.pm_requests(id) on delete cascade,
  kind       text not null,          -- request | request_reminder | scheduled | reminder_24h | reminder_day | followup | completed | cancelled
  recipients text[] not null default '{}',
  subject    text,
  ok         boolean not null,
  error      text,
  sent_at    timestamptz not null default now()
);
create index if not exists pm_email_log_request_idx on public.pm_email_log (request_id, sent_at desc);

-- Completed services can carry the vendor's work order and the request they closed
alter table public.maintenance_services add column if not exists attachment_path text;
alter table public.maintenance_services add column if not exists request_id uuid references public.pm_requests(id) on delete set null;

-- ---------------------------------------------------------------------
-- Keep the PM plan's scheduled date in step with the request
-- ---------------------------------------------------------------------
create or replace function public.pm_requests_sync_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'scheduled' and new.scheduled_date is not null then
    update public.maintenance_plans
       set scheduled_for  = new.scheduled_date,
           scheduled_note = coalesce(new.vendor_name, 'Vendor')
                            || coalesce(', ' || to_char(new.scheduled_time, 'FMHH12:MI AM'), '')
     where id = new.plan_id;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.maintenance_plans
       set scheduled_for = null, scheduled_note = null
     where id = new.plan_id and scheduled_for is not distinct from old.scheduled_date;
  end if;
  return new;
end $$;
drop trigger if exists pm_requests_sync_plan on public.pm_requests;
create trigger pm_requests_sync_plan after insert or update of status, scheduled_date, scheduled_time on public.pm_requests
  for each row execute function public.pm_requests_sync_plan();

-- A service logged by hand in Fleet closes any open vendor request for that plan
-- (so the vendor isn't asked to confirm a service someone already recorded)
create or replace function public.maintenance_services_close_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.request_id is null then
    update public.pm_requests
       set status = 'completed', completed_on = new.performed_on, completed_hours = new.hours,
           completed_notes = coalesce(new.notes, 'Logged in Fleet'), work_order_path = new.attachment_path,
           completed_at = now()
     where plan_id = new.plan_id and status in ('requested','scheduled','awaiting_confirmation');
  end if;
  return null;
end $$;
drop trigger if exists maintenance_services_close_request on public.maintenance_services;
create trigger maintenance_services_close_request after insert on public.maintenance_services
  for each row execute function public.maintenance_services_close_request();

-- ---------------------------------------------------------------------
-- Next-PM view for the Assets table: add the open request (columns appended)
-- ---------------------------------------------------------------------
create or replace view public.asset_next_pm with (security_invoker = true) as
select n.*,
       r.id             as request_id,
       r.status         as request_status,
       r.scheduled_date as request_scheduled_date,
       r.scheduled_time as request_scheduled_time
  from (select distinct on (asset_id) * from public.pm_status
         order by asset_id, hours_until_due asc nulls last) n
  left join public.pm_requests r
    on r.plan_id = n.plan_id and r.status in ('requested','scheduled','awaiting_confirmation');

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crews','pm_settings','pm_requests','pm_email_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on public.daily_hours_by_crew from anon;
grant select on public.daily_hours_by_crew, public.asset_daily_usage, public.asset_next_pm to authenticated;

-- ---------------------------------------------------------------------
-- Work order uploads (private bucket; vendor uploads through one-time signed links)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pm-workorders', 'pm-workorders', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "staff read pm work orders" on storage.objects;
create policy "staff read pm work orders" on storage.objects
  for select to authenticated using (bucket_id = 'pm-workorders');
drop policy if exists "staff upload pm work orders" on storage.objects;
create policy "staff upload pm work orders" on storage.objects
  for insert to authenticated with check (bucket_id = 'pm-workorders');

-- ---------------------------------------------------------------------
-- Every 15 minutes while requests are open: reminders and follow-ups
-- ---------------------------------------------------------------------
create or replace function public.invoke_pm_cron() returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'fleet_project_url') || '/functions/v1/pm-workflow',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-fleet-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'fleet_cron_key')),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )
   where exists (select 1 from public.pm_requests where status in ('requested','scheduled','awaiting_confirmation'));
$$;
revoke all on function public.invoke_pm_cron() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'pm-notify';
select cron.schedule('pm-notify', '*/15 * * * *', $$ select public.invoke_pm_cron() $$);
