-- TMWA PDC Warehouse — Canonical Supabase Schema
--
-- This file is the single database source of truth for the current application.
-- It is safe to run repeatedly on an existing project: missing tables/columns,
-- indexes, policies, triggers, and permissions are added/reconciled without
-- intentionally deleting study data.
--
-- Core data flow:
--   Process → Activity → Element Kerja
--   Observation → Validation → Rating Factor → Normal Time → Standard Time
--   TSKK / SWCT is stored separately as a supporting cycle-vs-takt analysis.

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. CORE STUDY DATA
-- ============================================================================

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  activity text,
  created_at timestamptz not null default now()
);

create table if not exists public.master_elements (
  id uuid primary key default gen_random_uuid(),
  process text not null,
  activity text not null,
  element_name text not null,
  classification text,
  lean_waste text,
  work_method text,
  equipment text,
  frequency_per_day numeric,
  frequency_small_per_day numeric,
  frequency_medium_per_day numeric,
  frequency_big_per_day numeric,
  notes text,
  created_at timestamptz not null default now(),
  unique(process, activity, element_name)
);

-- Keep existing installations aligned with the current master-element fields.
alter table public.master_elements
  add column if not exists frequency_small_per_day numeric,
  add column if not exists frequency_medium_per_day numeric,
  add column if not exists frequency_big_per_day numeric;

alter table public.master_elements
  alter column id set default gen_random_uuid();

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  observation_no integer,
  observed_at timestamptz not null default now(),
  study text,
  process text,
  activity text,
  element_name text,
  operator_id uuid references public.operators(id) on delete set null,
  operator_name text,
  size_category text,
  start_time numeric,
  end_time numeric,
  observed_time numeric not null,
  classification text,
  lean_waste text,
  work_method text,
  equipment text,
  notes text,
  observation_cycle_id text,
  observation_session_id text,
  rating_factor_snapshot numeric,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing projects receive any current observation fields that are missing.
alter table public.observations
  add column if not exists observation_cycle_id text,
  add column if not exists observation_session_id text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists rating_factor_snapshot numeric;

-- Each stored observation remains traceable to its own recorded session.
update public.observations
set observation_cycle_id = coalesce(observation_cycle_id, concat('LEGACY-', id::text))
where observation_cycle_id is null;

update public.observations
set observation_session_id = coalesce(observation_session_id, observation_cycle_id, concat('LEGACY-', id::text))
where observation_session_id is null;

create index if not exists idx_observations_created_by on public.observations(created_by);
create index if not exists idx_observations_cycle_id on public.observations(observation_cycle_id);
create index if not exists idx_observations_session_id on public.observations(observation_session_id);

-- ============================================================================
-- 2. WESTINGHOUSE RATING FACTOR
-- ============================================================================

create table if not exists public.rating_factors (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  activity_name text not null,
  skill_code text,
  effort_code text,
  condition_code text,
  consistency_code text,
  skill_value numeric default 0,
  effort_value numeric default 0,
  condition_value numeric default 0,
  consistency_value numeric default 0,
  rating_factor numeric generated always as (
    1 + skill_value + effort_value + condition_value + consistency_value
  ) stored,
  updated_at timestamptz not null default now(),
  unique(operator_id, activity_name)
);

-- Existing installations may have created this field before activity-level RF
-- became the current model. Keep those rows intact until an administrator cleans
-- them; every new/current record uses operator + activity.
alter table public.rating_factors
  add column if not exists activity_name text;

-- ============================================================================
-- 3. STUDY PARAMETERS
-- ============================================================================

create table if not exists public.study_settings (
  id integer primary key default 1 check (id = 1),
  n_min_observations integer not null default 5,
  allowance_percent numeric not null default 10,
  confidence_percent numeric not null default 95,
  z_value numeric not null default 1.96,
  precision_percent numeric not null default 5,
  updated_at timestamptz not null default now()
);

alter table public.study_settings
  add column if not exists confidence_percent numeric not null default 95,
  add column if not exists z_value numeric not null default 1.96,
  add column if not exists precision_percent numeric not null default 5;

insert into public.study_settings(id)
values (1)
on conflict (id) do nothing;

