/**
 * GET /api/models/hf/by-filename/:filename — fallback lookup by exact
 * requirement (filename), for the (rarer) case where a workflow node has a
 * filename but no record_id pointer.
 *
 * The primary lookup is always by record_id (GET /api/models/hf/:id) — this
 * only runs when that's missing. HF's list API doesn't expose the filename
 * (that's only in each repo's README, as `requirement`), so this
 * fetches+parses candidate repos one at a time and returns on the first
 * match. At today's scale (6 repos) that's a handful of cheap requests; if
 * the catalog grows large enough for this to matter, that's the natural
 * point to add caching — deliberately not built ahead of that need.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchModelCard, listModelRepos } from '@/lib/modelCards';

type RouteContext = { params: Promise<{ filename: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { filename } = await params;
    const target = decodeURIComponent(filename);

    const repos = await listModelRepos();

    for (const repo of repos) {
      const record = await fetchModelCard(repo.record_id);
      if (record?.requirement === target) {
        return NextResponse.json(record);
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    console.error('GET /api/models/hf/by-filename unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
