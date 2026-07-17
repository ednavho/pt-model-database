'use client';

import { cn } from '@/utils/cn';
import { useCallback, useRef, useState } from 'react';

type EnvironmentalData = {
  energy_kwh?: number | null;
  carbon_kgco2e?: number | null;
  water_l?: number | null;
  worker_location?: string | null;
  has_environmental_data?: boolean;
};

type ParseResult =
  | { kind: 'ok'; data: EnvironmentalData; raw: Record<string, unknown> }
  | { kind: 'no-env'; raw: Record<string, unknown> }
  | { kind: 'no-chunk' }
  | { kind: 'not-png' }
  | { kind: 'parse-error'; message: string };

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
        if (data[i] === 0) { nullIdx = i; break; }
      }

      if (nullIdx !== -1) {
        const keyword = decoder.decode(data.subarray(0, nullIdx));
        if (keyword.startsWith('pseudorandom_v')) {
          const text = decoder.decode(data.subarray(nullIdx + 1));
          try {
            const outer = JSON.parse(text);
            if (outer === null || typeof outer !== 'object') return { kind: 'no-env', raw: {} };
            const rec = outer as Record<string, unknown>;
            if (!('Environmental' in rec)) return { kind: 'no-env', raw: rec };
            const envRaw = rec['Environmental'];
            if (envRaw === null || envRaw === undefined) return { kind: 'no-env', raw: rec };
            const env = JSON.parse(String(envRaw)) as EnvironmentalData | null;
            if (env === null || typeof env !== 'object') return { kind: 'no-env', raw: rec };
            if ((env as Record<string, unknown>)['has_environmental_data'] === false) {
              return { kind: 'no-env', raw: rec };
            }
            return { kind: 'ok', data: env, raw: rec };
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

function fmt(value: number | null | undefined, decimals: number): string {
  if (value == null) return '—';
  return value.toFixed(decimals);
}

export default function ImageInfoViewer() {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const buffer = await file.arrayBuffer();
    setResult(parsePng(buffer));
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
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
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
              <code className="font-mono">.png</code> file rendered by the Pseudorandom Rhino plugin.
            </div>
          )}

          {result.kind === 'no-chunk' && (
            <div className="border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm px-4 py-3 rounded-sm">
              No Pseudorandom metadata found in this image. Only PNGs rendered by the Pseudorandom
              Rhino plugin contain embedded environmental data.
            </div>
          )}

          {result.kind === 'no-env' && (
            <div className="space-y-3">
              <div className="border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm px-4 py-3 rounded-sm">
                This image has Pseudorandom metadata, but environmental data wasn&apos;t recorded for
                this render. This can happen when the plugin couldn&apos;t retrieve energy or carbon
                figures at render time.
              </div>
              <RawMetadata raw={result.raw} />
            </div>
          )}

          {result.kind === 'parse-error' && (
            <div className="border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-sm">
              Failed to read the embedded metadata: {result.message}
            </div>
          )}

          {result.kind === 'ok' && (
            <div className="space-y-3">
            <div className="border border-zinc-200 rounded-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 bg-zinc-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Environmental Impact
                </p>
              </div>
              <dl className="divide-y divide-zinc-100">
                <div className="flex items-baseline justify-between px-5 py-3.5">
                  <dt className="text-sm text-zinc-500">Energy usage</dt>
                  <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                    {fmt(result.data.energy_kwh, 4)}{result.data.energy_kwh != null && ' kWh'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between px-5 py-3.5">
                  <dt className="text-sm text-zinc-500">Carbon</dt>
                  <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                    {fmt(result.data.carbon_kgco2e, 4)}{result.data.carbon_kgco2e != null && ' kg CO₂e'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between px-5 py-3.5">
                  <dt className="text-sm text-zinc-500">Water</dt>
                  <dd className="text-sm font-medium text-zinc-900 tabular-nums">
                    {fmt(result.data.water_l, 3)}{result.data.water_l != null && ' L'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between px-5 py-3.5">
                  <dt className="text-sm text-zinc-500">Worker location</dt>
                  <dd className="text-sm font-medium text-zinc-900">
                    {result.data.worker_location ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>
            <RawMetadata raw={result.raw} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
