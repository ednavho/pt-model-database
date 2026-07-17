import VettingBadge from '@/components/ui/VettingBadge';
import { MODEL_CATEGORIES, Model, VettingStatus } from '@/types/database';
import { isInternalUser } from '@/utils/auth';
import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';

interface SearchParams {
  category?: string;
  status?: string;
  sort?: string;
}

const VETTING_STATUSES = ['vetted', 'potentially_problematic', 'unknown'] as const;

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

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '—';
    const gb = bytes / 1_073_741_824;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1_048_576;
    return `${mb.toFixed(0)} MB`;
  };

  const LABELS: Record<string, string> = {
    checkpoints: 'Checkpoint',
    controlnet: 'ControlNet',
    loras: 'LoRA',
    clip_vision: 'Clip Vision',
    ipadapter: 'IPAdapter',
    vetted: 'Vetted',
    potentially_problematic: 'Potentially Problematic',
    unknown: 'Unknown',
  };

  const toggleValue = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const buildUrl = (cats: string[], stats: string[], s?: string) => {
    const p = new URLSearchParams();
    if (cats.length > 0) p.set('category', cats.join(','));
    if (stats.length > 0) p.set('status', stats.join(','));
    if (s) p.set('sort', s);
    const qs = p.toString();
    return qs ? `/models?${qs}` : '/models';
  };

  const sortToggleUrl = buildUrl(selectedCategories, selectedStatuses, sortDesc ? undefined : 'desc');

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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-14 shrink-0">Category</span>
              <div className="flex flex-wrap gap-1">
                {MODEL_CATEGORIES.map((cat) => (
                  <Link
                    key={cat}
                    href={buildUrl(toggleValue(selectedCategories, cat), selectedStatuses, sort)}
                    className={`text-xs px-2 py-1 border rounded-sm ${
                      selectedCategories.includes(cat)
                        ? 'border-zinc-800 bg-zinc-900 text-white'
                        : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                    }`}
                  >
                    {LABELS[cat] ?? cat}
                  </Link>
                ))}
              </div>
            </div>
            {selectedCategories.length === 0 ? (
              <span className="text-xs text-zinc-300 cursor-default">Clear</span>
            ) : (
              <Link href={buildUrl([], selectedStatuses, sort)} className="text-xs text-zinc-500 hover:text-zinc-800">
                Clear
              </Link>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/submit-model"
                className="text-xs border border-zinc-200 rounded-sm px-3 py-1 text-zinc-600 hover:border-zinc-400 transition-colors"
              >
                Request a model
              </Link>
              {internal && (
                <Link
                  href="/models/new"
                  className="text-xs border border-zinc-300 rounded-sm px-3 py-1 text-zinc-900 hover:bg-zinc-50 transition-colors"
                >
                  + Add Model
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-14 shrink-0">Status</span>
              <div className="flex gap-1">
                {VETTING_STATUSES.map((s) => (
                  <Link
                    key={s}
                    href={buildUrl(selectedCategories, toggleValue(selectedStatuses, s), sort)}
                    className={`text-xs px-2 py-1 border rounded-sm ${
                      selectedStatuses.includes(s)
                        ? 'border-zinc-800 bg-zinc-900 text-white'
                        : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                    }`}
                  >
                    {LABELS[s] ?? s}
                  </Link>
                ))}
              </div>
            </div>
            {selectedStatuses.length === 0 ? (
              <span className="text-xs text-zinc-300 cursor-default">Clear</span>
            ) : (
              <Link href={buildUrl(selectedCategories, [], sort)} className="text-xs text-zinc-500 hover:text-zinc-800">
                Clear
              </Link>
            )}
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
                <Link href={sortToggleUrl} className="inline-flex items-center gap-4">
                  Name / File
                  {sortDesc ? (
                    <span className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 193 193" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.3954 155.211C27.6092 155.717 38.3984 154.996 48.6637 155.321C51.0217 155.395 55.0942 155.401 57.1132 154.298C58.8657 153.326 60.1482 151.684 60.6667 149.749C61.9572 144.91 58.4339 141.671 54.0749 140.527L29.4209 140.49C25.2762 140.489 21.0982 140.363 16.9619 140.613C13.6022 140.788 10.3857 143.253 10.0584 146.75C9.55343 152.147 12.3492 154.676 17.3954 155.211Z" fill="currentColor"/>
                      <path d="M15.019 103.182C25.1335 103.717 35.4928 103.293 45.632 103.301C50.043 103.305 73.3838 103.836 76.145 102.918C77.7808 102.374 79.2218 101.022 79.9853 99.4966C80.815 97.8391 81.049 95.5969 80.4183 93.8356C79.585 91.5089 77.5608 90.3309 75.439 89.3384C72.6585 88.9714 68.6925 89.0864 65.786 89.0864L51.414 89.0711L30.0193 89.0403C26.258 89.0366 22.5723 89.0454 18.5865 89.0934C12.1873 89.1706 8.58328 92.8476 10.5263 99.2939C11.095 101.181 13.23 102.429 15.019 103.182Z" fill="currentColor"/>
                      <path d="M17.2974 51.9296C22.3164 52.1506 28.9021 51.9701 34.0294 51.9708L65.8991 51.9926L91.1542 52.0103C95.6254 52.0126 100.49 51.9401 104.902 51.9018C114.45 51.8191 114.299 38.7508 106.202 37.7541C87.4611 37.3918 67.6644 37.7166 48.8476 37.7126L27.8179 37.6911C23.9076 37.6863 19.8884 37.6111 15.9851 37.8126C14.7974 37.8738 13.9169 38.3086 12.9734 39.0171C11.3511 40.2343 10.2971 42.0618 10.0559 44.0756C9.51589 48.7971 12.9602 51.4671 17.2974 51.9296Z" fill="currentColor"/>
                      <path d="M139.269 37.7751C147.867 37.4422 156.696 37.8144 165.323 37.6874C169.77 37.6219 173.236 36.8538 175.922 40.7141C176.039 41.8327 176.283 43.9968 175.738 44.9405C173.408 48.9613 170.085 53.465 167.443 57.2707L148.611 84.6018C151.313 84.4569 154.828 84.5587 157.589 84.5601C162.625 84.54 167.659 84.5636 172.693 84.6315C174.138 85.552 174.941 86.4216 175.945 87.7606C176.044 88.8836 175.975 90.0294 175.936 91.1576C174.737 93.131 174.106 93.8114 171.857 94.421C161.272 94.7786 150.293 94.4237 139.676 94.4749C136.937 94.488 134.879 93.4642 134.237 90.7141C133.95 89.5283 134.055 88.2847 134.541 87.161C135.517 84.9471 141.105 77.2231 142.785 74.7928C149.092 65.7516 155.334 56.6689 161.511 47.5452C154.491 47.5372 147.462 47.6073 140.445 47.5426C134.893 47.4912 134.428 45.4903 134.555 40.855C136.005 38.6492 136.583 38.1938 139.269 37.7751Z" fill="currentColor"/>
                      <path d="M154.322 105.344C155.975 105.288 157.725 105.8 158.89 107.013C159.575 107.717 160 108.633 160.095 109.61C160.357 112.276 160.192 117.976 160.192 120.921L160.2 143.172L160.195 117.959C160.19 124.216 160.335 130.918 160.195 137.128C163.512 133.977 172.312 123.678 175.812 122.562C177.097 122.154 178.537 122.175 179.742 122.812C181.655 123.823 182.375 125.738 182.982 127.688C182.812 128.221 182.617 128.753 182.37 129.255C181.165 131.684 162.06 151.109 158.932 153.737C158.01 154.51 157.162 154.982 156.027 155.377C154.277 155.468 152.892 155.286 151.5 154.14C148.655 151.685 146.115 149.046 143.52 146.276C138.387 140.798 132.385 135.669 127.789 129.748C126.583 128.195 127.281 125.186 128.79 123.965C130.92 122.241 131.953 122.289 134.542 122.418C137.9 124.497 146.572 133.699 149.422 136.95C149.66 115.581 149.422 159.68 149.425 138.276L149.385 121.112C149.372 117.917 149.277 114.693 149.402 111.502C149.555 107.605 150.652 106.214 154.322 105.344Z" fill="currentColor"/>
                    </svg>
                    </span>
                  ) : (
                    <span className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 193 193" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.3954 37.7693C27.6092 37.2628 38.3984 37.9838 48.6637 37.6593C51.0217 37.5848 55.0942 37.5786 57.1132 38.6821C58.8657 39.6538 60.1482 41.2958 60.6667 43.2313C61.9572 48.0703 58.4339 51.3093 54.0749 52.4533L29.4209 52.49C25.2762 52.4913 21.0982 52.6165 16.9619 52.3668C13.6022 52.1915 10.3857 49.7268 10.0584 46.2298C9.55343 40.8333 12.3492 38.3035 17.3954 37.7693Z" fill="currentColor"/>
                      <path d="M15.019 89.7984C25.1335 89.2631 35.4928 89.6866 45.632 89.6786C50.043 89.6751 73.3838 89.1439 76.145 90.0619C77.7808 90.6059 79.2218 91.9579 79.9853 93.4834C80.815 95.1409 81.049 97.3831 80.4183 99.1444C79.585 101.471 77.5608 102.649 75.439 103.642C72.6585 104.009 68.6925 103.894 65.786 103.894L51.414 103.909L30.0193 103.94C26.258 103.943 22.5723 103.935 18.5865 103.887C12.1873 103.809 8.58328 100.132 10.5263 93.6861C11.095 91.7991 13.23 90.5511 15.019 89.7984Z" fill="currentColor"/>
                      <path d="M17.2974 141.05C22.3164 140.829 28.9021 141.01 34.0294 141.009L65.8991 140.987L91.1542 140.97C95.6254 140.967 100.49 141.04 104.902 141.078C114.45 141.161 114.299 154.229 106.202 155.226C87.4611 155.588 67.6644 155.263 48.8476 155.267L27.8179 155.289C23.9076 155.294 19.8884 155.369 15.9851 155.167C14.7974 155.106 13.9169 154.671 12.9734 153.963C11.3511 152.746 10.2971 150.918 10.0559 148.904C9.51589 144.183 12.9602 141.513 17.2974 141.05Z" fill="currentColor"/>
                      <path d="M153.324 37.653C161.402 36.9193 161.737 42.0211 163.985 48.3795L168.807 62.0387L176.004 81.8121C177.064 84.7484 178.857 88.8829 179.53 91.8434C180.94 98.0484 174.887 99.2615 170.562 96.4645C168.949 93.6217 167.117 87.1147 165.987 83.735C163.187 83.592 159.836 83.6733 156.996 83.6715L144.187 83.6608C143.052 87.121 141.615 92.2584 139.962 95.4069C138.965 97.3056 137.304 97.7508 135.384 98.1696C130.901 97.2535 129.535 95.3384 130.961 90.8883C131.824 88.1951 132.814 85.5803 133.766 82.9196L139.277 67.4117C141.294 61.52 143.352 55.6424 145.454 49.7799C146.152 47.8223 146.865 45.7904 147.582 43.8463C149 40.0106 149.407 38.8914 153.324 37.653ZM154.82 52.2184C152.817 59.1466 149.872 66.1901 147.74 73.3024C150.344 73.3261 152.947 73.3319 155.552 73.3209L162.284 73.2487C160.637 67.6045 157.157 58.3435 155.214 52.4615C155.084 52.3806 154.952 52.2991 154.82 52.2184Z" fill="currentColor"/>
                      <path d="M154.322 105.344C155.975 105.288 157.725 105.8 158.89 107.013C159.575 107.717 160 108.633 160.095 109.61C160.357 112.276 160.192 117.976 160.192 120.921L160.2 143.172L160.195 117.959C160.19 124.216 160.335 130.918 160.195 137.128C163.512 133.977 172.312 123.678 175.812 122.562C177.097 122.154 178.537 122.175 179.742 122.812C181.655 123.823 182.375 125.738 182.982 127.688C182.812 128.221 182.617 128.753 182.37 129.255C181.165 131.684 162.06 151.109 158.932 153.737C158.01 154.51 157.162 154.982 156.027 155.377C154.277 155.468 152.892 155.286 151.5 154.14C148.655 151.685 146.115 149.046 143.52 146.276C138.387 140.798 132.385 135.669 127.789 129.748C126.583 128.195 127.281 125.186 128.79 123.965C130.92 122.241 131.953 122.289 134.542 122.418C137.9 124.497 146.572 133.699 149.422 136.95C149.66 115.581 149.422 159.68 149.425 138.276L149.385 121.112C149.372 117.917 149.277 114.693 149.402 111.502C149.555 107.605 150.652 106.214 154.322 105.344Z" fill="currentColor"/>
                    </svg>
                    </span>
                  )}
                </Link>
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
                  {error ? 'Error loading models.' : 'No models found.'}
                </td>
              </tr>
            ) : (
              (models as unknown as Model[]).map((model) => (
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
                  <td className="px-4 py-3 text-zinc-600 hidden md:table-cell">{LABELS[model.model_categories?.name?.toLowerCase() ?? ''] ?? model.model_categories?.name}</td>
                  <td className="px-4 py-3">
                    <VettingBadge status={model.vetting_statuses?.name?.toLowerCase() as VettingStatus} />
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
        </p>
      )}
    </div>
  );
}
