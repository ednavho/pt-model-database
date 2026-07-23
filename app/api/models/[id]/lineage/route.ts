/**
 * GET /api/models/:id/lineage — where a model came from
 *
 * Thin wrapper over the get_model_lineage Postgres function, which returns one
 * hop only: the model's direct relationships, not the relationships of those
 * related records.
 *
 * Response shape:
 * [
 *   {
 *     id: string,                  // relationship row id
 *     relationship_label: string,  // e.g. "fine-tune-of"
 *     related_type: string,        // e.g. "model" | "dataset" | "paper"
 *     related_id: string,
 *     related_name: string,
 *   }
 * ]
 *
 * Most models have nothing recorded yet, so an empty array is the normal case
 * rather than an error.
 */

import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data, error } = await supabase.rpc('get_model_lineage', {
      target_model_id: id,
    });

    if (error) {
      console.error(`GET /api/models/${id}/lineage error:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('GET /api/models/:id/lineage unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
