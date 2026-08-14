/**
 * Shared parsing for pseudotools Hugging Face model card repos — the new
 * source of truth for model provenance, replacing the Supabase `models`
 * table. Each vetted model has its own repo under the `pseudotools` org
 * (e.g. `pseudotools/checkpoint-juggernaut-x-hyper`); this module fetches
 * and parses that repo's README.md (YAML front matter + a structured
 * Markdown body) into a single record.
 *
 * Shape follows the schema Kyle and Edna settled on: `record_id`,
 * `category`, `requirement`, and `display_name` sit outside a nested
 * `provenance` object, and that same `provenance` shape is reused verbatim
 * by the Package Workflow Wizard's exported JSON — see
 * app/package-workflow/WorkflowWizard.tsx.
 *
 * As of Claudius' latest card template update, the front-matter field names
 * on the deployed cards match this shape directly — `record_id`, `category`,
 * `requirement`, `display_name`, and a nested `provenance:` block with the
 * same keys as ModelProvenance below (including a real, direct
 * `download_url` — no more blob-URL derivation needed). No field-name
 * translation happens here anymore. `license_findings`/`evidence`/
 * `rationale` are the one exception: the front matter's copies of those
 * three are always null placeholders, so they're still read from the
 * Markdown body's H2 sections instead (see parseBody()).
 */

import matter from 'gray-matter';

export const HF_ORG = 'pseudotools';

/** Placeholder value the card template writes into unreviewed fields. */
const IN_PROGRESS = 'in_progress';

// HF tag -> canonical category value. Two different naming schemes are in
// play on the real repos, confirmed by fetching each one directly rather
// than guessed: the HF *tag* on a repo (e.g. "clip-vision", "ip-adapter",
// "lora") doesn't always match the *category* field inside that same
// repo's README front matter (e.g. "clip_vision", "ipadapter", "loras").
// This map is keyed by tag (what listModelRepos can see cheaply, without
// fetching any README) but its values are the front-matter spelling, so a
// repo's category is identical whether it came from the cheap list or the
// full card — otherwise the category filter dropdown could silently
// return zero results for the tag-spelled value it was built from.
const CATEGORY_TAG_MAP: Record<string, string> = {
  checkpoint: 'checkpoints',
  controlnet: 'controlnet',
  'clip-vision': 'clip_vision',
  'ip-adapter': 'ipadapter',
  lora: 'loras',
};

export const RECOGNIZED_CATEGORIES = Object.values(CATEGORY_TAG_MAP);

/** Display label per canonical category value, for UI rendering. */
export const CATEGORY_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  controlnet: 'ControlNet',
  clip_vision: 'Clip Vision',
  ipadapter: 'IPAdapter',
  loras: 'LoRA',
};

export type ModelRepoSummary = { record_id: string; category: string };

function categoryOf(tags: string[]): string | null {
  const tag = Object.keys(CATEGORY_TAG_MAP).find((t) => tags.includes(t));
  return tag ? CATEGORY_TAG_MAP[tag] : null;
}

/** How long a Hugging Face response stays cached before Next.js re-fetches
 *  it — 24 hours, shared by every HF call in this file. A rolling window,
 *  not a midnight reset: whoever loads a page first re-populates it for
 *  the next 24h, not "until end of calendar day". A card edited on
 *  Hugging Face won't show up here until its cache entry ages out —
 *  accepted tradeoff, not an oversight. */
const HF_CACHE_SECONDS = 60 * 60 * 24;

/**
 * Lists every pseudotools repo carrying a recognized category tag — a
 * single cheap call to HF's org-listing API (tags only, no README
 * content). Shared by the list endpoint and the by-filename fallback
 * lookup so both agree on what counts as a real per-model repo.
 */
