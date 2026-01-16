import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import env from '../env.js';
import logger from '../logger.js';
import { getOrCreateOrg } from '../db/queries.js';
import { getSummary } from '../db/queries.js';

const summaryQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('24h'),
});

export async function summaryRoutes(fastify: FastifyInstance) {
  fastify.get('/summary', async (request, reply) => {
    const queryResult = summaryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Invalid query parameters',
        details: queryResult.error.format(),
      });
    }

    const { range } = queryResult.data;

    try {
      // Resolve org by DEFAULT_ORG_NAME
      const org = await getOrCreateOrg(env.DEFAULT_ORG_NAME);

      // Get summary (all queries filtered by org_id)
      const summary = await getSummary(org.id, range);

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
