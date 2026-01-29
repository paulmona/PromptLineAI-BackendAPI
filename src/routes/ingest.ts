import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import logger from '../logger.js';
import { ingestRequestSchema, separateEventFields } from '../validation.js';
import { db } from '../db/index.js';
import { upsertDeviceReturningOrgId, insertEvents } from '../db/queries.js';
import { requireClerkAuth } from '../auth/middleware.js';
import { checkRateLimit } from '../auth/ingest-rate-limit.js';

class DeviceOrgMismatchError extends Error {
  constructor(
    public readonly deviceId: string,
    public readonly expectedOrgId: string,
    public readonly actualOrgId: string
  ) {
    super('Device belongs to different organization');
  }
}

export async function ingestRoutes(fastify: FastifyInstance) {
  fastify.post('/ingest', { preHandler: [requireClerkAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

    logger.info(
      {
        requestId,
        method: request.method,
        url: request.url,
        clientIp,
        hasBody: !!request.body,
        contentType: request.headers['content-type'],
      },
      'Incoming ingest request'
    );

    // Get org ID from Clerk authentication context
    const authContext = request.authContext;
    if (!authContext) {
      return reply.code(401).send({
        error: 'Unauthorized',
        code: 'ORG_REQUIRED',
      });
    }

    const resolvedOrgId = authContext.internalOrgId;

    // Rate limiting per org
    const rateLimitKey = `org:${resolvedOrgId}`;
    const rl = checkRateLimit({ identifier: rateLimitKey, windowMs: 60_000, maxRequests: 60 });
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      return reply.code(429).send({ error: 'Too Many Requests' });
    }

    // Validate request body
    const validationResult = ingestRequestSchema.safeParse(request.body);
    if (!validationResult.success) {
      logger.warn(
        {
          requestId,
          clientIp,
          validationErrors: validationResult.error.format(),
        },
        'Request validation failed'
      );
      return reply.code(400).send({
        error: 'Invalid request body',
        details: validationResult.error.format(),
      });
    }

    const { device_id, device_name, events } = validationResult.data;

    logger.debug(
      {
        requestId,
        device_id,
        eventCount: events.length,
      },
      'Request validated, processing events'
    );

    try {
      const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;

      // Device + events insert must be fail-closed and race-safe.
      const result = await db.transaction(async (tx) => {
        // Single-statement upsert returning org_id (race-safe).
        const deviceRow = await upsertDeviceReturningOrgId(tx as any, {
          deviceId: device_id,
          orgId: resolvedOrgId,
          deviceName: device_name,
          userAgent,
        });

        if (deviceRow.orgId !== resolvedOrgId) {
          throw new DeviceOrgMismatchError(device_id, resolvedOrgId, deviceRow.orgId);
        }

        // Prepare events for insertion (tenant derived from Clerk auth context)
        const eventData = events.map((event) => {
          const { known, extra } = separateEventFields(event);

          return {
            id: known.id,
            orgId: resolvedOrgId,
            deviceId: device_id,
            occurredAt: new Date(known.ts),
            tool: known.tool,
            eventType: known.event_type,
            urlHost: known.url_host,
            fileExt: known.file_ext ?? null,
            fileSizeKb: known.file_size_kb ?? null,
            fileName: known.file_name ?? null,
            promptLenBucket: known.prompt_len_bucket ?? null,
            hasCodeBlock: known.has_code_block ?? null,
            pasteDetected: known.paste_detected ?? null,
            extra,
          };
        });

        return await insertEvents(tx as any, eventData);
      });

      logger.info(
        {
          requestId,
          device_id,
          org_id: resolvedOrgId,
          attempted: result.attempted,
          inserted: result.inserted,
          ignored: result.attempted - result.inserted,
          clientIp,
        },
        'Events ingested successfully'
      );

      return {
        attempted: result.attempted,
        inserted: result.inserted,
      };
    } catch (err) {
      if (err instanceof DeviceOrgMismatchError) {
        logger.warn(
          { requestId, device_id: err.deviceId, expectedOrgId: err.expectedOrgId, actualOrgId: err.actualOrgId },
          'Rejecting ingest due to device org mismatch'
        );
        return reply.code(409).send({
          error: 'Device belongs to different organization',
          code: 'DEVICE_ORG_MISMATCH',
          message: 'This device is already associated with another organization',
        });
      }

      logger.error(
        {
          requestId,
          err,
          device_id,
          clientIp,
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          errorStack: err instanceof Error ? err.stack : undefined,
        },
        'Failed to ingest events'
      );
      return reply.code(500).send({
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
