/**
 * GET /api/models/:id — get a single model record by UUID
 * PATCH /api/models/:id — update a model record
 * DELETE /api/models/:id — delete a model record
 *
 * Response shape for GET (full Model object including internal fields):
 * {
 *   id: string,
 *   category: string,
 *   name: string | null,
 *   file_name: string,
 *   download_url: string | null,
 *   attribution: string | null,
 *   attribution_url: string | null,
 *   license: string | null,
 *   data_provenance_notes: string | null,
 *   size_bytes: number | null,
 *   vetting_status: "vetted" | "potentially_problematic" | "unknown",
 *   used_by_workflows: string[] | null,
 *   created_at: string,
 *   updated_at: string,
 * }
 *
 * Kyle's ComfyUI node should call GET /api/models/:id after a user selects
 * a model from the dropdown (populated via GET /api/models) to get full details.
 */

import { createClient } from '@/utils/supabase/server';
import { isInternalUser } from '@/utils/auth';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    // Auth guard placeholder

    const { data, error } = await supabase
      .from('models')
      .select('*,model_categories(name),vetting_statuses(name)')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error(`GET /api/models/${id} error:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { model_categories, vetting_statuses, category_id, vetting_status_id, ...rest } =
      data as typeof data & {
        model_categories: { name: string } | null;
        vetting_statuses: { name: string } | null;
        category_id: unknown;
        vetting_status_id: unknown;
      };

    return NextResponse.json({
      ...rest,
      category: model_categories?.name ?? null,
      vetting_status: vetting_statuses?.name ?? null,
    });
  } catch (err) {
    console.error('GET /api/models/:id unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isInternalUser(user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // Strip id/created_at from body to prevent overwrite
    const { id: _id, created_at: _ca, ...updates } = body;

    const { data, error } = await supabase
            .from('models')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error(`PATCH /api/models/${id} error:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('PATCH /api/models/:id unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isInternalUser(user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
            .from('models')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`DELETE /api/models/${id} error:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('DELETE /api/models/:id unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
