'use client';

import ModelProvenanceCard from '@/components/ui/ModelProvenanceCard';
import RiskBadge from '@/components/ui/RiskBadge';
import VettingBadge from '@/components/ui/VettingBadge';
import { MODEL_FILE_TO_NODE, lineageLinks, lineageNodes, type LineageLink, type LineageNode } from '@/data/lineageData';
import { EMPTY_PROVENANCE, computeReviewStatus, type ModelProvenance, type ReviewStatus } from '@/lib/modelCards';
import type { VettingStatus } from '@/types/database';
import { cn } from '@/utils/cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LineageGraph, { LayoutMode, buildIndex, computeVisible } from '../lineage-sketch/LineageGraph';

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'environmental' | 'provenance';

type EnvironmentalData = {
  energy_kwh?: number | null;
  carbon_kgco2e?: number | null;
  water_l?: number | null;
  worker_location?: string | null;
  has_environmental_data?: boolean;
};

/** Flat shape embedded by pre-migration renders — mirrors the old Supabase `models` row. */
type LegacyProvenance = {
  download_url?: string | null;
  attribution?: string | null;
  attribution_url?: string | null;
  license?: string | null;
  data_provenance_notes?: string | null;
  size_bytes?: number | null;
};

type Requirement = {
  category: string;
  requirement: string;
  display_name: string | null;
  /** Hugging Face repo path — set on images rendered after the migration.
   *  The only pointer this app ever resolves against a live API; there is
   *  no Supabase connection anywhere in this feature. A pre-migration
   *  image's Supabase `provenance_id` (if present in its metadata) is
   *  simply never read — those requirements fall back to whatever
   *  provenance was embedded at render time, same as any unpointed one. */
  record_id: string | null;
  /** Legacy flat status string — only present on pre-migration images,
   *  read straight from the PNG's own embedded metadata. */
  legacyVettingStatus: string | null;
  /** Whatever was embedded at render time, normalized to the current
   *  ModelProvenance shape whether it came from the old flat schema or the
   *  new nested one — so everything downstream deals with one shape. */
  provenance: ModelProvenance;
};

type Resolved = Requirement & {
  source: 'database' | 'embedded' | 'none';
  data: ModelProvenance;
  name: string | null;
  pointerBroken: boolean;
  /** Synthesized 5-level status, only for new-style (Hugging Face-sourced
   *  or new-schema-embedded) requirements. null for legacy pre-migration
   *  requirements, which render their own vetting_status tri-state via
   *  VettingBadge instead — the two aren't the same shape and don't merge. */
  status: ReviewStatus | null;
};

type ParseResult =
  | { kind: 'ok'; raw: Record<string, unknown>; env: EnvironmentalData | null; requirements: Requirement[] }
  | { kind: 'no-chunk' }
  | { kind: 'not-png' }
  | { kind: 'parse-error'; message: string };

// ── PNG parsing ──────────────────────────────────────────────────────────────

function decodeField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function readEnvironmental(rec: Record<string, unknown>): EnvironmentalData | null {
  const env = decodeField(rec['Environmental']);
  if (!env || typeof env !== 'object') return null;
  if ((env as EnvironmentalData).has_environmental_data === false) return null;
  return env as EnvironmentalData;
}

/**
 * Old embedded/DB shape -> current ModelProvenance shape, so the rest of
 * this file only ever deals with one provenance shape regardless of when
 * the image was rendered. data_provenance_notes has no direct analog in
 * the new schema; `evidence` is the closest fit (its own field
 * description already covers "training-data evidence").
 */
function normalizeLegacyProvenance(p: LegacyProvenance): ModelProvenance {
  return {
    ...EMPTY_PROVENANCE,
    download_url: p.download_url ?? null,
    size_bytes: p.size_bytes ?? null,
    license_id: p.license ?? null,
    attribution_name: p.attribution ?? null,
    attribution_url: p.attribution_url ?? null,
    evidence: p.data_provenance_notes ?? null,
  };
}

/** New- vs old-schema embedded provenance don't share any key names, so
 *  presence of a new-only key is enough to tell them apart. */
function isNewProvenance(p: Record<string, unknown>): boolean {
  return 'license_id' in p || 'attribution_name' in p || 'risk_severity' in p;
}

