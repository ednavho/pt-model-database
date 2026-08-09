import { formatBytes, type ModelProvenance } from '@/lib/modelCards';

/** Same underline + trailing-arrow affordance used everywhere else a
 *  provenance field links out (lineage hover cards, model detail page). */
function ExternalLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-black underline underline-offset-2 hover:opacity-60 break-all"
    >
      {label ?? href} <span className="inline-block">↗</span>
    </a>
  );
}

/**
 * One model/requirement's provenance, as a card — display name, category,
 * attribution, license, download link, size, and (when present) the
 * review-specific fields: reviewer, reviewed at, license findings,
 * evidence, rationale. Shared by app/image-info/ImageInfoViewer.tsx and
 * app/workflow-review/page.tsx rather than each rendering their own copy.
 *
 * `badge` is left to the caller: what belongs in that top-right slot
 * (RiskBadge, VettingBadge, a "not in database" chip, or nothing) depends
 * on context this component doesn't have.
 *
 * `emptyMessage`, when set, replaces the field rows entirely — for a
 * requirement with a pointer but nothing behind it (broken record_id, or
 * genuinely nothing recorded), showing a row grid of blanks reads as
 * broken rather than "not reviewed yet".
 */
export default function ModelProvenanceCard({
  name,
  requirement,
  category,
  provenance,
  badge,
  emptyMessage,
}: {
  name: string | null;
  requirement: string | null;
  category?: string | null;
  provenance: ModelProvenance | null;
  badge?: React.ReactNode;
  emptyMessage?: string | null;
}) {
  const size = provenance ? formatBytes(provenance.size_bytes) : null;

  const rows: { label: string; value: React.ReactNode }[] = [];
  if (category) rows.push({ label: 'Category', value: category });
  if (provenance?.attribution_name) rows.push({ label: 'Attribution', value: provenance.attribution_name });
  if (provenance?.attribution_url) {
    rows.push({ label: 'Attribution URL', value: <ExternalLink href={provenance.attribution_url} /> });
  }
  if (provenance?.license_id || provenance?.license_url) {
    rows.push({
      label: 'License',
      value: provenance.license_url ? (
        <ExternalLink href={provenance.license_url} label={provenance.license_id ?? provenance.license_url} />
      ) : (
        provenance.license_id
      ),
    });
  }
  if (provenance?.download_url) {
    rows.push({ label: 'Download', value: <ExternalLink href={provenance.download_url} /> });
  }
  if (size && size !== '—') rows.push({ label: 'Size', value: size });
  if (provenance?.reviewer) rows.push({ label: 'Reviewer', value: provenance.reviewer });
  if (provenance?.reviewed_at) rows.push({ label: 'Reviewed at', value: provenance.reviewed_at });
  if (provenance?.license_findings) rows.push({ label: 'License findings', value: provenance.license_findings });
  if (provenance?.evidence) rows.push({ label: 'Evidence', value: provenance.evidence });
  if (provenance?.rationale) rows.push({ label: 'Rationale', value: provenance.rationale });

  return (
    <div className="border border-[#E9E9E9] rounded-[8px] px-5 py-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-black break-all">{name ?? requirement ?? 'Unknown requirement'}</p>
          {name && requirement && (
            <p className="text-[12px] text-[#939393] font-mono break-all mt-0.5">{requirement}</p>
          )}
        </div>
        {badge && <div className="flex items-center gap-2 shrink-0">{badge}</div>}
      </div>
      {emptyMessage ? (
        <p className="text-[13px] text-[#939393]">{emptyMessage}</p>
      ) : (
        <div className="space-y-4">
          {rows.map(({ label, value }) => (
            <div key={label} className="grid grid-cols-[110px_1fr]">
              <span className="text-[12px] text-[#939393]">{label}</span>
              <span className="text-[13px] text-black min-w-0">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
