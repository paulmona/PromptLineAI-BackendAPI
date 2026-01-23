import type { FastifyInstance } from 'fastify';
import logger from '../logger.js';
import { requireClerkAuth } from '../auth/middleware.js';
import { db } from '../db/index.js';
import { devices } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export async function devicesRoutes(fastify: FastifyInstance) {
  fastify.get('/devices', { preHandler: requireClerkAuth }, async (request, reply) => {
    try {
      const ctx = request.authContext;
      if (!ctx) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Get all devices for the org, ordered by last_seen_at descending
      const devicesList = await db
        .select({
          device_id: devices.id,
          device_name: devices.deviceName,
          last_seen_at: devices.lastSeenAt,
        })
        .from(devices)
        .where(eq(devices.orgId, ctx.internalOrgId))
        .orderBy(desc(devices.lastSeenAt));

      return {
        devices: devicesList.map((d) => ({
          device_id: d.device_id,
          device_name: d.device_name,
          last_seen_at: d.last_seen_at.toISOString(),
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get devices');
      return reply.code(500).send({
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