function toRequirement(v: unknown): Requirement | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.requirement !== 'string') return null;
  const raw = r.provenance && typeof r.provenance === 'object' ? (r.provenance as Record<string, unknown>) : null;

  const provenance: ModelProvenance = !raw
    ? EMPTY_PROVENANCE
    : isNewProvenance(raw)
      ? ({ ...EMPTY_PROVENANCE, ...raw } as ModelProvenance)
      : normalizeLegacyProvenance(raw as LegacyProvenance);

  return {
    category: typeof r.category === 'string' ? r.category : '—',
    requirement: r.requirement,
    display_name: typeof r.display_name === 'string' ? r.display_name : null,
    record_id: typeof r.record_id === 'string' ? r.record_id : null,
    legacyVettingStatus: typeof r.vetting_status === 'string' ? r.vetting_status : null,
    provenance,
  };
}

function readRequirementsFromRecord(rec: Record<string, unknown>): Requirement[] {
  const collect = (v: unknown): Requirement[] | null => {
    if (!v || typeof v !== 'object') return null;
    const list = (v as Record<string, unknown>)['endpoint_requirements'];
    if (!Array.isArray(list)) return null;
    return list.map(toRequirement).filter((r): r is Requirement => r !== null);
  };
  return (
    collect(rec) ??
    collect(decodeField(rec['Workflow'])) ??
    Object.values(rec).map(decodeField).map(collect).find(Boolean) ??
    []
  );
}

function parsePng(buffer: ArrayBuffer): ParseResult {
  const bytes = new Uint8Array(buffer);
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return { kind: 'not-png' };
  }
  const decoder = new TextDecoder('latin1');
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    offset += 4;
    const type = decoder.decode(bytes.subarray(offset, offset + 4));
    offset += 4;
    if (type === 'tEXt') {
      const data = bytes.subarray(offset, offset + length);
      let nullIdx = -1;
      for (let i = 0; i < data.length; i++) { if (data[i] === 0) { nullIdx = i; break; } }
      if (nullIdx !== -1) {
        const keyword = decoder.decode(data.subarray(0, nullIdx));
        if (keyword.startsWith('pseudorandom_v')) {
          const text = decoder.decode(data.subarray(nullIdx + 1));
          try {
            const outer = JSON.parse(text);
            if (outer === null || typeof outer !== 'object') return { kind: 'ok', raw: {}, env: null, requirements: [] };
            const rec = outer as Record<string, unknown>;
            return { kind: 'ok', raw: rec, env: readEnvironmental(rec), requirements: readRequirementsFromRecord(rec) };
          } catch (e) {
            return { kind: 'parse-error', message: e instanceof Error ? e.message : 'JSON parse failed' };
          }
        }
      }
    }
    offset += length + 4;
    if (type === 'IEND') break;
  }
  return { kind: 'no-chunk' };
}

// ── Pointer resolution ───────────────────────────────────────────────────────

/** True once at least one review-relevant field is actually filled in — a
 *  provenance object that's structurally present but entirely null/-1
 *  (the default for an unmatched requirement) shouldn't count as "there is
 *  embedded data" for source-labeling purposes. */
function hasRealData(p: ModelProvenance): boolean {
  return Object.values(p).some((v) => v !== null && v !== undefined && v !== '' && v !== -1);
}

/**
 * Resolves every requirement's display data. The only network call this
 * makes is to the Hugging Face-backed /api/models/hf/:id route — there is
 * no Supabase connection anywhere in this feature. A requirement with a
 * record_id gets the live card; everything else (no pointer, or a
 * pre-migration image's Supabase provenance_id, which is never read)
 * falls back to whatever provenance was embedded in the PNG at render
 * time — offline data, exactly as good as it was the day the image was
 * rendered.
 */