-- ============================================================================
-- 4. USER PROFILES / ACCESS CONTROL SUPPORT
-- ============================================================================

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','analyst','viewer')),
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_user_profiles_status_role
  on public.user_profiles(status, role);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.user_profiles(id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data->>'full_name', ''), ''),
    'viewer',
    'pending'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.user_profiles(id, email, full_name, role, status)
select
  u.id,
  coalesce(u.email, ''),
  nullif(coalesce(u.raw_user_meta_data->>'full_name', ''), ''),
  'viewer',
  'pending'
from auth.users u
left join public.user_profiles p on p.id = u.id
where p.id is null;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
  );
$$;

create or replace function public.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
      and (p.role = required_role or p.role = 'admin')
  );
$$;

create or replace function public.touch_observation_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
  else
    new.created_by := coalesce(old.created_by, new.created_by);
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_observation_actor on public.observations;
create trigger trg_observation_actor
before insert or update on public.observations
for each row execute function public.touch_observation_actor();

-- ============================================================================
-- 5. AUDIT TRAIL
-- ============================================================================

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_logs_table_record
  on public.audit_logs(table_name, record_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, new_data)
    values (
      auth.uid(),
      tg_op,
      tg_table_name,
      coalesce(to_jsonb(new)->>'id', ''),
      to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
    values (
      auth.uid(),
      tg_op,
      tg_table_name,
      coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', ''),
      to_jsonb(old),
      to_jsonb(new)
    );
    return new;
  else
    insert into public.audit_logs(actor_id, action, table_name, record_id, old_data)
    values (
      auth.uid(),
      tg_op,
      tg_table_name,
      coalesce(to_jsonb(old)->>'id', ''),
      to_jsonb(old)
    );
    return old;
  end if;
end;
$$;

drop trigger if exists trg_audit_operators on public.operators;
create trigger trg_audit_operators
after insert or update or delete on public.operators
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_master_elements on public.master_elements;
create trigger trg_audit_master_elements
after insert or update or delete on public.master_elements
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_observations on public.observations;
create trigger trg_audit_observations
after insert or update or delete on public.observations
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_rating_factors on public.rating_factors;
create trigger trg_audit_rating_factors
after insert or update or delete on public.rating_factors
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_study_settings on public.study_settings;
create trigger trg_audit_study_settings
after insert or update or delete on public.study_settings
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_user_profiles on public.user_profiles;
create trigger trg_audit_user_profiles
after insert or update or delete on public.user_profiles
for each row execute function public.write_audit_log();

-- ============================================================================
-- 6. TSKK / SWCT SUPPORTING DATA
-- ============================================================================

create table if not exists public.tskk_studies (
  id uuid primary key default gen_random_uuid(),
  tskk_no text not null unique,
  part_name text,
  area text,
  process text,
  activity text,
  operator_name text,
  study_date date,
  size_category text not null default 'Small',
  shift text,
  available_minutes numeric not null default 0,
  required_units numeric not null default 0,
  takt_time numeric not null default 0,
  notes text,
  observation_cycle_id text,
  observation_session_id text,
  source_observation_ids jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tskk_studies_size_category_check
    check (size_category in ('Small','Medium','Big'))
);

create table if not exists public.tskk_items (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.tskk_studies(id) on delete cascade,
  seq integer not null,
  element_name text not null,
  work_type text not null check (work_type in ('manual','auto','walk','wait')),
  time_seconds numeric not null default 0,
  start_seconds numeric not null default 0,
  end_seconds numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(study_id, seq)
);

-- Align existing projects with the current TSKK fields.
alter table public.tskk_studies
  add column if not exists size_category text not null default 'Small',
  add column if not exists observation_cycle_id text,
  add column if not exists observation_session_id text,
  add column if not exists source_observation_ids jsonb not null default '[]'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.tskk_studies
  drop constraint if exists tskk_studies_size_category_check;

alter table public.tskk_studies
  add constraint tskk_studies_size_category_check
  check (size_category in ('Small','Medium','Big'));

update public.tskk_studies
set observation_session_id = coalesce(observation_session_id, observation_cycle_id)
where observation_session_id is null;

create unique index if not exists ux_tskk_studies_observation_cycle_id
  on public.tskk_studies(observation_cycle_id)
  where observation_cycle_id is not null;

create index if not exists idx_tskk_studies_observation_cycle_id
  on public.tskk_studies(observation_cycle_id);

create unique index if not exists ux_tskk_studies_observation_session_id
  on public.tskk_studies(observation_session_id)
  where observation_session_id is not null;

create index if not exists idx_tskk_studies_observation_session_id
  on public.tskk_studies(observation_session_id);

create index if not exists idx_tskk_studies_process_activity
  on public.tskk_studies(process, activity);
create index if not exists idx_tskk_items_study_seq
  on public.tskk_items(study_id, seq);

-- Keep the final schema free of no-longer-used TSKK header columns.
alter table public.tskk_studies drop column if exists machine_name;
alter table public.tskk_studies drop column if exists from_point;
alter table public.tskk_studies drop column if exists to_point;

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

alter table public.operators enable row level security;
alter table public.master_elements enable row level security;
alter table public.observations enable row level security;
alter table public.rating_factors enable row level security;
alter table public.study_settings enable row level security;
alter table public.user_profiles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.tskk_studies enable row level security;
alter table public.tskk_items enable row level security;

-- Operators
drop policy if exists "authenticated operators" on public.operators;
drop policy if exists "approved users can read operators" on public.operators;
drop policy if exists "analyst admin can insert operators" on public.operators;
drop policy if exists "analyst admin can update operators" on public.operators;
drop policy if exists "admin can delete operators" on public.operators;
create policy "approved users can read operators"
on public.operators for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert operators"
on public.operators for insert to authenticated
with check (public.has_role('analyst'));
create policy "analyst admin can update operators"
on public.operators for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "admin can delete operators"
on public.operators for delete to authenticated
using (public.has_role('admin'));

-- Master Elements
drop policy if exists "authenticated master_elements" on public.master_elements;
drop policy if exists "approved users can read master_elements" on public.master_elements;
drop policy if exists "analyst admin can insert master_elements" on public.master_elements;
drop policy if exists "analyst admin can update master_elements" on public.master_elements;
drop policy if exists "admin can delete master_elements" on public.master_elements;
create policy "approved users can read master_elements"
on public.master_elements for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert master_elements"
on public.master_elements for insert to authenticated
with check (public.has_role('analyst'));
create policy "analyst admin can update master_elements"
on public.master_elements for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "admin can delete master_elements"
on public.master_elements for delete to authenticated
using (public.has_role('admin'));

-- Observations
drop policy if exists "authenticated observations" on public.observations;
drop policy if exists "approved users can read observations" on public.observations;
drop policy if exists "analyst admin can insert observations" on public.observations;
drop policy if exists "analyst admin can update observations" on public.observations;
drop policy if exists "admin can delete observations" on public.observations;
create policy "approved users can read observations"
on public.observations for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert observations"
on public.observations for insert to authenticated
with check (
  public.has_role('analyst')
  and (created_by is null or created_by = auth.uid())
);
create policy "analyst admin can update observations"
on public.observations for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "admin can delete observations"
on public.observations for delete to authenticated
using (public.has_role('admin'));

-- Rating Factors
drop policy if exists "authenticated rating_factors" on public.rating_factors;
drop policy if exists "approved users can read rating_factors" on public.rating_factors;
drop policy if exists "analyst admin can insert rating_factors" on public.rating_factors;
drop policy if exists "analyst admin can update rating_factors" on public.rating_factors;
drop policy if exists "admin can delete rating_factors" on public.rating_factors;
create policy "approved users can read rating_factors"
on public.rating_factors for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert rating_factors"
on public.rating_factors for insert to authenticated
with check (public.has_role('analyst'));
create policy "analyst admin can update rating_factors"
on public.rating_factors for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "admin can delete rating_factors"
on public.rating_factors for delete to authenticated
using (public.has_role('admin'));

-- Study Settings
drop policy if exists "authenticated study_settings" on public.study_settings;
drop policy if exists "approved users can read study_settings" on public.study_settings;
drop policy if exists "admin can insert study_settings" on public.study_settings;
drop policy if exists "admin can update study_settings" on public.study_settings;
drop policy if exists "admin can delete study_settings" on public.study_settings;
create policy "approved users can read study_settings"
on public.study_settings for select to authenticated
using (public.is_approved());
create policy "admin can insert study_settings"
on public.study_settings for insert to authenticated
with check (public.has_role('admin'));
create policy "admin can update study_settings"
on public.study_settings for update to authenticated
using (public.has_role('admin'))
with check (public.has_role('admin'));
create policy "admin can delete study_settings"
on public.study_settings for delete to authenticated
using (public.has_role('admin'));

-- User Profiles
drop policy if exists "users can read own profile" on public.user_profiles;
drop policy if exists "admins can read profiles" on public.user_profiles;
drop policy if exists "admins can update profiles" on public.user_profiles;
create policy "users can read own profile"
on public.user_profiles for select to authenticated
using (id = auth.uid());
create policy "admins can read profiles"
on public.user_profiles for select to authenticated
using (public.has_role('admin'));
create policy "admins can update profiles"
on public.user_profiles for update to authenticated
using (public.has_role('admin'))
with check (public.has_role('admin'));

-- Audit Logs: clients cannot write audit records directly.
drop policy if exists "admins can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
on public.audit_logs for select to authenticated
using (public.has_role('admin'));

-- TSKK Studies
drop policy if exists "approved users can read tskk studies" on public.tskk_studies;
drop policy if exists "analyst admin can insert tskk studies" on public.tskk_studies;
drop policy if exists "analyst admin can update tskk studies" on public.tskk_studies;
drop policy if exists "admin can delete tskk studies" on public.tskk_studies;
create policy "approved users can read tskk studies"
on public.tskk_studies for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert tskk studies"
on public.tskk_studies for insert to authenticated
with check (
  public.has_role('analyst')
  and (created_by is null or created_by = auth.uid())
);
create policy "analyst admin can update tskk studies"
on public.tskk_studies for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "admin can delete tskk studies"
on public.tskk_studies for delete to authenticated
using (public.has_role('admin'));

-- TSKK Items
drop policy if exists "approved users can read tskk items" on public.tskk_items;
drop policy if exists "analyst admin can insert tskk items" on public.tskk_items;
drop policy if exists "analyst admin can update tskk items" on public.tskk_items;
drop policy if exists "admin can delete tskk items" on public.tskk_items;
drop policy if exists "analyst admin can delete tskk items" on public.tskk_items;
create policy "approved users can read tskk items"
on public.tskk_items for select to authenticated
using (public.is_approved());
create policy "analyst admin can insert tskk items"
on public.tskk_items for insert to authenticated
with check (public.has_role('analyst'));
create policy "analyst admin can update tskk items"
on public.tskk_items for update to authenticated
using (public.has_role('analyst'))
with check (public.has_role('analyst'));
create policy "analyst admin can delete tskk items"
on public.tskk_items for delete to authenticated
using (public.has_role('analyst'));

-- ============================================================================
-- 8. AUDIT TRIGGERS FOR TSKK
-- ============================================================================

drop trigger if exists trg_audit_tskk_studies on public.tskk_studies;
create trigger trg_audit_tskk_studies
after insert or update or delete on public.tskk_studies
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_tskk_items on public.tskk_items;
create trigger trg_audit_tskk_items
after insert or update or delete on public.tskk_items
for each row execute function public.write_audit_log();

-- ============================================================================
-- 9. REALTIME
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'observations'
  ) then
    alter publication supabase_realtime add table public.observations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'operators'
  ) then
    alter publication supabase_realtime add table public.operators;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'master_elements'
  ) then
    alter publication supabase_realtime add table public.master_elements;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rating_factors'
  ) then
    alter publication supabase_realtime add table public.rating_factors;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'study_settings'
  ) then
    alter publication supabase_realtime add table public.study_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tskk_studies'
  ) then
    alter publication supabase_realtime add table public.tskk_studies;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tskk_items'
  ) then
    alter publication supabase_realtime add table public.tskk_items;
  end if;
end $$;

-- ============================================================================
-- 10. PRIVILEGE HYGIENE
-- ============================================================================

revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.write_audit_log() from public;
revoke execute on function public.touch_observation_actor() from public;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.has_role(text) to authenticated;
