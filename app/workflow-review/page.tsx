import ModelProvenanceCard from '@/components/ui/ModelProvenanceCard';
import RiskBadge from '@/components/ui/RiskBadge';
import {
  EMPTY_PROVENANCE,
  REVIEW_STATUS_META,
  computeWorkflowStatus,
  fetchModelCard,
  type ModelCardRecord,
  type ModelProvenance,
  type WorkflowStatusSummary,
} from '@/lib/modelCards';
import { cn } from '@/utils/cn';

/**
 * Replaces the Rhino plugin's old left "Workflow Details" panel — reached
 * from a button next to the workflow name in the plugin's middle panel,
 * which opens this page in the user's browser rather than rendering the
 * info in-plugin. Query params, not a path segment: `record_id` already
 * has to work around slash-in-path routing (see
 * app/api/models/hf/[...id]/route.ts), there's no reason to take that on
 * again here, and this page is never linked from site navigation anyway —
 * a human-readable path buys nothing.
 *
 * ── Input contract ────────────────────────────────────────────────────────
 * `workflowSource` points to the *entire* pseudorandom workflow document —
 * the same JSON WorkflowWizard.tsx's buildOutput() produces and the PWW
 * downloads as `<name>.pseudorandom.json`. Everything below other than
 * `workflow` (the raw ComfyUI graph, deliberately never read here — this
 * page shows the metadata *around* the graph, not the graph itself) is
 * modeled from that function's actual return shape, not guessed. What's
 * still genuinely unconfirmed is how the plugin delivers this link (the
 * generation mechanism doesn't exist yet) — not the document shape itself.
 *
 * `riskTolerance` is accepted and threaded through so the plugin's setting
 * has somewhere to land, but nothing here is tolerance-driven yet — no
 * thresholds, no filtering. That behavior hasn't been specified.
 */

type WorkflowAttribution = {
  author: string | null;
  author_url: string | null;
  license: string | null;
};

type GlobalGuidanceCapabilities = { txt_scene: boolean; txt_style: boolean; txt_negative: boolean; img_style: boolean };
type RegionalGuidanceCapabilities = { text: boolean; image: boolean };
type SpatialGuidanceCapabilities = { depth: boolean; edge: boolean };

type WorkflowVariable = {
  name: string;
  type: 'int' | 'float' | 'string';
  description: string;
  default: number | string;
  binds_to: string;
  min?: number;
  max?: number;
  step?: number;
};

/**
 * Every endpoint_requirements[] entry carries display_name/category/
 * requirement/provenance regardless of source; record_id is present (and
 * truthy) only for a database-matched, vetted model — absent for a manual
 * entry or a fixed requirement like the pseudocomfy extension. `provenance`
 * is typed loosely (not the full ModelProvenance) because the PWW emits two
 * different sizes of it (6-key "not vetted" vs 14-key "vetted") depending
 * on whether record_id is set — see WorkflowWizard.tsx's buildOutput().
 */
type WorkflowRequirementInput = {
  display_name: string;
  category: string;
  requirement: string;
  record_id?: string | null;
  provenance: Partial<ModelProvenance>;
};

type PseudorandomWorkflowDocument = {
  pseudorandom_workflow_schema_version?: number;
  type?: string;
  name: string;
  description: string;
  thumbnail: string | null;
  attribution: WorkflowAttribution;
  global_guidance_capabilities: GlobalGuidanceCapabilities;
  regional_guidance_capabilities: RegionalGuidanceCapabilities;
  spatial_guidance_capabilities: SpatialGuidanceCapabilities;
  variables: WorkflowVariable[];
  endpoint_requirements: WorkflowRequirementInput[];
  // `workflow` (the raw ComfyUI graph) intentionally not modeled — out of scope for this page.
};

type ResolvedRequirement = {
  /** Feeds computeWorkflowStatus() — null for anything with no live database record. */
  card: ModelCardRecord | null;
  displayName: string | null;
  requirement: string | null;
  category: string | null;
  provenance: ModelProvenance | null;
  /** True when the input never had a record_id at all (manual entry, or a
   *  fixed requirement like the pseudocomfy extension) — as opposed to a
   *  record_id that was given but didn't resolve. */
  isManual: boolean;
  isExtension: boolean;
  recordId: string | null;
};

async function resolveEntry(entry: WorkflowRequirementInput): Promise<ResolvedRequirement> {
  const isExtension = entry.category === 'custom_nodes';

  if (entry.record_id) {
    // Live lookup, not the provenance embedded in the document — a card's
    // review status can change after a workflow was packaged, and the
    // whole point of a badge here is to reflect current status, not a
    // stale snapshot from export time.
    const card = await fetchModelCard(entry.record_id);
    if (card) {
      return {
        card,
        displayName: card.display_name,
        requirement: card.requirement,
        category: card.category,
        provenance: card.provenance,
        isManual: false,
        isExtension,
        recordId: entry.record_id,
      };
    }
    return {
      card: null,
      displayName: entry.display_name,
      requirement: entry.requirement,
      category: entry.category,
      provenance: null,
      isManual: false,
      isExtension,
      recordId: entry.record_id,
    };
  }

  // No record_id: a manual entry or a fixed requirement (e.g. pseudocomfy)
  // — render whatever provenance the document embedded directly.
  return {
    card: null,
    displayName: entry.display_name,
    requirement: entry.requirement,
    category: entry.category,
    provenance: { ...EMPTY_PROVENANCE, ...entry.provenance },
    isManual: true,
    isExtension,
    recordId: null,
  };
}

