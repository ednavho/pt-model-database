/**
 * GET /api/models — list vetted models from the pseudotools Hugging Face org
 *   ?category=checkpoints  (optional filter — matches the canonical category
 *                           value from CATEGORY_TAG_MAP, e.g. "checkpoints",
 *                           "controlnet", "clip_vision", "ipadapter", "loras")
 *
 * Model provenance now lives one Hugging Face repo per model (see
 * lib/modelCards.ts) instead of the Supabase `models` table. This endpoint
 * deliberately does NOT fetch/parse every repo's README — that is
 * expensive and would make listing slow as more cards are added. It only
 * calls the HF org-listing API (tags only, no README content) and derives
 * a readable name from the repo slug; the full display_name and all other
 * card fields are only fetched once a specific model is resolved via the
 * detail route.
 *
 * POST is not implemented — there is no write-back path to Hugging Face in
 * this task. Edit the model's card repo directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listModelRepos } from '@/lib/modelCards';

/** "pseudotools/checkpoint-juggernaut-x-hyper" -> "Juggernaut X Hyper" */
function nameFromSlug(repoId: string, category: string): string {
  const slug = repoId.split('/').pop() ?? repoId;
  const withoutOrg = slug.startsWith(`${category}-`) ? slug.slice(category.length + 1) : slug;
  return withoutOrg
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    const repos = await listModelRepos();

    const models = repos
      .filter((m) => !category || m.category === category)
      .map((m) => ({ ...m, name: nameFromSlug(m.record_id, m.category) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(models);
  } catch (err) {
    console.error('GET /api/models unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Not implemented. Model records now live on Hugging Face — edit the model’s card repo directly.' },
    { status: 501 }
  );
}
