-- =====================================================================
-- 010: reconcile the Fleet registry with the SharePoint "Asset Management" list
--
--  * adds a T&M rate ($/hr) to assets and carries it into job costing (daily_hours_by_crew.tm_amount)
--  * loads the SharePoint export into public.sharepoint_assets_import
--  * public.sharepoint_reconcile_preview shows every match / gap BEFORE anything changes
--  * select public.apply_sharepoint_reconcile();  applies it:
--      - only machines ACTIVE in SharePoint and IN SERVICE in Fleet, matched by serial / PIN
--      - SharePoint wins for: asset #, crew, T&M rate (when SharePoint has a value)
--      - fills Fleet blanks for: year, make, purchase date/price, salvage value, useful life, category
--      - nothing is added to Fleet and nothing is deleted
-- Safe to re-run: the import table is rebuilt each time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- T&M rate
-- ---------------------------------------------------------------------
alter table public.assets add column if not exists tm_rate numeric;   -- time & material bill rate, $ per machine hour

insert into public.equipment_categories (name, icon, sort_order) values ('Wheel Loader', 'truck', 8)
on conflict (name) do nothing;

-- daily usage carries the rate (column appended)
create or replace view public.asset_daily_usage with (security_invoker = true) as
select a.id as asset_id, m.reading_date, m.closing_hours, m.hours_used, m.idle_hours_used, m.idle_pct,
       m.fuel_used, m.fuel_units, m.fuel_used_gal, m.loads,
       m.project_id, m.project_name,
       a.crew_id, c.name as crew_name,
       a.tm_rate
  from public.assets a
  join fleet.v_daily_metrics m on m.asset_id = a.telematics_asset_id
  left join public.crews c on c.id = a.crew_id
 where a.retired_on is null or m.reading_date <= a.retired_on;

-- job costing: T&M value = machine hours x rate (column appended)
create or replace view public.daily_hours_by_crew with (security_invoker = true) as
select u.reading_date,
       coalesce(u.crew_name, 'Unassigned') as crew,
       u.project_id, coalesce(u.project_name, 'No jobsite') as jobsite,
       count(distinct u.asset_id)          as machines,
       round(sum(u.hours_used), 1)         as machine_hours,
       round(sum(u.idle_hours_used), 1)    as idle_hours,
       round(sum(u.fuel_used_gal), 1)      as fuel_gal,
       round(sum(u.hours_used * u.tm_rate), 2) as tm_amount
  from public.asset_daily_usage u
 group by 1, 2, 3, 4;
grant select on public.asset_daily_usage, public.daily_hours_by_crew to authenticated;

-- ---------------------------------------------------------------------
-- SharePoint export (Asset_Management.csv)
-- ---------------------------------------------------------------------
drop table if exists public.sharepoint_assets_import cascade;
create table public.sharepoint_assets_import (
  row_no          int primary key,
  machine_number  text,
  title           text,
  serial_raw      text,
  serial          text,        -- cleaned for matching (null when unusable)
  serial_note     text,
  active          boolean,
  rpo_duplicate   boolean,     -- inactive "- RPO" row that duplicates the purchased machine
  make            text,
  model           text,
  equipment_type  text,
  crew            text,        -- Pipe | Site
  tm_rate         numeric,
  model_year      int,
  purchase_date   date,
  purchase_price  numeric,
  salvage_value   numeric,
  useful_life_yrs int,
  disposal_date   date,
  serial_norm     text generated always as (public.norm_serial(serial)) stored
);
alter table public.sharepoint_assets_import enable row level security;   -- not exposed to the app
revoke all on public.sharepoint_assets_import from anon, authenticated;

insert into public.sharepoint_assets_import
  (row_no, machine_number, title, serial_raw, serial, serial_note, active, rpo_duplicate, make, model,
   equipment_type, crew, tm_rate, model_year, purchase_date, purchase_price, salvage_value, useful_life_yrs, disposal_date)
