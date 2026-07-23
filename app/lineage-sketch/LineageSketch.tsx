'use client';

import {
  DEFAULT_RENDER_ID,
  MODEL_FILE_TO_NODE,
  lineageLinks,
  lineageNodes,
  lineageRenders,
  type LineageLink,
  type LineageNode,
} from '@/data/lineageData';
import { readRequirementsFromPng, type PngRequirement } from '@/utils/pngLineage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LineageGraph, {
  TYPE_COLORS,
  TYPE_ICONS,
  buildIndex,
  computeVisible,
  type LayoutMode,
} from './LineageGraph';

const FORMATS: { id: LayoutMode; label: string; note: string }[] = [
  { id: 'force', label: 'Force', note: 'Organic springy network' },
  { id: 'flow', label: 'Flow (L→R)', note: 'Image on the right, its ingredients pulling left' },
  { id: 'layers', label: 'Layers', note: 'Image right, rows of models / datasets / papers / people' },
];

const DROPPED_ROOT = '__dropped__';

const KNOWN_NODE_IDS = new Set(lineageNodes.map((n) => n.id));

/** How a requirement found its way into the graph — shown so the join is legible. */
type MatchRow = {
  requirement: string;
  category: string;
  provenanceId: string | null;
  via: 'provenance_id' | 'filename' | null;
  nodeId: string | null;
};

type Dropped = {
  fileName: string;
  extraNodes: LineageNode[];
  extraLinks: LineageLink[];
  rows: MatchRow[];
};

type DropState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: Dropped };

/**
 * Turns a dropped image's requirements into graph nodes.
 *
 * The pointer wins: a requirement carrying a provenance_id is resolved through
 * the database so the canonical filename decides which lineage node it lands
 * on, rather than trusting whatever string the workflow happened to record.
 * Requirements with no pointer fall back to their own filename.
 */
