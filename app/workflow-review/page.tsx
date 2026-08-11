/** @format */

import {
  EMPTY_PROVENANCE,
  REVIEW_STATUS_META,
  computeWorkflowStatus,
  fetchModelCard,
  formatBytes,
  type ModelCardRecord,
  type ModelProvenance,
  type ReviewStatus,
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
 * `riskTolerance` is accepted in the query-param contract so the plugin's
 * setting has somewhere to land, but nothing here is tolerance-driven yet
 * — no thresholds, no filtering, no display. That behavior hasn't been
 * specified.
 *
 * ── Card/badge styling ────────────────────────────────────────────────────
 * The redesign's requirement cards and badges are kept page-local (not
 * folded into components/ui/ModelProvenanceCard.tsx / RiskBadge.tsx) since
 * those are still shared with app/image-info/ImageInfoViewer.tsx, which
 * this redesign doesn't touch.
 */

type WorkflowAttribution = {
  author: string | null;
  author_url: string | null;
  license: string | null;
};

type GlobalGuidanceCapabilities = {
  txt_scene: boolean;
  txt_style: boolean;
  txt_negative: boolean;
  img_style: boolean;
};
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

async function resolveEntry(
  entry: WorkflowRequirementInput,
): Promise<ResolvedRequirement> {
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

/** Shared pill shape for StatusPill and the manual-entry "Review Pending"
 *  badge, so the two visually match — just different colors/label. */
function Pill({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-[6px] py-[4px] text-[11px] font-medium border rounded-[6px] opacity-80 whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tighter pill than components/ui/RiskBadge.tsx's, sized to sit inline
 *  next to the workflow title as well as on a requirement card. Reuses
 *  REVIEW_STATUS_META's colors so the semantics (and the palette) stay
 *  identical to the shared badge. */
function StatusPill({ status }: { status: ReviewStatus }) {
  const meta = REVIEW_STATUS_META[status];
  return <Pill className={meta.className}>{meta.label}</Pill>;
}

function badgeFor(req: ResolvedRequirement): React.ReactNode {
  if (req.isExtension) return null;
  if (req.card) return <StatusPill status={req.card.status} />;
  // Grey, like REVIEW_STATUS_META's 'unknown' pill — a manual entry has no
  // record to review in the first place, which reads the same as "not yet
  // reviewed" here.
  if (req.isManual)
    return (
      <Pill className="bg-zinc-50 text-zinc-500 border-zinc-200">
        Review Pending
      </Pill>
    );
  return null; // record_id given but unresolved — emptyMessageFor() already explains it
}

function emptyMessageFor(req: ResolvedRequirement): string | null {
  if (req.card || req.isManual) return null;
  return `record_id "${req.recordId}" was not found in the model database.`;
}

const CAPABILITY_GROUPS = (doc: PseudorandomWorkflowDocument) => [
  {
    title: 'Global Guidance',
    items: [
      {
        label: 'Scene Text',
        used: !!doc.global_guidance_capabilities?.txt_scene,
      },
      {
        label: 'Style Text',
        used: !!doc.global_guidance_capabilities?.txt_style,
      },
      {
        label: 'Negative Text',
        used: !!doc.global_guidance_capabilities?.txt_negative,
      },
      {
        label: 'Style Image',
        used: !!doc.global_guidance_capabilities?.img_style,
      },
    ],
  },
  {
    title: 'Regional Guidance',
    items: [
      {
        label: 'Regional Text',
        used: !!doc.regional_guidance_capabilities?.text,
      },
      {
        label: 'Regional Image',
        used: !!doc.regional_guidance_capabilities?.image,
      },
    ],
  },
  {
    title: 'Spatial Guidance',
    items: [
      {
        label: 'Spatial Depth',
        used: !!doc.spatial_guidance_capabilities?.depth,
      },
      {
        label: 'Spatial Edge',
        used: !!doc.spatial_guidance_capabilities?.edge,
      },
    ],
  },
];

function CapabilitiesSection({ doc }: { doc: PseudorandomWorkflowDocument }) {
  return (
    <div className="flex flex-col gap-6">
      {CAPABILITY_GROUPS(doc).map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <p className="text-[14px] text-[#939393] w-[120px]">{group.title}</p>
          <div className="flex flex-wrap gap-x-8 gap-y-2 pl-4 text-[14px]">
            {group.items.map((item) => (
              <span
                key={item.label}
                className={item.used ? 'text-black' : 'text-[#939393]'}
              >
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
    <div className="border border-[#ededed] rounded-[8px] p-[16px] flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <p className="text-[14px] font-semibold text-black">
            {v.name || '(unnamed variable)'}
          </p>
          <span className="text-[12px] text-[#939393] border border-[#e8e8e8] rounded-[6px] px-[6px] py-[4px] opacity-80">
            {v.type}
          </span>
        </div>
        {v.description && (
          <p className="text-[14px] text-black">{v.description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-[12px] text-[#939393]">
        <span>Default: {String(v.default)}</span>
        {isNumeric && v.min !== undefined && <span>Min: {v.min}</span>}
        {isNumeric && v.max !== undefined && <span>Max: {v.max}</span>}
        {isNumeric && v.step !== undefined && <span>Step: {v.step}</span>}
      </div>
    </div>
  );
}

/** The small external-link arrow used on Source/Download rows — copied
 *  inline from the Figma asset rather than fetched at runtime, since the
 *  Figma-hosted asset URL is short-lived. */
function ArrowIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      fill="none"
      className="shrink-0"
    >
      <path
        d="M8.5 7.27647L8.40588 0.59412L1.72353 0.500001M8.40588 0.59412L0.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-black underline underline-offset-2 hover:opacity-60 break-all"
    >
      {href}
      <ArrowIcon />
    </a>
  );
}

/**
 * One requirement's provenance, as a card. Page-local variant of
 * components/ui/ModelProvenanceCard.tsx built for this redesign — see the
 * "Card/badge styling" note at the top of this file for why it isn't
 * shared.
 */
function RequirementCard({ req }: { req: ResolvedRequirement }) {
  const provenance = req.provenance;
  const size = provenance ? formatBytes(provenance.size_bytes) : null;

  const rows: { label: string; value: React.ReactNode }[] = [];
  if (req.category) rows.push({ label: 'Category', value: req.category });
  if (provenance?.attribution_name)
    rows.push({ label: 'Attribution', value: provenance.attribution_name });
  if (provenance?.attribution_url)
    rows.push({
      label: 'Source',
      value: <SourceLink href={provenance.attribution_url} />,
    });
  if (provenance?.license_id || provenance?.license_url) {
    rows.push({
      label: 'License',
      value: provenance.license_url ? (
        <a
          href={provenance.license_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-black underline underline-offset-2 hover:opacity-60 break-all"
        >
          {provenance.license_id ?? provenance.license_url}
        </a>
      ) : (
        provenance.license_id
      ),
    });
  }
  if (provenance?.download_url)
    rows.push({
      label: 'Download',
      value: <SourceLink href={provenance.download_url} />,
    });
  if (size && size !== '—') rows.push({ label: 'Size', value: size });
  if (provenance?.reviewer)
    rows.push({ label: 'Reviewer', value: provenance.reviewer });
  if (provenance?.reviewed_at)
    rows.push({ label: 'Reviewed at', value: provenance.reviewed_at });
  if (provenance?.license_findings)
    rows.push({
      label: 'License findings',
      value: provenance.license_findings,
    });
  if (provenance?.evidence)
    rows.push({ label: 'Evidence', value: provenance.evidence });
  if (provenance?.rationale)
    rows.push({ label: 'Rationale', value: provenance.rationale });

  const emptyMessage = emptyMessageFor(req);

  return (
    <div className="border border-[#ededed] rounded-[8px] p-[16px]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-black break-all">
            {req.displayName ?? req.requirement ?? 'Unknown requirement'}
          </p>
          {req.displayName && req.requirement && (
            <p className="text-[12px] text-[#939393] font-mono break-all mt-0.5">
              {req.requirement}
            </p>
          )}
        </div>
        {badgeFor(req) && <div className="shrink-0">{badgeFor(req)}</div>}
      </div>
      {emptyMessage ? (
        <p className="text-[13px] text-[#939393]">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ label, value }) => (
            <div key={label} className="grid grid-cols-[110px_1fr] gap-1">
              <span className="text-[12px] text-[#939393]">{label}</span>
              <span className="text-[13px] text-black min-w-0">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="px-6 pt-10 pb-6 max-w-[800px] mx-auto">
      <h1 className="text-[24px] font-semibold text-black mb-2">
        Workflow review
      </h1>
      <p className="text-[13px] text-[#DC2626]">{message}</p>
    </div>
  );
}

export default async function WorkflowReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workflowSource?: string; riskTolerance?: string }>;
}) {
  // riskTolerance is accepted (see the "Input contract" note above) but
  // unused — nothing on this page is tolerance-driven yet.
  const { workflowSource } = await searchParams;

  if (!workflowSource) {
    return (
      <ErrorPage message="Missing required workflowSource query parameter — this page has nothing to load without it." />
    );
  }

  let doc: PseudorandomWorkflowDocument;
  try {
    const res = await fetch(workflowSource, { cache: 'no-store' });
    if (!res.ok) throw new Error(`workflowSource returned ${res.status}`);
    const json = await res.json();
    if (
      !json ||
      typeof json !== 'object' ||
      !Array.isArray(json.endpoint_requirements)
    ) {
      throw new Error(
        'workflowSource did not return a pseudorandom workflow document (missing endpoint_requirements)',
      );
    }
    doc = json as PseudorandomWorkflowDocument;
  } catch (err) {
    return (
      <ErrorPage
        message={`Couldn't load the workflow document: ${err instanceof Error ? err.message : String(err)}`}
      />
    );
  }

  const resolved = await Promise.all(
    doc.endpoint_requirements.map(resolveEntry),
  );
  const summary = computeWorkflowStatus(resolved.map((r) => r.card));

  return (
    <div className="px-6 pt-10 pb-6 max-w-[700px] mx-auto">
      <div className="flex flex-col gap-11">
        {/* Workflow identity */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[28px] font-semibold text-black leading-tight">
                {doc.name || 'Untitled workflow'}
              </h1>
              <StatusPill status={summary.status} />
              {doc.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={doc.thumbnail}
                  alt=""
                  className="w-[21px] h-[21px] rounded-[4px] object-cover shrink-0"
                />
              )}
            </div>
            {doc.description && (
              <p className="text-[15px] text-[#474747]">{doc.description}</p>
            )}
          </div>
          {(doc.attribution?.author || doc.attribution?.license) && (
            <div className="text-[14px] text-[#939393] flex flex-col gap-1">
              {doc.attribution.author && (
                <p>
                  Author:{' '}
                  {doc.attribution.author_url ? (
                    <a
                      href={doc.attribution.author_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {doc.attribution.author}
                    </a>
                  ) : (
                    doc.attribution.author
                  )}
                </p>
              )}
              {doc.attribution.license && (
                <p>License: {doc.attribution.license}</p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#ededed]" />

        <div className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold text-black">
            Guidance Capabilities
          </h2>
          <CapabilitiesSection doc={doc} />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold text-black">
            Variables ({doc.variables?.length ?? 0})
          </h2>
          {!doc.variables || doc.variables.length === 0 ? (
            <p className="text-[13px] text-[#939393]">
              This workflow has no adjustable variables.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {doc.variables.map((v, i) => (
                <VariableCard key={`${v.binds_to}-${i}`} v={v} />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold text-black">
            Requirements ({resolved.length})
          </h2>
          {resolved.length === 0 ? (
            <p className="text-[13px] text-[#939393]">
              This workflow has no requirements listed.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {resolved.map((req, i) => (
                <RequirementCard
                  key={`${req.recordId ?? req.requirement ?? 'entry'}-${i}`}
                  req={req}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
