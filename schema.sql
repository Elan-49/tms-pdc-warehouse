create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
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
  created_at timestamptz not null default now()
);
create table if not exists observations (
  id uuid primary key default gen_random_uuid(),
  observation_no integer,
  observed_at timestamptz not null default now(),
  process text,
  activity text,
  element_name text,
  operator_id uuid references operators(id) on delete set null,
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
  operator_id uuid not null references operators(id) on delete cascade,
  skill_code text,
  effort_code text,
  condition_code text,
  consistency_code text,
  skill_value numeric default 0,
  effort_value numeric default 0,
  condition_value numeric default 0,
  consistency_value numeric default 0,
  rating_factor numeric generated always as (1 + skill_value + effort_value + condition_value + consistency_value) stored,
  updated_at timestamptz not null default now(),
  unique(operator_id)
);
create table if not exists study_settings (
  id integer primary key default 1,
  n_min_observations integer not null default 5,
  allowance_percent numeric not null default 10,
  updated_at timestamptz not null default now()
);
insert into study_settings(id) values (1) on conflict (id) do nothing;
