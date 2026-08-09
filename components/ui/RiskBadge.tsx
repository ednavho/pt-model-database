import { REVIEW_STATUS_META, type ModelCardRecord } from '@/lib/modelCards';
import { cn } from '@/utils/cn';

/**
 * Renders the 5-level status synthesized from risk_severity,
 * evidence_completeness, and evidence_reliability (see
 * computeReviewStatus() in lib/modelCards.ts). This is the only place
 * those three review dimensions surface in the model database UI — the
 * raw scores stay inside `provenance`, visible only in technical/JSON
 * views (API response, PWW preview).
 *
 * This is a separate component from components/ui/VettingBadge.tsx on
 * purpose — VettingBadge is still load-bearing for the (untouched, still
 * Supabase-backed) lineage feature in app/image-info/ImageInfoViewer.tsx.
 */
export default function RiskBadge({ record }: { record: Pick<ModelCardRecord, 'status'> }) {
  const meta = REVIEW_STATUS_META[record.status];
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-[11px] border rounded-[8px] font-medium',
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}
