import VettingBadge from '@/components/ui/VettingBadge';
import { Model, VettingStatus } from '@/types/database';
import { isInternalUser } from '@/utils/auth';
import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: model, error }, { data: { user } }] = await Promise.all([
    supabase
      .from('models')
      .select('*,model_categories(name),vetting_statuses(name)')
      .eq('id', id)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (error || !model) notFound();

  const internal = isInternalUser(user?.email);

  const m = model as Model;

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '—';
    const gb = bytes / 1_073_741_824;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1_048_576;
    return `${mb.toFixed(0)} MB`;
  };

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex gap-4 py-3 border-b border-zinc-100 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-400 w-40 shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className="text-sm text-zinc-900 flex-1">{value ?? <span className="text-zinc-300">—</span>}</dd>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block">
          ← Back to Models
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-zinc-900 mb-1">
              {m.name ?? m.file_name}
            </h1>
            {m.name && (
              <p className="font-mono text-sm text-zinc-500">{m.file_name}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <VettingBadge status={m.vetting_statuses?.name as VettingStatus} />
            {internal && (
              <Link
                href={`/models/${m.id}/edit`}
                className="text-xs border border-zinc-200 rounded-sm px-3 py-1.5 text-zinc-600 hover:border-zinc-400 transition-colors"
              >
                Edit
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Main provenance card */}
      <div className="border border-zinc-200 rounded-sm p-6 mb-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Provenance
        </div>
        <dl>
          <Row label="Category" value={m.model_categories?.name} />
          <Row label="File Name" value={<span className="font-mono">{m.file_name}</span>} />
          <Row label="Vetting Status" value={<VettingBadge status={m.vetting_statuses?.name as VettingStatus} />} />
          <Row label="License" value={m.license} />
          <Row label="Attribution" value={
            m.attribution_url ? (
              <a href={m.attribution_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600">
                {m.attribution ?? m.attribution_url}
              </a>
            ) : (
              m.attribution
            )
          } />
          <Row label="Download URL" value={
            m.download_url ? (
              <a href={m.download_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600 break-all">
                {m.download_url}
              </a>
            ) : null
          } />
          <Row label="File Size" value={formatBytes(m.size_bytes)} />
          <Row label="Data Provenance" value={
            m.data_provenance_notes ? (
              <span className="whitespace-pre-wrap">{m.data_provenance_notes}</span>
            ) : null
          } />
        </dl>
      </div>

      {/* Workflows card */}
      <div className="border border-zinc-200 rounded-sm p-6 mb-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Used By Workflows
        </div>
        {m.used_by_workflows && m.used_by_workflows.length > 0 ? (
          <ul className="space-y-1">
            {m.used_by_workflows.map((w) => (
              <li key={w} className="text-sm text-zinc-700">
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">No known essential workflows reference this model.</p>
        )}
      </div>

      {/* Metadata */}
      <div className="border border-zinc-200 rounded-sm p-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Record Info
        </div>
        <dl>
          <Row label="ID" value={<span className="font-mono text-xs">{m.id}</span>} />
          <Row label="Added" value={new Date(m.created_at).toLocaleDateString()} />
          <Row label="Last Updated" value={new Date(m.updated_at).toLocaleDateString()} />
        </dl>
      </div>
    </div>
  );
}