function badgeFor(req: ResolvedRequirement): React.ReactNode {
  if (req.isExtension) return null;
  if (req.card) return <RiskBadge record={{ status: req.card.status }} />;
  if (req.isManual) return <span className="text-[11px] text-[#939393] italic">Manually added, not reviewed</span>;
  return null; // record_id given but unresolved — emptyMessageFor() already explains it
}

function emptyMessageFor(req: ResolvedRequirement): string | null {
  if (req.card || req.isManual) return null;
  return `record_id "${req.recordId}" was not found in the model database.`;
}

/** "5 of 6 requirements have a review record — 4 assessed, 1 pending review — 1 not in the database." */
function breakdownSentence(summary: WorkflowStatusSummary): string {
  const withRecord = summary.verdictCount + summary.pendingReviewCount;
  const recordClause = `${withRecord} of ${summary.total} requirement${summary.total === 1 ? '' : 's'} ${withRecord === 1 ? 'has' : 'have'} a review record`;

  const parts: string[] = [];
  if (summary.verdictCount > 0) parts.push(`${summary.verdictCount} assessed`);
  if (summary.pendingReviewCount > 0) parts.push(`${summary.pendingReviewCount} pending review`);
  const assessedClause = parts.length > 0 ? ` — ${parts.join(', ')}` : '';

  const missingClause = summary.notInDatabaseCount > 0 ? ` — ${summary.notInDatabaseCount} not in the database` : '';

  return `${recordClause}${assessedClause}${missingClause}.`;
}

function WorkflowStatusBanner({
  summary,
  riskTolerance,
}: {
  summary: WorkflowStatusSummary;
  riskTolerance: string | null;
}) {
  const meta = REVIEW_STATUS_META[summary.status];
  const copy =
    summary.verdictCount === 0
      ? 'No models in this workflow have completed review yet.'
      : breakdownSentence(summary);

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        {summary.notInDatabaseCount > 0 && (
          <span className="inline-flex items-center px-2.5 py-1 text-[13px] border rounded-[8px] font-medium bg-amber-50 text-amber-700 border-amber-200">
            {summary.notInDatabaseCount} not in database
          </span>
        )}
        <span className={cn('inline-flex items-center px-2.5 py-1 text-[13px] border rounded-[8px] font-medium', meta.className)}>
          {meta.label}
        </span>
      </div>
      <p className="text-[13px] text-black">{copy}</p>
      {riskTolerance && (
        // Placeholder — accepted and displayed so the plugin's setting has
        // somewhere to land, but nothing on this page reacts to it yet.
        <p className="text-[12px] text-[#C0C0C0] mt-1">Risk tolerance (not yet used on this page): {riskTolerance}</p>
      )}
    </div>
  );
}

const CAPABILITY_GROUPS = (doc: PseudorandomWorkflowDocument) => [
  {
    title: 'Global Guidance',
    items: [
      { label: 'Scene Text', used: !!doc.global_guidance_capabilities?.txt_scene },
      { label: 'Style Text', used: !!doc.global_guidance_capabilities?.txt_style },
      { label: 'Negative Text', used: !!doc.global_guidance_capabilities?.txt_negative },
      { label: 'Style Image', used: !!doc.global_guidance_capabilities?.img_style },
    ],
  },
  {
    title: 'Regional Guidance',
    items: [
      { label: 'Regional Text', used: !!doc.regional_guidance_capabilities?.text },
      { label: 'Regional Image', used: !!doc.regional_guidance_capabilities?.image },
    ],
  },
  {
    title: 'Spatial Guidance',
    items: [
      { label: 'Spatial Depth', used: !!doc.spatial_guidance_capabilities?.depth },
      { label: 'Spatial Edge', used: !!doc.spatial_guidance_capabilities?.edge },
    ],
  },
];

