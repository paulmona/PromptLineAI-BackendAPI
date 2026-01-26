import type { FastifyInstance } from 'fastify';
import { requireClerkAuth } from '../auth/middleware.js';
import { getOrgByExternalOrgId } from '../db/queries.js';

export async function meRoutes(fastify: FastifyInstance) {
  fastify.get('/me', { preHandler: requireClerkAuth }, async (request, reply) => {
    const ctx = request.authContext;
    if (!ctx) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const org = await getOrgByExternalOrgId(ctx.clerkOrgId);
    if (!org?.slug) {
      return reply.code(403).send({ error: 'Organization not provisioned' });
    }

    return {
      user: {
        id: ctx.internalUserId,
        role: ctx.role,
      },
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    };
  });
}

