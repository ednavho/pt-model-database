'use client';

import VettingBadge from '@/components/ui/VettingBadge';
import type { VettingStatus } from '@/types/database';
import { cn } from '@/utils/cn';
import { useCallback, useRef, useState } from 'react';

type EnvironmentalData = {
  energy_kwh?: number | null;
  carbon_kgco2e?: number | null;
  water_l?: number | null;
  worker_location?: string | null;
  has_environmental_data?: boolean;
};

type Provenance = {
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
  provenance_id: string | null;
  vetting_status: string | null;
  provenance: Provenance | null;
};

/**
 * A requirement after its pointer has been looked up. The database is always
 * preferred — it's the living record and may have been corrected since the
 * image was made — with the copy baked into the file as the fallback.
 */
type Resolved = Requirement & {
  source: 'database' | 'embedded' | 'none';
  data: Provenance;
  name: string | null;
  /** Pointer was present but the record couldn't be fetched. */
  pointerBroken: boolean;
};

type ParseResult =
  | {
      kind: 'ok';
      raw: Record<string, unknown>;
      env: EnvironmentalData | null;
      requirements: Requirement[];
    }
  | { kind: 'no-chunk' }
  | { kind: 'not-png' }
  | { kind: 'parse-error'; message: string };

// ── PNG parsing ─────────────────────────────────────────────────────────────

/** A field may be a nested JSON string or an already-decoded object. */
function decodeField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readEnvironmental(rec: Record<string, unknown>): EnvironmentalData | null {
  const env = decodeField(rec['Environmental']);
  if (!env || typeof env !== 'object') return null;
  if ((env as EnvironmentalData).has_environmental_data === false) return null;
  return env as EnvironmentalData;
}

function toRequirement(v: unknown): Requirement | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.requirement !== 'string') return null;
  const p = r.provenance;
  return {
    category: typeof r.category === 'string' ? r.category : '—',
    requirement: r.requirement,
    provenance_id: typeof r.provenance_id === 'string' ? r.provenance_id : null,
    vetting_status: typeof r.vetting_status === 'string' ? r.vetting_status : null,
    provenance: p && typeof p === 'object' ? (p as Provenance) : null,
  };
}

/**
 * The workflow is expected under `Workflow`, but tolerate it sitting at the
 * top level or one level deeper rather than silently showing nothing.
 */
function readRequirements(rec: Record<string, unknown>): Requirement[] {
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
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    offset += 4;

    const type = decoder.decode(bytes.subarray(offset, offset + 4));
    offset += 4;

    if (type === 'tEXt') {
      const data = bytes.subarray(offset, offset + length);

      let nullIdx = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) {
          nullIdx = i;
          break;
        }
      }

      if (nullIdx !== -1) {
        const keyword = decoder.decode(data.subarray(0, nullIdx));
        if (keyword.startsWith('pseudorandom_v')) {
          const text = decoder.decode(data.subarray(nullIdx + 1));
          try {
            const outer = JSON.parse(text);
            if (outer === null || typeof outer !== 'object') {
              return { kind: 'ok', raw: {}, env: null, requirements: [] };
            }
            const rec = outer as Record<string, unknown>;
            return {
              kind: 'ok',
              raw: rec,
              env: readEnvironmental(rec),
              requirements: readRequirements(rec),
            };
          } catch (e) {
            return {
              kind: 'parse-error',
              message: e instanceof Error ? e.message : 'JSON parse failed',
            };
          }
        }
      }
    }

    // Skip chunk data + 4-byte CRC
    offset += length + 4;
    if (type === 'IEND') break;
  }

  return { kind: 'no-chunk' };
}

// ── Pointer resolution ──────────────────────────────────────────────────────