values
(1, null, '2019 Freightliner 4x2 M2106', '1FVACXFC1KHKE6680', '1FVACXFC1KHKE6680', null, true, false, null, 'M2', 'Trucks', null, null, 2019, '2020-01-01', null, 0.0, 7, null),
(2, null, '2019 Ford Super Duty F-350 Crew XLT 6.7L 4x4 DRW', '1FT8W3DTXKEE42457', '1FT8W3DTXKEE42457', null, true, false, 'Ford', 'F-350', 'Trucks', null, null, 2019, '2020-01-01', null, 0.0, 7, null),
(3, null, '2014 Ford F250 4x2 Crew Cab Super Duty', '1FD7W2A6XEEB88253', '1FD7W2A6XEEB88253', null, true, false, 'Ford', 'F-250', 'Trucks', null, null, 2019, '2020-01-01', null, 0.0, 7, null),
(4, null, '2014 Ford F350 4x2 Crew Cab Super Duty', '1FD8W3GT0EEA93742', '1FD8W3GT0EEA93742', null, true, false, 'Ford', 'F-350', 'Trucks', null, null, 2014, '2020-01-01', null, 0.0, 7, null),
(5, null, '2005 F550-750 Series', '3FRPF75N45178490', '3FRPF75N45178490', null, true, false, 'Ford', 'F-550', 'Trucks', null, null, 2005, null, null, 0.0, 7, null),
(6, null, '2017 Ford F350 4x2 Crew Cab Super Duty', '1FD8W3GT5HEB66592', '1FD8W3GT5HEB66592', null, true, false, 'Ford', 'F-350', 'Trucks', null, null, 2017, null, null, 0.0, 7, null),
(7, null, '2000 Ford F550-750 Series', '3FDPF7560YMA41817', '3FDPF7560YMA41817', null, true, false, 'Ford', null, 'Trucks', null, null, 2000, null, null, 0.0, 7, null),
(8, null, '2001 F250-450 Series', '1FDXF46F61EA98676', '1FDXF46F61EA98676', null, false, false, 'Ford', 'F-450', 'Trucks', null, null, 2001, null, null, 0.0, 7, '2025-01-06'),
(9, null, '2013 F750', '3FRXF7FG8DV028025', '3FRXF7FG8DV028025', null, false, false, 'Ford', 'F-750', 'Trucks', null, null, 2013, null, null, 0.0, 7, '2025-01-08'),
(10, null, '1999 F550', '1FDAF56F7XEC95926', '1FDAF56F7XEC95926', null, true, false, 'Ford', 'F550', 'Trucks', null, null, 1999, null, null, 0.0, 7, null),
(11, null, '2018 F150 Crew cab Lariat 5.0', '1FTEW1E53JKF63872', '1FTEW1E53JKF63872', null, false, false, 'Ford', 'F-150', 'Trucks', null, null, 2018, null, null, 0.0, 7, null),
(12, null, '2019 F250 4X4', '1FT7W2BT4KEG63500', '1FT7W2BT4KEG63500', null, true, false, 'Ford', 'F-250', 'Trucks', null, null, 2019, null, null, 0.0, 7, null),
(13, null, '2020 F450 Crew Cab', '1FD0W4GT7LEE52570', '1FD0W4GT7LEE52570', null, true, false, 'Ford', 'F450', 'Trucks', null, null, 2020, null, null, 0.0, 7, null),
(14, null, '2024 F450', '1FD0W4GT7REE53999', '1FD0W4GT7REE53999', null, true, false, 'Ford', 'F450', 'Trucks', null, null, 2024, '2024-12-31', 86545.94, 8654.59, 7, null),
(15, null, '2025 F650', '1FDNF6AN0SDF05657', '1FDNF6AN0SDF05657', null, true, false, 'Ford', 'F650', 'Trucks', null, null, 2025, '2025-01-08', 34455.52, 3445.55, null, null),
(16, null, '2024 F350 Truck', '1FT8W3BA6REF39120', '1FT8W3BA6REF39120', null, true, false, 'Ford', 'F350', 'Trucks', null, null, 2024, '2025-03-26', 53584.93, 5358.49, null, null),
(17, null, '2026 Ford F150', '1FTFW1RJ1TFA18051', '1FTFW1RJ1TFA18051', null, true, false, null, 'F150', 'Trucks', null, null, 2026, '2026-01-29', 158056.0, 15805.6, null, null),
(18, null, '2026 Ford F150', '1FTFW1L88TKD75790', '1FTFW1L88TKD75790', null, true, false, 'Ford', 'F150', 'Trucks', null, null, 2026, '2026-06-26', 61139.56, 6113.96, null, null),
(19, null, '2006 Hudson Trailer', '10HHTD1D261000030', '10HHTD1D261000030', null, true, false, 'Hudson', null, 'Trailers', null, null, 2006, null, null, 0.0, 7, null),
(20, null, '2004 Hudson Trailer', '10HHSE18341001468', '10HHSE18341001468', null, true, false, 'Hudson', null, 'Trailers', null, null, 2004, null, null, 0.0, 7, null),
(21, null, '2017 Red Hot Trailer', '1S91C822HR763843', '1S91C822HR763843', null, true, false, 'Red Hot', null, 'Trailers', null, null, 2017, null, null, 0.0, 7, null),
(22, null, '2017 Red Hot Trailer', '1S9FA1221HR763381', '1S9FA1221HR763381', null, true, false, 'Red Hot', null, 'Trailers', null, null, 2017, null, null, 0.0, 7, null),
(23, null, '2022 Gatormade 20+5 Gooseneck Trailer', '4Z1PB2527NS005574', '4Z1PB2527NS005574', null, true, false, 'Gatormade', null, 'Trailers', null, null, 2022, null, 17340.0, 1734.0, null, null),
(24, null, '2024 John Deere Utility Tractor', '1LV5115MKJJ402366', '1LV5115MKJJ402366', null, true, false, 'John Deere', '5115', 'Tractor', null, null, 2024, '2024-11-04', 82646.0, 8264.6, null, null),
(25, '10', '2018 John Deere 325G Compact Track Loader', '1T0325GMAMJ390213', '1T0325GMAMJ390213', null, false, false, 'John Deere', '325G', 'Skid steers', 'Site', 115.0, 2018, '2021-01-01', 50000.0, 5000.0, 7, '2025-06-23'),
(26, '3', '2021 John Deere 331G Compact Loader', '1T0331GKALF383770', '1T0331GKALF383770', null, false, false, 'John Deere', '331G', 'Skid steers', 'Site', 115.0, 2021, '2021-01-01', 70000.0, 7000.0, 7, '2025-06-27'),
(27, null, '2018 John Deere 331G Compact Loader', '1T0333GMAJF333025', '1T0333GMAJF333025', null, false, false, 'John Deere', '333G', 'Skid steers', null, null, 2018, '2020-01-01', 85000.0, 8500.0, 7, null),
(28, '5', '2021 John Deere 333G Compact Track Loader', '1T0333GMEMF393928', '1T0333GMEMF393928', null, false, false, 'John Deere', '333G', 'Skid steers', 'Site', 115.0, 2021, '2021-01-01', 83900.0, 8390.0, 7, '2025-06-23'),
(29, '4', '2021 John Deere 333G Compact Track Loader', '1T0333GMHMF398612', '1T0333GMHMF398612', null, false, false, 'John Deere', '333G', 'Skid steers', 'Site', 115.0, 2021, '2021-01-01', 90000.0, 9000.0, 7, '2025-06-23'),
(30, '6', '2022 John Deere 331G', '1T0331GKLPF435101', '1T0331GKLPF435101', null, false, false, 'John Deere', '331G', 'Skid steers', 'Pipe', 115.0, 2022, '2022-01-01', 110000.0, 11000.0, 7, '2026-10-07'),
(31, '8', '2023 John Deere 325G Compact Track Loader', '1T0325GKAPJ445875', '1T0325GKAPJ445875', null, false, false, 'John Deere', '325G', 'Skid steers', 'Pipe', 115.0, 2023, '2023-01-01', 85000.0, 8500.0, 7, '2026-06-22'),
(32, '7', '2023 Case Dozer Loader DL550', 'NPM400911', 'NPM400911', null, false, false, 'Case', 'DL550', 'Skid steers', 'Site', 150.0, 2023, '2023-01-01', 160000.0, 16000.0, 7, '2025-12-31'),
(33, '9', '2023 John Deere 331G Skid Steer', '1T0331GMHPF456680', '1T0331GMHPF456680', null, false, false, 'John Deere', '331G', 'Skid steers', 'Site', 115.0, 2023, '2023-01-01', 110000.0, 11000.0, 7, '2025-06-23'),
(34, '1', '2018 John Deere 317G', '1T0317GJTHJ312709', '1T0317GJTHJ312709', null, false, false, 'John Deere', '317G', 'Skid steers', 'Site', 100.0, 2018, null, null, 0.0, null, '2025-06-23'),
(35, '2', '2024 John Deere 335P', '1T0335PACRFF03459', '1T0335PACRFF03459', null, true, false, 'John Deere', '335P', 'Skid steers', 'Site', 135.0, 2024, '2024-10-01', 147935.0, 14793.5, null, null),
(36, '9', '2025 JD 331P Compact Track Loader', '1T0331PAVSFB11050', '1T0331PAVSFB11050', null, true, false, 'John Deere', '331P', 'Skid steers', 'Site', null, 2025, '2025-06-25', 117800.0, 11780.0, null, null),
(37, '5', '2025 JD 331P Compact Track Loader', '1T0331PAPSFB10989', '1T0331PAPSFB10989', null, true, false, 'John Deere', '331 P', 'Skid steers', 'Site', null, 2025, '2025-06-25', 117800.0, 11780.0, null, null),
(38, '4', '2025 JD 331P Compact Track Loader', '1T0331PACSFB11113', '1T0331PACSFB11113', null, true, false, 'John Deere', '331P', 'Skid steers', 'Site', null, 2025, '2025-06-25', 117800.0, 11780.0, null, null),
(39, '10', '2025 JD 325G Compact Track Loader', '1T0325GKLSJ476053', '1T0325GKLSJ476053', null, true, false, 'John Deere', '325G', 'Skid steers', 'Site', 115.0, 2025, '2025-06-25', 97800.0, 9780.0, null, null),
(40, '1', '2025 JD 317G Compact Track Loader', '1P0317GJTSJ442234', '1P0317GJTSJ442234', null, true, false, 'John Deere', '317G', 'Skid steers', 'Site', 317.0, 2025, '2025-06-26', 127743.42, 12774.34, null, null),
(41, '8', '2026 JD 325P Compact Track Loader', '1T0325PAATJK18428', '1T0325PAATJK18428', null, true, false, 'John Deere', '325P', 'Skid steers', 'Pipe', 115.0, 2026, '2026-03-01', 89611.66, 8961.17, 7, null),
(42, '6', '2026 JD 331P Compact Track Loader', '1T0331PALTFB33280', '1T0331PALTFB33280', null, true, false, 'John Deere', '331P', 'Skid steers', 'Pipe', 115.0, 2026, '2026-10-08', 117927.36, 11792.74, null, null),
(43, '403', '2014 Bomag Trench Compactor', '1017212287', '1017212287', null, true, false, 'Bomag', 'BMP 8500', 'Rollers', 'Pipe', 85.0, 2014, '2024-04-01', 15000.0, 1500.0, 7, null),
(44, '402', '2005 HAAM Roller', 'H48072', 'H48072', null, true, false, 'HAMM', '3205P', 'Rollers', 'Site', 115.0, 2005, '2020-01-01', 50000.0, 5000.0, 7, null),
(45, '401', '2003 HAAM Roller', 'H1580113', 'H1580113', null, true, false, 'HAMM', '3205P', 'Rollers', 'Site', 115.0, 2003, '2020-01-01', 50000.0, 5000.0, 7, null),
(46, '408', '2019 HAMM H7i Roller', 'H2222832', 'H2222832', null, true, false, 'HAMM', 'H7i', 'Rollers', 'Site', 175.0, 2019, '2021-04-02', 104856.25, 10485.63, 7, null),
(47, '406', '2017 Hamm 84" Padfoot roller', 'H2110704', 'H2110704', null, true, false, 'HAMM', 'Padfoot roller', 'Rollers', 'Site', 225.0, 2017, '2020-01-01', 145000.0, 14500.0, 7, null),
(48, '404', '2017 Bomag BMP 8500 Trench Roller', '1.0172E+11', null, 'serial damaged by Excel export', true, false, 'Bomag', 'BMP 8500', 'Rollers', 'Pipe', 85.0, 2017, '2021-03-05', 32500.0, 3250.0, 7, null),
(49, '405', '2017 Bomag BMP 8500 Trench Roller', '1.0172E+11', null, 'serial damaged by Excel export', true, false, 'Bomag', 'BMP 8500', 'Rollers', 'Pipe', 85.0, null, '2020-01-01', 33500.0, 3350.0, 7, null),
(50, '409', '2020 Hamm H5i Roller', 'H2700275', 'H2700275', null, true, false, 'HAMM', 'H5i', 'Rollers', 'Site', 115.0, 2020, '2021-10-26', 87341.0, 8734.1, 7, null),
(51, '407', '2019 Hamm H7i Roller', 'H2222652', 'H2222652', null, true, false, 'HAMM', 'H7i', 'Rollers', 'Site', 175.0, 2019, '2020-01-01', 128747.43, 12874.74, 7, null),
(52, '410', '2020 Hamm H7i Smooth Drum Roller', 'H2700491', 'H2700491', null, true, false, 'HAMM', 'H7i', 'Rollers', 'Site', 175.0, 2020, '2020-01-01', 85000.0, 8500.0, 7, null),
(53, '411', '2023 Hamm HD12iVV Double Drum Roller', '411 - H2306680', 'H2306680', null, true, false, 'HAMM', 'HD12iVV', 'Rollers', 'Site', 115.0, 2023, '2023-01-01', 60000.0, 6000.0, 7, null),
(54, null, 'Wacker Neuson RTSC3 Trench Roller - Leased', '123456', '123456', null, true, false, 'Wacker', 'RTSC3', 'Rollers', null, 85.0, 2025, '2025-05-05', null, 0.0, null, null),
(55, '412', 'HAMM 50i', 'H2880908', 'H2880908', null, true, false, 'HAMM', '50i', 'Rollers', 'Site', 115.0, 2025, '2025-12-29', 108578.93, 10857.89, null, null),
(56, '413', '2026 Dynapac D.ONE Trench Roller - 71193', '1.01925E+11', null, 'serial damaged by Excel export', true, false, 'Dynapac', 'D.ONE', 'Rollers', 'Pipe', 85.0, 2026, '2026-09-04', 39000.0, 3900.0, null, null),
(57, '414', '2026 Dynapac D. One Trench Roller - 71196', '1.01925E+11', null, 'serial damaged by Excel export', true, false, 'Dynapac', 'D.ONE', 'Rollers', 'Pipe', 85.0, 2026, '2026-09-04', 39000.0, 3900.0, null, null),
(58, '415', '2026 Dynapac D.ONE Trench Roller - 71213', '1.01925E+11', null, 'serial damaged by Excel export', true, false, 'Dynapac', 'D.ONE', 'Rollers', null, 85.0, 2026, '2026-09-04', 39000.0, 3900.0, null, null),
(59, null, 'Sullican Air Compressor', '211662', '211662', null, true, false, null, '185', 'Msc', null, null, null, '2020-01-01', 30000.0, 3000.0, 7, null),
(60, null, 'John Deere Gator TH 6X4', '1M06X4DDVGM110484', '1M06X4DDVGM110484', null, true, false, 'John Deere', 'TH 6x4', 'Msc', null, null, null, '2020-01-01', 25000.0, 2500.0, 7, null),
(61, null, '2017 Mulcher', '170191', '170191', null, true, false, null, null, 'Msc', null, null, 2017, '2020-01-01', 50000.0, 5000.0, 7, null),
(62, null, 'Leica GPS System', '20104533', '20104533', null, true, false, 'Leica', null, 'Msc', null, null, null, '2020-01-01', 28000.0, 2800.0, 7, null),
(63, null, 'Leica Panel Configurator', '2632460', '2632460', null, true, false, 'Leica', 'MCP80', 'Msc', null, null, null, '2020-01-01', 50000.0, 5000.0, 7, null),
(64, null, 'Dual Reciever', '2975608', '2975608', null, true, false, null, null, 'Msc', null, null, null, '2020-01-01', 20000.0, 2000.0, 7, null),
(65, null, 'Leica Grading System', '2680658', '2680658', null, true, false, 'Leica', 'Icon GPS 60', 'Msc', null, null, 2023, '2023-05-03', 60058.8, 6005.88, 7, null),
(66, null, '2015 Case Forklift 588', 'JJGN580HCGC738018', 'JJGN580HCGC738018', null, true, false, 'Case', '588', 'Msc', null, null, 2015, '2020-01-01', 75000.0, 7500.0, 7, null),
(67, null, 'John Deere 3025E Tractor', '1LV3025ETKK137045', '1LV3025ETKK137045', null, true, false, 'John Deere', '3025E', 'Msc', null, null, null, '2020-01-01', 20000.0, 2000.0, 7, null),
(68, null, '2023 John Deere Gator 4x4', '1M0855MBCPM060258', '1M0855MBCPM060258', null, true, false, 'John Deere', 'XUV855M', 'Msc', null, null, 2023, '2024-04-28', 26836.85, 2683.69, 7, null),
(69, null, '2018 Morbark Boxer 600HD w/ 44" Blue Diamond Smooth Bucket', '21068862', '21068862', null, true, false, null, '600HD', 'Msc', null, null, 2018, '2020-01-01', 28000.0, 2800.0, 7, null),
(70, null, '2023 Leica iCG60 Dual GNSS System w/ iCON gps', null, null, null, true, false, 'Leica', 'iCG60', 'Msc', null, null, 2023, '2023-01-01', 65000.0, 6500.0, 7, null),
(71, null, 'John Deere XUV8 Gator', '1M0855MBJRM070099', '1M0855MBJRM070099', null, true, false, 'John Deere', 'XUV855M', 'Msc', null, null, 2023, '2024-04-18', 27536.85, 2753.69, 7, null),
(72, null, 'BOXER 600H Skid Steer Loader', '5483', '5483', null, true, false, null, '600H', 'Msc', null, null, null, '2022-04-22', 15796.0, 1579.6, 7, null),
(73, null, '2020 John Deere 5100E Utility Tractor', '1LV5100EELK408704', '1LV5100EELK408704', null, false, false, 'John Deere', '5100E', 'Msc', null, null, 2020, '2024-04-18', 60828.43, 6082.84, null, '2024-11-04'),
(74, null, 'B40 Straw Blower', 'MU-2389', 'MU-2389', null, true, false, null, null, 'Msc', null, null, null, null, null, 0.0, null, null),
(75, null, '2020 Pronar Shredder - RPO', 'XX0044-01', 'XX0044-01', null, false, true, 'Pronar', 'MRW285g', 'Msc', null, null, null, null, 560000.0, 56000.0, null, '2024-12-15'),
(76, null, 'Leica Bay Station - RPO', null, null, null, true, false, 'Leica', null, 'Msc', null, null, null, '2024-10-01', 27000.0, 2700.0, null, null),
(77, null, '2020 Pronar Shredder', 'XX0044', 'XX0044', null, true, false, 'Pronar', 'MRW285g', 'Msc', null, null, 2020, '2024-12-12', 394200.0, 39420.0, 10, null),
(78, null, '2025 CHCNAV MCPad300', 'MCP202504291238', 'MCP202504291238', null, true, false, null, 'MCPad300', 'Msc', null, null, 2025, '2026-04-21', 30149.8, 3014.98, 10, null),
(79, '501', '2019 Volvo Loader', '622059', '622059', null, true, false, 'Volvo', 'L60H', 'Loader', 'Pipe', 250.0, 2019, '2020-01-01', 168050.0, 16805.0, 7, null),
(80, '502', '2024 John Deere 544G Wheel Loader', '1YN544GALPLA00378', '1YN544GALPLA00378', null, true, false, 'John Deere', '544G', 'Loader', 'Pipe', 250.0, null, '2024-04-19', 207245.39, 20724.54, 7, null),
(81, null, '2024 John Deere 300E Loader', '1P0300EXPPX175734', '1P0300EXPPX175734', null, true, false, 'John Deere', '300E', 'Loader', null, null, 2023, '2024-04-18', 6850.0, 685.0, 7, null),
(82, '503', 'Hitachi ZW180 Wheel Loader', 'HCMNTK61V00010335', 'HCMNTK61V00010335', null, true, false, 'Hitachi', 'ZW180', 'Loader', 'Pipe', 250.0, 2024, '2025-03-28', 253002.75, 25300.28, null, null),
(83, '504', '2025 John Deere 324P Wheel Loader', '1LU324PAAZB090767', '1LU324PAAZB090767', null, true, false, 'John Deere', '324G', 'Loader', 'Pipe', 250.0, 2025, '2025-10-23', 120260.45, 12026.05, null, null),
(84, '203', '2016 Hitachi 160 Excavator', '1FFDBP70HGF240057', '1FFDBP70HGF240057', null, true, false, 'Hitachi', '160', 'Excavators', 'Pipe', 175.0, 2016, null, 325000.0, 32500.0, 7, null),
(85, '202', '2013 Hitachi 85 Excavator w/ Bucket', 'HCM1P700L0083160', 'HCM1P700L0083160', null, true, false, 'Hitachi', '85', 'Excavators', 'Pipe', 150.0, 2013, '2020-01-01', 54500.0, 5450.0, 7, null),
(86, '204', '2017 Case CX160D', 'DAC160K7NNGS7F1362', 'DAC160K7NNGS7F1362', null, true, false, 'Case', 'CX160D', 'Excavators', 'Site', 175.0, 2017, '2020-01-01', 200000.0, 20000.0, 7, null),
(87, '206', '2019 Hitachi ZX350LC Excavator', '1FFDDR70TMF940991', '1FFDDR70TMF940991', null, true, false, 'Hitachi', 'Zaxis 350-6', 'Excavators', 'Pipe', 350.0, 2019, '2020-01-01', 300000.0, 30000.0, 7, null),
(88, '212', 'Case Excavator CX350C', 'DAC350K6NFS6P1415', 'DAC350K6NFS6P1415', null, true, false, 'Case', 'CX350C', 'Excavators', 'Site', 350.0, null, '2020-01-01', 200000.0, 20000.0, 7, null),
(89, '201', '2008 Hitachi 270LC', 'FF01V4Q030960', 'FF01V4Q030960', null, true, false, 'Hitachi', '270LC', 'Excavators', 'Site', 300.0, 2008, '2020-01-01', 100000.0, 10000.0, 7, null),
(90, '205', '2018 Hitachi 250LC-6', '1FFDC270PJF440210', '1FFDC270PJF440210', null, true, false, 'Hitachi', '250LC-6', 'Excavators', 'Site', 250.0, 2018, '2021-10-06', 169662.0, 16966.2, 7, null),
(91, '209', '2023 Hitachi ZX470LC-6', 'HCMJAG60C00061163', 'HCMJAG60C00061163', null, true, false, 'Hitachi', 'ZX470LC-6', 'Excavators', 'Site', 450.0, 2023, '2023-01-01', 235000.0, 23500.0, 7, null),
(92, '210', '2023 John Deere 250P Excavator', '1FF250PAJPF000224', '1FF250PAJPF000224', null, true, false, 'John Deere', '250P', 'Excavators', 'Site', 250.0, 2023, '2023-01-01', 300000.0, 30000.0, 7, null),
(93, '207', '2024 John Deere 160P Excavator', '1FF160PATRF000599', '1FF160PATRF000599', null, true, false, 'John Deere', '160P', 'Excavators', 'Site', 175.0, null, '2024-04-28', 237757.0, 23775.7, 7, null),
(94, '208', '2023 Hitachi ZX245USLC-6', 'HCMDFB60J00514276', 'HCMDFB60J00514276', null, true, false, 'Hitachi', 'ZX245USLC-6', 'Excavators', 'Pipe', 250.0, 2023, '2023-05-31', 224400.0, 22440.0, null, null),
(95, '211', '2024 Hitachi ZW50U5N', 'HCMAED60E00300172', 'HCMAED60E00300172', null, true, false, 'Hitachi', 'ZW50U5N', 'Excavators', 'Site', 125.0, 2024, '2024-07-08', 85000.0, 8500.0, 7, null),
(96, '213', 'John Deere 50G', '1FF050GXCEH281920', '1FF050GXCEH281920', null, true, false, 'John Deere', '50G', 'Excavators', 'Pipe', 125.0, null, null, null, 0.0, null, null),
(97, '214', '2024 John Deere 250P Excavator - RPO', '1FF250PACPF000279-RPO', '1FF250PACPF000279-RPO', null, false, true, 'John Deere', '250P', 'Excavators', 'Site', 250.0, 2024, '2024-10-01', 293395.0, 29339.5, null, '2025-02-28'),
(98, '214', '2024 John Deere 250P Excavator', '1FF250PACPF000279', '1FF250PACPF000279', null, true, false, 'John Deere', '250P', 'Excavators', 'Site', 250.0, 2024, '2025-03-03', 347424.52, 34742.45, null, null),
(99, '215', '2023 Hitachi ZX350LC', 'HCMDDQ60H00082662', 'HCMDDQ60H00082662', null, true, false, 'Hitachi', 'ZX350', 'Excavators', 'Pipe', 350.0, 2023, '2025-03-31', 317554.38, 31755.44, null, null),
(100, '216', '2024 Hitachi 300LC Excavator', 'HCMDDN60K00060679', 'HCMDDN60K00060679', null, true, false, 'Hitachi', '300', 'Excavators', 'Site', 350.0, 2024, '2025-04-08', 332206.88, 33220.69, null, null),
(101, '218', '2025 JD 350P Excavator', '1FF350PACRF001754', '1FF350PACRF001754', null, true, false, 'John Deere', '350P', 'Excavators', 'Pipe', 350.0, 2025, '2025-06-26', 396103.47, 39610.35, null, null),
(102, '217', '2025 JD 135 Excavator', '1FF135PATRF001953', '1FF135PATRF001953', null, true, false, 'John Deere', '135P', 'Excavators', 'Site', 135.0, 2025, '2025-06-26', 286446.39, 28644.64, 10, null),
(103, '219', '2025 JD 350P Excavator', '1FF350PAPSF002162', '1FF350PAPSF002162', null, true, false, 'John Deere', '350P', 'Excavators', 'Pipe', 350.0, 2025, '2025-07-28', 394027.66, 39402.77, null, null),
(104, '221', '2025 JD 85P Excavator', '1FF085PACSJ003000', '1FF085PACSJ003000', null, true, false, 'John Deere', '85P Excavator', 'Excavators', 'Pipe', null, 2025, '2025-12-31', 173208.39, 17320.84, null, null),
(105, '220', '2025 JD 350P Excavator', '1FF350PACSF002568', '1FF350PACSF002568', null, true, false, 'John Deere', '350P', 'Excavators', 'Site', 350.0, null, '2026-01-28', 354491.28, 35449.13, null, null),
(106, '222', '2024 Hyundai HX350 Excavator - 22235', 'HHKHK903CE0000462', 'HHKHK903CE0000462', null, true, false, 'Hyundai', 'HX50', 'Excavators', 'Pipe', null, 2024, '2026-02-05', 344749.63, 34474.96, 7, null),
(107, '302', '2006 John Deere Articulated Dump Truck', 'DW250DT604147', 'DW250DT604147', null, false, false, 'John Deere', '250D', 'Dump Trucks', 'Site', 250.0, 2006, '2020-01-01', 265000.0, 26500.0, 7, '2026-01-26'),
(108, '301', '2006 John Deere Articulated Dump Truck', 'BE250DT201548', 'BE250DT201548', null, true, false, 'John Deere', '250D', 'Dump Trucks', 'Site', 250.0, 2006, '2020-01-01', 250000.0, 25000.0, 7, null),
(109, null, 'International Dump Truck', '1HTSDTVN3LH23508', '1HTSDTVN3LH23508', null, true, false, 'International', '4900', 'Dump Trucks', null, null, null, '2020-01-01', 50000.0, 5000.0, 7, null),
(110, '304', 'Bell Dump Truck', 'B93A331ET01206625', 'B93A331ET01206625', null, true, false, 'Bell', '30E', 'Dump Trucks', 'Site', 300.0, null, '2020-01-01', 300000.0, 30000.0, 7, null),
(111, '303', 'John Deere 310E Vehicle', '1DW310EXVMF712264', '1DW310EXVMF712264', null, true, false, 'John Deere', '310E', 'Dump Trucks', 'Site', 300.0, null, '2024-04-28', 321546.0, 32154.6, 7, null),
(112, '305', '2024 Bell 30E', 'B93A631EK03511086', 'B93A631EK03511086', null, true, false, 'Bell', '30E', 'Dump Trucks', 'Site', 300.0, 2024, '2024-10-20', 332000.0, 33200.0, null, null),
(113, '306', '2023 Bell 30E', 'B93A631EE03411032', 'B93A631EE03411032', null, true, false, 'Bell', '30E', 'Dump Trucks', 'Site', 300.0, 2023, '2024-10-20', 331994.0, 33199.4, null, null),
(114, null, '2023 Bell 30E Dump Truck - RPO', 'B93A631EV03411025', 'B93A631EV03411025', null, true, false, 'Bell', '30E', 'Dump Trucks', 'Site', 300.0, 2023, '2025-11-11', 38000.0, 3800.0, null, null),
(115, '103', '2012 John Deere Dozer', '1T0650JXVBD213018', '1T0650JXVBD213018', null, true, false, 'John Deere', '650 J', 'Bulldozers', 'Site', 175.0, 2012, '2020-01-01', 130000.0, 13000.0, 7, null),
(116, '102', '2006 John Deere Bulldozer 750J', 'T0750JX126626', 'T0750JX126626', null, true, false, 'John Deere', '750J', 'Bulldozers', 'Site', 300.0, 2006, '2000-01-01', 250000.0, 25000.0, 7, null),
(117, '104', '2014 Case 1650M Dozer', 'NEDC16063', 'NEDC16063', null, true, false, 'Case', '1650M', 'Bulldozers', 'Site', 250.0, 2014, '2020-01-01', 200000.0, 20000.0, 7, null),
(118, '107', '2023 John Deere Crawler Dozer 650K', '1T0650KKLNF432091', '1T0650KKLNF432091', null, true, false, 'John Deere', '650K', 'Bulldozers', 'Site', 175.0, 2023, '2023-01-01', 250000.0, 25000.0, 7, null),
(119, '108', '2024 JD  850L Crawler Dozer', '1T0850LXPRF460652', '1T0850LXPRF460652', null, true, false, 'John Deere', '850L', 'Bulldozers', 'Site', 400.0, null, '2024-04-19', 521925.83, 52192.58, 7, null),
(120, '105', 'John Deere 700K Crawler Dozer', '1T0700KXEKF350987', '1T0700KXEKF350987', null, true, false, 'John Deere', '700K', 'Bulldozers', 'Site', 250.0, null, '2023-07-28', 49942.82, 4994.28, 7, null),
(121, '101', 'Caterpillar D-4C Dozer', '8CS00362', '8CS00362', null, true, false, 'Caterpillar', 'D-4C', 'Bulldozers', 'Site', 175.0, null, null, null, 0.0, null, null),
(122, '106', '2024 650P Crawler Dozer - RPO', '1T0650PALRLX09474-RPO', '1T0650PALRLX09474-RPO', null, false, true, 'John Deere', '650P', 'Bulldozers', 'Site', 175.0, 2024, '2024-10-01', 247500.0, 24750.0, null, '2025-02-28'),
(123, '106', '2024 650P Crawler Dozer', '1T0650PALRLX09474', '1T0650PALRLX09474', null, true, false, 'John Deere', '650P', 'Bulldozers', 'Site', 175.0, 2024, '2025-03-03', 235557.0, 23555.7, null, null),
(124, '109', '2025 John Deere 450P Crawler Dozer', '1T0450PAKSMX13380', '1T0450PAKSMX13380', null, true, false, 'John Deere', '450P', 'Bulldozers', 'Site', 175.0, 2025, '2025-10-23', 222007.15, 22200.72, null, null),
(125, '110', '2025 John Deere 700P Crawler Dozer', '1T0700PAKSFX13220', '1T0700PAKSFX13220', null, true, false, 'John Deere', '700P', 'Bulldozers', 'Site', 250.0, 2025, '2025-10-23', 300605.16, 30060.52, null, null),
(126, null, 'Rockland B72" Bucket', '10001', '10001', null, true, false, null, null, 'Attachements', null, null, null, '2020-01-01', 12000.0, 1200.0, 7, null),
(127, null, 'Case Hammer Attachement CH310', '11553', '11553', null, true, false, 'Case', 'CH310', 'Attachements', null, null, null, '2020-01-01', 20000.0, 2000.0, 7, null),
(128, null, 'Case 65 Inch Bucket Attachement', '10002', '10002', null, true, false, 'Case', 'Bucket Attachment', 'Attachements', null, null, null, '2020-01-01', 10000.0, 1000.0, 7, null),
(129, null, '2021 Hitachi Zaxis 3506 Attachement', '79193', '79193', null, true, false, 'Hitachi', null, 'Attachements', null, null, 2021, '2021-01-01', 10000.0, 1000.0, 7, null);

