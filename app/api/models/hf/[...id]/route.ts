/**
 * GET /api/models/hf/:repoPath — full model card record from Hugging Face
 *
 * :repoPath is a catch-all (e.g. "pseudotools/checkpoint-juggernaut-x-hyper")
 * because a repo id contains a slash, which a single dynamic segment can't
 * capture. Deliberately a NEW route rather than a rewrite of the existing
 * app/api/models/[id]/route.ts: that route (and its /lineage child) is
 * still called directly by app/image-info/ImageInfoViewer.tsx and
 * app/lineage-sketch/LineageSketch.tsx with a Supabase `models.id` UUID —
 * pointers already embedded in previously-rendered images — and rewriting
 * it to be Hugging Face-only would 404 the lineage tab for all of those.
 * See PR discussion for the full writeup; flagged for a decision rather
 * than silently restructuring the shared route.
 *
 * No caching layer — every request live-fetches Hugging Face. Deferred by
 * design for this task, not an oversight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchModelCard } from '@/lib/modelCards';

type RouteContext = { params: Promise<{ id: string[] }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const repoPath = id.join('/');

    const record = await fetchModelCard(repoPath);
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(record);
  } catch (err) {
    console.error('GET /api/models/hf/:id unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH() {
  return NextResponse.json(
    { error: 'Not implemented. Model records now live on Hugging Face — edit the model’s card repo directly.' },
    { status: 501 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Not implemented. Model records now live on Hugging Face — edit the model’s card repo directly.' },
    { status: 501 }
  );
}
