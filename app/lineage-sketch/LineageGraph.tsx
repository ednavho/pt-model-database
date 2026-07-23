'use client';

import {
  NODE_DESCRIPTIONS,
  RELATIONSHIP_PHRASING,
  type LineageLink,
  type LineageNode,
} from '@/data/lineageData';
import * as d3 from 'd3';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type LayoutMode = 'force' | 'flow' | 'layers';

export const TYPE_COLORS: Record<string, string> = {
  root: '#18181b',
  model: '#a855f7',
  dataset: '#3b82f6',
  paper: '#10b981',
  org: '#f59e0b',
  person: '#ec4899',
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
 * Keeps every node inside the frame like a bumper car: a node reaching the
 * wall is stopped at it and its velocity reflected back inward. Pinned nodes
 * (dragged, or the anchored root) get clamped instead. Zoom is a separate
 * transform, so a viewer who wants more air just scrolls to zoom out.
 */
function boundsForce(
  getBounds: () => { w: number; h: number },
  radiusFn: (n: SimNode) => number
) {
  let nodes: SimNode[] = [];
  const force = () => {
    const { w, h } = getBounds();
    for (const n of nodes) {
      const r = radiusFn(n) + 2;
      if (n.fx == null) {
        if (n.x! < r) {
          n.x = r;
          if (n.vx! < 0) n.vx = -n.vx! * 0.5;
        } else if (n.x! > w - r) {
          n.x = w - r;
          if (n.vx! > 0) n.vx = -n.vx! * 0.5;
        }
      } else {
        n.fx = Math.max(r, Math.min(w - r, n.fx));
      }
      if (n.fy == null) {
        if (n.y! < r) {
          n.y = r;
          if (n.vy! < 0) n.vy = -n.vy! * 0.5;
        } else if (n.y! > h - r) {
          n.y = h - r;
          if (n.vy! > 0) n.vy = -n.vy! * 0.5;
        }
      } else {
        n.fy = Math.max(r, Math.min(h - r, n.fy));
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

  const badge = node.verified === false
    ? '<span style="margin-left:6px;font-size:10px;color:#b45309;border:1px dashed #f59e0b;border-radius:3px;padding:0 4px">unverified</span>'
    : '';
  const src = node.source
    ? `<a href="${node.source}" target="_blank" rel="noopener noreferrer" style="color:#3f3f46;text-decoration:underline;font-size:11px">source ↗</a>`
    : '';

  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block"></span>
        <strong style="font-size:12px;color:#18181b">${node.label}</strong>
        <span style="font-size:10px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.04em">${kind}</span>
        ${badge}
      </div>
      <p style="margin:0;font-size:11px;line-height:1.45;color:#52525b">${desc}</p>
      <div id="lg-usage" style="margin-top:6px;font-size:11px;color:#71717a"></div>
      ${src ? `<div style="margin-top:6px">${src}</div>` : ''}
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
  showLinkLabels?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const zoomRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
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

      const visible = computeVisible(index, expanded, rootId);
      const depth = depthsFrom(index, visible, rootId);
      const maxDepth = Math.max(1, ...depth.values());

      // ── Layout target positions ──────────────────────────────────────────
      const marginR = 90;
      const marginL = 70;
      const colGap = layout === 'force' ? 0 : (width - marginL - marginR) / maxDepth;
      const colX = (d: number) => width - marginR - d * colGap;

      const bandOrder = new Map(GRAPH_TYPES.map((t, i) => [t, i]));
      const bandGap = (height - 80) / GRAPH_TYPES.length;
      const bandY = (t: string) => 50 + (bandOrder.get(t) ?? 0) * bandGap + bandGap / 2;

      const nodes: SimNode[] = [...visible].map((id) => {
        const base = index.nodeById.get(id)!;
        const prev = posRef.current.get(id);
        const seedX = prev?.x ?? (layout === 'force' ? width / 2 : colX(depth.get(id) ?? 1));
        const seedY = prev?.y ?? (layout === 'layers' ? bandY(base.type) : height / 2);
        return { ...base, x: seedX, y: seedY };
      });

      const links: SimLink[] = allLinks
        .filter((l) => visible.has(l.source) && visible.has(l.target))
        .map((l) => ({ source: l.source, target: l.target, label: l.label, verified: l.verified }));

      const ROOT_R = 30;
      const degree = (id: string) => index.neighbours.get(id)?.size ?? 0;
      const radius = (d: SimNode) => (d.type === 'root' ? ROOT_R : 9 + Math.min(6, degree(d.id)));

      // ── SVG scaffold ──────────────────────────────────────────────────────
      const defs = svg.append('defs');
      defs
        .append('filter')
        .attr('id', 'cluster-blur')
        .append('feGaussianBlur')
        .attr('stdDeviation', 10);
      if (imageUrl) {
        defs
          .append('clipPath')
          .attr('id', 'root-clip')
          .append('circle')
          .attr('r', ROOT_R);
      }

      const root = svg.append('g');
      const hullLayer = root.append('g');
      const linkLayer = root.append('g');
      const nodeLayer = root.append('g');

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (e) => {
          zoomRef.current = e.transform;
          root.attr('transform', e.transform.toString());
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

      const node = nodeLayer
        .selectAll<SVGGElement, SimNode>('g')
        .data(nodes, (d) => d.id)
        .join('g')
        .attr('cursor', 'pointer')
        // Click expands/collapses; the description card is hover-only so it
        // never lingers or needs a second click to dismiss.
        .on('click', (event, d) => {
          event.stopPropagation();
          onToggleRef.current(d.id);
        })
        .on('mouseenter', (_event, d) => {
          selectedRef.current = d.id;
          updatePopup();
        })
        .on('mouseleave', () => {
          selectedRef.current = null;
          updatePopup();
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

      const rootHasImage = (d: SimNode) => d.type === 'root' && !!imageUrl;

      // Node body. Verified → solid fill + white icon. Unverified → white fill,
      // dashed coloured stroke, coloured icon. Root-with-image gets the actual
      // render clipped to a circle, with a ring drawn over it.
      node
        .filter((d) => !rootHasImage(d))
        .append('circle')
        .attr('r', radius)
        .attr('fill', (d) => (d.verified === false ? '#fff' : TYPE_COLORS[d.type]))
        .attr('stroke', (d) => TYPE_COLORS[d.type])
        .attr('stroke-width', (d) => (d.type === 'root' ? 2 : 1.5))
        .attr('stroke-dasharray', (d) => (d.verified === false ? '3,2' : null));

      const rootWithImg = node.filter((d) => rootHasImage(d));
      rootWithImg
        .append('image')
        .attr('href', imageUrl!)
        .attr('x', -ROOT_R)
        .attr('y', -ROOT_R)
        .attr('width', ROOT_R * 2)
        .attr('height', ROOT_R * 2)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', 'url(#root-clip)')
        .attr('pointer-events', 'none');
      rootWithImg
        .append('circle')
        .attr('r', ROOT_R)
        .attr('fill', 'none')
        .attr('stroke', TYPE_COLORS.root)
        .attr('stroke-width', 2.5);

      // Type icon (skip root when it shows an image).
      node
        .filter((d) => !rootHasImage(d) && !!TYPE_ICONS[d.type])
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

      // ── Popup (foreignObject rides along with pan/zoom & ticks) ───────────
      const CARD_W = 224;
      const CARD_H = 150;
      const popup = root
        .append('foreignObject')
        .attr('width', CARD_W + 16)
        .attr('height', CARD_H)
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
        .style('width', `${CARD_W}px`);

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

        // Sit under the node, nudged to whichever side keeps it in frame; flip
        // above when there's no room below.
        const nx = n.x ?? 0;
        const ny = n.y ?? 0;
        const x = Math.max(4, Math.min(width - CARD_W - 4, nx - CARD_W / 2));
        const below = ny + radius(n) + 10;
        const y = below + CARD_H > height ? ny - radius(n) - 10 - CARD_H : below;
        popup.attr('x', x).attr('y', y);
      }

      // ── Forces per layout ─────────────────────────────────────────────────
      const span = Math.sqrt(width * height);
      const sim = d3.forceSimulation(nodes).velocityDecay(0.35).alphaDecay(0.028);

      if (layout === 'force') {
        sim
          .force(
            'link',
            d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(Math.max(60, Math.min(150, span / 8))).strength(0.45)
          )
          .force('charge', d3.forceManyBody().strength(-Math.max(320, (width * height) / 2200)))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 14 + Math.min(46, d.label.length * 1.5)))
          .force('bounds', boundsForce(() => ({ w: width, h: height }), radius));
      } else {
        // flow + layers both pin x by depth (root on the right). layers also
        // pins y to a per-type band; flow lets y settle with a gentle centre.
        sim
          .force('link', d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(colGap * 0.9).strength(0.15))
          .force('x', d3.forceX<SimNode>((d) => colX(depth.get(d.id) ?? 1)).strength(0.9))
          .force(
            'y',
            layout === 'layers'
              ? d3.forceY<SimNode>((d) => (d.type === 'root' ? height / 2 : bandY(d.type))).strength(0.9)
              : d3.forceY<SimNode>(height / 2).strength(0.06)
          )
          .force('charge', d3.forceManyBody().strength(layout === 'layers' ? -120 : -220))
          .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 10))
          .force('bounds', boundsForce(() => ({ w: width, h: height }), radius));
      }

      // Anchor the render on the right in the directed layouts.
      const rootNode = nodes.find((n) => n.id === rootId);
      if (rootNode && layout !== 'force') {
        rootNode.fx = colX(0);
        rootNode.fy = height / 2;
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

      updatePopup();

      node.call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.25).restart();
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

      return () => sim.stop();
    },
    [index, allLinks, expanded, rootId, layout, imageUrl, showLinkLabels, linkPhrase]
  );

  useEffect(() => {
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
