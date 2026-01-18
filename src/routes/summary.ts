import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import logger from '../logger.js';
import { getSummary } from '../db/queries.js';
import { requireClerkAuth } from '../auth/middleware.js';

const summaryQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('24h'),
});

export async function summaryRoutes(fastify: FastifyInstance) {
  fastify.get('/summary', { preHandler: requireClerkAuth }, async (request, reply) => {
    const queryResult = summaryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Invalid query parameters',
        details: queryResult.error.format(),
      });
    }

    const { range } = queryResult.data;

    try {
      const ctx = request.authContext;
      if (!ctx) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Get summary (all queries filtered by org_id)
      const summary = await getSummary(ctx.internalOrgId, range);

      return summary;
    } catch (err) {
      logger.error({ err, range }, 'Failed to get summary');
      return reply.code(500).send({
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
