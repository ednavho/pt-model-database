/**
 * Reads the endpoint requirements out of a Pseudorandom-rendered PNG.
 *
 * This duplicates the chunk-walking in app/image-info/ImageInfoViewer.tsx.
 * That file was explicitly off-limits when the lineage sketch was written, so
 * the logic lives here too rather than being imported from a page component.
 * Worth collapsing into one module once the sketch stops being throwaway.
 */

export type PngRequirement = {
  category: string;
  requirement: string;
};

export type PngReadResult =
  | { kind: 'ok'; fileName: string; requirements: PngRequirement[] }
  | { kind: 'not-png' }
  | { kind: 'no-chunk' }
  | { kind: 'bad-json'; message: string };

/** A chunk field may be a nested JSON string or an already-decoded object. */
function decodeField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toRequirement(v: unknown): PngRequirement | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.requirement !== 'string') return null;
  return {
    category: typeof r.category === 'string' ? r.category : '—',
    requirement: r.requirement,
  };
}

/** Expected under `Workflow`, but tolerate the root or one level deeper. */
function findRequirements(rec: Record<string, unknown>): PngRequirement[] {
  const collect = (v: unknown): PngRequirement[] | null => {
    if (!v || typeof v !== 'object') return null;
    const list = (v as Record<string, unknown>)['endpoint_requirements'];
    if (!Array.isArray(list)) return null;
    return list.map(toRequirement).filter((r): r is PngRequirement => r !== null);
  };

  return (
    collect(rec) ??
    collect(decodeField(rec['Workflow'])) ??
    Object.values(rec).map(decodeField).map(collect).find(Boolean) ??
    []
  );
}

export function readRequirementsFromPng(buffer: ArrayBuffer, fileName: string): PngReadResult {
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
        // Keyword is versioned (pseudorandom_v1_2), so match on the prefix.
        if (keyword.startsWith('pseudorandom_v')) {
          try {
            const outer = JSON.parse(decoder.decode(data.subarray(nullIdx + 1)));
            if (!outer || typeof outer !== 'object') {
              return { kind: 'ok', fileName, requirements: [] };
            }
            return {
              kind: 'ok',
              fileName,
              requirements: findRequirements(outer as Record<string, unknown>),
            };
          } catch (e) {
            return { kind: 'bad-json', message: e instanceof Error ? e.message : 'parse failed' };
          }
        }
      }
    }

    offset += length + 4; // chunk data + CRC
    if (type === 'IEND') break;
  }

  return { kind: 'no-chunk' };
}