async function resolveRequirements(reqs: Requirement[]): Promise<Resolved[]> {
  const ids = [...new Set(reqs.map((r) => r.provenance_id).filter(Boolean))] as string[];
  const records = await Promise.all(
    ids.map((id) =>
      fetch(`/api/models/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  const byId = new Map<string, Record<string, unknown>>();
  ids.forEach((id, i) => {
    if (records[i]) byId.set(id, records[i]);
  });

  return reqs.map((r) => {
    const db = r.provenance_id ? byId.get(r.provenance_id) : undefined;

    if (db) {
      return {
        ...r,
        source: 'database' as const,
        name: (db.name as string) ?? null,
        vetting_status: (db.vetting_status as string) ?? r.vetting_status,
        pointerBroken: false,
        data: {
          download_url: db.download_url as string | null,
          attribution: db.attribution as string | null,
          attribution_url: db.attribution_url as string | null,
          license: db.license as string | null,
          data_provenance_notes: db.data_provenance_notes as string | null,
          size_bytes: db.size_bytes as number | null,
        },
      };
    }

    const embedded = r.provenance ?? {};
    const hasAny = Object.values(embedded).some((v) => v !== null && v !== undefined && v !== '');
    return {
      ...r,
      source: hasAny ? ('embedded' as const) : ('none' as const),
      name: null,
      pointerBroken: r.provenance_id !== null,
      data: embedded,
    };
  });
}

// ── Display helpers ─────────────────────────────────────────────────────────

function fmt(value: number | null | undefined, decimals: number): string {
  if (value == null) return '—';
  return value.toFixed(decimals);
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

const SOURCE_LABEL: Record<Resolved['source'], string> = {
  database: 'Live from the model database',
  embedded: 'Recorded in the image',
  none: 'No provenance recorded',
};

function ProvenanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-xs text-zinc-400 sm:w-32 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-zinc-700 break-words min-w-0">{children}</dd>
    </div>
  );
}

function RequirementCard({ req }: { req: Resolved }) {
  const { data } = req;
  const size = formatBytes(data.size_bytes);
  const isExtension = req.category === 'custom_nodes';

  return (
    <div className="border border-zinc-200 rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-medium text-sm text-zinc-900 break-all">
              {req.name ?? req.requirement}
            </p>
            {req.name && (
              <p className="text-xs text-zinc-400 font-mono break-all">{req.requirement}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-500 border border-zinc-200 bg-white rounded-sm px-2 py-0.5">
              {req.category}
            </span>
            {!isExtension && req.vetting_status && (
              <VettingBadge status={req.vetting_status.toLowerCase() as VettingStatus} />
            )}
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {req.source === 'none' ? (
          <p className="text-sm text-zinc-400">
            Nothing was recorded for this{' '}
            {isExtension ? 'extension' : 'model'}
            {req.pointerBroken
              ? ", and the record it points to is no longer in the database."
              : '.'}
          </p>
        ) : (
          <dl className="space-y-2.5">
            {data.attribution && (
              <ProvenanceRow label="Attribution">{data.attribution}</ProvenanceRow>
            )}
            {data.attribution_url && (
              <ProvenanceRow label="Source">
                <a
                  href={data.attribution_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
                >
                  {data.attribution_url}
                </a>
              </ProvenanceRow>
            )}
            {data.license && <ProvenanceRow label="License">{data.license}</ProvenanceRow>}
            {data.download_url && (
              <ProvenanceRow label="Download">
                <a
                  href={data.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
                >
                  {data.download_url}
                </a>
              </ProvenanceRow>
            )}
            {size && <ProvenanceRow label="Size">{size}</ProvenanceRow>}
            {data.data_provenance_notes && (
              <ProvenanceRow label="Training data">{data.data_provenance_notes}</ProvenanceRow>
            )}
          </dl>
        )}

        <p className="mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-400">
          {SOURCE_LABEL[req.source]}
          {req.pointerBroken && req.source === 'embedded' && (
            <> — the database record it points to could not be found, so the image&apos;s own copy is shown.</>
          )}
        </p>
      </div>
    </div>
  );
}

function RawMetadata({ raw }: { raw: Record<string, unknown> }) {
  return (
    <details className="group border border-zinc-200 rounded-sm">
      <summary className="px-4 py-2.5 text-xs font-medium text-zinc-500 cursor-pointer select-none list-none flex items-center justify-between hover:text-zinc-700">
        Raw metadata
        <span className="group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="border-t border-zinc-100 px-4 py-3 overflow-x-auto">
        <pre className="text-xs text-zinc-600 whitespace-pre-wrap break-all">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </details>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function ImageInfoViewer() {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [resolving, setResolving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setResolved([]);

    const parsed = parsePng(await file.arrayBuffer());
    setResult(parsed);

    if (parsed.kind === 'ok' && parsed.requirements.length > 0) {
      setResolving(true);
      try {
        setResolved(await resolveRequirements(parsed.requirements));
      } finally {
        setResolving(false);
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-sm p-12 text-center cursor-pointer transition-colors',
          isDragging ? 'border-zinc-400 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={handleFileChange}
        />
        {fileName ? (
          <div>
            <p className="font-medium text-zinc-900">{fileName}</p>
            <p className="text-xs text-zinc-400 mt-1">Click to replace</p>
          </div>
        ) : (
          <div>
            <p className="text-zinc-500 mb-1">Drag and drop a rendered PNG image</p>
            <p className="text-xs text-zinc-400">or click to browse</p>
          </div>
        )}
      </div>

      {result && (
        <>
          {result.kind === 'not-png' && (
            <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-sm">
              This file doesn&apos;t look like a valid PNG. Make sure you&apos;re dropping a{' '}
              <code className="font-mono">.png</code> file rendered by the Pseudorandom Rhino
              plugin.
            </div>
          )}

          {result.kind === 'no-chunk' && (
            <div className="border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm px-4 py-3 rounded-sm">
              No Pseudorandom metadata found in this image. Only PNGs rendered by the Pseudorandom
              Rhino plugin carry embedded provenance.
            </div>
          )}

          {result.kind === 'parse-error' && (
            <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
              Failed to read the embedded metadata: {result.message}
            </div>
          )}

          {result.kind === 'ok' && (
            <div className="space-y-6">
              {/* Environmental */}
              <div className="border border-zinc-200 rounded-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-100 bg-zinc-50">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Environmental Impact
                  </p>
                </div>
                {result.env ? (
                  <dl className="divide-y divide-zinc-100">
                    <div className="flex items-baseline justify-between px-5 py-3.5">
                      <dt className="text-sm text-zinc-500">Energy usage</dt>
                      <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                        {fmt(result.env.energy_kwh, 4)}
                        {result.env.energy_kwh != null && ' kWh'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between px-5 py-3.5">
                      <dt className="text-sm text-zinc-500">Carbon</dt>
                      <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                        {fmt(result.env.carbon_kgco2e, 4)}
                        {result.env.carbon_kgco2e != null && ' kg CO₂e'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between px-5 py-3.5">
                      <dt className="text-sm text-zinc-500">Water</dt>
                      <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                        {fmt(result.env.water_l, 3)}
                        {result.env.water_l != null && ' L'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between px-5 py-3.5">
                      <dt className="text-sm text-zinc-500">Worker location</dt>
                      <dd className="text-sm font-medium text-zinc-900">
                        {result.env.worker_location ?? '—'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="px-5 py-4 text-sm text-zinc-500">
                    Environmental data wasn&apos;t recorded for this render. This happens when the
                    plugin couldn&apos;t retrieve energy or carbon figures at the time.
                  </p>
                )}
              </div>

              {/* Provenance */}
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Model Provenance
                  </p>
                  {resolving && <span className="text-xs text-zinc-400">Checking database…</span>}
                </div>

                {result.requirements.length === 0 ? (
                  <div className="border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm px-4 py-3 rounded-sm">
                    This image has Pseudorandom metadata, but no model requirements were recorded
                    with it, so there&apos;s nothing to trace back.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(resolved.length > 0
                      ? resolved
                      : result.requirements.map(
                          (r): Resolved => ({
                            ...r,
                            source: 'none',
                            data: {},
                            name: null,
                            pointerBroken: false,
                          })
                        )
                    ).map((req, i) => (
                      <RequirementCard key={`${req.requirement}-${i}`} req={req} />
                    ))}
                  </div>
                )}
              </div>

              <RawMetadata raw={result.raw} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
