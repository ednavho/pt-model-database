-- Migration: create_models_table
-- Sets up the full model provenance schema: lookup tables, models, model_submissions.
--
-- NOTE: Tables are in the public schema (default Supabase API schema).
-- The original migration created a pseudorandom_provenance schema, but app code
-- accesses tables via supabase.from('models') without a schema prefix, so public
-- is what the client actually queries.
--
-- Auth is enforced at the application layer (INTERNAL_EMAILS allow-list in
-- config/auth.ts), not via RLS. RLS is enabled with permissive policies to
-- match current behavior. Tighten before production hardening.

-- ── Lookup tables ──────────────────────────────────────────────────────────────

create table if not exists model_categories (
  id   text primary key,  -- slug: 'checkpoints', 'controlnet', 'loras', etc.
  name text not null      -- same as id; present for PostgREST join queries
);

insert into model_categories (id, name) values
  ('checkpoints', 'checkpoints'),
  ('controlnet',  'controlnet'),
  ('loras',       'loras'),
  ('clip_vision', 'clip_vision'),
  ('ipadapter',   'ipadapter')
on conflict (id) do nothing;

create table if not exists vetting_statuses (
  id   text primary key,  -- slug: 'vetted', 'potentially_problematic', 'unknown'
  name text not null
);

insert into vetting_statuses (id, name) values
  ('vetted',                 'vetted'),
  ('potentially_problematic','potentially_problematic'),
  ('unknown',                'unknown')
on conflict (id) do nothing;

-- ── models ─────────────────────────────────────────────────────────────────────

create table if not exists models (
  id                    uuid        primary key default gen_random_uuid(),
  category_id           text        not null references model_categories(id),
  name                  text,
  -- Exact filename ComfyUI expects (e.g. "v1-5-pruned.safetensors").
  -- Matched against node widgets_values[0] by the Package Workflow wizard
  -- and against the model_id input by Kyle's VettedModelLoader node.
  file_name             text        not null unique,
  download_url          text,
  attribution           text,
  attribution_url       text,
  license               text,
  data_provenance_notes text,
  size_bytes            bigint,
  vetting_status_id     text        not null references vetting_statuses(id) default 'unknown',
  -- UUIDs of pseudorandom workflows that reference this model via provenance_id.
  used_by_workflows     text[],
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists models_category_id_idx       on models(category_id);
create index if not exists models_vetting_status_id_idx on models(vetting_status_id);
create index if not exists models_file_name_idx         on models(file_name);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger models_updated_at
  before update on models
  for each row execute function set_updated_at();

alter table models enable row level security;
-- Public read; writes are auth-gated in API routes (isInternalUser check).
create policy "public select"   on models for select using (true);
create policy "public insert"   on models for insert with check (true);
create policy "public update"   on models for update using (true);
create policy "public delete"   on models for delete using (true);

-- ── model_submissions ──────────────────────────────────────────────────────────

-- Holds models submitted for review via /submit-model.
-- On approval, records are manually promoted to the models table.
create table if not exists model_submissions (
  id                    uuid        primary key default gen_random_uuid(),
  -- Required
  name                  text        not null,
  source_url            text        not null,
  submitted_by_name     text        not null,
  submitted_by_email    text        not null,
  -- Optional
  file_name             text,
  category_id           text        references model_categories(id),
  license               text,
  attribution           text,
  attribution_url       text,
  data_provenance_notes text,
  reason                text,       -- why the submitter wants it added
  -- No vetting_status — assigned only when promoted to models table
  created_at            timestamptz not null default now()
);

alter table model_submissions enable row level security;
-- Anyone can submit; only internal users should read (enforced in app layer).
create policy "public insert"   on model_submissions for insert with check (true);
create policy "public select"   on model_submissions for select using (true);
