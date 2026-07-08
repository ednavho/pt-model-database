import VettingBadge from '@/components/ui/VettingBadge';
import { MODEL_CATEGORIES, Model, VettingStatus } from '@/types/database';
import { isInternalUser } from '@/utils/auth';
import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';

interface SearchParams {
  category?: string;
  status?: string;
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const { category, status } = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const internal = isInternalUser(user?.email);

  let query = supabase
    .from('models')
    .select(
      'id,category_id,name,file_name,download_url,attribution,license,size_bytes,vetting_status_id,used_by_workflows,created_at,updated_at,model_categories!inner(name),vetting_statuses!inner(name)'
    )
    .order('name', { ascending: true });

  if (category) query = query.eq('model_categories.name', category);
  if (status) query = query.eq('vetting_statuses.name', status);

  const { data: models, error } = await query;

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '—';
    const gb = bytes / 1_073_741_824;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1_048_576;
    return `${mb.toFixed(0)} MB`;
  };

  const buildUrl = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    const s = p.toString();
    return s ? `/models?${s}` : '/models';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-12">
      {/* Page header */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 mb-2">Model Database</h1>
        <p className="text-zinc-500">
          Vetted AI models for use with Pseudorandom workflows.
        </p>
      </div>

      {/* Filters card */}
      <div className="border border-zinc-200 rounded-sm p-5 mb-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Filters
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-14 shrink-0">Category</span>
            <div className="flex flex-wrap gap-1">
              <Link
                href={buildUrl({ status })}
                className={`text-xs px-2 py-1 border rounded-sm ${
                  !category
                    ? 'border-zinc-800 bg-zinc-900 text-white'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                }`}
              >
                All
              </Link>
              {MODEL_CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  href={buildUrl({ category: cat, status })}
                  className={`text-xs px-2 py-1 border rounded-sm ${
                    category === cat
                      ? 'border-zinc-800 bg-zinc-900 text-white'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                  }`}
                >
                  {cat}
                </Link>
              ))}
              {internal && (
                <Link
                  href="/models/new"
                  className="text-xs border border-zinc-300 rounded-sm px-3 py-1 text-zinc-900 hover:bg-zinc-50 transition-colors ml-2"
                >
                  + Add Model
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-14 shrink-0">Status</span>
            <div className="flex gap-1">
              {['vetted', 'potentially_problematic', 'unknown'].map((s) => (
                <Link
                  key={s}
                  href={buildUrl({ category, status: s === status ? undefined : s })}
                  className={`text-xs px-2 py-1 border rounded-sm ${
                    status === s
                      ? 'border-zinc-800 bg-zinc-900 text-white'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                  }`}
                >
                  {s === 'potentially_problematic' ? 'problematic' : s}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm mb-6">
          Failed to load models: {error.message}
        </div>
      )}

      {/* Table */}
      <div className="border border-zinc-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3">
                Name / File
              </th>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3 hidden md:table-cell">
                Category
              </th>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3">
                Status
              </th>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3 hidden lg:table-cell">
                License
              </th>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3 hidden lg:table-cell">
                Size
              </th>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 px-4 py-3 hidden sm:table-cell">
                Download
              </th>
            </tr>
          </thead>
          <tbody>
            {!models || models.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-zinc-400 px-4 py-12 text-sm">
                  {error ? 'Error loading models.' : 'No models found. Add the first one!'}
                </td>
              </tr>
            ) : (
              (models as Model[]).map((model) => (
                <tr key={model.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/models/${model.id}`}
                      className="font-medium text-zinc-900 hover:underline block"
                    >
                      {model.name ?? model.file_name}
                    </Link>
                    {model.name && (
                      <span className="text-xs text-zinc-400 font-mono">{model.file_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 hidden md:table-cell">{model.model_categories?.name}</td>
                  <td className="px-4 py-3">
                    <VettingBadge status={model.vetting_statuses?.name as VettingStatus} />
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs hidden lg:table-cell">
                    {model.license ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs hidden lg:table-cell">
                    {formatBytes(model.size_bytes)}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {model.download_url ? (
                      <a
                        href={model.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs border border-zinc-200 rounded-sm px-2 py-1 text-zinc-600 hover:border-zinc-400 transition-colors"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {models && (
        <p className="text-xs text-zinc-400 mt-3 text-right">
          {models.length} model{models.length !== 1 ? 's' : ''}
          {category ? ` in ${category}` : ''}
          {status ? `, ${status}` : ''}
        </p>
      )}
    </div>
  );
}