async function resolveRequirements(reqs: Requirement[]): Promise<Resolved[]> {
  const recordIds = [...new Set(reqs.map((r) => r.record_id).filter(Boolean))] as string[];

  const hfRecords = await Promise.all(
    recordIds.map((id) =>
      fetch(`/api/models/hf/${id.split('/').map(encodeURIComponent).join('/')}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  const hfById = new Map<string, Record<string, unknown>>();
  recordIds.forEach((id, i) => { if (hfRecords[i]) hfById.set(id, hfRecords[i]); });

  return reqs.map((r): Resolved => {
    if (r.record_id) {
      const hf = hfById.get(r.record_id);
      if (hf) {
        return {
          ...r,
          source: 'database',
          name: (hf.display_name as string) ?? r.display_name,
          pointerBroken: false,
          data: hf.provenance as ModelProvenance,
          status: hf.status as ReviewStatus,
        };
      }
      return { ...r, source: 'none', name: r.display_name, pointerBroken: true, data: EMPTY_PROVENANCE, status: 'unknown' };
    }

    // No pointer, or a legacy Supabase pointer we don't chase — whatever
    // was embedded is all there is.
    const hasData = hasRealData(r.provenance);
    // A pre-migration render always embedded vetting_status inline (never
    // just a DB pointer for it), so its presence is the signal that this
    // is old-schema data with no risk_severity/etc. concept at all — not
    // "new-schema data that happens to be unreviewed". Synthesizing a
    // status from normalizeLegacyProvenance's -1 defaults in that case
    // would show "Not Yet Reviewed" instead of the real embedded
    // vetting_status, so status stays null and VettingBadge takes over.
    const status =
      r.legacyVettingStatus === null && hasData
        ? computeReviewStatus(r.provenance.risk_severity, r.provenance.evidence_completeness, r.provenance.evidence_reliability)
        : null;
    return {
      ...r,
      source: hasData ? 'embedded' : 'none',
      name: r.display_name,
      pointerBroken: false,
      data: r.provenance,
      status,
    };
  });
}

// ── Graph building ────────────────────────────────────────────────────────────

const DROPPED_ROOT = '__image_inspector__';
const KNOWN_NODE_IDS = new Set(lineageNodes.map((n) => n.id));

function buildGraphFromRequirements(
  fileName: string,
  requirements: Requirement[]
): { extraNodes: LineageNode[]; extraLinks: LineageLink[] } {
  const extraNodes: LineageNode[] = [{ id: DROPPED_ROOT, label: fileName, type: 'root' }];
  const extraLinks: LineageLink[] = [];
  const linked = new Set<string>();

  for (const r of requirements) {
    const key = r.requirement;
    const nodeId = MODEL_FILE_TO_NODE[key] ?? (KNOWN_NODE_IDS.has(key) ? key : null);

    if (nodeId) {
      if (!linked.has(nodeId)) {
        extraLinks.push({ source: DROPPED_ROOT, target: nodeId, label: 'requires', verified: true });
        linked.add(nodeId);
      }
    } else {
      const synthetic = `unmapped:${r.requirement}`;
      if (!linked.has(synthetic)) {
        extraNodes.push({ id: synthetic, label: r.requirement, type: 'model', verified: false });
        extraLinks.push({ source: DROPPED_ROOT, target: synthetic, label: 'requires', verified: true });
        linked.add(synthetic);
      }
    }
  }

  return { extraNodes, extraLinks };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: number | null | undefined, decimals: number): string {
  if (value == null) return '—';
  return value.toFixed(decimals);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Alert({ kind, title, message }: { kind: 'warning' | 'error'; title: string; message: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-[8px] px-4 py-3 border', kind === 'error' ? 'bg-[#FFF5F5] border-[#FECACA]' : 'bg-[#FFFBEB] border-[#FDE68A]')}>
      <div className="shrink-0">
        {kind === 'error' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#DC2626" strokeWidth="1.5" />
            <path d="M12 8v5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="0.75" fill="#DC2626" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#D97706" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 9v4" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.75" fill="#D97706" />
          </svg>
        )}
      </div>
      <div>
        <p className={cn('text-[13px] font-semibold', kind === 'error' ? 'text-[#DC2626]' : 'text-amber-800')}>{title}</p>
        <p className={cn('text-[13px] mt-0.5', kind === 'error' ? 'text-[#DC2626]' : 'text-amber-800')}>{message}</p>
      </div>
    </div>
  );
}

const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { type: 'model', label: 'Models', color: '#a855f7', icon: 'M12 2.5 L20 7 V16 L12 20.5 L4 16 V7 Z M4 7 L12 11.5 L20 7 M12 11.5 V20.5' },
  { type: 'dataset', label: 'Datasets', color: '#3b82f6', icon: 'M4 6 C4 4 8 3 12 3 C16 3 20 4 20 6 C20 8 16 9 12 9 C8 9 4 8 4 6 M4 6 V18 C4 20 8 21 12 21 C16 21 20 20 20 18 V6 M4 12 C4 14 8 15 12 15 C16 15 20 14 20 12' },
  { type: 'paper', label: 'Papers', color: '#10b981', icon: 'M6 2.5 H13.5 L18 7 V21.5 H6 Z M13.5 2.5 V7 H18 M9 12 H15 M9 15.5 H15 M9 8.5 H11' },
  { type: 'org', label: 'Organisations', color: '#f59e0b', icon: 'M4 21 V5.5 L11 3 V21 M11 9 H20 V21 M4 21 H21 M7 8.5 V8.6 M7 12 V12.1 M7 15.5 V15.6 M15 13 V13.1 M15 16.5 V16.6' },
  { type: 'person', label: 'People', color: '#ec4899', icon: 'M12 11 A3.5 3.5 0 1 0 12 4 A3.5 3.5 0 0 0 12 11 Z M5 21 C5 16.5 8.5 14 12 14 C15.5 14 19 16.5 19 21' },
];

function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.type} className="flex items-center gap-1 text-[11px] text-[#939393]">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d={item.icon} fill="none" stroke={item.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1 text-[11px] text-[#939393]">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="none" stroke="#a1a1aa" strokeWidth="1.2" strokeDasharray="3,2" />
          <path d="M12 2.5 L20 7 V16 L12 20.5 L4 16 V7 Z M4 7 L12 11.5 L20 7 M12 11.5 V20.5" fill="none" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Unverified — placeholder, not confirmed
      </span>
    </div>
  );
}

// ── Layout toggle ─────────────────────────────────────────────────────────────

const LAYOUT_OPTIONS: { id: LayoutMode; label: string }[] = [
  { id: 'force', label: 'Scatter' },
  { id: 'flow', label: 'Flow' },
  { id: 'layers', label: 'Layers' },
  { id: 'timeline', label: 'Timeline' },
];

// ── Requirement card ──────────────────────────────────────────────────────────

function RequirementCard({ req }: { req: Resolved }) {
  const isExtension = req.category === 'custom_nodes';
  const badge = !isExtension && req.status
    ? <RiskBadge record={{ status: req.status }} />
    : !isExtension && req.legacyVettingStatus
      ? <VettingBadge status={req.legacyVettingStatus.toLowerCase() as VettingStatus} />
      : null;
  const emptyMessage = req.source === 'none'
    ? `Nothing was recorded for this ${isExtension ? 'extension' : 'model'}${req.pointerBroken ? ', and the record it points to is no longer in the database.' : '.'}`
    : null;

  return (
    <ModelProvenanceCard
      name={req.name}
      requirement={req.requirement}
      category={req.category}
      provenance={req.source === 'none' ? null : req.data}
      badge={badge}
      emptyMessage={emptyMessage}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImageInfoViewer() {
  const [tab, setTab] = useState<Tab>('environmental');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileDate, setFileDate] = useState<Date | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolving, setResolving] = useState(false);

  const [graphLayout, setGraphLayout] = useState<LayoutMode>('force');
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(true);
  const [provenanceOpen, setProvenanceOpen] = useState(true);
  const [extraNodes, setExtraNodes] = useState<LineageNode[]>([]);
  const [extraLinks, setExtraLinks] = useState<LineageLink[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(lineageNodes.map((n) => n.id)));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevUrlRef = useRef<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(file);
    prevUrlRef.current = url;
    setImageUrl(url);
    setFileName(file.name);
    setFileDate(new Date(file.lastModified));
    setResult(null);
    setResolved([]);

    const parsed = parsePng(await file.arrayBuffer());
    setResult(parsed);

    if (parsed.kind === 'ok') {
      const { extraNodes: en, extraLinks: el } = buildGraphFromRequirements(file.name, parsed.requirements);
      setExtraNodes(en);
      setExtraLinks(el);
      setExpanded(new Set([DROPPED_ROOT, ...lineageNodes.map((n) => n.id)]));

      if (parsed.requirements.length > 0) {
        setResolving(true);
        try { setResolved(await resolveRequirements(parsed.requirements)); }
        finally { setResolving(false); }
      }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const allNodes = [...lineageNodes, ...extraNodes];
      const allLinks = [...lineageLinks, ...extraLinks];
      const index = buildIndex(allNodes, allLinks);
      const beforeVisible = computeVisible(index, prev, DROPPED_ROOT);

      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const stillVisible = computeVisible(index, next, DROPPED_ROOT);
        for (const n of [...next]) { if (!stillVisible.has(n)) next.delete(n); }
      } else {
        next.add(id);
      }

      // A leaf node — nothing reachable from it — toggling its own expanded
      // flag doesn't change what's actually on screen. Returning the same
      // Set reference tells React to bail out of this update entirely, so
      // the graph doesn't redraw/re-simulate (and visibly jiggle) for a
      // click that had nothing to expand or collapse.
      const afterVisible = computeVisible(index, next, DROPPED_ROOT);
      if (beforeVisible.size === afterVisible.size && [...beforeVisible].every((v) => afterVisible.has(v))) {
        return prev;
      }
      return next;
    });
  }, [extraNodes, extraLinks]);

  const graphNodes = useMemo(() => [...lineageNodes, ...extraNodes], [extraNodes]);
  const graphLinks = useMemo(() => [...lineageLinks, ...extraLinks], [extraLinks]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoomed(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const hasImage = imageUrl !== null;
  const hasGraph = hasImage && result?.kind === 'ok' && extraNodes.length > 0;

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* Always-mounted file input */}
      <input ref={fileInputRef} type="file" accept="image/png" className="hidden" onChange={handleFileChange} />

      {/* Title — full-width header, matches PWW "Workflow Converter" */}
      <div className="shrink-0 px-6 pt-8 pb-4">
        <p className="text-[13px] font-semibold text-black">Image Inspector</p>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden pt-4">

        {/* Left sidebar */}
        <aside className="w-[200px] shrink-0 px-6 pb-8 overflow-y-auto">
          {!hasImage ? (
            <p className="text-[13px] text-[#939393] leading-relaxed">Drop a PNG rendered by the Pseudorandom Rhino plugin to inspect its environmental data and model provenance.</p>
          ) : (
            <div className="space-y-3">
              {([
                { key: 'environmental', label: 'Environmental data' },
                { key: 'provenance', label: 'Model provenance' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'w-full text-left text-[13px] transition-colors',
                    tab === key ? 'text-black' : 'text-[#939393] hover:text-black'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="px-10 pb-[40px] max-w-[800px]">

            {/* Drop zone */}
            {!hasImage && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'relative border border-dashed rounded-[8px] cursor-pointer transition-colors flex flex-col items-center justify-center min-h-[280px] gap-3',
                  isDragging ? 'border-[#B0B0B0] bg-zinc-50' : 'border-[#D4D4D4] hover:border-[#B0B0B0]'
                )}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <div className="text-center">
                  <p className="text-[15px] text-black">Select an image to upload</p>
                  <p className="text-[13px] text-[#939393] mt-1">or drag and drop it here</p>
                </div>
                <p className="absolute bottom-10 left-0 right-0 text-center text-[13px] text-[#C0C0C0]">(Must be a Pseudorandom PNG)</p>
              </div>
            )}

            {/* Parse errors */}
            {result && result.kind !== 'ok' && (
              <div className="space-y-3">
                {result.kind === 'not-png' && (
                  <Alert kind="error" title="Invalid file" message="This doesn't look like a valid PNG. Make sure you're uploading a .png file rendered by the Pseudorandom Rhino plugin." />
                )}
                {result.kind === 'no-chunk' && (
                  <Alert kind="warning" title="No metadata found" message="No Pseudorandom metadata was found in this image. Only PNGs rendered by the Pseudorandom Rhino plugin carry embedded provenance." />
                )}
                {result.kind === 'parse-error' && (
                  <Alert kind="error" title="Parse error" message={`Failed to read embedded metadata: ${result.message}`} />
                )}
              </div>
            )}

            {/* Environmental tab */}
            {result?.kind === 'ok' && tab === 'environmental' && (
              <div className="space-y-4">
                {result.env ? (
                  <div className="border border-[#E9E9E9] rounded-[8px] px-5 py-4">
                    <div className="space-y-4">
                      {[
                        { label: 'Carbon', value: result.env.carbon_kgco2e != null ? `${fmt(result.env.carbon_kgco2e, 4)} kg CO₂e` : '—' },
                        { label: 'Energy', value: result.env.energy_kwh != null ? `${fmt(result.env.energy_kwh, 4)} kWh` : '—' },
                        { label: 'Water', value: result.env.water_l != null ? `${fmt(result.env.water_l, 3)} L` : '—' },
                        { label: 'Worker location', value: result.env.worker_location ?? '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="grid grid-cols-[110px_1fr]">
                          <span className="text-[13px] text-[#939393]">{label}</span>
                          <span className="text-[13px] text-black tabular-nums">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Alert kind="warning" title="No environmental data" message="Environmental data wasn't recorded for this render." />
                )}
              </div>
            )}

            {/* Provenance tab */}
            {result?.kind === 'ok' && tab === 'provenance' && (
              <div>
                {/* Lineage graph section */}
                {hasGraph && (
                  <div>
                    <button
                      onClick={() => setLineageOpen((v) => !v)}
                      className="flex items-center gap-2 mb-3 text-left"
                    >
                      <span className="text-[24px] font-semibold text-black">Model lineage</span>
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#939393"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={cn('transition-transform shrink-0', lineageOpen ? '' : '-rotate-90')}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {lineageOpen && (
                      <>
                        {/* Keyframes are always mounted (harmless when unused) rather than
                            gated on `zoomed`, so this never inserts/removes a sibling ahead
                            of the frame below — doing that would shift every later child's
                            index and could make React remount the LineageGraph subtree
                            instead of preserving it (and its settled layout) across the
                            zoom toggle. */}
                        <style>{`
                          @keyframes lineage-fade { from { opacity: 0 } to { opacity: 1 } }
                          @keyframes lineage-rise { from { opacity: 0; transform: scale(.975) } to { opacity: 1; transform: none } }
                          @media (prefers-reduced-motion: reduce) {
                            [style*="lineage-"] { animation: none !important }
                          }
                        `}</style>
                        <div
                          className={zoomed ? 'fixed inset-0 z-50 flex items-center justify-center bg-white/50 p-6 backdrop-blur-sm' : ''}
                          style={zoomed ? { animation: 'lineage-fade 180ms ease-out' } : undefined}
                          onClick={zoomed ? () => setZoomed(false) : undefined}
                        >
                          {/* One LineageGraph instance total — its internal simulation state
                              (settled positions, zoom, expand/collapse) lives in refs keyed to
                              this component instance. Swapping to a second instance in the
                              zoomed modal (as an earlier version did) meant a fresh simulation
                              at a different pixel size, producing a visibly different layout
                              and losing whatever was expanded. Keeping it the same element
                              across the zoom toggle — only the wrapping classNames change —
                              preserves all of that; the container resize even plays through
                              playNodeTransition() in LineageGraph.tsx for a smooth reflow
                              instead of a jump cut. */}
                          <div
                            onClick={zoomed ? (e) => e.stopPropagation() : undefined}
                            style={zoomed ? { animation: 'lineage-rise 200ms ease-out' } : undefined}
                            className={
                              zoomed
                                ? 'relative flex h-full w-full max-w-6xl flex-col rounded-sm border border-zinc-200 bg-white shadow-xl'
                                : 'border border-[#E9E9E9] rounded-[8px] relative'
                            }
                          >
                            <div className="relative min-h-0 flex-1">
                              {/* Floating view picker */}
                              <div className="absolute top-3 right-3 z-10">
                                <button
                                  onClick={() => setShowLayoutMenu((v) => !v)}
                                  className="flex items-center gap-1.5 bg-white border border-[#E9E9E9] rounded-[8px] px-3 py-1.5 text-[12px] hover:opacity-75 transition-opacity shadow-[0_0_4px_rgba(0,0,0,0.10)]"
                                >
                                  <span className="text-[#939393]">View:</span>
                                  <span className="text-black">{LAYOUT_OPTIONS.find((o) => o.id === graphLayout)?.label}</span>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#939393" strokeWidth="2" strokeLinecap="round">
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                </button>
                                {showLayoutMenu && (
                                  <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowLayoutMenu(false)} />
                                    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-[#E9E9E9] rounded-[8px] shadow-sm overflow-hidden min-w-[120px]">
                                      {LAYOUT_OPTIONS.map((opt) => (
                                        <button
                                          key={opt.id}
                                          onClick={() => { setGraphLayout(opt.id); setShowLayoutMenu(false); }}
                                          className={cn('w-full text-left px-3 py-2 text-[12px] hover:bg-zinc-50 transition-colors', graphLayout === opt.id ? 'text-black font-medium' : 'text-[#939393]')}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                              <LineageGraph
                                nodes={graphNodes}
                                links={graphLinks}
                                expanded={expanded}
                                onToggle={handleToggle}
                                rootId={DROPPED_ROOT}
                                layout={graphLayout}
                                imageUrl={imageUrl}
                                showLinkLabels={zoomed}
                                className={zoomed ? 'h-full w-full' : 'h-[420px]'}
                              />
                              {!zoomed && (
                                <button
                                  type="button"
                                  onClick={() => setZoomed(true)}
                                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-sm bg-white/80 px-2 py-1 text-xs text-zinc-500 backdrop-blur-sm transition-colors hover:text-zinc-900"
                                >
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path
                                      d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  Click to expand
                                </button>
                              )}
                            </div>
                            {zoomed && (
                              <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-3 shrink-0">
                                <GraphLegend />
                              </div>
                            )}
                            {zoomed && (
                              <button
                                type="button"
                                onClick={() => setZoomed(false)}
                                aria-label="Close"
                                // Outside the frame entirely, not inset within it — right-4 (a
                                // positive inset) landed the button on top of the view picker,
                                // which lives in that same top-right corner of the graph area.
                                // -right-12 pushes it 48px past the frame's own right edge,
                                // i.e. 16px clear of the edge once the button's own 32px width
                                // is accounted for (32 + 16 = 48) — same 16px gap, now measured
                                // on the outside of the frame instead of the inside.
                                className="absolute -right-12 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:text-zinc-900"
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Legend — outside the frame, 4px gap, 2px left padding */}
                        {!zoomed && (
                          <div className="mt-1 pl-0.5">
                            <GraphLegend />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Requirement cards section */}
                {result.requirements.length === 0 ? (
                  <div className={hasGraph ? 'mt-9' : ''}>
                    <Alert kind="warning" title="No model provenance" message="This image has metadata but no model requirements were recorded with it." />
                  </div>
                ) : (
                  <div className={hasGraph ? 'mt-9' : ''}>
                    <button
                      onClick={() => setProvenanceOpen((v) => !v)}
                      className="flex items-center gap-2 mb-3 text-left"
                    >
                      <span className="text-[24px] font-semibold text-black">Model provenance</span>
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#939393"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={cn('transition-transform shrink-0', provenanceOpen ? '' : '-rotate-90')}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {provenanceOpen && (
                      <div className="space-y-4">
                        {resolving && <p className="text-[13px] text-[#939393]">Checking database…</p>}
                        {(resolved.length > 0
                          ? resolved
                          : result.requirements.map((r): Resolved => ({ ...r, source: 'none', data: EMPTY_PROVENANCE, name: null, pointerBroken: false, status: null }))
                        ).map((req, i) => (
                          <RequirementCard key={`${req.requirement}-${i}`} req={req} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Right panel — only after a file is loaded */}
        {hasImage && (
          <div className="w-[280px] shrink-0 self-start border border-[#E9E9E9] rounded-[8px] p-5 flex flex-col mr-6">
            <div className="rounded-[8px] overflow-hidden border border-[#E9E9E9]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl!} alt={fileName} className="w-full aspect-square object-cover" />
            </div>
            <div className="mt-2">
              <p className="text-[13px] font-medium text-black truncate">{fileName}</p>
              {fileDate && (
                <p className="text-[12px] text-[#939393] mt-0.5">{formatDate(fileDate)}</p>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 flex items-center justify-center gap-2 w-full border border-[#E9E9E9] rounded-[8px] px-3 py-2 text-[13px] text-black hover:border-[#B0B0B0] transition-colors"
            >
              <UploadIcon />
              Upload another image
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
