import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meaningAnchors, separateLabels } from '../src/layout.js';
import { readFileSync } from 'node:fs';
import type { GraphNode } from '../src/types.js';
test('expanded meanings receive distinct anchors for their own synonym clusters', () => {
  const nodes: GraphNode[] = [
    { id: 's:1', kind: 'meaning', label: 'parent', senseId: 1, group: 1 },
    { id: 's:2', kind: 'meaning', label: 'child', senseId: 2, group: 1, related: true },
    { id: 's:3', kind: 'meaning', label: 'child two', senseId: 3, group: 1, related: true },
    { id: 'w:1', kind: 'word', label: 'synonym', group: 2 },
  ];
  const { anchors } = meaningAnchors(nodes);
  assert.equal(anchors.size, 3);
  assert.notDeepEqual(anchors.get(1), anchors.get(2));
  assert.notDeepEqual(anchors.get(2), anchors.get(3));
  assert.ok(anchors.has(nodes[3].group!));
});
test('the captured 180-node break map has no overlapping word labels after projection', () => {
  const nodes = JSON.parse(readFileSync('tests/fixtures/dense-layout.json', 'utf8')) as Array<{ id: string; kind: string; x: number; y: number; width: number; height: number; fx?: number; fy?: number }>;
  const root = nodes.find(n => n.fx === 0 && n.fy === 0)!;
  const overlaps = () => {
    let count = 0;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.kind !== 'word' || b.kind !== 'word') continue;
      if ((a.width + b.width) / 2 - Math.abs(a.x - b.x) > 0.5 && (a.height + b.height) / 2 - Math.abs(a.y - b.y) > 0.5) count++;
    }
    return count;
  };
  assert.ok(overlaps() > 0, 'fixture must reproduce the observed failure');
  separateLabels(nodes);
  assert.equal(overlaps(), 0);
  assert.equal(root.x, 0); assert.equal(root.y, 0);
  assert.ok(nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});
