import RiskBadge from '@/components/ui/RiskBadge';
import { CATEGORY_LABELS, fetchModelCard, formatBytes } from '@/lib/modelCards';
import Link from 'next/link';
import { notFound } from 'next/navigation';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-3 border-b border-zinc-100 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-400 w-40 shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className="text-sm text-zinc-900 flex-1">{value ?? <span className="text-zinc-300">—</span>}</dd>
    </div>
  );
}

function Section({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="border border-zinc-200 rounded-sm p-6 mb-6">
      <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">{label}</div>
      {text ? (
        <p className="text-sm text-zinc-700 whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="text-sm text-zinc-400">Nothing recorded yet.</p>
      )}
    </div>
  );
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const recordId = id.join('/');

  const m = await fetchModelCard(recordId);
  if (!m) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-xs text-zinc-400 hover:text-zinc-600 mb-4 inline-block">
          ← Back to Models
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-zinc-900 mb-1">{m.display_name}</h1>
            {m.requirement && <p className="font-mono text-sm text-zinc-500">{m.requirement}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RiskBadge record={m} />
          </div>
        </div>
      </div>

      {/* Main provenance card */}
      <div className="border border-zinc-200 rounded-sm p-6 mb-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Provenance
        </div>
        <dl>
          <Row label="Category" value={CATEGORY_LABELS[m.category] ?? m.category} />
          <Row label="Filename" value={m.requirement && <span className="font-mono">{m.requirement}</span>} />
          <Row
            label="License"
            value={
              m.provenance.license_url ? (
                <a href={m.provenance.license_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600">
                  {m.provenance.license_id ?? m.provenance.license_url}
                </a>
              ) : (
                m.provenance.license_id
              )
            }
          />
          <Row
            label="Attribution"
            value={
              m.provenance.attribution_url ? (
                <a href={m.provenance.attribution_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600">
                  {m.provenance.attribution_name ?? m.provenance.attribution_url}
                </a>
              ) : (
                m.provenance.attribution_name
              )
            }
          />
          <Row
            label="Download"
            value={
              m.provenance.download_url ? (
                <a href={m.provenance.download_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600 break-all">
                  {m.provenance.download_url}
                </a>
              ) : null
            }
          />
          <Row label="File Size" value={formatBytes(m.provenance.size_bytes)} />
          <Row label="Reviewer" value={m.provenance.reviewer} />
          <Row label="Reviewed At" value={m.provenance.reviewed_at} />
        </dl>
      </div>

      <Section label="License Findings" text={m.provenance.license_findings} />
      <Section label="Evidence" text={m.provenance.evidence} />
      <Section label="Rationale" text={m.provenance.rationale} />

      {/* Metadata */}
      <div className="border border-zinc-200 rounded-sm p-6">
        <div className="font-semibold text-xs uppercase tracking-wide text-zinc-500 mb-4">
          Record Info
        </div>
        <dl>
          <Row label="Record ID" value={<span className="font-mono text-xs">{m.record_id}</span>} />
        </dl>
      </div>
    </div>
  );
}
