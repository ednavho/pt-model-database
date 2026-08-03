'use client';

import {
  NODE_DESCRIPTIONS,
  RELATIONSHIP_PHRASING,
  type LineageLink,
  type LineageNode,
} from '@/data/lineageData';
import * as d3 from 'd3';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type LayoutMode = 'force' | 'flow' | 'layers' | 'timeline';

export const TYPE_COLORS: Record<string, string> = {
  root: '#18181b',
  model: '#9970C2',
  dataset: '#6990BF',
  paper: '#50A589',
  org: '#C09A59',
  person: '#BD7599',
};

// Feather-ish glyphs in a 24×24 box, drawn as white strokes inside each node
// and reused at full colour in the legend, so type reads without the colour key.
export const TYPE_ICONS: Record<string, string> = {
  root: 'M4 5 H20 V19 H4 Z M4 15 L9 11 L13 14 L16 12 L20 15',
  model: 'M12 2.5 L20 7 V16 L12 20.5 L4 16 V7 Z M4 7 L12 11.5 L20 7 M12 11.5 V20.5',
  dataset:
    'M4 6 C4 4 8 3 12 3 C16 3 20 4 20 6 C20 8 16 9 12 9 C8 9 4 8 4 6 M4 6 V18 C4 20 8 21 12 21 C16 21 20 20 20 18 V6 M4 12 C4 14 8 15 12 15 C16 15 20 14 20 12',
  paper: 'M6 2.5 H13.5 L18 7 V21.5 H6 Z M13.5 2.5 V7 H18 M9 12 H15 M9 15.5 H15 M9 8.5 H11',
  person: 'M12 11 A3.5 3.5 0 1 0 12 4 A3.5 3.5 0 0 0 12 11 Z M5 21 C5 16.5 8.5 14 12 14 C15.5 14 19 16.5 19 21',
  org: 'M4 21 V5.5 L11 3 V21 M11 9 H20 V21 M4 21 H21 M7 8.5 V8.6 M7 12 V12.1 M7 15.5 V15.6 M15 13 V13.1 M15 16.5 V16.6',
};

const GRAPH_TYPES = ['model', 'dataset', 'paper', 'org', 'person'];

const ROOT_R = 30;
const ROOT_MAX_SIZE = 100;

type SimNode = LineageNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { label: string; verified: boolean };

export type GraphIndex = {
  nodeById: Map<string, LineageNode>;
  neighbours: Map<string, Set<string>>;
};

/**
 * Adjacency is undirected on purpose. Links are written parent-last, so
 * following only outgoing edges from the root would strand most of the graph.
 */
export function buildIndex(nodes: LineageNode[], links: LineageLink[]): GraphIndex {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    if (!nodeById.has(l.source) || !nodeById.has(l.target)) continue;
    if (!neighbours.has(l.source)) neighbours.set(l.source, new Set());
    if (!neighbours.has(l.target)) neighbours.set(l.target, new Set());
    neighbours.get(l.source)!.add(l.target);
    neighbours.get(l.target)!.add(l.source);
  }
  return { nodeById, neighbours };
}

function reachableFrom(index: GraphIndex, id: string, rootId: string): string[] {
  return [...(index.neighbours.get(id) ?? [])].filter((n) => {
    const node = index.nodeById.get(n);
    return !(node?.type === 'root' && n !== rootId);
  });
}

export function computeVisible(
  index: GraphIndex,
  expanded: Set<string>,
  rootId: string
): Set<string> {
  const visible = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of Array.from(visible)) {
      if (!expanded.has(id)) continue;
      for (const n of reachableFrom(index, id, rootId)) {
        if (!visible.has(n)) {
          visible.add(n);
          grew = true;
        }
      }
    }
  }
  return visible;
}

function hasHidden(index: GraphIndex, id: string, visible: Set<string>, rootId: string): boolean {
  for (const n of reachableFrom(index, id, rootId)) if (!visible.has(n)) return true;
  return false;
}

