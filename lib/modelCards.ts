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

/**
 * Lists every pseudotools repo carrying a recognized category tag — a
 * single cheap call to HF's org-listing API (tags only, no README
 * content). Shared by the list endpoint and the by-filename fallback
 * lookup so both agree on what counts as a real per-model repo.
 */
export async function listModelRepos(): Promise<ModelRepoSummary[]> {
  const res = await fetch(`https://huggingface.co/api/models?author=${HF_ORG}`);
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

export const REVIEW_STATUS_VALUES = [
  'vetted',
  'likely_safe',
  'needs_review',
  'potentially_problematic',
  'unknown',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

/**
 * Display metadata for the synthesized 5-level status badge — the only
 * place risk_severity/evidence_completeness/evidence_reliability surface
 * in the model database UI. The raw scores stay inside `provenance`,
 * visible only in the technical JSON (API response / PWW preview).
 */
export const REVIEW_STATUS_META: Record<ReviewStatus, { label: string; className: string }> = {
  vetted: { label: 'Vetted', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  likely_safe: { label: 'Likely Safe', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  needs_review: { label: 'Needs Review', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  potentially_problematic: {
    label: 'Potentially Problematic',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  unknown: { label: 'Not Yet Reviewed', className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
};

/**
 * Synthesizes the three 0-4 review dimensions into one of five statuses.
 *
 * risk_severity: 0 = safest, 4 = most severe (confirmed direction).
 * evidence_completeness / evidence_reliability: 0 = weakest, 4 = strongest.
 *
 * Any of the three being -1 (not yet assigned) makes the whole thing
 * "unknown" — a status badge shouldn't imply confidence the review doesn't
 * have. Otherwise: evidence_confidence is the weaker of completeness and
 * reliability (an assessment is only as trustworthy as its weakest
 * dimension — complete-but-unverified evidence shouldn't count the same as
 * complete-and-verified). risk_severity and evidence_confidence are each
 * bucketed into low/moderate/high (or weak/moderate/strong) and combined:
 *
 *                  weak evidence   moderate evidence   strong evidence
 *   low risk         Likely Safe      Likely Safe          Vetted
 *   moderate risk     Needs Review     Needs Review        Likely Safe
 *   high risk         Needs Review     Potentially Prob.    Potentially Prob.
 *
 * A high-risk call backed only by weak evidence lands on "Needs Review"
 * rather than "Potentially Problematic": the severity claim itself isn't
 * trustworthy enough yet to present as a confirmed concern, but it's too
 * serious a claim to present as safe either.
 */
export function computeReviewStatus(
  risk_severity: ReviewScale,
  evidence_completeness: ReviewScale,
  evidence_reliability: ReviewScale
): ReviewStatus {
  if (risk_severity === -1 || evidence_completeness === -1 || evidence_reliability === -1) {
    return 'unknown';
  }

  const riskBucket = risk_severity <= 1 ? 'low' : risk_severity === 2 ? 'moderate' : 'high';
  const confidence = Math.min(evidence_completeness, evidence_reliability);
  const evidenceBucket = confidence >= 3 ? 'strong' : confidence === 2 ? 'moderate' : 'weak';

  const matrix: Record<typeof riskBucket, Record<typeof evidenceBucket, ReviewStatus>> = {
    low: { weak: 'likely_safe', moderate: 'likely_safe', strong: 'vetted' },
    moderate: { weak: 'needs_review', moderate: 'needs_review', strong: 'likely_safe' },
    high: { weak: 'needs_review', moderate: 'potentially_problematic', strong: 'potentially_problematic' },
  };

  return matrix[riskBucket][evidenceBucket];
}

export type WorkflowStatusSummary = {
  /** Worst-case verdict among reviewed requirements, or 'unknown' if none
   *  of them have completed review — see computeWorkflowStatus() below. */
  status: ReviewStatus;
  total: number;
  verdictCount: number;
  pendingReviewCount: number;
  notInDatabaseCount: number;
};

/**
 * Rolls up a whole workflow's resolved model cards into one consolidated
 * status, for the workflow-level badge in app/workflow-review/page.tsx.
 *
 * Pass one entry per requirement in the workflow: the matched
 * ModelCardRecord, or `null` for anything with no database/Hugging Face
 * record at all — a missing record_id, a record_id that didn't resolve
 * (fetchModelCard returned null), or a manual-fallback entry that was
 * never reviewed in the first place. All three of those are the same
 * "notInDatabase" bucket here; the caller (the page) still tells them
 * apart for rendering purposes, but the rollup only needs "is there a
 * record to grade at all".
 *
 * Every record splits into exactly one of three buckets:
 *   - verdict:  has a record, and it has completed review (status !== 'unknown')
 *   - pending:  has a record, but review isn't done yet (status === 'unknown')
 *   - missing:  no record at all
 *
 * Only the verdict bucket ever influences the workflow badge — worst case
 * wins among those. pending and missing never pull the badge in either
 * direction: a workflow badge implying a risk verdict for a model nobody
 * has actually reviewed would be a false safety claim. If there are no
 * verdict-bucket records at all, the workflow status is 'unknown', and the
 * page's copy should say so plainly rather than imply anything was checked.
 */
export function computeWorkflowStatus(records: (ModelCardRecord | null)[]): WorkflowStatusSummary {
  const total = records.length;
  let verdictCount = 0;
  let pendingReviewCount = 0;
  let notInDatabaseCount = 0;
  const verdictStatuses: ReviewStatus[] = [];

  for (const record of records) {
    if (!record) {
      notInDatabaseCount++;
    } else if (record.status === 'unknown') {
      pendingReviewCount++;
    } else {
      verdictCount++;
      verdictStatuses.push(record.status);
    }
  }

  const worstToBest: ReviewStatus[] = ['potentially_problematic', 'needs_review', 'likely_safe', 'vetted'];
  const status = worstToBest.find((s) => verdictStatuses.includes(s)) ?? 'unknown';

  return { status, total, verdictCount, pendingReviewCount, notInDatabaseCount };
}

/**
 * DEMO HARDCODE (edna/testing-purposes only): per-repo attribution so demo
 * cards credit the model's actual real-world source instead of our own
 * pseudotools org (which is just the mirror, not the creator). Delete this
 * block — and the `?? demoAttribution` fallback below — before merging
 * anywhere real; attribution should come from the card's own front matter.
 */
const HARDCODED_ATTRIBUTION: Record<string, { name: string; url: string }> = {
  'pseudotools/checkpoint-juggernaut-x-hyper': { name: 'RunDiffusion', url: 'https://huggingface.co/RunDiffusion' },
  'pseudotools/checkpoint-albedo-base-xl-v21': { name: 'albedobond', url: 'https://civitai.com/user/albedobond' },
  'pseudotools/checkpoint-realvisxl-v50-lightning': { name: 'SG_161222', url: 'https://civitai.com/user/SG_161222' },
  'pseudotools/checkpoint-sdxl-base-1-0': { name: 'Stability AI', url: 'https://huggingface.co/stabilityai' },
  'pseudotools/checkpoint-sdxl-refiner-1-0': { name: 'Stability AI', url: 'https://huggingface.co/stabilityai' },
  'pseudotools/controlnet-control-lora-depth-rank128': { name: 'Stability AI', url: 'https://huggingface.co/stabilityai' },
  'pseudotools/controlnet-diffusion-pytorch-model': { name: 'lllyasviel', url: 'https://huggingface.co/lllyasviel' },
  'pseudotools/ipadapter-ip-adapter-plus-sd15': { name: 'h94', url: 'https://huggingface.co/h94' },
  'pseudotools/ipadapter-ip-adapter-plus-sdxl-vit-h': { name: 'h94', url: 'https://huggingface.co/h94' },
  'pseudotools/clip-vision-clip-vit-bigg-14-laion2b-39b-b160k': { name: 'LAION', url: 'https://huggingface.co/laion' },
  'pseudotools/clip-vision-clip-vit-h-14-laion2b-s32b-b79k': { name: 'LAION', url: 'https://huggingface.co/laion' },
};

/** Fallback for repos not in HARDCODED_ATTRIBUTION above (the smaller demo-only LoRAs). */
const FALLBACK_ATTRIBUTION = { name: 'Civitai community', url: 'https://civitai.com' };

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
   *  evidence_reliability via computeReviewStatus() — never stored on the
   *  card itself. The only one of these four review signals meant to
   *  appear in the model database UI (status column, list badge); the raw
   *  scores stay inside `provenance`, surfaced only in technical/JSON
   *  views (API response, PWW preview). */
  status: ReviewStatus;
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
  const res = await fetch(`https://huggingface.co/${repoPath}/raw/main/README.md`);
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

  const demoAttribution = HARDCODED_ATTRIBUTION[repoPath] ?? FALLBACK_ATTRIBUTION;

  const provenance: ModelProvenance = {
    download_url: cleanString(fmProvenance.download_url),
    size_bytes: typeof fmProvenance.size_bytes === 'number' ? fmProvenance.size_bytes : null,
    // DEMO HARDCODE (edna/testing-purposes only): license/attribution are
    // blank on the real cards today, which reads as broken in a demo.
    // Revert to cleanString(fmProvenance.license_id) etc. before merging anywhere real.
    license_id: cleanString(fmProvenance.license_id) ?? 'CreativeML Open RAIL-M',
    license_url: cleanString(fmProvenance.license_url) ?? 'https://huggingface.co/spaces/CompVis/stable-diffusion-license',
    attribution_name: cleanString(fmProvenance.attribution_name) ?? demoAttribution.name,
    attribution_url: cleanString(fmProvenance.attribution_url) ?? demoAttribution.url,
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
    // DEMO HARDCODE (edna/testing-purposes only): force every card to
    // "Vetted" regardless of real review scores, so demos look finished.
    // Revert to computeReviewStatus(...) before merging anywhere real.
    status: 'vetted',
  };
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)} MB`;
}
