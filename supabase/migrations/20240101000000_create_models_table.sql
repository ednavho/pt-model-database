-- Migration: create_models_table
-- Creates the pseudorandom_provenance.models table for the model provenance system.
-- Uses a dedicated schema to avoid colliding with existing tables used by
-- the Dispatcher and PT Accounts apps that share this Supabase instance.

create schema if not exists pseudorandom_provenance;

-- Vetting status values: vetted (green), potentially_problematic (orange), unknown (red)
create type pseudorandom_provenance.vetting_status_enum as enum (
  'vetted',
  'potentially_problematic',
  'unknown'
);

create table pseudorandom_provenance.models (
  id                     uuid primary key default gen_random_uuid(),
  category               text not null,
  name                   text,
  -- Exact filename ComfyUI expects (e.g. "Juggernaut_X_RunDiffusion_Hyper.safetensors").
  -- This is what workflow JSON requirement fields match against.
  file_name              text not null,
  download_url           text,
  attribution            text,
  attribution_url        text,
  license                text,
  data_provenance_notes  text,
  size_bytes             bigint,
  -- vetted=green, potentially_problematic=orange, unknown=red
  vetting_status         pseudorandom_provenance.vetting_status_enum not null default 'unknown',
  -- Names/IDs of known essential workflows referencing this model.
  used_by_workflows      text[],
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Index for the most common query: filtering by category (used by GET /api/models?category=)
create index models_category_idx on pseudorandom_provenance.models (category);
create index models_file_name_idx on pseudorandom_provenance.models (file_name);

-- Auto-update updated_at on any row change
create or replace function pseudorandom_provenance.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger models_updated_at
  before update on pseudorandom_provenance.models
  for each row execute function pseudorandom_provenance.set_updated_at();

-- Row Level Security (open for now; add policies when auth is wired)
alter table pseudorandom_provenance.models enable row level security;

-- Temporary open policies — replace with real policies when auth is added
create policy "allow_all_select" on pseudorandom_provenance.models
  for select using (true);

create policy "allow_all_insert" on pseudorandom_provenance.models
  for insert with check (true);

create policy "allow_all_update" on pseudorandom_provenance.models
  for update using (true);

create policy "allow_all_delete" on pseudorandom_provenance.models
  for delete using (true);
