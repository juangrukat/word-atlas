import { resolve } from 'node:path';
import { createApp } from './app.js';
const app = await createApp(resolve(process.env.DICTIONARY_PATH ?? 'data/dictionary.sqlite'), { staticDir: resolve('dist'), logger: true });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => { await app.close(); process.exit(0); });