export async function listModelRepos(): Promise<ModelRepoSummary[]> {
  const res = await fetch(`https://huggingface.co/api/models?author=${HF_ORG}`, {
    next: { revalidate: HF_CACHE_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`Hugging Face list API returned ${res.status}`);
  }
  const items: { id: string; tags?: string[] }[] = await res.json();
  return items
    .map((item) => {
      const category = categoryOf(item.tags ?? []);
      return category ? { record_id: item.id, category } : null;
    })
    .filter((m): m is ModelRepoSummary => m !== null);
}

/**
 * The three review dimensions, each a 0-4 score (5-point scale) or -1 when
 * not yet assigned. -1 rather than null: the schema treats "not yet
 * assigned" as a real value within the field's own range, distinct from
 * the field being entirely inapplicable (which is when a producer would
 * omit or null the field instead).
 */
export type ReviewScale = number;

/**
 * The -1..3 assessment badge Kyle and Edna specced, originally for
 * app/workflow-review/page.tsx (the Rhino plugin's own icon uses the same
 * formula independently — see that file's header comment) and since rolled
 * out everywhere a model's review state is shown: the model database
 * table, its detail page, the Package Workflow Wizard's model picker, and
 * app/image-info/ImageInfoViewer.tsx. This replaced the older five-value
 * ReviewStatus/computeReviewStatus/REVIEW_STATUS_META system, which no
 * longer exists in this file.
 */
export type AssessmentBadge = -1 | 0 | 1 | 2 | 3;

/** Every possible badge value, worst-confidence-first — for building
 *  filter-option lists (see app/models/page.tsx's RISK_OPTIONS). */
export const ASSESSMENT_BADGE_VALUES: AssessmentBadge[] = [-1, 0, 1, 2, 3];

/** Icon-only tooltip copy for the Rhino plugin's badge — terse, since the
 *  plugin's users already know what the badge means. Not used on the web
 *  (see WORKFLOW_BADGE_TOOLTIP_LABELS for workflow-review's title badge,
 *  whose audience needs the badge explained, not just labeled). */
export const BADGE_TOOLTIP_LABELS: Record<AssessmentBadge, string> = {
  [-1]: "We haven't checked yet",
  0: "We looked, but can't tell",
  1: 'We have significant concerns',
  2: 'We have some concerns',
  3: 'Looks good, have fun!',
};

/** Tooltip copy for workflow-review's title badge — unlike
 *  BADGE_TOOLTIP_LABELS, this spells out what's being assessed (the
 *  workflow's models) for visitors who may be seeing this badge for the
 *  first time, not just the plugin's already-oriented users. */
export const WORKFLOW_BADGE_TOOLTIP_LABELS: Record<AssessmentBadge, string> = {
  [-1]: "This workflow's models haven't been reviewed yet.",
  0: "We don't have enough information to assess this workflow's models.",
  1: 'This workflow uses models with significant known risks.',
  2: 'This workflow uses models with some known concerns.',
  3: "This workflow's models have been reviewed and look good.",
};

/** Visible text-tag copy — for surfaces that show an actual pill with a
 *  phrase in it (per-requirement cards), distinct from the tooltip copy
 *  above even though both index the same badge value. */
export const BADGE_TAG_META: Record<AssessmentBadge, { label: string; className: string }> = {
  [-1]: { label: 'Review Pending', className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
  0: { label: 'Insufficient information', className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
  1: { label: 'Not recommended', className: 'bg-red-50 text-red-700 border-red-200' },
  2: { label: 'Potentially problematic', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  3: { label: 'Healthy', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/**
 * Requirement-level badge. Certainty (the weaker of evidence_completeness/
 * evidence_reliability) gates whether risk_severity is even trustworthy
 * enough to report — a severe-sounding call backed by weak evidence reads
 * as "insufficient information", not as a confirmed problem.
 */
export function computeRequirementBadge(
  risk_severity: ReviewScale,
  evidence_completeness: ReviewScale,
  evidence_reliability: ReviewScale
): AssessmentBadge {
  const certainty = Math.min(evidence_completeness, evidence_reliability);
  if (risk_severity === -1 || certainty === -1) return -1;
  if (certainty <= 1) return 0;
  if (risk_severity >= 3) return 1;
  if (risk_severity <= 1) return 3;
  return 2;
}

export type RiskTolerance = 'high' | 'low' | 'dev';

/**
 * Workflow-level badge: collapses every requirement's three scores into one
 * triple per `riskTolerance`'s aggregation rule, then runs the same formula
 * as computeRequirementBadge. `dev` returns null (not -1) — "no badge
 * calculated" is a distinct state from "checked and found nothing", and the
 * workflow runs regardless of score in that mode.
 *
 * `high` averages each dimension across requirements as specified; note
 * this doesn't exclude -1 (unscored) requirements from the average, so a
 * workflow that's a mix of scored and unscored requirements can average out
 * to a misleadingly middling number under `high` specifically. `low`
 * doesn't have this problem — min()/max() naturally let one unscored
 * requirement pull the whole result to -1. Flagging this rather than
 * silently deviating from the given spec; worth confirming with Kyle if
 * unscored requirements should be excluded from the `high` average instead.
 */
export function computeWorkflowBadge(
  scores: Pick<ModelProvenance, 'risk_severity' | 'evidence_completeness' | 'evidence_reliability'>[],
  riskTolerance: RiskTolerance
): AssessmentBadge | null {
  if (riskTolerance === 'dev') return null;
  if (scores.length === 0) return -1;

  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;

  const risk_severity =
    riskTolerance === 'high'
      ? avg(scores.map((s) => s.risk_severity))
      : Math.max(...scores.map((s) => s.risk_severity));
  const evidence_completeness =
    riskTolerance === 'high'
      ? avg(scores.map((s) => s.evidence_completeness))
      : Math.min(...scores.map((s) => s.evidence_completeness));
  const evidence_reliability =
    riskTolerance === 'high'
      ? avg(scores.map((s) => s.evidence_reliability))
      : Math.min(...scores.map((s) => s.evidence_reliability));

  return computeRequirementBadge(risk_severity, evidence_completeness, evidence_reliability);
}

/**
 * The `provenance` object shape — identical whether it's nested inside a
 * ModelCardRecord (this file), a PWW "vetted" requirement, or the
 * pseudorandom model provenance API response. One shape, reused
 * everywhere, so there is exactly one place that ever lists these keys.
 */
export type ModelProvenance = {
  download_url: string | null;
  size_bytes: number | null;
  license_id: string | null;
  license_url: string | null;
  attribution_name: string | null;
  attribution_url: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  license_findings: string | null;
  evidence: string | null;
  rationale: string | null;
  risk_severity: ReviewScale;
  evidence_completeness: ReviewScale;
  evidence_reliability: ReviewScale;
};

export const EMPTY_PROVENANCE: ModelProvenance = {
  download_url: null,
  size_bytes: null,
  license_id: null,
  license_url: null,
  attribution_name: null,
  attribution_url: null,
  reviewer: null,
  reviewed_at: null,
  license_findings: null,
  evidence: null,
  rationale: null,
  risk_severity: -1,
  evidence_completeness: -1,
  evidence_reliability: -1,
};

export type ModelCardRecord = {
  /** Always the repo path itself (e.g. "pseudotools/checkpoint-x") — never
   *  trusted from the file's own front matter, which may be stale. */
  record_id: string;
  category: string;
  requirement: string | null;
  display_name: string;

  provenance: ModelProvenance;

  /** Synthesized from provenance.risk_severity/evidence_completeness/
   *  evidence_reliability via computeRequirementBadge() — never stored on
   *  the card's own front matter. The one of these four review signals
   *  meant to appear as a badge across the UI; the raw scores stay inside
   *  `provenance`, surfaced only in technical/JSON views (API response,
   *  PWW preview). */
  badge: AssessmentBadge;
};

/** Plain string field: sentinel and blank become null, everything else passes through. */
function cleanString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === IN_PROGRESS) return null;
  return trimmed;
}

/**
 * A 0-4 review score. Anything else — the sentinel, blank, an out-of-range
 * number, or (today) the deployed cards' old 3-value strings like "low" /
 * "conditional" / "declared" — becomes -1 (not yet assigned) rather than a
 * guessed mapping. The card template doesn't carry real 0-4 scores yet;
 * once it does, this starts reading them without any change here.
 */
function cleanScale(raw: unknown): ReviewScale {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n >= 0 && n <= 4) return n;
    }
  }
  return -1;
}

/**
 * H2 section body: unlike front-matter fields, an unreviewed section isn't
 * the bare "in_progress" token — it's a full placeholder sentence the card
 * template writes in ("**In progress.** License terms, ... have not yet
 * been verified."). Treated the same way as the sentinel fields: null,
 * not a real value, so a not-yet-reviewed card looks consistently "not
 * filled in" everywhere rather than having real prose in three fields and
 * null in the rest.
 */
function cleanSection(text: string | null): string | null {
  if (!text) return null;
  if (/^\*{0,2}in progress\.?\*{0,2}/i.test(text)) return null;
  return text;
}

/** Extracts the three named H2 sections from the card body. */
function parseBody(body: string): {
  license_findings: string | null;
  evidence: string | null;
  rationale: string | null;
} {
  const lines = body.split('\n');

  // Every H2 heading and the line range of its content (up to the next H2).
  const h2Positions: { heading: string; start: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) h2Positions.push({ heading: m[1].trim(), start: i + 1 });
  });

  const sectionText = (heading: string): string | null => {
    const idx = h2Positions.findIndex((h) => h.heading === heading);
    if (idx === -1) return null;
    const start = h2Positions[idx].start;
    const end = idx + 1 < h2Positions.length ? h2Positions[idx + 1].start - 1 : lines.length;
    const text = lines.slice(start, end).join('\n').trim();
    return text || null;
  };

  return {
    license_findings: cleanSection(sectionText('License Findings')),
    evidence: cleanSection(sectionText('Evidence')),
    rationale: cleanSection(sectionText('Rationale')),
  };
}

