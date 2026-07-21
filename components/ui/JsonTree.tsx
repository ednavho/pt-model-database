'use client';

import { cn } from '@/utils/cn';
import { useMemo, useState } from 'react';

/**
 * Collapsible JSON viewer. Containers past `openToDepth` start collapsed so a
 * large document is scannable at a glance, and any branch can be opened.
 */

type Entry = [string, unknown];

const LONG_STRING = 140;

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === 'object';
}

function entriesOf(v: Record<string, unknown> | unknown[]): Entry[] {
  return Array.isArray(v) ? v.map((item, i) => [String(i), item]) : Object.entries(v);
}

/** Every container path, so expand-all / collapse-all know what exists. */
function collectPaths(
  value: unknown,
  path = '$',
  depth = 0,
  out: { path: string; depth: number }[] = []
): { path: string; depth: number }[] {
  if (!isContainer(value)) return out;
  out.push({ path, depth });
  for (const [k, v] of entriesOf(value)) collectPaths(v, `${path}.${k}`, depth + 1, out);
  return out;
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-zinc-400">null</span>;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <span className="font-medium text-zinc-900">{String(value)}</span>;
  }
  const s = String(value);
  if (s.length > LONG_STRING) {
    return (
      <span className="text-zinc-700">
        &quot;{s.slice(0, LONG_STRING)}…&quot;
        <span className="ml-1 text-zinc-400">+{s.length - LONG_STRING} chars</span>
      </span>
    );
  }
  return <span className="text-zinc-700">&quot;{s}&quot;</span>;
}

function Branch({
  name,
  value,
  path,
  depth,
  collapsed,
  toggle,
  isLast,
}: {
  name: string | null;
  value: unknown;
  path: string;
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  isLast: boolean;
}) {
  const key =
    name === null ? null : (
      <>
        <span className="text-zinc-500">&quot;{name}&quot;</span>
        <span className="text-zinc-400">: </span>
      </>
    );

  if (!isContainer(value)) {
    return (
      <div className="flex" style={{ paddingLeft: depth * 14 }}>
        <span className="w-4 shrink-0" />
        <span className="min-w-0 break-all">
          {key}
          <Scalar value={value} />
          {!isLast && <span className="text-zinc-400">,</span>}
        </span>
      </div>
    );
  }

  const arr = Array.isArray(value);
  const [open, close] = arr ? ['[', ']'] : ['{', '}'];
  const items = entriesOf(value);
  const isOpen = !collapsed.has(path);
  const count = `${items.length} ${arr ? (items.length === 1 ? 'item' : 'items') : items.length === 1 ? 'key' : 'keys'}`;

  return (
    <div>
      <div className="flex" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          onClick={() => toggle(path)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${name ?? 'root'}`}
          className="w-4 shrink-0 text-left text-zinc-400 hover:text-zinc-700 focus:text-zinc-700 focus:outline-none"
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <span className="min-w-0 break-all">
          {key}
          <span className="text-zinc-400">{open}</span>
          {!isOpen && (
            <>
              <button
                type="button"
                onClick={() => toggle(path)}
                className="mx-1 rounded-sm px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                … {count}
              </button>
              <span className="text-zinc-400">
                {close}
                {!isLast && ','}
              </span>
            </>
          )}
        </span>
      </div>

      {isOpen && (
        <>
          {items.map(([k, v], i) => (
            <Branch
              key={k}
              name={arr ? null : k}
              value={v}
              path={`${path}.${k}`}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              isLast={i === items.length - 1}
            />
          ))}
          <div className="flex" style={{ paddingLeft: depth * 14 }}>
            <span className="w-4 shrink-0" />
            <span className="text-zinc-400">
              {close}
              {!isLast && ','}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function JsonTree({
  data,
  openToDepth = Infinity,
  maxHeight = 520,
  className,
}: {
  data: unknown;
  /** Containers at or beyond this depth start collapsed. Default: all open. */
  openToDepth?: number;
  /** Scroll height of the code panel, in px. */
  maxHeight?: number;
  className?: string;
}) {
  const paths = useMemo(() => collectPaths(data), [data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(paths.filter((p) => p.depth >= openToDepth).map((p) => p.path))
  );

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allCollapsed = collapsed.size >= paths.length;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          disabled={collapsed.size === 0}
          className="text-xs text-zinc-500 hover:text-zinc-900 disabled:cursor-default disabled:text-zinc-300"
        >
          Expand all
        </button>
        <span className="text-zinc-200">|</span>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(paths.map((p) => p.path)))}
          disabled={allCollapsed}
          className="text-xs text-zinc-500 hover:text-zinc-900 disabled:cursor-default disabled:text-zinc-300"
        >
          Collapse all
        </button>
      </div>

      <div
        style={{ maxHeight }}
        className={cn(
          'overflow-auto rounded-sm border border-zinc-100 bg-zinc-50 p-4',
          'font-mono text-xs leading-relaxed'
        )}
      >
        <Branch
          name={null}
          value={data}
          path="$"
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          isLast
        />
      </div>
    </div>
  );
}
