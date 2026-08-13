import { BADGE_TAG_META, type ModelCardRecord } from '@/lib/modelCards';
import { cn } from '@/utils/cn';

/**
 * Renders the -1..3 assessment badge synthesized from risk_severity,
 * evidence_completeness, and evidence_reliability (see
 * computeRequirementBadge() in lib/modelCards.ts) as a visible text tag.
 * This is the only place those three review dimensions surface in the UI
 * — the raw scores stay inside `provenance`, visible only in technical/
 * JSON views (API response, PWW preview).
 *
 * This is a separate component from components/ui/VettingBadge.tsx on
 * purpose — VettingBadge is still load-bearing for the (untouched, still
 * Supabase-backed) legacy lineage feature in app/image-info/
 * ImageInfoViewer.tsx, a different tri-state system for pre-migration
 * images that predates risk_severity/evidence_completeness/
 * evidence_reliability entirely.
 */
/** 'sm' (default) is every existing usage's size, unchanged — the model
 *  database table, PWW model cards, image-info requirement cards. 'md' is
 *  only for app/models/[...id]/page.tsx's header, which sits next to a
 *  much larger title than these other contexts do. */
export default function RiskBadge({
  record,
  size = 'sm',
}: {
  record: Pick<ModelCardRecord, 'badge'>;
  size?: 'sm' | 'md';
}) {
  const meta = BADGE_TAG_META[record.badge];
  return (
    <span
      className={cn(
        'inline-flex items-center border rounded-[8px] font-medium',
        size === 'md' ? 'px-3 py-1 text-[13px]' : 'px-2 py-0.5 text-[11px]',
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}
