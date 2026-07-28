import FilterDropdown from '@/components/models/FilterDropdown';
import ModelsList from '@/components/models/ModelsList';
import { MODEL_CATEGORIES } from '@/types/database';
import { isInternalUser } from '@/utils/auth';
import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';
import { Suspense } from 'react';

interface SearchParams {
  category?: string;
  status?: string;
  sort?: string;
}

const VETTING_STATUSES = ['vetted', 'potentially_problematic', 'unknown'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  controlnet: 'ControlNet',
  loras: 'LoRA',
  clip_vision: 'Clip Vision',
  ipadapter: 'IPAdapter',
};

const STATUS_LABELS: Record<string, string> = {
  vetted: 'Vetted',
  potentially_problematic: 'Potentially Problematic',
  unknown: 'Unknown',
};

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const { category, status, sort } = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const internal = isInternalUser(user?.email);

  const selectedCategories = category ? category.split(',').filter(Boolean) : [];
  const selectedStatuses = status ? status.split(',').filter(Boolean) : [];
  const sortDesc = sort === 'desc';

  let query = supabase
    .from('models')
    .select(
      'id,category_id,name,file_name,download_url,attribution,attribution_url,license,data_provenance_notes,size_bytes,vetting_status_id,used_by_workflows,created_at,updated_at,model_categories!inner(name),vetting_statuses!inner(name)'
    )
    .order('name', { ascending: !sortDesc });

  if (selectedCategories.length > 0) query = query.in('model_categories.name', selectedCategories);
  if (selectedStatuses.length > 0) query = query.in('vetting_statuses.name', selectedStatuses);

  const { data: models, error } = await query;

  return (
    <div className="px-6 pt-10 pb-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[40px] font-bold leading-none tracking-tight text-black">
          Model Database
        </h1>
        <p className="text-[15px] font-normal mt-2" style={{ color: '#878787' }}>
          Checked models, ready to use in your workflow
        </p>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 mb-6">
        <Suspense fallback={<div className="h-[35px] w-[150px] rounded-[8px] bg-zinc-50 border border-[#E9E9E9]" />}>
          <FilterDropdown
            dropdownLabel="Type"
            options={MODEL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))}
            selected={selectedCategories}
            paramName="category"
          />
        </Suspense>
        <Suspense fallback={<div className="h-[35px] w-[150px] rounded-[8px] bg-zinc-50 border border-[#E9E9E9]" />}>
          <FilterDropdown
            dropdownLabel="Status"
            options={VETTING_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
            selected={selectedStatuses}
            paramName="status"
          />
        </Suspense>
        {internal && (
          <Link
            href="/models/new"
            className="ml-auto text-[13px] border border-[#E9E9E9] rounded-[8px] px-3 py-[7px] text-zinc-700 hover:border-zinc-400 transition-colors"
          >
            + Add Model
          </Link>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-[13px] px-4 py-3 rounded-[8px] mb-6">
          Failed to load models: {error.message}
        </div>
      )}

      {/* Table with client-side search */}
      <ModelsList models={(models ?? []) as any} />
    </div>
  );
}