-- ---------------------------------------------------------------------
-- Matching (serial / PIN, exact or one ending with the other, 6+ characters)
-- ---------------------------------------------------------------------
create or replace function public.sharepoint_matches()
returns table (asset_id uuid, sp_row int)
language sql stable security definer set search_path = public, fleet as $$
  with sp as (
    select row_no, serial_norm, lower(left(regexp_replace(coalesce(make, ''), '[^A-Za-z]', '', 'g'), 4)) as mk
      from public.sharepoint_assets_import
     where active and not rpo_duplicate and serial_norm is not null
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
 where sp.active and not sp.rpo_duplicate and sp.row_no not in (select sp_row from m);
revoke all on public.sharepoint_reconcile_preview from anon, authenticated;   -- run from the SQL editor

-- ---------------------------------------------------------------------
-- Apply
-- ---------------------------------------------------------------------
create or replace function public.apply_sharepoint_reconcile() returns jsonb
language plpgsql security definer set search_path = public, fleet as $$
declare
  n_matched int; n_numbered int; n_crew int; n_rate int; n_filled int; n_fleet int;
  skipped text[];
begin
  drop table if exists _m;
  create temp table _m on commit drop as
  select m.asset_id, sp.*
    from public.sharepoint_matches() m
    join public.sharepoint_assets_import sp on sp.row_no = m.sp_row;
  get diagnostics n_matched = row_count;

  -- asset numbers: SharePoint wins. Skip any number already used by a different in-service machine.
  select array_agg(_m.machine_number || ' (in use by ' || o.asset_number || ' ' || coalesce(o.model, '') || ')')
    into skipped
    from _m join public.assets o
      on o.asset_number = _m.machine_number and o.status <> 'retired'
     and o.id <> _m.asset_id and o.id not in (select asset_id from _m);

  update public.assets a set asset_number = a.asset_number || ' ~' || left(a.id::text, 8)    -- free up numbers first
    from _m where a.id = _m.asset_id and _m.machine_number is not null
     and a.asset_number is distinct from _m.machine_number;
  update public.assets a set asset_number = _m.machine_number
    from _m where a.id = _m.asset_id and _m.machine_number is not null
     and a.asset_number is distinct from _m.machine_number
     and not exists (select 1 from public.assets o where o.asset_number = _m.machine_number
                       and o.status <> 'retired' and o.id <> a.id);
  get diagnostics n_numbered = row_count;
  -- anything we freed but couldn't renumber goes back to its old number
  update public.assets a set asset_number = split_part(a.asset_number, ' ~', 1)
   where a.asset_number like '% ~________' and a.id in (select asset_id from _m);

  -- crew and T&M rate: SharePoint wins when it has a value
  update public.assets a set crew_id = c.id
    from _m join public.crews c on c.name = _m.crew
   where a.id = _m.asset_id and a.crew_id is distinct from c.id;
  get diagnostics n_crew = row_count;
  update public.assets a set tm_rate = _m.tm_rate
    from _m where a.id = _m.asset_id and _m.tm_rate is not null and a.tm_rate is distinct from _m.tm_rate;
  get diagnostics n_rate = row_count;

  -- fill blanks only
  update public.assets a set
         year                = coalesce(a.year, _m.model_year),
         make                = coalesce(nullif(a.make, ''), nullif(_m.make, '')),
         purchase_date       = coalesce(a.purchase_date, _m.purchase_date),
         purchase_price      = coalesce(a.purchase_price, _m.purchase_price),
         salvage_value       = coalesce(a.salvage_value, _m.salvage_value),
         useful_life_years   = coalesce(a.useful_life_years, _m.useful_life_yrs),
         category_id         = coalesce(a.category_id, (
           select c.id from public.equipment_categories c
            where c.name = case _m.equipment_type
                             when 'Excavators' then 'Excavator' when 'Bulldozers' then 'Dozer'
                             when 'Skid steers' then 'Skid Steer' when 'Rollers' then 'Compactor'
                             when 'Dump Trucks' then 'Dump Truck' when 'Loader' then 'Wheel Loader'
                             when 'Trailers' then 'Trailer' when 'Attachements' then 'Attachment' end))
    from _m
   where a.id = _m.asset_id
     and (   (a.year is null and _m.model_year is not null)
          or (nullif(a.make, '') is null and nullif(_m.make, '') is not null)
          or (a.purchase_date is null and _m.purchase_date is not null)
          or (a.purchase_price is null and _m.purchase_price is not null)
          or (a.salvage_value is null and _m.salvage_value is not null)
          or (a.useful_life_years is null and _m.useful_life_yrs is not null)
          or (a.category_id is null and _m.equipment_type in
                ('Excavators','Bulldozers','Skid steers','Rollers','Dump Trucks','Loader','Trailers','Attachements')));
  get diagnostics n_filled = row_count;

  -- keep the telematics unit numbers in step: release the numbers being assigned, then set them
  select count(*) into n_fleet
    from fleet.assets f join public.assets a on a.telematics_asset_id = f.id join _m on _m.asset_id = a.id
   where f.unit_number is distinct from a.asset_number;
  update fleet.assets f set unit_number = null
   where f.unit_number in (select a.asset_number from public.assets a join _m on _m.asset_id = a.id)
      or f.id in (select a.telematics_asset_id from public.assets a join _m on _m.asset_id = a.id
                   where a.telematics_asset_id is not null);
  update fleet.assets f set unit_number = a.asset_number
    from public.assets a join _m on _m.asset_id = a.id
   where f.id = a.telematics_asset_id and f.unit_number is distinct from a.asset_number;

  return jsonb_build_object('matched', n_matched, 'renumbered', n_numbered, 'crew_set', n_crew,
                            'rate_set', n_rate, 'blanks_filled', n_filled, 'telematics_units_renumbered', n_fleet,
                            'numbers_skipped', coalesce(to_jsonb(skipped), '[]'::jsonb));
end $$;
revoke all on function public.apply_sharepoint_reconcile() from public, anon, authenticated;
revoke all on function public.sharepoint_matches() from public, anon, authenticated;
