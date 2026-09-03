-- TMS PDC Warehouse — Supabase schema V3 Cloud
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

-- Realtime publication (aman dijalankan ulang)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='observations') then alter publication supabase_realtime add table observations; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='operators') then alter publication supabase_realtime add table operators; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='master_elements') then alter publication supabase_realtime add table master_elements; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rating_factors') then alter publication supabase_realtime add table rating_factors; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='study_settings') then alter publication supabase_realtime add table study_settings; end if;
end $$;

-- RLS: semua user yang sudah login dapat memakai data studi bersama.
alter table operators enable row level security;
alter table master_elements enable row level security;
alter table observations enable row level security;
alter table rating_factors enable row level security;
alter table study_settings enable row level security;

drop policy if exists "authenticated operators" on operators;
create policy "authenticated operators" on operators for all to authenticated using (true) with check (true);
drop policy if exists "authenticated master_elements" on master_elements;
create policy "authenticated master_elements" on master_elements for all to authenticated using (true) with check (true);
drop policy if exists "authenticated observations" on observations;
create policy "authenticated observations" on observations for all to authenticated using (true) with check (true);
drop policy if exists "authenticated rating_factors" on rating_factors;
create policy "authenticated rating_factors" on rating_factors for all to authenticated using (true) with check (true);
drop policy if exists "authenticated study_settings" on study_settings;
create policy "authenticated study_settings" on study_settings for all to authenticated using (true) with check (true);
