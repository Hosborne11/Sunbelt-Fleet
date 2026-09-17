-- Run this in the Supabase SQL editor to add map support to an existing project.
alter table jobsites add column if not exists latitude numeric;
alter table jobsites add column if not exists longitude numeric;
