import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../db/index.js';

export async function healthzRoutes(fastify: FastifyInstance) {
  fastify.get('/healthz', async (request, reply) => {
    const dbConnected = await checkDatabaseConnection();
    return {
      ok: true,
      db: dbConnected ? 'connected' : 'disconnected',
    };
  });
}
