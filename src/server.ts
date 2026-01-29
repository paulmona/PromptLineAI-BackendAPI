import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import nunjucks from 'nunjucks';
import env from './env.js';
import logger from './logger.js';
import { closeDatabase } from './db/index.js';
import { healthzRoutes } from './routes/healthz.js';
import { ingestRoutes } from './routes/ingest.js';
import { summaryRoutes } from './routes/summary.js';
import { meRoutes } from './routes/me.js';
import { devicesRoutes } from './routes/devices.js';
import { policyRoutes } from './routes/policy.js';
import { adminRoutes } from './routes/admin.js';
import { requireClerkAuth, requireOrgAdmin } from './auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger,
  disableRequestLogging: true, // We'll log manually for /ingest
  bodyLimit: 1_000_000, // 1MB basic anti-abuse limit for /ingest
});

// CSP policy to allow Clerk.js scripts from FAPI URL (per Clerk.com documentation)
const CSP_POLICY = 
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://cdn.jsdelivr.net; " +
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com; " +
  "frame-src https://*.clerk.accounts.dev https://*.clerk.com; " +
  "worker-src 'self' blob:; " +
  "img-src 'self' data: https:; " +
  "style-src 'self' 'unsafe-inline' https:; " +
  "font-src 'self' data: https:;";

// Add CSP headers to all HTML responses
fastify.addHook('onSend', async (request, reply) => {
  const contentType = reply.getHeader('content-type');
  const url = request.url;
  // Apply CSP to HTML pages (landing, dashboard, and org routes)
  if ((typeof contentType === 'string' && contentType.includes('text/html')) || 
      url === '/' || 
      (url.startsWith('/') && !url.startsWith('/assets') && !url.startsWith('/env.js') && !url.startsWith('/healthz') && !url.startsWith('/ingest') && !url.startsWith('/me') && !url.startsWith('/summary'))) {
    reply.header('Content-Security-Policy', CSP_POLICY);
  }
});

// Register view engine (Nunjucks)
await fastify.register(fastifyView, {
  engine: {
    nunjucks: nunjucks,
  },
  root: path.join(__dirname, '../views'),
  viewExt: 'njk',
});

// Register API routes first (exact matches take precedence)
await fastify.register(healthzRoutes);
await fastify.register(ingestRoutes);
await fastify.register(meRoutes);
await fastify.register(summaryRoutes);
await fastify.register(devicesRoutes);
await fastify.register(policyRoutes);

// Register admin routes (BEFORE /:orgSlug to avoid route conflicts)
await fastify.register(adminRoutes);

// Public env (publishable only) for the static frontend
fastify.get('/env.js', async (_request, reply) => {
  reply.header('content-type', 'application/javascript; charset=utf-8');
  // Publishable key + hosted page URLs are safe to expose
  
  // Build Clerk.js URL using FAPI URL (per official Clerk.com documentation)
  // Format: https://{{fapi_url}}/npm/@clerk/clerk-js@5/dist/clerk.browser.js
  const clerkJsUrl =
    env.CLERK_JS_URL ??
    `${env.CLERK_FAPI_URL}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  
  const payload = {
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY,
    CLERK_SIGN_IN_URL: env.CLERK_SIGN_IN_URL ?? null,
    // CLERK_SIGN_UP_URL removed - app doesn't support sign-ups
    CLERK_FAPI_URL: env.CLERK_FAPI_URL,
    CLERK_JS_URL: clerkJsUrl,
  };
  return `window.__ENV = ${JSON.stringify(payload)};\n`;
});

// Register static assets under /assets/ to avoid collisions with /:orgSlug
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/assets/',
  index: false,
});

// Backward-compatible legacy asset paths (temporary guardrail)
fastify.get('/dashboard.js', async (_request, reply) => reply.redirect(302, '/assets/dashboard.js'));
fastify.get('/dashboard.css', async (_request, reply) => reply.redirect(302, '/assets/dashboard.css'));

// Helper to get common template context
const getTemplateContext = (overrides: Record<string, any> = {}) => {
  return {
    currentYear: new Date().getFullYear(),
    CLERK_SIGN_IN_URL: env.CLERK_SIGN_IN_URL ?? null,
    ...overrides,
  };
};

// Landing page
fastify.get('/', async (_request, reply: FastifyReply) => {
  return (reply as any).view('pages/landing.njk', getTemplateContext({
    showUserControls: false,
    orgSlug: null,
  }));
});

// Pricing page (must be before /:orgSlug to avoid route conflicts)
fastify.get('/pricing', async (_request, reply: FastifyReply) => {
  return (reply as any).view('pages/pricing.njk', getTemplateContext({
    showUserControls: false,
    orgSlug: null,
  }));
});

// Login page (must be before /:orgSlug to avoid route conflicts)
fastify.get('/login', async (_request, reply: FastifyReply) => {
  return (reply as any).view('pages/login.njk', getTemplateContext({
    showUserControls: false,
    orgSlug: null,
  }));
});

// Admin UI page (must be before /admin/policy-access to avoid conflicts)
fastify.get('/admin', async (_request, reply: FastifyReply) => {
  return (reply as any).view('pages/admin.njk', getTemplateContext({
    showUserControls: false,
    orgSlug: null,
  }));
});

// Admin-only API endpoint to check policy access
fastify.get('/admin/policy-access', { preHandler: [requireClerkAuth, requireOrgAdmin] }, async (_request, reply) => {
  return { allowed: true };
});

// Platform Admin UI page (must be before /:orgSlug to avoid route conflicts)
fastify.get('/platform-admin', async (_request, reply: FastifyReply) => {
  return (reply as any).view('pages/admin.njk', getTemplateContext({
    showUserControls: true,
    orgSlug: 'platform-admin',
    isPlatformAdmin: true,
  }));
});

// Policy page route (must be before /:orgSlug/devices)
fastify.get<{ Params: { orgSlug: string } }>('/:orgSlug/policy', async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  return (reply as any).view('pages/policy.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
  }));
});

fastify.get<{ Params: { orgSlug: string } }>('/:orgSlug/key-generation', async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  return (reply as any).view('pages/key-generation.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
  }));
});

// Device detail route (must be before /:orgSlug/devices)
fastify.get<{ Params: { orgSlug: string; deviceId: string } }>('/:orgSlug/devices/:deviceId', async (request: FastifyRequest<{ Params: { orgSlug: string; deviceId: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  const deviceId = decodeURIComponent(request.params.deviceId);
  return (reply as any).view('pages/device-detail.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
    deviceId,
    showRangeSelector: true,
  }));
});

// Device list route (must be before /:orgSlug)
fastify.get<{ Params: { orgSlug: string } }>('/:orgSlug/devices', async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  return (reply as any).view('pages/devices.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
  }));
});

// Org dashboard route (register LAST)
fastify.get<{ Params: { orgSlug: string } }>('/:orgSlug', async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  return (reply as any).view('pages/dashboard.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
    showRangeSelector: true,
  }));
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
