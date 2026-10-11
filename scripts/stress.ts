import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/app.js';
import { RELATION_FILTERS } from '../server/dictionary.js';
import type { Graph, LookupResult, PartOfSpeech } from '../src/types.js';

const WORDS = ['run', 'set', 'light', 'right', 'spring', 'charge', 'pitch', 'draw', 'break', 'strike', 'match', 'lead', 'bat', 'bank', 'seal', 'bass', 'bark', 'club', 'pen', 'cut', 'play', 'make', 'hold', 'take'];
const PARTS: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb'];
const app = await createApp(resolve('data/dictionary.sqlite'));
await app.ready();
let calls = 0;
const checkGraph = (graph: Graph, bound = 180) => {
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.nodes.length, 'duplicate nodes');
  assert.ok(ids.size <= bound, 'node limit exceeded');
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length, 'duplicate edges');
  assert.ok(graph.edges.every(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target), 'invalid edge');
  const adjacent = new Map([...ids].map(id => [id, [] as string[]]));
  for (const e of graph.edges) { adjacent.get(e.source)!.push(e.target); adjacent.get(e.target)!.push(e.source); }
  const seed = graph.nodes.find(n => n.root)?.id ?? graph.nodes[0]?.id;
  const seen = new Set<string>();
  const pending = seed ? [seed] : [];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...adjacent.get(id)!); }
  assert.equal(seen.size, ids.size, 'disconnected graph');
};
async function request(url: string) {
  const start = performance.now();
  // Each request identity is isolated for correctness checks, retaining real limiter configuration.
  const n = ++calls;
  const response = await app.inject({ method: 'GET', url, remoteAddress: `10.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}` });
  assert.equal(response.statusCode, 200, `${url}: ${response.statusCode}`);
  return { data: response.json(), ms: performance.now() - start, bytes: Buffer.byteLength(response.body) };
}
const rows: object[] = [];
const serial: number[] = [];
const jobs: string[] = [];
const started = performance.now();
try {
  for (const word of WORDS) {
    const base = await request(`/api/lookup?word=${word}`);
    const value = base.data as LookupResult;
    checkGraph(value.graph);
    assert.equal(value.totalMeanings, value.meanings.length);
    assert.equal(new Set(value.meanings.map(m => m.id)).size, value.totalMeanings);
    assert.ok(value.meanings.every(m => m.definition.length && m.synonyms.includes(value.word.text)), `missing definition/membership: ${word}`);
    const counts = Object.fromEntries(PARTS.map(pos => [pos, value.meanings.filter(m => m.pos === pos).length]).filter(([, n]) => n));
    let maxNodes = value.graph.nodes.length, maxEdges = value.graph.edges.length, maxBytes = base.bytes;
    for (const filter of RELATION_FILTERS) {
      const url = `/api/lookup?word=${word}&relations=${filter}&senses=32`;
      const r = await request(url);
      const v = r.data as LookupResult;
      checkGraph(v.graph);
      assert.equal(v.totalMeanings, value.totalMeanings);
      maxNodes = Math.max(maxNodes, v.graph.nodes.length); maxEdges = Math.max(maxEdges, v.graph.edges.length); maxBytes = Math.max(maxBytes, r.bytes);
      serial.push(r.ms); jobs.push(url);
    }
    for (const pos of PARTS.filter(p => value.meanings.some(m => m.pos === p))) {
      const v = (await request(`/api/lookup?word=${word}&pos=${pos}&senses=32`)).data as LookupResult;
      checkGraph(v.graph);
      assert.equal(v.meanings.length, value.totalMeanings);
      assert.ok(v.graph.nodes.filter(n => n.kind === 'meaning').every(n => n.pos === pos));
      assert.equal(v.graph.nodes.filter(n => n.kind === 'meaning' && !n.related).length, Math.min(32, Number(counts[pos])));
    }
    // Include senses beyond the initial map and beyond the 32-sense map cap.
    for (const m of [value.meanings[0], value.meanings[Math.floor(value.meanings.length / 2)], value.meanings.at(-1)!]) {
      const v = (await request(`/api/meanings/${m.id}/expand?relations=all`)).data;
      checkGraph(v.graph);
      assert.equal(v.meaning.id, m.id);
      assert.equal(v.meaning.definition, m.definition);
    }
    rows.push({ word, meanings: value.totalMeanings, parts: counts, initialNodes: value.graph.nodes.length, maxNodes, maxEdges, largestResponseBytes: maxBytes });
  }
  const parallel: number[] = [];
  const loadStart = performance.now();
  const workload = Array.from({ length: 3 }, () => jobs).flat();
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < workload.length) {
      const url = workload[cursor++];
      const r = await request(url); checkGraph(r.data.graph); parallel.push(r.ms);
    }
  }));
  const loadMs = performance.now() - loadStart;
  const quantiles = (numbers: number[]) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
  };
  // Verify production protection without hammering the user's running preview.
  const statuses: Record<string, number> = {};
  for (let i = 0; i < 125; i++) {
    const response = await app.inject({ method: 'GET', url: '/api/lookup?word=run', remoteAddress: '192.0.2.99' });
    statuses[response.statusCode] = (statuses[response.statusCode] ?? 0) + 1;
  }
  assert.equal(statuses[200], 120); assert.equal(statuses[429], 5);
  const output = {
    words: rows,
    correctnessRequests: calls - workload.length,
    serialLookupLatencyMs: quantiles(serial),
    concurrent: { requests: workload.length, concurrency: 8, durationMs: loadMs, requestsPerSecond: workload.length / (loadMs / 1000), latencyMs: quantiles(parallel) },
    rateLimiter: statuses,
    totalDurationMs: performance.now() - started,
    processMemory: process.memoryUsage(),
    limits: 'In-process Fastify HTTP injection on one local Node process; not a Docker, remote-network, or sustained multi-host benchmark.',
  };
  writeFileSync('docs/stress-results.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally { await app.close(); }
