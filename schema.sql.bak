-- TMS PDC Warehouse — Supabase production security hardening
-- Safe to run on the existing V3.0.x database: uses CREATE/ALTER IF NOT EXISTS and
-- replaces only authorization/audit objects. Existing study data is preserved.

create extension if not exists pgcrypto;

create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  activity text,
  created_at timestamptz not null default now()
);

create table if not exists master_elements (
  id uuid primary key default gen_random_uuid(),
  process text not null,
  activity text not null,
  element_name text not null,
  classification text,
  lean_waste text,
  work_method text,
  equipment text,
  frequency_per_day numeric,
  notes text,
  created_at timestamptz not null default now(),
  unique(process, activity, element_name)
);

create table if not exists observations (
  id uuid primary key default gen_random_uuid(),
  observation_no integer,
  observed_at timestamptz not null default now(),
  study text,
  process text,
  activity text,
  element_name text,
  operator_id uuid references operators(id) on delete set null,
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
  created_at timestamptz not null default now()
);

alter table observations add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table observations add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table observations add column if not exists updated_at timestamptz not null default now();

create table if not exists rating_factors (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id) on delete cascade unique,
  skill_code text,
  effort_code text,
  condition_code text,
  consistency_code text,
  skill_value numeric default 0,
  effort_value numeric default 0,
  condition_value numeric default 0,
  consistency_value numeric default 0,
  rating_factor numeric generated always as (1 + skill_value + effort_value + condition_value + consistency_value) stored,
  updated_at timestamptz not null default now()
);

create table if not exists study_settings (
  id integer primary key default 1 check (id=1),
  n_min_observations integer not null default 5,
  allowance_percent numeric not null default 10,
  updated_at timestamptz not null default now()
);
insert into study_settings(id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- User approval + role-based access control
-- ---------------------------------------------------------------------------
create table if not exists user_profiles (
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

create index if not exists idx_user_profiles_status_role on user_profiles(status, role);
create index if not exists idx_observations_created_by on observations(created_by);

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

-- Backfill profiles for accounts created before this hardening migration.
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
    if new.created_by is null then new.created_by := auth.uid(); end if;
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

drop trigger if exists trg_observation_actor on observations;
create trigger trg_observation_actor
before insert or update on observations
for each row execute function public.touch_observation_actor();

-- ---------------------------------------------------------------------------
-- Immutable audit trail
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id bigint generated by default as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);
create index if not exists idx_audit_logs_actor on audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_logs_table_record on audit_logs(table_name, record_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), tg_op, tg_table_name, coalesce(to_jsonb(new)->>'id', ''), to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), tg_op, tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', ''), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_logs(actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), tg_op, tg_table_name, coalesce(to_jsonb(old)->>'id', ''), to_jsonb(old));
    return old;
  end if;
end;
$$;

-- Avoid duplicate trigger names during repeated runs.
drop trigger if exists trg_audit_operators on operators;
create trigger trg_audit_operators after insert or update or delete on operators for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_master_elements on master_elements;
create trigger trg_audit_master_elements after insert or update or delete on master_elements for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_observations on observations;
create trigger trg_audit_observations after insert or update or delete on observations for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_rating_factors on rating_factors;
create trigger trg_audit_rating_factors after insert or update or delete on rating_factors for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_study_settings on study_settings;
create trigger trg_audit_study_settings after insert or update or delete on study_settings for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_user_profiles on user_profiles;
create trigger trg_audit_user_profiles after insert or update or delete on user_profiles for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='observations') then alter publication supabase_realtime add table observations; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='operators') then alter publication supabase_realtime add table operators; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='master_elements') then alter publication supabase_realtime add table master_elements; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rating_factors') then alter publication supabase_realtime add table rating_factors; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='study_settings') then alter publication supabase_realtime add table study_settings; end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default through explicit role policies
-- ---------------------------------------------------------------------------
alter table operators enable row level security;
alter table master_elements enable row level security;
alter table observations enable row level security;
alter table rating_factors enable row level security;
alter table study_settings enable row level security;
alter table user_profiles enable row level security;
alter table audit_logs enable row level security;

-- Operators
 drop policy if exists "authenticated operators" on operators;
