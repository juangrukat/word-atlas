import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
const app = await createApp(resolve('data/dictionary.sqlite'), { staticDir: resolve('dist') });
after(async () => app.close());

test('health and real dictionary statistics are available', async () => {
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  const stats = await app.inject('/api/stats');
  assert.equal(stats.json().words, 148730);
});
test('the lookup API provides separate bank meanings and a valid graph', async () => {
  const response = await app.inject('/api/lookup?word=bank&relations=broader&senses=12');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().totalMeanings, 18);
  assert.equal(response.json().graph.nodes.filter((n: { root?: boolean }) => n.root).length, 1);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});
test('invalid query inputs are rejected before lookup', async () => {
  for (const url of ['/api/lookup', '/api/lookup?word=', '/api/lookup?word=bank&senses=1000', '/api/lookup?word=bank&pos=invalid', '/api/lookup?word=bank&relations=invalid', '/api/meanings/-1/expand', '/api/suggest?q=a&limit=99']) {
    assert.equal((await app.inject(url)).statusCode, 400, url);
  }
});
test('absent words and meanings return useful 404 responses', async () => {
  const response = await app.inject('/api/lookup?word=hapy');
  assert.equal(response.statusCode, 404);
  assert.ok(response.json().suggestions.some((w: { text: string }) => w.text === 'happy'));
  assert.equal((await app.inject('/api/meanings/2147483647/expand')).statusCode, 404);
});
test('SQL metacharacters cannot alter the dictionary', async () => {
  const word = "'; DROP TABLE words; --";
  assert.equal((await app.inject(`/api/lookup?word=${encodeURIComponent(word)}`)).statusCode, 404);
  assert.equal((await app.inject('/api/stats')).json().words, 148730);
});
test('API requests can never receive the SPA fallback', async () => {
  const response = await app.inject('/api/absent');
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
});
test('the application HTML revalidates so a deployment can update its asset references', async () => {
  const response = await app.inject('/');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-cache');
});
test('API bursts are limited while health checks and other clients remain available', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 125; i++) statuses.push((await app.inject({ method: 'GET', url: '/api/stats', remoteAddress: '203.0.113.9' })).statusCode);
  assert.equal(statuses.filter(status => status === 200).length, 120);
  assert.equal(statuses.filter(status => status === 429).length, 5);
  assert.equal((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '203.0.113.9' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/stats', remoteAddress: '203.0.113.10' })).statusCode, 200);
});
