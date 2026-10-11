import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dictionary, RELATION_FILTERS, type RelationFilter } from './dictionary.js';
import type { PartOfSpeech } from '../src/types.js';

const queryText = { type: 'string', minLength: 1, maxLength: 100 } as const;
const relationSchema = { type: 'string', enum: [...RELATION_FILTERS] } as const;
export async function createApp(dbPath: string, options: { staticDir?: string; logger?: boolean } = {}) {
  const dictionary = new Dictionary(dbPath);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 4096, requestTimeout: 15000 });
  app.addHook('onClose', async () => dictionary.close());
  // The plugin installs an onRoute hook. It must finish before routes are declared.
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    return payload;
  });
  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ status: 'ok', dictionary: true }));
  app.get('/api/stats', async (_request, reply) => { reply.header('Cache-Control', 'public, max-age=86400'); return dictionary.stats; });
  app.get<{ Querystring: { q: string; limit?: number } }>('/api/suggest', {
    schema: { querystring: { type: 'object', required: ['q'], additionalProperties: false, properties: { q: queryText, limit: { type: 'integer', minimum: 1, maximum: 12, default: 8 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return { suggestions: dictionary.suggestions(request.query.q, request.query.limit) };
  });
  app.get<{ Querystring: { word: string; pos?: string; relations?: RelationFilter; senses?: number } }>('/api/lookup', {
    schema: { querystring: { type: 'object', required: ['word'], additionalProperties: false, properties: {
      word: queryText, pos: { type: 'string', pattern: '^(noun|verb|adjective|adverb)(,(noun|verb|adjective|adverb))*$' },
      relations: relationSchema, senses: { type: 'integer', minimum: 1, maximum: 32, default: 8 },
    } } },
  }, async (request, reply) => {
    const { word, pos, relations, senses } = request.query;
    const result = dictionary.lookup(word, { pos: pos?.split(',') as PartOfSpeech[] | undefined, relations, senseLimit: senses });
    if (!result) return reply.code(404).send({ error: 'WORD_NOT_FOUND', message: `No entry for “${word}”.`, suggestions: dictionary.suggestions(word) });
    reply.header('Cache-Control', 'public, max-age=3600');
    return result;
  });
  app.get<{ Params: { id: number }; Querystring: { relations?: RelationFilter } }>('/api/meanings/:id/expand', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } } }, querystring: { type: 'object', additionalProperties: false, properties: { relations: relationSchema } } },
  }, async (request, reply) => {
    const result = dictionary.expand(request.params.id, request.query.relations);
    if (!result) return reply.code(404).send({ error: 'MEANING_NOT_FOUND', message: 'This meaning was not found.' });
    reply.header('Cache-Control', 'public, max-age=3600');
    return result;
  });
  if (options.staticDir && existsSync(options.staticDir)) {
    app.register(fastifyStatic, { root: resolve(options.staticDir), prefix: '/', maxAge: '1h',
      setHeaders(reply, path) { if (path.endsWith('/index.html')) reply.header('Cache-Control', 'no-cache'); },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND' });
      if (request.method !== 'GET' || new URL(request.url, 'http://localhost').pathname.includes('.')) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