async function buildFromRequirements(
  fileName: string,
  requirements: PngRequirement[]
): Promise<Dropped> {
  const ids = [...new Set(requirements.map((r) => r.provenance_id).filter(Boolean))] as string[];
  const records = await Promise.all(
    ids.map((id) =>
      fetch(`/api/models/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  const fileById = new Map<string, string>();
  ids.forEach((id, i) => {
    const f = records[i]?.file_name;
    if (typeof f === 'string') fileById.set(id, f);
  });

  const extraNodes: LineageNode[] = [{ id: DROPPED_ROOT, label: fileName, type: 'root' }];
  const extraLinks: LineageLink[] = [];
  const rows: MatchRow[] = [];
  const linked = new Set<string>();

  for (const r of requirements) {
    const dbFile = r.provenance_id ? fileById.get(r.provenance_id) : undefined;
    const key = dbFile ?? r.requirement;
    // Extensions like "pseudocomfy" aren't filenames but do have lineage nodes.
    const nodeId = MODEL_FILE_TO_NODE[key] ?? (KNOWN_NODE_IDS.has(key) ? key : null);
    const via = r.provenance_id && dbFile ? 'provenance_id' : 'filename';

    if (nodeId) {
      if (!linked.has(nodeId)) {
        extraLinks.push({ source: DROPPED_ROOT, target: nodeId, label: 'requires', verified: true });
        linked.add(nodeId);
      }
      rows.push({ requirement: r.requirement, category: r.category, provenanceId: r.provenance_id, via, nodeId });
    } else {
      // Still show it — an unmapped requirement is a finding, not something
      // to hide. It appears as a leaf with no lineage behind it.
      const synthetic = `unmapped:${r.requirement}`;
      if (!linked.has(synthetic)) {
        extraNodes.push({ id: synthetic, label: r.requirement, type: 'model', verified: false });
        extraLinks.push({ source: DROPPED_ROOT, target: synthetic, label: 'requires', verified: true });
        linked.add(synthetic);
      }
      rows.push({ requirement: r.requirement, category: r.category, provenanceId: r.provenance_id, via: null, nodeId: null });
    }
  }

  return { fileName, extraNodes, extraLinks, rows };
}

const LEGEND: { type: string; label: string }[] = [
  { type: 'root', label: 'This render' },
  { type: 'model', label: 'Models' },
  { type: 'dataset', label: 'Datasets' },
  { type: 'paper', label: 'Papers' },
  { type: 'org', label: 'Organisations' },
  { type: 'person', label: 'People' },
];

function TypeIcon({ type, dashed = false }: { type: string; dashed?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      {dashed && (
        <circle
          cx="12"
          cy="12"
          r="11"
          fill="none"
          stroke="#a1a1aa"
          strokeWidth="1.2"
          strokeDasharray="3,2"
        />
      )}
      {TYPE_ICONS[type] && (
        <path
          d={TYPE_ICONS[type]}
          fill="none"
          stroke={TYPE_COLORS[type]}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {LEGEND.filter((l) => l.type !== 'root').map((l) => (
        <span key={l.type} className="flex items-center gap-1.5 text-xs text-zinc-500">
          <TypeIcon type={l.type} />
          {l.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
        <TypeIcon type="model" dashed />
        Unverified — placeholder, not confirmed
      </span>
    </div>
  );
}

export default function LineageSketch() {
  const [drop, setDrop] = useState<DropState>({ kind: 'idle' });
  const [exampleId, setExampleId] = useState(DEFAULT_RENDER_ID);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([DEFAULT_RENDER_ID]));
  const [zoomed, setZoomed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('force');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs for the dropped image must be revoked when replaced.
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const dropped = drop.kind === 'ok' ? drop.data : null;
  const rootId = dropped ? DROPPED_ROOT : exampleId;

  const nodes = useMemo(
    () => (dropped ? [...lineageNodes, ...dropped.extraNodes] : lineageNodes),
    [dropped]
  );
  const links = useMemo(
    () => (dropped ? [...lineageLinks, ...dropped.extraLinks] : lineageLinks),
    [dropped]
  );
  const index = useMemo(() => buildIndex(nodes, links), [nodes, links]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const processFile = useCallback(async (file: File) => {
    setDrop({ kind: 'reading' });
    const result = readRequirementsFromPng(await file.arrayBuffer(), file.name);

    if (result.kind === 'not-png') {
      setDrop({ kind: 'error', message: "That doesn't look like a PNG." });
      return;
    }
    if (result.kind === 'no-chunk') {
      setDrop({
        kind: 'error',
        message:
          'No Pseudorandom metadata in this image. Only PNGs rendered by the Rhino plugin carry model requirements.',
      });
      return;
    }
    if (result.kind === 'bad-json') {
      setDrop({ kind: 'error', message: `Could not read the metadata: ${result.message}` });
      return;
    }
    if (result.requirements.length === 0) {
      setDrop({
        kind: 'error',
        message: 'This image has Pseudorandom metadata but records no model requirements.',
      });
      return;
    }

    const data = await buildFromRequirements(result.fileName, result.requirements);
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setDrop({ kind: 'ok', data });
    setExpanded(new Set([DROPPED_ROOT]));
  }, []);

  const pickExample = (id: string) => {
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDrop({ kind: 'idle' });
    setExampleId(id);
    setExpanded(new Set([id]));
  };

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoomed(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const visibleCount = computeVisible(index, expanded, rootId).size;
  const reachable = computeVisible(index, new Set(nodes.map((n) => n.id)), rootId).size;

  const graph = (extra: { showLinkLabels?: boolean; className: string }) => (
    <LineageGraph
      nodes={nodes}
      links={links}
      expanded={expanded}
      onToggle={toggle}
      rootId={rootId}
      layout={layout}
      imageUrl={dropped ? imageUrl : null}
      {...extra}
    />
  );

  return (
    <div className="space-y-3">
      {/* Drop a real render */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) processFile(f);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={
          'cursor-pointer rounded-sm border-2 border-dashed p-6 text-center transition-colors ' +
          (isDragging ? 'border-zinc-400 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300')
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
          }}
        />
        {dropped ? (
          <div>
            <p className="text-sm font-medium text-zinc-900">{dropped.fileName}</p>
            <p className="mt-0.5 text-xs text-zinc-400">Click to replace</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-zinc-500">
              {drop.kind === 'reading' ? 'Reading…' : 'Drop a rendered PNG to root the graph in it'}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              or explore one of the example renders below
            </p>
          </div>
        )}
      </div>

      {drop.kind === 'error' && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {drop.message}
        </div>
      )}

      {/* How each requirement reached the graph */}
      {dropped && (
        <div className="overflow-x-auto rounded-sm border border-zinc-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-zinc-400">
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Requirement</th>
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Category</th>
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Matched via</th>
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Lineage node</th>
              </tr>
            </thead>
            <tbody>
              {dropped.rows.map((r, i) => (
                <tr key={`${r.requirement}-${i}`} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-zinc-700 break-all">{r.requirement}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.category}</td>
                  <td className="px-3 py-2 text-zinc-500">
                    {r.via === 'provenance_id' ? (
                      <span className="text-zinc-900">provenance_id → database</span>
                    ) : r.via === 'filename' ? (
                      'filename'
                    ) : (
                      <span className="text-amber-700">no match</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-500">
                    {r.nodeId ?? <span className="not-italic text-amber-700">no lineage recorded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Format — the three ways to lay the same graph out */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">Format:</span>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setLayout(f.id)}
              title={f.note}
              className={
                'rounded-sm border px-2.5 py-1 text-xs transition-colors ' +
                (layout === f.id
                  ? 'border-zinc-800 bg-zinc-900 text-white'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-400')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Example renders remain as stand-ins when nothing is dropped. */}
        {!dropped && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">Example:</span>
            {lineageRenders.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pickExample(r.id)}
                title={r.note}
                className={
                  'rounded-sm border px-2.5 py-1 text-xs transition-colors ' +
                  (r.id === exampleId
                    ? 'border-zinc-400 bg-zinc-100 text-zinc-800'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-400')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative rounded-sm border border-zinc-200">
        {graph({ className: 'h-[420px] w-full' })}

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

        <span className="absolute bottom-3 left-3 text-xs text-zinc-400">
          {visibleCount} of {reachable} shown — click a ringed node to follow it
        </span>
      </div>

      <Legend />

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/50 p-6 backdrop-blur-sm"
          style={{ animation: 'lineage-fade 180ms ease-out' }}
          onClick={() => setZoomed(false)}
        >
          {/* Keyframes live here so the sketch stays self-contained. */}
          <style>{`
            @keyframes lineage-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes lineage-rise { from { opacity: 0; transform: scale(.975) } to { opacity: 1; transform: none } }
            @media (prefers-reduced-motion: reduce) {
              [style*="lineage-"] { animation: none !important }
            }
          `}</style>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'lineage-rise 200ms ease-out' }}
            className="relative flex h-full w-full max-w-6xl flex-col rounded-sm border border-zinc-200 bg-white shadow-xl"
          >
            {graph({ showLinkLabels: true, className: 'min-h-0 w-full flex-1' })}
            <div className="flex items-center justify-between gap-4 border-t border-zinc-100 px-4 py-3">
              <Legend />
              <button
                type="button"
                onClick={() => setExpanded(new Set([rootId]))}
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-900"
              >
                Collapse all
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close"
            className="absolute right-6 top-6 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:text-zinc-900"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
