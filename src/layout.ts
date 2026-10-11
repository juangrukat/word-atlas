import type { GraphNode } from './types.js';

export interface Point { x: number; y: number; }
interface LabelBox {
  x?: number; y?: number; width: number; height: number;
  fx?: number | null; fy?: number | null;
}
/** Project settled positions out of label collisions; springs alone can balance while overlapping. */
export function separateLabels(nodes: LabelBox[]): void {
  const placed = nodes.filter(n => n.fx != null && n.fy != null);
  const movable = nodes.filter(n => !placed.includes(n)).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  for (const node of movable) {
    const vertical = node.fy == null;
    const position = vertical ? node.y ?? 0 : node.x ?? 0;
    const neighbors = placed.filter(other => vertical
      ? Math.abs((node.x ?? 0) - (other.x ?? 0)) < (node.width + other.width) / 2 + 4
      : Math.abs((node.y ?? 0) - (other.y ?? 0)) < (node.height + other.height) / 2 + 4);
    const half = (other: LabelBox) => ((vertical ? node.height + other.height : node.width + other.width) / 2) + 4;
    const coordinate = (other: LabelBox) => vertical ? other.y ?? 0 : other.x ?? 0;
    const free = (candidate: number) => neighbors.every(other => Math.abs(candidate - coordinate(other)) >= half(other) - 0.01);
    if (!free(position)) {
      // Boundary candidates guarantee a free slot without oscillating pairwise corrections.
      const candidates = neighbors.flatMap(other => [coordinate(other) - half(other) - 0.1, coordinate(other) + half(other) + 0.1]);
      candidates.sort((a, b) => Math.abs(a - position) - Math.abs(b - position));
      const destination = candidates.find(free);
      if (destination !== undefined) { if (vertical) node.y = destination; else node.x = destination; }
    }
    placed.push(node);
  }
}
/** Shell placement: each related meaning gets its own branch and synonym cluster. */
export function meaningAnchors(nodes: GraphNode[]): { anchors: Map<number, Point>; radius: number } {
  const primary = nodes.filter(n => n.kind === 'meaning' && !n.related);
  const radius = primary.length <= 1 ? 90 : primary.length <= 8 ? 125 : 220;
  const anchors = new Map<number, Point>();
  for (const [i, n] of primary.entries()) {
    const angle = i * Math.PI * 2 / primary.length - Math.PI / 2;
    anchors.set(n.senseId!, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  const branches = new Map<number, GraphNode[]>();
  for (const n of nodes.filter(n => n.kind === 'meaning' && n.related)) {
    const siblings = branches.get(n.group ?? 0) ?? [];
    siblings.push(n); branches.set(n.group ?? 0, siblings);
  }
  for (const [parentId, children] of branches) {
    const parent = anchors.get(parentId) ?? { x: 0, y: 0 };
    const outward = Math.atan2(parent.y, parent.x);
    for (const [i, child] of children.entries()) {
      const angle = outward + (children.length <= 1 ? 0 : (i / (children.length - 1) - 0.5) * Math.PI * 1.25);
      const distance = 180 + Math.floor(i / 6) * 80;
      anchors.set(child.senseId!, { x: parent.x + Math.cos(angle) * distance, y: parent.y + Math.sin(angle) * distance });
    }
  }
  return { anchors, radius };
}
