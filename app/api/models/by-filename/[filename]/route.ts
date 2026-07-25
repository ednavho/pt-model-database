/**
 * GET /api/models/by-filename/:filename — look up a single model by its exact filename.
 * Returns the same shape as GET /api/models/:id.
 */

import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ filename: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient();
    const { filename } = await params;

    const { data, error } = await supabase
      .from('models')
      .select('*,model_categories(name),vetting_statuses(name)')
      .eq('file_name', decodeURIComponent(filename))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error(`GET /api/models/by-filename/${filename} error:`, error);
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
    console.error('GET /api/models/by-filename unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
