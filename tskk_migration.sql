-- TMS PDC Warehouse — TSKK / SWCT migration
-- Run this once in Supabase SQL Editor after the main security schema.

create table if not exists public.tskk_studies (
  id uuid primary key default gen_random_uuid(),
  tskk_no text not null unique,
  part_name text,
  area text,
  process text,
  activity text,
  operator_name text,
  study_date date,
  size_category text not null default 'Small' check (size_category in ('Small','Medium','Big')),
  shift text,
  available_minutes numeric not null default 0,
  required_units numeric not null default 0,
  takt_time numeric not null default 0,
  from_point text,
  to_point text,
  machine_name text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tskk_studies add column if not exists size_category text not null default 'Small';
alter table public.tskk_studies drop constraint if exists tskk_studies_size_category_check;
alter table public.tskk_studies add constraint tskk_studies_size_category_check check (size_category in ('Small','Medium','Big'));

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
  unique(study_id,seq)
);

create index if not exists idx_tskk_studies_process_activity on public.tskk_studies(process,activity);
create index if not exists idx_tskk_items_study_seq on public.tskk_items(study_id,seq);

alter table public.tskk_studies enable row level security;
alter table public.tskk_items enable row level security;

drop policy if exists "approved users can read tskk studies" on public.tskk_studies;
drop policy if exists "analyst admin can insert tskk studies" on public.tskk_studies;
drop policy if exists "analyst admin can update tskk studies" on public.tskk_studies;
drop policy if exists "admin can delete tskk studies" on public.tskk_studies;
create policy "approved users can read tskk studies" on public.tskk_studies for select to authenticated using (public.is_approved());
create policy "analyst admin can insert tskk studies" on public.tskk_studies for insert to authenticated with check (public.has_role('analyst') and (created_by is null or created_by=auth.uid()));
create policy "analyst admin can update tskk studies" on public.tskk_studies for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete tskk studies" on public.tskk_studies for delete to authenticated using (public.has_role('admin'));

drop policy if exists "approved users can read tskk items" on public.tskk_items;
drop policy if exists "analyst admin can insert tskk items" on public.tskk_items;
drop policy if exists "analyst admin can update tskk items" on public.tskk_items;
drop policy if exists "admin can delete tskk items" on public.tskk_items;
create policy "approved users can read tskk items" on public.tskk_items for select to authenticated using (public.is_approved());
create policy "analyst admin can insert tskk items" on public.tskk_items for insert to authenticated with check (public.has_role('analyst'));
create policy "analyst admin can update tskk items" on public.tskk_items for update to authenticated using (public.has_role('analyst')) with check (public.has_role('analyst'));
create policy "admin can delete tskk items" on public.tskk_items for delete to authenticated using (public.has_role('admin'));


-- Keep audit trail consistent with existing security schema.
drop trigger if exists trg_audit_tskk_studies on public.tskk_studies;
create trigger trg_audit_tskk_studies after insert or update or delete on public.tskk_studies for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_tskk_items on public.tskk_items;
create trigger trg_audit_tskk_items after insert or update or delete on public.tskk_items for each row execute function public.write_audit_log();

alter table public.tskk_studies add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.tskk_studies add column if not exists updated_by uuid references auth.users(id) on delete set null;
