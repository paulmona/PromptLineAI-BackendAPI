import Fastify from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import fastifyStatic from '@fastify/static';
import env from './env.js';
import logger from './logger.js';
import { closeDatabase } from './db/index.js';
import { healthzRoutes } from './routes/healthz.js';
import { ingestRoutes } from './routes/ingest.js';
import { summaryRoutes } from './routes/summary.js';
import { meRoutes } from './routes/me.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger,
  disableRequestLogging: true, // We'll log manually for /ingest
  bodyLimit: 1_000_000, // 1MB basic anti-abuse limit for /ingest
});

// Register API routes first (exact matches take precedence)
await fastify.register(healthzRoutes);
await fastify.register(ingestRoutes);
await fastify.register(meRoutes);
await fastify.register(summaryRoutes);

// Public env (publishable only) for the static frontend
fastify.get('/env.js', async (_request, reply) => {
  reply.header('content-type', 'application/javascript; charset=utf-8');
  // Publishable key + hosted page URLs are safe to expose
  const payload = {
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY,
    CLERK_SIGN_IN_URL: env.CLERK_SIGN_IN_URL ?? null,
    CLERK_SIGN_UP_URL: env.CLERK_SIGN_UP_URL ?? null,
  };
  return `window.__ENV = ${JSON.stringify(payload)};\n`;
});

// Register static assets under /assets/ to avoid collisions with /:orgSlug
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/assets/',
  index: false,
});

const publicDir = path.join(__dirname, '../public');

// Landing page
fastify.get('/', async (_request, reply) => {
  const html = await readFile(path.join(publicDir, 'landing.html'), 'utf8');
  return reply.type('text/html; charset=utf-8').send(html);
});

// Backward-compatible legacy asset paths (temporary guardrail)
fastify.get('/dashboard.js', async (_request, reply) => reply.redirect(302, '/assets/dashboard.js'));
fastify.get('/dashboard.css', async (_request, reply) => reply.redirect(302, '/assets/dashboard.css'));

// Org dashboard route (register LAST)
fastify.get('/:orgSlug', async (_request, reply) => {
  const html = await readFile(path.join(publicDir, 'dashboard.html'), 'utf8');
  return reply.type('text/html; charset=utf-8').send(html);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');
  try {
    await fastify.close();
    await closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
try {
  logger.info({ port: env.PORT, host: '127.0.0.1' }, 'Starting server');
  await fastify.listen({ port: env.PORT, host: '127.0.0.1' });
  logger.info({ port: env.PORT, host: '127.0.0.1' }, 'Server started and listening');
} catch (err) {
  logger.error({ err, port: env.PORT, host: '127.0.0.1' }, 'Failed to start server');
  await closeDatabase();
  process.exit(1);
}