/**
 * Fetches and parses one model card by repo path (e.g.
 * "pseudotools/checkpoint-juggernaut-x-hyper"). Returns null if the repo
 * or its README does not exist (never throws for that case — a missing
 * card is an expected, not-yet-populated state, not a server error).
 */
export async function fetchModelCard(repoPath: string): Promise<ModelCardRecord | null> {
  const res = await fetch(`https://huggingface.co/${repoPath}/raw/main/README.md`, {
    next: { revalidate: HF_CACHE_SECONDS },
  });
  if (!res.ok) return null;

  const raw = await res.text();
  const { data: fm, content } = matter(raw);
  const { license_findings, evidence, rationale } = parseBody(content);

  // The card's own provenance block — same shape as ModelProvenance, but
  // still untrusted input, so every field still goes through
  // cleanString/cleanScale below rather than being spread in directly.
  const fmProvenance = (fm.provenance ?? {}) as Record<string, unknown>;

  const risk_severity = cleanScale(fmProvenance.risk_severity);
  const evidence_completeness = cleanScale(fmProvenance.evidence_completeness);
  const evidence_reliability = cleanScale(fmProvenance.evidence_reliability);

  const provenance: ModelProvenance = {
    download_url: cleanString(fmProvenance.download_url),
    size_bytes: typeof fmProvenance.size_bytes === 'number' ? fmProvenance.size_bytes : null,
    license_id: cleanString(fmProvenance.license_id),
    license_url: cleanString(fmProvenance.license_url),
    attribution_name: cleanString(fmProvenance.attribution_name),
    attribution_url: cleanString(fmProvenance.attribution_url),
    reviewer: cleanString(fmProvenance.reviewer),
    reviewed_at: cleanString(fmProvenance.reviewed_at),
    license_findings,
    evidence,
    rationale,
    risk_severity,
    evidence_completeness,
    evidence_reliability,
  };

  return {
    record_id: repoPath,
    category: cleanString(fm.category) ?? '',
    requirement: cleanString(fm.requirement),
    display_name: cleanString(fm.display_name) ?? '',
    provenance,
    badge: computeRequirementBadge(risk_severity, evidence_completeness, evidence_reliability),
  };
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)} MB`;
}
