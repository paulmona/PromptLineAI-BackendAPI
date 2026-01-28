import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import logger from '../logger.js';
import { requirePlatformAdmin } from '../auth/middleware.js';
import { clerkClient } from '../auth/clerk.js';
import { getOrgsList, getOrgDetail, revokeOrgIngestKeys } from '../db/queries.js';
import { db } from '../db/index.js';
import { orgs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSingleHeaderValue } from '../auth/headers.js';

// Query params schema for GET /admin/orgs
const orgsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function adminRoutes(fastify: FastifyInstance) {
  // GET /admin/orgs - List organizations (paginated)
  fastify.get<{ Querystring: unknown }>(
    '/admin/orgs',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest<{ Querystring: unknown }>, reply: FastifyReply) => {
      try {
        const validationResult = orgsListQuerySchema.safeParse(request.query);
        if (!validationResult.success) {
          return reply.code(400).send({
            error: 'Invalid query parameters',
            details: validationResult.error.format(),
          });
        }

        const { limit, offset } = validationResult.data;
        const result = await getOrgsList({ limit, offset });

        logger.info({ limit, offset, total: result.total }, 'Platform admin: listed organizations');
        return result;
      } catch (err) {
        logger.error({ err }, 'Failed to list organizations');
        return reply.code(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // GET /admin/orgs/:orgId - Get organization detail
  fastify.get<{ Params: { orgId: string } }>(
    '/admin/orgs/:orgId',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      try {
        const { orgId } = request.params;
        const org = await getOrgDetail(orgId);

        if (!org) {
          return reply.code(404).send({
            error: 'Organization not found',
          });
        }

        logger.info({ orgId }, 'Platform admin: retrieved organization detail');
        return org;
      } catch (err) {
        logger.error({ err, orgId: request.params.orgId }, 'Failed to get organization detail');
        return reply.code(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // POST /admin/orgs/:orgId/revoke-ingest-keys - Revoke all ingest keys for an org
  fastify.post<{ Params: { orgId: string } }>(
    '/admin/orgs/:orgId/revoke-ingest-keys',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      try {
        const { orgId } = request.params;

        // Verify org exists
        const org = await getOrgDetail(orgId);
        if (!org) {
          return reply.code(404).send({
            error: 'Organization not found',
          });
        }

        const revokedCount = await revokeOrgIngestKeys(orgId);

        logger.info({ orgId, revokedCount }, 'Platform admin: revoked ingest keys');
        return { revoked_count: revokedCount };
      } catch (err) {
        logger.error({ err, orgId: request.params.orgId }, 'Failed to revoke ingest keys');
        return reply.code(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // DELETE /admin/orgs/:orgId - Delete organization and all tenant data
  fastify.delete<{ Params: { orgId: string } }>(
    '/admin/orgs/:orgId',
    { preHandler: [requirePlatformAdmin] },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      try {
        const { orgId } = request.params;

        // Check for confirmation header
        const confirmHeader = getSingleHeaderValue(request.headers['x-admin-confirm'] as string | string[] | undefined);
        if (!confirmHeader.ok || confirmHeader.value !== 'DELETE') {
          return reply.code(400).send({
            error: 'Confirmation required',
            message: 'DELETE requests require X-ADMIN-CONFIRM: DELETE header',
          });
        }

        // Fetch org record to get externalOrgId before deletion
        const orgResult = await db
          .select({ id: orgs.id, externalOrgId: orgs.externalOrgId })
          .from(orgs)
          .where(eq(orgs.id, orgId))
          .limit(1);

        if (orgResult.length === 0) {
          return reply.code(404).send({
            error: 'Organization not found',
          });
        }

        const externalOrgId = orgResult[0].externalOrgId;

        // Delete org in transaction (CASCADE will handle dependent rows)
        await db.transaction(async (tx) => {
          // Delete org - CASCADE will handle devices, events, ingest_keys
          // SET NULL will handle users.org_id
          await tx.delete(orgs).where(eq(orgs.id, orgId));
        });

        // After successful DB deletion, verify and delete from Clerk
        if (externalOrgId) {
          try {
            // First, verify the org exists in Clerk
            logger.debug({ orgId, externalOrgId }, 'Verifying organization exists in Clerk before deletion');
            const clerkOrg = await clerkClient.organizations.getOrganization({ organizationId: externalOrgId });
            
            if (!clerkOrg) {
              logger.warn({ orgId, externalOrgId }, 'Organization not found in Clerk (may have been deleted already)');
            } else {
              // Org exists, proceed with deletion
              logger.debug({ orgId, externalOrgId, clerkOrgName: clerkOrg.name }, 'Organization found in Clerk, proceeding with deletion');
              
              try {
                await clerkClient.organizations.deleteOrganization(externalOrgId);
                logger.info({ orgId, externalOrgId }, 'Platform admin: deleted organization from Clerk');
              } catch (deleteErr: any) {
                // Log complete error details for debugging
                const fullError = {
                  type: deleteErr?.constructor?.name,
                  message: deleteErr?.message,
                  code: deleteErr?.code,
                  status: deleteErr?.status,
                  clerkError: deleteErr?.clerkError,
                  clerkTraceId: deleteErr?.clerkTraceId,
                  errors: deleteErr?.errors,
                  aggregateErrors: deleteErr?.aggregateErrors,
                  stack: deleteErr?.stack,
                };
                
                logger.error(
                  { orgId, externalOrgId, fullError },
                  'Platform admin: deleteOrganization failed with detailed error'
                );
                
                // Re-throw to be caught by outer catch
                throw deleteErr;
              }
            }
          } catch (err: any) {
            // Enhanced error handling
            const errorCode = err?.code || err?.status || 'unknown';
            const errorMessage = err?.message || 'Unknown error';
            
            // Log full error structure for debugging
            logger.error(
              {
                orgId,
                externalOrgId,
                errorCode,
                errorMessage,
                errorType: err?.constructor?.name,
                clerkError: err?.clerkError,
                clerkTraceId: err?.clerkTraceId,
                status: err?.status,
                errors: err?.errors,
                fullError: err,
              },
              'Platform admin: failed to delete organization from Clerk (org already deleted from database)'
            );
            
            if (errorCode === 404 || err?.status === 404) {
              logger.warn(
                { orgId, externalOrgId, errorCode, errorMessage },
                'Platform admin: organization not found in Clerk (may have been deleted already or externalOrgId is incorrect)'
              );
            }
          }
        } else {
          logger.warn({ orgId }, 'Platform admin: org has no external_org_id, skipping Clerk deletion');
        }

        logger.warn({ orgId }, 'Platform admin: deleted organization');
        return reply.code(204).send();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        
        if (errorMessage === 'Organization not found') {
          return reply.code(404).send({
            error: 'Organization not found',
          });
        }

        logger.error({ err, orgId: request.params.orgId }, 'Failed to delete organization');
        return reply.code(500).send({
          error: 'Internal server error',
          message: errorMessage,
        });
      }
    }
  );
}
