-- TMS PDC Warehouse — one video = one observation = one TSKK source
-- Run once after schema.sql and existing TSKK migrations.

alter table public.observations add column if not exists observation_session_id text;
update public.observations set observation_session_id = coalesce(observation_session_id, observation_cycle_id, concat('LEGACY-', id::text));
create index if not exists idx_observations_session_id on public.observations(observation_session_id);

alter table public.tskk_studies add column if not exists observation_session_id text;
update public.tskk_studies set observation_session_id = coalesce(observation_session_id, observation_cycle_id);
create unique index if not exists ux_tskk_studies_observation_session_id on public.tskk_studies(observation_session_id) where observation_session_id is not null;
create index if not exists idx_tskk_studies_observation_session_id on public.tskk_studies(observation_session_id);

-- Preserve existing RLS/policies; new columns are covered by the parent-row policies.
