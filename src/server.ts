import Fastify from 'fastify';
import env from './env.js';
import logger from './logger.js';
import { closeDatabase } from './db/index.js';
import { healthzRoutes } from './routes/healthz.js';
import { ingestRoutes } from './routes/ingest.js';
import { summaryRoutes } from './routes/summary.js';

const fastify = Fastify({
  logger,
  disableRequestLogging: true, // We'll log manually for /ingest
});

// Register routes
await fastify.register(healthzRoutes);
await fastify.register(ingestRoutes);
await fastify.register(summaryRoutes);

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
