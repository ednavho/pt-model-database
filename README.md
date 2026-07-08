# Pseudorandom Model Provenance

NSF-funded AI rendering plugin for Rhino (Pseudorandom) — model provenance database, API, management web app, and workflow packaging tool.

---

## Local setup

```bash
cp .env.local.example .env.local
# Fill in your Supabase URL and keys (see below)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Only needed for admin operations; not used by current API routes |
| `NEXT_PUBLIC_SITE_URL` | Optional | Base URL for redirects; defaults to localhost in dev |

These variable names match `pt-accounts-main` — if this app is ever added to the same Vercel project, they'll already be configured.

---

## Database setup

Run the migration against your Supabase project:

```bash
# Option 1: Supabase CLI
supabase db push

# Option 2: Paste directly into the Supabase SQL editor
cat supabase/migrations/20240101000000_create_models_table.sql
```

The migration creates a `pseudorandom_provenance` schema with a `models` table. Using a dedicated schema avoids collisions with the existing `public` schema tables used by pt-accounts and the Dispatcher.

---

## Routes

| Route | Description |
|---|---|
| `/` | Home / nav links |
| `/models` | Browse all vetted models — filter by category and vetting status |
| `/models/new` | Add a new model record |
| `/models/[id]` | Full provenance detail for one model |
| `/models/[id]/edit` | Edit a model record |
| `/package-workflow` | Step-by-step wizard: upload a ComfyUI export → download a `.pseudorandom.json` workflow |

**API routes** (Next.js route handlers, JSON):

| Endpoint | Method | Description |
|---|---|---|
| `/api/models` | GET | List all models; `?category=` to filter |
| `/api/models` | POST | Create a model record |
| `/api/models/:id` | GET | Get one model by UUID |
| `/api/models/:id` | PATCH | Update a model record |
| `/api/models/:id` | DELETE | Delete a model record |

---

## Decision points to revisit

### Repo structure
Currently: a single Next.js repo with API routes, the web app, and the helper tool as different pages. This is simpler to build and deploy as one person. Revisit if the API needs to be independently versioned or if the management UI and public-facing browsing UI diverge significantly in auth requirements.

### Auth
Currently a stub: the "Sign In" button auto-authenticates with no credential check, stored in `sessionStorage`. All auth logic is isolated in `utils/auth/index.ts` — replace its body with Supabase Auth or any other provider without touching any other file.

The API routes have auth guard placeholder comments at the top of each handler — add a real check there once auth is wired. RLS policies on the Supabase table are currently open (`allow_all_*`); tighten these at the same time.

### Kyle's ComfyUI node
See [`config/vettedNodeTypes.ts`](config/vettedNodeTypes.ts) — the single file that needs updating when Kyle confirms his node's `class_type` string. No other code changes needed.

The endpoints Kyle's node should use:
- `GET /api/models?category=checkpoints` — populate the model picker dropdown
- `GET /api/models/:id` — fetch full details after a user selects a model

Both endpoints are documented with response shapes in their route handler files.

---

## Tech stack

- **Next.js 16** — App Router, TypeScript strict
- **Supabase** — Postgres via `@supabase/ssr`
- **Tailwind CSS 4** — zinc color palette, no heavy design system
- **Vercel** — deploy with `vercel --prod` from this repo root; add the env vars in the Vercel dashboard
