-- TMS PDC Warehouse — Observation-driven TSKK migration
-- Run once after the main V3.0.28 security schema and existing TSKK migration.

alter table public.observations add column if not exists observation_cycle_id text;
update public.observations set observation_cycle_id = coalesce(observation_cycle_id, concat('LEGACY-', id::text));
create index if not exists idx_observations_cycle_id on public.observations(observation_cycle_id);

alter table public.tskk_studies add column if not exists observation_cycle_id text;
alter table public.tskk_studies add column if not exists source_observation_ids jsonb not null default '[]'::jsonb;
create unique index if not exists ux_tskk_studies_observation_cycle_id on public.tskk_studies(observation_cycle_id) where observation_cycle_id is not null;
create index if not exists idx_tskk_studies_observation_cycle_id on public.tskk_studies(observation_cycle_id);

-- Preserve existing RLS; policies remain as defined by tskk_migration.sql.


-- Allow Analysts to replace/edit child items while editing a saved TSKK.
drop policy if exists "analyst admin can delete tskk items" on public.tskk_items;
create policy "analyst admin can delete tskk items" on public.tskk_items
for delete to authenticated
using (public.has_role('analyst'));
