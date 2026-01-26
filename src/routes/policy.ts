import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import logger from '../logger.js';
import { requireClerkAuth, requireOrgAdmin } from '../auth/middleware.js';
import { getOrgPolicyConfig, updateOrgPolicyConfig } from '../db/queries.js';
import { policyConfigSchema } from '../validation.js';

export async function policyRoutes(fastify: FastifyInstance) {
  // GET /:orgSlug/policy/config - Get current policy configuration
  fastify.get<{ Params: { orgSlug: string } }>(
    '/:orgSlug/policy/config',
    { preHandler: [requireClerkAuth, requireOrgAdmin] },
    async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
      try {
        const ctx = request.authContext;
        if (!ctx) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const config = await getOrgPolicyConfig(ctx.internalOrgId);
        if (!config) {
          // Return defaults if no config exists
          return {
            llms: { chatgpt: true, gemini: true },
            fileUpload: { logFileNames: true },
          };
        }

        return config;
      } catch (err) {
        logger.error({ err }, 'Failed to get policy config');
        return reply.code(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // PUT /:orgSlug/policy/config - Update policy configuration
  fastify.put<{ Params: { orgSlug: string }; Body: unknown }>(
    '/:orgSlug/policy/config',
    { preHandler: [requireClerkAuth, requireOrgAdmin] },
    async (request: FastifyRequest<{ Params: { orgSlug: string }; Body: unknown }>, reply: FastifyReply) => {
      try {
        const ctx = request.authContext;
        if (!ctx) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        // Validate request body
        const validationResult = policyConfigSchema.safeParse(request.body);
        if (!validationResult.success) {
          return reply.code(400).send({
            error: 'Invalid policy configuration',
            details: validationResult.error.format(),
          });
        }

        const config = validationResult.data;
        const updated = await updateOrgPolicyConfig(ctx.internalOrgId, config);

        logger.info(
          { orgId: ctx.internalOrgId, config },
          'Policy configuration updated'
        );

        return updated;
      } catch (err) {
        logger.error({ err }, 'Failed to update policy config');
        return reply.code(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );
}