/** BFS hop count from the root, honouring foreign-root dead ends. */
function depthsFrom(index: GraphIndex, visible: Set<string>, rootId: string): Map<string, number> {
  const depth = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of reachableFrom(index, id, rootId)) {
      if (visible.has(n) && !depth.has(n)) {
        depth.set(n, depth.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  // Anything unreached (shouldn't happen) parks one column out.
  for (const id of visible) if (!depth.has(id)) depth.set(id, 1);
  return depth;
}

/**
 * Groups of ≥3 visible nodes that share a type and the exact same set of
 * visible neighbours — the LoRAs, the SDXL merges. Rendered as a soft cloud to
 * signal "these belong together" without asserting anything precise.
 */
function findClusters(index: GraphIndex, visible: Set<string>): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of visible) {
    const node = index.nodeById.get(id);
    if (!node || node.type === 'root') continue;
    const nbrs = [...(index.neighbours.get(id) ?? [])].filter((n) => visible.has(n)).sort();
    if (nbrs.length === 0) continue;
    const key = `${node.type}|${nbrs.join(',')}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }
  return [...groups.values()].filter((g) => g.length >= 3);
}

function iconScale(radius: number): number {
  // Icon box is 24 units; fit it to ~1.15× the node radius.
  return (radius * 2 * 0.62) / 24;
}

/**
 * Soft-spring border: applies gentle velocity nudges when a node gets near the
 * edge, with a hard stop only far outside the frame to prevent total escape.
 */
function boundsForce(
  getBounds: () => { w: number; h: number; minX?: number; minY?: number },
  radiusFn: (n: SimNode) => number
) {
  let nodes: SimNode[] = [];
  const force = () => {
    const { w, h, minX = 0, minY = 0 } = getBounds();
    for (const n of nodes) {
      const r = radiusFn(n) + 4;
      const soft = 35;
      if (n.fx == null) {
        const gaps = [
          (n.x! - minX) - r,
          (minX + w) - r - n.x!,
          (n.y! - minY) - r,
          (minY + h) - r - n.y!,
        ];
        if (gaps[0] < soft) n.vx = (n.vx ?? 0) + (soft - gaps[0]) * 0.012;
        if (gaps[1] < soft) n.vx = (n.vx ?? 0) - (soft - gaps[1]) * 0.012;
        if (gaps[2] < soft) n.vy = (n.vy ?? 0) + (soft - gaps[2]) * 0.012;
        if (gaps[3] < soft) n.vy = (n.vy ?? 0) - (soft - gaps[3]) * 0.012;
        n.x = Math.max(minX - r * 0.5, Math.min(minX + w + r * 0.5, n.x!));
        n.y = Math.max(minY - r * 0.5, Math.min(minY + h + r * 0.5, n.y!));
      } else {
        n.fx = Math.max(minX + r, Math.min(minX + w - r, n.fx ?? 0));
        n.fy = Math.max(minY + r, Math.min(minY + h - r, n.fy ?? 0));
      }
    }
  };
  force.initialize = (n: SimNode[]) => {
    nodes = n;
  };
  return force;
}

function popupHtml(node: LineageNode): string {
  const color = TYPE_COLORS[node.type];
  const kind = node.type === 'root' ? 'render' : node.type;
  const desc =
    node.type === 'root'
      ? 'The image this whole graph is rooted in.'
      : (NODE_DESCRIPTIONS[node.id] ?? `A ${node.type} in this image's lineage.`);

  const badge =
    node.verified === false
      ? '<span style="margin-left:6px;font-size:10px;color:#b45309;border:1px dashed #f59e0b;border-radius:3px;padding:0 4px">unverified</span>'
      : '';

  const allLinks = [
    ...(node.links ?? []),
    ...(node.source ? [{ label: 'Source', url: node.source }] : []),
  ];

  const linksHtml =
    allLinks.length > 0
      ? `<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px 8px">
          ${allLinks
            .map(
              (l) =>
                `<a href="${l.url}" target="_blank" rel="noopener noreferrer" style="color:#3f3f46;text-decoration:underline;font-size:11px">${l.label} ↗</a>`
            )
            .join('')}
        </div>`
      : '';

  const dateLine = node.date
    ? `<div style="font-size:10px;color:#a1a1aa;margin-bottom:2px">${node.date}</div>`
    : '';

  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block"></span>
        <strong style="font-size:12px;color:#18181b">${node.label}</strong>
        <span style="font-size:10px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.04em">${kind}</span>
        ${badge}
      </div>
      ${dateLine}
      <p style="margin:0;font-size:11px;line-height:1.45;color:#52525b">${desc}</p>
      <div id="lg-usage" style="margin-top:6px;font-size:11px;color:#71717a"></div>
      ${linksHtml}
    </div>`;
}

export default function LineageGraph({
  nodes: allNodes,
  links: allLinks,
  expanded,
  onToggle,
  rootId,
  layout,
  imageUrl,
  imageDimensions,
  showLinkLabels = false,
  className,
}: {
  nodes: LineageNode[];
  links: LineageLink[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  rootId: string;
  layout: LayoutMode;
  imageUrl?: string | null;
  imageDimensions?: { w: number; h: number };
  showLinkLabels?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const zoomRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const hasFittedRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  const index = useMemo(() => buildIndex(allNodes, allLinks), [allNodes, allLinks]);

  // Label + direction of every link, for the popup's "how used" line.
  const linkPhrase = useCallback(
    (nodeId: string): string[] => {
      const out: string[] = [];
      for (const l of allLinks) {
        const phrase = RELATIONSHIP_PHRASING[l.label] ?? l.label;
        if (l.source === nodeId) {
          const other = index.nodeById.get(l.target);
          if (other) {
            if (l.label === 'requires') out.push(`This render uses <strong>${other.label}</strong>.`);
            else out.push(`This ${phrase} <strong>${other.label}</strong>.`);
          }
        } else if (l.target === nodeId) {
          const other = index.nodeById.get(l.source);
          if (other) {
            if (l.label === 'requires') out.push(`<strong>Used directly to generate this image.</strong>`);
            else out.push(`<strong>${other.label}</strong> ${phrase} this.`);
          }
        }
      }
      return [...new Set(out)].slice(0, 4);
    },
    [allLinks, index]
  );

  const draw = useCallback(
    (width: number, height: number) => {
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const svg = d3.select(svgEl);
      svg.selectAll('*').remove();
      if (!width || !height) return;

      // Closure vars populated inside the timeline block; zoom handler reads them.
      let yearXByYear = new Map<number, number>();
      let yearStripLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

      const zoomBounds = () => {
        // Before the initial fit: keep nodes within the original frame so the
        // fit has a clean, stable bounding box to work from.
        // After the fit: allow nodes to flow into the zoom-visible area so
        // panning/zooming reveals more of the graph.
        if (!hasFittedRef.current) return { w: width, h: height, minX: 0, minY: 0 };
        const t = zoomRef.current;
        return { w: width / t.k, h: height / t.k, minX: -t.x / t.k, minY: -t.y / t.k };
      };

      const visible = computeVisible(index, expanded, rootId);
      const depth = depthsFrom(index, visible, rootId);
      const maxDepth = Math.max(1, ...depth.values());

      // ── Layout target positions ──────────────────────────────────────────
      const marginR = 90;
      const marginL = 70;
      const colGap =
        layout === 'force' || layout === 'timeline'
          ? 0
          : (width - marginL - marginR) / maxDepth;
      const colX = (d: number) => width - marginR - d * colGap;

      const bandOrder = new Map(GRAPH_TYPES.map((t, i) => [t, i]));
      const bandGap = (height - 80) / GRAPH_TYPES.length;
      const bandY = (t: string) => 50 + (bandOrder.get(t) ?? 0) * bandGap + bandGap / 2;

      // ── Timeline variables (computed always, used when layout==='timeline') ──
      const yearOf = (id: string) => index.nodeById.get(id)?.year ?? 2020;
      const visYears = [...visible].filter((id) => id !== rootId).map(yearOf);

      // Density-based x mapping: years with more nodes get proportionally more space.
      const yearCounts = new Map<number, number>();
      for (const id of visible) {
        if (id === rootId) continue;
        const yr = yearOf(id);
        yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + 1);
      }
      const uniqueYearsSorted = [...new Set(visYears)].sort((a, b) => a - b);
      const MIN_SLICE = 1.5;
      const totalYearWeight = uniqueYearsSorted.reduce(
        (s, yr) => s + Math.max(MIN_SLICE, yearCounts.get(yr) ?? 0),
        0
      );
      const availTimeW = width - marginL - marginR - 80;
      let cumYearW = 0;
      for (const yr of uniqueYearsSorted) {
        yearXByYear.set(yr, marginL + (cumYearW / Math.max(1, totalYearWeight)) * availTimeW);
        cumYearW += Math.max(MIN_SLICE, yearCounts.get(yr) ?? 0);
      }
      const timeX = (year: number) => yearXByYear.get(year) ?? marginL;

      const nodes: SimNode[] = [...visible].map((id) => {
        const base = index.nodeById.get(id)!;
        const prev = posRef.current.get(id);
        const seedX =
          prev?.x ??
          (layout === 'force'
            ? width / 2
            : layout === 'timeline'
            ? id === rootId
              ? width - marginR
              : timeX(yearOf(id))
            : colX(depth.get(id) ?? 1));
        const seedY = prev?.y ?? (layout === 'layers' ? bandY(base.type) : height / 2);
        return { ...base, x: seedX, y: seedY };
      });

      const links: SimLink[] = allLinks
        .filter((l) => visible.has(l.source) && visible.has(l.target))
        .map((l) => ({ source: l.source, target: l.target, label: l.label, verified: l.verified }));

      const degree = (id: string) => index.neighbours.get(id)?.size ?? 0;

      // Direct (non-root) neighbours of the root get a slightly larger radius.
      const immediateNeighborIds = new Set(
        [...(index.neighbours.get(rootId) ?? [])].filter(
          (id) => index.nodeById.get(id)?.type !== 'root'
        )
      );

      // ── Image root dimensions (aspect-ratio-correct rect) ────────────────
      let imageRootW = 80;
      let imageRootH = 80;
      if (imageDimensions) {
        const { w, h } = imageDimensions;
        const scale = ROOT_MAX_SIZE / Math.max(w, h);
        imageRootW = Math.round(w * scale);
        imageRootH = Math.round(h * scale);
      }
      const rootEffR = Math.max(imageRootW, imageRootH) / 2 + 4;

      const rootHasImage = (d: SimNode) => d.type === 'root' && !!imageUrl;

      const radius = (d: SimNode): number => {
        if (d.type === 'root') return rootHasImage(d) ? rootEffR : ROOT_R;
        if (immediateNeighborIds.has(d.id)) return 15;
        return 9 + Math.min(6, degree(d.id));
      };

      // ── SVG scaffold ──────────────────────────────────────────────────────
      const defs = svg.append('defs');
      defs.append('filter').attr('id', 'cluster-blur').append('feGaussianBlur').attr('stdDeviation', 10);
      if (imageUrl) {
        defs
          .append('clipPath')
          .attr('id', 'root-clip')
          .append('rect')
          .attr('x', -imageRootW / 2)
          .attr('y', -imageRootH / 2)
          .attr('width', imageRootW)
          .attr('height', imageRootH)
          .attr('rx', 3);
      }

      const root = svg.append('g');
      const hullLayer = root.append('g');
      const linkLayer = root.append('g');
      const nodeLayer = root.append('g');


      // simRef lets the zoom handler kick the sim without requiring sim to be
      // defined before zoom is set up.
      let simRef: d3.Simulation<SimNode, SimLink> | null = null;

      let isFitting = false;
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (e) => {
          zoomRef.current = e.transform;
          root.attr('transform', e.transform.toString());
          // Always kick the sim so nodes re-settle into any newly revealed space.
          if (simRef && !isFitting) simRef.alpha(Math.max(simRef.alpha(), 0.15)).restart();
          // Reposition year strip labels to stay fixed at top of frame.
          if (yearStripLayer) {
            yearStripLayer.selectAll<SVGTextElement, number>('text')
              .attr('x', (yr) => e.transform.x + (yearXByYear.get(yr) ?? 0) * e.transform.k)
              .attr('visibility', (yr) => {
                const sx = e.transform.x + (yearXByYear.get(yr) ?? 0) * e.transform.k;
                return sx >= 10 && sx <= width - 10 ? 'visible' : 'hidden';
              });
            yearStripLayer.selectAll<SVGLineElement, number>('line')
              .attr('x1', (yr) => e.transform.x + (yearXByYear.get(yr) ?? 0) * e.transform.k)
              .attr('x2', (yr) => e.transform.x + (yearXByYear.get(yr) ?? 0) * e.transform.k)
              .attr('visibility', (yr) => {
                const sx = e.transform.x + (yearXByYear.get(yr) ?? 0) * e.transform.k;
                return sx >= 10 && sx <= width - 10 ? 'visible' : 'hidden';
              });
          }
        });
      svg.call(zoom);
      svg.call(zoom.transform, zoomRef.current);
      root.attr('transform', zoomRef.current.toString());

      const clusters = findClusters(index, visible);
      const hull = hullLayer
        .selectAll('path')
        .data(clusters)
        .join('path')
        .attr('fill', (c) => TYPE_COLORS[index.nodeById.get(c[0])!.type])
        .attr('opacity', 0.08)
        .attr('filter', 'url(#cluster-blur)')
        .attr('pointer-events', 'none');

      const link = linkLayer
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', '#d4d4d8')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', (d) => (d.verified ? null : '3,3'));

      const linkLabel = showLinkLabels
        ? linkLayer
            .append('g')
            .selectAll('text')
            .data(links)
            .join('text')
            .text((d) => d.label)
            .attr('font-size', 8)
            .attr('fill', '#a1a1aa')
            .attr('text-anchor', 'middle')
        : null;

      // ── Hide timer for popup hover-stay ───────────────────────────────────
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      function scheduleHide() {
        hideTimer = setTimeout(() => {
          selectedRef.current = null;
          updatePopup();
        }, 100);
      }

      function cancelHide() {
        if (hideTimer !== null) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      }

      const node = nodeLayer
        .selectAll<SVGGElement, SimNode>('g')
        .data(nodes, (d) => d.id)
        .join('g')
        .attr('cursor', 'pointer')
        .on('click', (event, d) => {
          event.stopPropagation();
          scheduleHide();
          onToggleRef.current(d.id);
        })
        .on('mouseenter', (_event, d) => {
          cancelHide();
          selectedRef.current = d.id;
          updatePopup();
        })
        .on('mouseleave', () => {
          scheduleHide();
        });

      // Halo marks a node with something left to reveal.
      node
        .filter((d) => hasHidden(index, d.id, visible, rootId))
        .append('circle')
        .attr('r', (d) => radius(d) + 4)
        .attr('fill', 'none')
        .attr('stroke', (d) => TYPE_COLORS[d.type])
        .attr('stroke-width', 1)
        .attr('opacity', 0.3);

      // ── Node bodies ───────────────────────────────────────────────────────

      // Standard nodes (no image, no photo).
      node
        .filter((d) => !rootHasImage(d) && !d.photoUrl)
        .append('circle')
        .attr('r', radius)
        .attr('fill', (d) => (d.verified === false ? '#fff' : TYPE_COLORS[d.type]))
        .attr('stroke', (d) => TYPE_COLORS[d.type])
        .attr('stroke-width', (d) => (d.type === 'root' ? 2 : 1.5))
        .attr('stroke-dasharray', (d) => (d.verified === false ? '3,2' : null));

      // Root with dropped image: rect clip, actual aspect ratio, no ring circle.
      const rootWithImg = node.filter((d) => rootHasImage(d));
      rootWithImg
        .append('image')
        .attr('href', imageUrl!)
        .attr('x', -imageRootW / 2)
        .attr('y', -imageRootH / 2)
        .attr('width', imageRootW)
        .attr('height', imageRootH)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', 'url(#root-clip)')
        .attr('pointer-events', 'none');
      rootWithImg
        .append('rect')
        .attr('x', -imageRootW / 2)
        .attr('y', -imageRootH / 2)
        .attr('width', imageRootW)
        .attr('height', imageRootH)
        .attr('rx', 3)
        .attr('fill', 'none')
        .attr('pointer-events', 'all')
        .attr('stroke', TYPE_COLORS.root)
        .attr('stroke-width', 2);

      // Nodes with a photo (person/org): circular crop with coloured ring.
      const photoNodes = node.filter((d) => !rootHasImage(d) && !!d.photoUrl);
      photoNodes.each(function (d) {
        const g = d3.select(this);
        const r = radius(d);
        const clipId = `photo-clip-${d.id.replace(/[^a-z0-9]/gi, '_')}`;
        defs
          .append('clipPath')
          .attr('id', clipId)
          .append('circle')
          .attr('r', r);
        // White backing so transparent areas of the photo look clean.
        g.append('circle').attr('r', r).attr('fill', '#fff');
        g.append('image')
          .attr('href', d.photoUrl!)
          .attr('x', -r)
          .attr('y', -r)
          .attr('width', r * 2)
          .attr('height', r * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`)
          .attr('pointer-events', 'none');
        // Coloured ring on top to keep category colour visible.
        g.append('circle')
          .attr('r', r)
          .attr('fill', 'none')
          .attr('stroke', TYPE_COLORS[d.type])
          .attr('stroke-width', 2);
      });

      // Type icon (skip root-with-image and photo nodes).
      node
        .filter((d) => !rootHasImage(d) && !d.photoUrl && !!TYPE_ICONS[d.type])
        .append('path')
        .attr('d', (d) => TYPE_ICONS[d.type])
        .attr('transform', (d) => {
          const s = iconScale(radius(d));
          return `translate(${-12 * s},${-12 * s}) scale(${s})`;
        })
        .attr('fill', 'none')
        .attr('stroke', (d) =>
          d.type === 'root' ? '#fff' : d.verified === false ? TYPE_COLORS[d.type] : '#fff'
        )
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('pointer-events', 'none');

      node
        .append('text')
        .text((d) => d.label)
        .attr('x', (d) => radius(d) + 5)
        .attr('y', 3)
        .attr('font-size', 10)
        .attr('fill', '#3f3f46')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#fff')
        .attr('stroke-width', 3)
        .attr('pointer-events', 'none');

      // ── Popup (lives on SVG directly so it's in viewport space, not zoom space) ──
      const CARD_W = 224;
      const CARD_H = 220;
      const popup = svg
        .append('foreignObject')
        .attr('width', CARD_W + 16)
        .attr('height', CARD_H * 2)
        .style('overflow', 'visible')
        .style('pointer-events', 'none')
        .style('display', 'none');
      const popupBody = popup
        .append('xhtml:div')
        .style('background', '#fff')
        .style('border', '1px solid #e4e4e7')
        .style('border-radius', '4px')
        .style('box-shadow', '0 4px 16px rgba(0,0,0,.10)')
        .style('padding', '10px 12px')
        .style('width', `${CARD_W}px`)
        .style('pointer-events', 'all')
        .style('cursor', 'default')
        .on('mouseenter', cancelHide)
        .on('mouseleave', scheduleHide);

      function updatePopup() {
        const id = selectedRef.current;
        const n = id ? nodes.find((x) => x.id === id) : null;
        if (!id || !n) {
          popup.style('display', 'none');
          return;
        }
        const meta = index.nodeById.get(id)!;
        popupBody.html(popupHtml(meta));
        const usage = linkPhrase(id);
        const usageEl = popupBody.select<HTMLDivElement>('#lg-usage');
        usageEl.html(
          usage.length
            ? `<span style="text-transform:uppercase;letter-spacing:.04em;font-size:9px;color:#a1a1aa">In this render</span><br>${usage.join('<br>')}`
            : ''
        );
        popup.style('display', null);

        // Measure actual rendered card height (popup must be visible first)
        const cardEl = popupBody.node() as HTMLElement | null;
        const actualH = cardEl ? (cardEl.offsetHeight || CARD_H) : CARD_H;

        // Convert node position (simulation space) → screen space via zoom transform
        const t = zoomRef.current;
        const sX = t.x + (n.x ?? 0) * t.k;  // node center x in screen px
        const sY = t.y + (n.y ?? 0) * t.k;  // node center y in screen px
        const sR = radius(n) * t.k;           // node radius in screen px
        const GAP = 10;

        // Horizontal: center card on node, shift left if it would overflow right edge
        const defaultX = sX - CARD_W / 2;
        const nearRight = defaultX + CARD_W > width - 4;
        let x: number, y: number;
        if (nearRight) {
          // Place to the left of the node
          x = Math.max(4, sX - sR - GAP - CARD_W);
          y = Math.max(4, Math.min(height - actualH - 4, sY - actualH / 2));
        } else {
          x = Math.max(4, Math.min(width - CARD_W - 4, defaultX));
          const below = sY + sR + GAP;
          y = below + actualH > height - 4 ? Math.max(4, sY - sR - GAP - actualH) : below;
        }
        popup.attr('x', x).attr('y', y);
      }

      // ── Link distance / strength (root links treated differently) ─────────
      const span = Math.sqrt(width * height);
      const normalLinkDistance =
        layout === 'force'
          ? Math.max(60, Math.min(150, span / 8))
          : layout === 'timeline'
          ? 80
          : colGap * 0.9;
      const normalLinkStrength = layout === 'force' ? 0.45 : 0.15;

      const linkDistance = (l: SimLink) => {
        const src = l.source as SimNode;
        const tgt = l.target as SimNode;
        return src.type === 'root' || tgt.type === 'root' ? 55 : normalLinkDistance;
      };
      const linkStrength = (l: SimLink) => {
        const src = l.source as SimNode;
        const tgt = l.target as SimNode;
        return src.type === 'root' || tgt.type === 'root' ? 0.6 : normalLinkStrength;
      };

      // ── Forces per layout ─────────────────────────────────────────────────
      const sim = d3
        .forceSimulation<SimNode, SimLink>(nodes)
        .velocityDecay(0.45)
        .alphaDecay(0.03)
        .alpha(0.7);
      simRef = sim;

      if (layout === 'force') {
        sim
          .force(
            'link',
            d3
              .forceLink<SimNode, SimLink>(links)
              .id((d) => d.id)
              .distance(linkDistance)
              .strength(linkStrength)
          )
          .force('charge', d3.forceManyBody().strength(-Math.max(320, (width * height) / 2200)))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force(
            'collide',
            d3
              .forceCollide<SimNode>()
              .radius((d) => radius(d) + 14 + Math.min(46, d.label.length * 1.5))
          )
          .force('bounds', boundsForce(zoomBounds, radius));
      } else if (layout === 'timeline') {
        sim
          .force(
            'link',
            d3
              .forceLink<SimNode, SimLink>(links)
              .id((d) => d.id)
              .distance(linkDistance)
              .strength(linkStrength)
          )
          .force(
            'x',
            d3
              .forceX<SimNode>((d) =>
                d.type === 'root' ? width - marginR : timeX(yearOf(d.id))
              )
              .strength(0.85)
          )
          .force(
            'y',
            d3
              .forceY<SimNode>((d) =>
                d.type === 'root' ? height / 2 : bandY(d.type)
              )
              .strength(0.25)
          )
          .force('charge', d3.forceManyBody().strength(-200))
          .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 12))
          .force('bounds', boundsForce(zoomBounds, radius));

        // Fixed year strip: appended to the SVG (outside root) so it stays at
        // the top of the frame regardless of pan/zoom. The zoom handler updates
        // each label's x position so they spread/compress with the graph.
        yearStripLayer = svg.append('g');
        yearStripLayer.append('rect')
          .attr('x', 0).attr('y', 0)
          .attr('width', width).attr('height', 22)
          .attr('fill', 'rgba(255,255,255,0.88)');
        for (const yr of uniqueYearsSorted) {
          const svgX = yearXByYear.get(yr) ?? 0;
          const initScreenX = zoomRef.current.x + svgX * zoomRef.current.k;
          const visible = initScreenX >= 10 && initScreenX <= width - 10;
          yearStripLayer.append('line')
            .datum(yr)
            .attr('x1', initScreenX).attr('y1', 6)
            .attr('x2', initScreenX).attr('y2', 14)
            .attr('stroke', '#d4d4d8').attr('stroke-width', 0.5)
            .attr('visibility', visible ? 'visible' : 'hidden');
          yearStripLayer.append('text')
            .datum(yr)
            .attr('x', initScreenX).attr('y', 12)
            .attr('text-anchor', 'middle')
            .attr('font-size', 9).attr('fill', '#a1a1aa')
            .attr('visibility', visible ? 'visible' : 'hidden')
            .text(String(yr));
        }
      } else {
        // flow + layers both pin x by depth (root on the right). layers also
        // pins y to a per-type band; flow lets y settle with a gentle centre.
        sim
          .force(
            'link',
            d3
              .forceLink<SimNode, SimLink>(links)
              .id((d) => d.id)
              .distance(linkDistance)
              .strength(linkStrength)
          )
          .force('x', d3.forceX<SimNode>((d) => colX(depth.get(d.id) ?? 1)).strength(0.9))
          .force(
            'y',
            layout === 'layers'
              ? d3
                  .forceY<SimNode>((d) => (d.type === 'root' ? height / 2 : bandY(d.type)))
                  .strength(0.9)
              : d3.forceY<SimNode>(height / 2).strength(0.06)
          )
          .force('charge', d3.forceManyBody().strength(layout === 'layers' ? -120 : -220))
          .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 10))
          .force('bounds', boundsForce(zoomBounds, radius));
      }

      // Anchor the render on the right in directed layouts.
      const rootNode = nodes.find((n) => n.id === rootId);
      if (rootNode && layout !== 'force') {
        rootNode.fx = colX(0); // for timeline colGap=0, so colX(0) = width - marginR
        rootNode.fy = height / 2;
      }

      // Give the simulation a synchronous head-start so nodes have meaningful
      // spread positions even if the RAF-based loop is cancelled before its
      // first tick fires (e.g. React StrictMode double-mount cleanup).
      for (let i = 0; i < 30; i++) sim.tick();

      // Fit all nodes into view when the simulation first settles.
      // hasFittedRef persists across redraws caused by ResizeObserver so the
      // fit fires exactly once per data/layout change (hasFittedRef is reset in
      // the useEffect below when the draw callback reference changes).
      function fitToView() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
          const r = radius(n) + 4;
          minX = Math.min(minX, (n.x ?? 0) - r);
          maxX = Math.max(maxX, (n.x ?? 0) + r);
          minY = Math.min(minY, (n.y ?? 0) - r);
          maxY = Math.max(maxY, (n.y ?? 0) + r);
        }
        if (!isFinite(minX)) return;
        const pad = 24;
        const gW = maxX - minX + pad * 2;
        const gH = maxY - minY + pad * 2;
        const k = Math.min(width / gW, height / gH, 1);
        const tx = (width - (maxX + minX) * k) / 2;
        const ty = (height - (maxY + minY) * k) / 2;
        const t = d3.zoomIdentity.translate(tx, ty).scale(k);
        // Instant transform — no animation so ResizeObserver redraws can't
        // interrupt it, and the zoom handler fires synchronously.
        isFitting = true;
        svg.call(zoom.transform, t);
        isFitting = false;
        zoomRef.current = t;
      }

      sim.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as SimNode).x!)
          .attr('y1', (d) => (d.source as SimNode).y!)
          .attr('x2', (d) => (d.target as SimNode).x!)
          .attr('y2', (d) => (d.target as SimNode).y!);

        linkLabel
          ?.attr('x', (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
          .attr('y', (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2 - 3);

        node.attr('transform', (d) => `translate(${d.x},${d.y})`);

        hull.attr('d', (c) => {
          const pts = c.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as SimNode[];
          const hp = d3.polygonHull(pts.map((p) => [p.x!, p.y!] as [number, number]));
          if (!hp) return '';
          const cx = d3.mean(hp, (p) => p[0])!;
          const cy = d3.mean(hp, (p) => p[1])!;
          const grown = hp.map(([x, y]) => {
            const dx = x - cx;
            const dy = y - cy;
            const len = Math.hypot(dx, dy) || 1;
            return [x + (dx / len) * 34, y + (dy / len) * 34] as [number, number];
          });
          return `M${grown.map((p) => p.join(',')).join('L')}Z`;
        });

        for (const n of nodes) posRef.current.set(n.id, { x: n.x!, y: n.y! });
        updatePopup();
      });

      function doFit() {
        if (!hasFittedRef.current) {
          hasFittedRef.current = true;
          fitToView();
        }
      }
      sim.on('end', doFit);
      // Fallback: if the sim never fires 'end' (kept alive by user interaction),
      // fit after enough ticks to settle (~alphaDecay 0.03 × 215 ticks ≈ 4s).
      const fitTimer = setTimeout(doFit, 4000);

      updatePopup();

      node.call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.12).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            // Directed layouts keep the render pinned; everything else releases.
            if (!(d.id === rootId && layout !== 'force')) {
              d.fx = null;
              d.fy = null;
            }
          })
      );

      return () => { sim.stop(); clearTimeout(fitTimer); };
    },
    [index, allLinks, expanded, rootId, layout, imageUrl, imageDimensions, showLinkLabels, linkPhrase]
  );

  useEffect(() => {
    // Reset fit and zoom whenever data/layout changes so each new graph starts
    // from a clean slate (prevents stale zoom accumulating across HMR reloads
    // or layout switches).
    hasFittedRef.current = false;
    zoomRef.current = d3.zoomIdentity;

    const host = hostRef.current;
    if (!host) return;
    let stop: (() => void) | undefined;
    const render = () => {
      stop?.();
      const { width, height } = host.getBoundingClientRect();
      stop = draw(width, height);
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    return () => {
      ro.disconnect();
      stop?.();
    };
  }, [draw]);

  return (
    <div ref={hostRef} className={className}>
      <svg ref={svgRef} width="100%" height="100%" />
    </div>
  );
}