drop policy if exists "approved users can read operators" on operators;
drop policy if exists "analyst admin can insert operators" on operators;
drop policy if exists "analyst admin can update operators" on operators;
drop policy if exists "admin can delete operators" on operators;
create policy "approved users can read operators" on operators for select to authenticated using (public.is_approved());
create policy "analyst admin can insert operators" on operators for insert to authenticated with check (public.has_role('analyst'));
create policy "analyst admin can update operators" on operators for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete operators" on operators for delete to authenticated using (public.has_role('admin'));

-- Master Elements
 drop policy if exists "authenticated master_elements" on master_elements;
drop policy if exists "approved users can read master_elements" on master_elements;
drop policy if exists "analyst admin can insert master_elements" on master_elements;
drop policy if exists "analyst admin can update master_elements" on master_elements;
drop policy if exists "admin can delete master_elements" on master_elements;
create policy "approved users can read master_elements" on master_elements for select to authenticated using (public.is_approved());
create policy "analyst admin can insert master_elements" on master_elements for insert to authenticated with check (public.has_role('analyst'));
create policy "analyst admin can update master_elements" on master_elements for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete master_elements" on master_elements for delete to authenticated using (public.has_role('admin'));

-- Observations
 drop policy if exists "authenticated observations" on observations;
drop policy if exists "approved users can read observations" on observations;
drop policy if exists "analyst admin can insert observations" on observations;
drop policy if exists "analyst admin can update observations" on observations;
drop policy if exists "admin can delete observations" on observations;
create policy "approved users can read observations" on observations for select to authenticated using (public.is_approved());
create policy "analyst admin can insert observations" on observations for insert to authenticated with check (public.has_role('analyst') and (created_by is null or created_by = auth.uid()));
create policy "analyst admin can update observations" on observations for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete observations" on observations for delete to authenticated using (public.has_role('admin'));

-- Rating Factors
 drop policy if exists "authenticated rating_factors" on rating_factors;
drop policy if exists "approved users can read rating_factors" on rating_factors;
drop policy if exists "analyst admin can insert rating_factors" on rating_factors;
drop policy if exists "analyst admin can update rating_factors" on rating_factors;
drop policy if exists "admin can delete rating_factors" on rating_factors;
create policy "approved users can read rating_factors" on rating_factors for select to authenticated using (public.is_approved());
create policy "analyst admin can insert rating_factors" on rating_factors for insert to authenticated with check (public.has_role('analyst'));
create policy "analyst admin can update rating_factors" on rating_factors for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete rating_factors" on rating_factors for delete to authenticated using (public.has_role('admin'));

-- Study Settings
 drop policy if exists "authenticated study_settings" on study_settings;
drop policy if exists "approved users can read study_settings" on study_settings;
drop policy if exists "admin can insert study_settings" on study_settings;
drop policy if exists "admin can update study_settings" on study_settings;
drop policy if exists "admin can delete study_settings" on study_settings;
create policy "approved users can read study_settings" on study_settings for select to authenticated using (public.is_approved());
create policy "admin can insert study_settings" on study_settings for insert to authenticated with check (public.has_role('admin'));
create policy "admin can update study_settings" on study_settings for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "admin can delete study_settings" on study_settings for delete to authenticated using (public.has_role('admin'));

-- User profiles: users read themselves; admins manage approvals/roles.
drop policy if exists "users can read own profile" on user_profiles;
drop policy if exists "admins can read profiles" on user_profiles;
drop policy if exists "admins can update profiles" on user_profiles;
create policy "users can read own profile" on user_profiles for select to authenticated using (id = auth.uid());
create policy "admins can read profiles" on user_profiles for select to authenticated using (public.has_role('admin'));
create policy "admins can update profiles" on user_profiles for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- Audit: immutable from client; admins only can read.
drop policy if exists "admins can read audit logs" on audit_logs;
create policy "admins can read audit logs" on audit_logs for select to authenticated using (public.has_role('admin'));

-- No client INSERT/UPDATE/DELETE policies are intentionally created for audit_logs.

-- Privilege hygiene: roles used by the browser do not get direct table privileges
-- beyond what Supabase/PostgREST requires for RLS evaluation.
revoke all on table audit_logs from anon, authenticated;
grant select on table audit_logs to authenticated;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.write_audit_log() from public;
revoke execute on function public.touch_observation_actor() from public;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.has_role(text) to authenticated;
