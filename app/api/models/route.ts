/**
 * GET /api/models — list all models
 *   ?category=checkpoints  (optional filter by category)
 *
 * POST /api/models — create a new model record
 *
 * This endpoint is the primary integration point for:
 *   - The /models browsing page (web app)
 *   - The /package-workflow helper tool (filename matching)
 *   - Kyle's future ComfyUI VettedModelLoader node (dropdown population)
 *
 * Response shape for GET (array of Model objects):
 * [
 *   {
 *     id: string,           // UUID — stable pointer; used by workflows and Kyle's node
 *     category: string,     // e.g. "checkpoints", "controlnet", "loras", "custom_nodes"
 *     name: string | null,
 *     file_name: string,    // exact filename ComfyUI expects; used for matching
 *     download_url: string | null,
 *     attribution: string | null,
 *     attribution_url: string | null,
 *     license: string | null,
 *     data_provenance_notes: string | null,
 *     size_bytes: number | null,
 *     vetting_status: "vetted" | "potentially_problematic" | "unknown",
 *     used_by_workflows: string[] | null,
 *     created_at: string,
 *     updated_at: string,
 *   }
 * ]
 */

import { createClient } from '@/utils/supabase/server';
import { isInternalUser } from '@/utils/auth';
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_COLUMNS = 'id,name,file_name';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    // Auth guard placeholder — add: const { data: { user } } = await supabase.auth.getUser();
    // if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let query = supabase
      .from('models')
      .select(PUBLIC_COLUMNS)
      .order('name', { ascending: true });

    if (category) {
      query = query.eq('category_id', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('GET /api/models error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/models unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isInternalUser(user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    if (!body.category_id || !body.file_name) {
      return NextResponse.json(
        { error: 'category_id and file_name are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('models')
      .insert({
        category_id: body.category_id,
        name: body.name ?? null,
        file_name: body.file_name,
        download_url: body.download_url ?? null,
        attribution: body.attribution ?? null,
        attribution_url: body.attribution_url ?? null,
        license: body.license ?? null,
        data_provenance_notes: body.data_provenance_notes ?? null,
        size_bytes: body.size_bytes ?? null,
        vetting_status_id: body.vetting_status_id ?? null,
        used_by_workflows: body.used_by_workflows ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('POST /api/models error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('POST /api/models unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