function CapabilitiesSection({ doc }: { doc: PseudorandomWorkflowDocument }) {
  return (
    <div className="pl-5 space-y-4">
      {CAPABILITY_GROUPS(doc).map((group) => (
        <div key={group.title}>
          <p className="text-[12px] text-[#939393] mb-2">{group.title}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {group.items.map((item) => (
              <span
                key={item.label}
                className={cn('flex items-center gap-1.5 text-[13px]', item.used ? 'text-black font-medium' : 'text-[#C0C0C0]')}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', item.used ? 'bg-black' : 'bg-[#E9E9E9]')} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function VariableCard({ v }: { v: WorkflowVariable }) {
  const isNumeric = v.type === 'int' || v.type === 'float';
  return (
    <div className="border border-[#E9E9E9] rounded-[8px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[15px] font-semibold text-black">{v.name || '(unnamed variable)'}</p>
        <span className="text-[11px] text-[#939393] border border-[#E9E9E9] rounded-[6px] px-1.5 py-0.5">{v.type}</span>
      </div>
      <p className="text-[12px] text-[#939393] font-mono mb-2">binds_to: {v.binds_to}</p>
      {v.description && <p className="text-[13px] text-black mb-3">{v.description}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#939393]">
        <span>default: {String(v.default)}</span>
        {isNumeric && v.min !== undefined && <span>min: {v.min}</span>}
        {isNumeric && v.max !== undefined && <span>max: {v.max}</span>}
        {isNumeric && v.step !== undefined && <span>step: {v.step}</span>}
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="px-6 pt-10 pb-6 max-w-[800px] mx-auto">
      <h1 className="text-[24px] font-semibold text-black mb-2">Workflow review</h1>
      <p className="text-[13px] text-[#DC2626]">{message}</p>
    </div>
  );
}

export default async function WorkflowReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workflowSource?: string; riskTolerance?: string }>;
}) {
  const { workflowSource, riskTolerance } = await searchParams;

  if (!workflowSource) {
    return <ErrorPage message="Missing required workflowSource query parameter — this page has nothing to load without it." />;
  }

  let doc: PseudorandomWorkflowDocument;
  try {
    const res = await fetch(workflowSource, { cache: 'no-store' });
    if (!res.ok) throw new Error(`workflowSource returned ${res.status}`);
    const json = await res.json();
    if (!json || typeof json !== 'object' || !Array.isArray(json.endpoint_requirements)) {
      throw new Error('workflowSource did not return a pseudorandom workflow document (missing endpoint_requirements)');
    }
    doc = json as PseudorandomWorkflowDocument;
  } catch (err) {
    return <ErrorPage message={`Couldn't load the workflow document: ${err instanceof Error ? err.message : String(err)}`} />;
  }

  const resolved = await Promise.all(doc.endpoint_requirements.map(resolveEntry));
  const summary = computeWorkflowStatus(resolved.map((r) => r.card));

  return (
    <div className="px-6 pt-10 pb-6 max-w-[800px] mx-auto">
      {/* Workflow identity */}
      <div className="flex items-start gap-4 mb-3">
        {doc.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.thumbnail} alt="" className="w-16 h-16 rounded-[8px] object-cover border border-[#E9E9E9] shrink-0" />
        )}
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold text-black leading-tight">{doc.name || 'Untitled workflow'}</h1>
          {doc.description && <p className="text-[13px] text-[#939393] mt-1">{doc.description}</p>}
        </div>
      </div>
      {(doc.attribution?.author || doc.attribution?.license) && (
        <div className="text-[13px] text-[#939393] space-y-0.5 mb-6">
          {doc.attribution.author && (
            <p>
              Author:{' '}
              {doc.attribution.author_url ? (
                <a href={doc.attribution.author_url} target="_blank" rel="noopener noreferrer" className="text-black underline underline-offset-2 hover:opacity-60">
                  {doc.attribution.author}
                </a>
              ) : (
                doc.attribution.author
              )}
            </p>
          )}
          {doc.attribution.license && <p>License: {doc.attribution.license}</p>}
        </div>
      )}

      <WorkflowStatusBanner summary={summary} riskTolerance={riskTolerance ?? null} />

      <h2 className="text-[20px] font-semibold text-black mb-3">Guidance Capabilities</h2>
      <CapabilitiesSection doc={doc} />

      <h2 className="text-[20px] font-semibold text-black mt-8 mb-3">Variables ({doc.variables?.length ?? 0})</h2>
      {!doc.variables || doc.variables.length === 0 ? (
        <p className="text-[13px] text-[#939393]">This workflow has no adjustable variables.</p>
      ) : (
        <div className="space-y-3">
          {doc.variables.map((v, i) => (
            <VariableCard key={`${v.binds_to}-${i}`} v={v} />
          ))}
        </div>
      )}

      <h2 className="text-[20px] font-semibold text-black mt-8 mb-3">Requirements ({resolved.length})</h2>
      {resolved.length === 0 ? (
        <p className="text-[13px] text-[#939393]">This workflow has no requirements listed.</p>
      ) : (
        <div className="space-y-4">
          {resolved.map((req, i) => (
            <ModelProvenanceCard
              key={`${req.recordId ?? req.requirement ?? 'entry'}-${i}`}
              name={req.displayName}
              requirement={req.requirement}
              category={req.category}
              provenance={req.provenance}
              badge={badgeFor(req)}
              emptyMessage={emptyMessageFor(req)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
