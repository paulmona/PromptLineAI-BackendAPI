import type { FastifyInstance } from 'fastify';
import logger from '../logger.js';
import { requireClerkAuth } from '../auth/middleware.js';
import { listUsersByOrgId } from '../db/queries.js';

export async function usersRoutes(fastify: FastifyInstance) {
  fastify.get('/users', { preHandler: requireClerkAuth }, async (request, reply) => {
    try {
      const ctx = request.authContext;
      if (!ctx) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const usersList = await listUsersByOrgId(ctx.internalOrgId);

      return {
        users: usersList.map((u) => ({
          id: u.id,
          external_uid: u.external_uid ?? undefined,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get users');
      return reply.code(500).send({
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
