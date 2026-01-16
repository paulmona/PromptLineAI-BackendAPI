import type { FastifyInstance } from 'fastify';
import env from '../env.js';
import logger from '../logger.js';
import { ingestRequestSchema, separateEventFields } from '../validation.js';
import { getOrCreateOrg, upsertDevice, insertEvents } from '../db/queries.js';

export async function ingestRoutes(fastify: FastifyInstance) {
  fastify.post('/ingest', async (request, reply) => {
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

    // Check X-POC-TOKEN header
    const token = request.headers['x-poc-token'];
    const hasToken = !!token;
    const tokenValid = token === env.POC_TOKEN;

    if (!hasToken || !tokenValid) {
      logger.warn(
        {
          requestId,
          clientIp,
          hasToken,
          tokenValid,
        },
        'Authentication failed - invalid or missing X-POC-TOKEN'
      );
      return reply.code(401).send({ error: 'Invalid or missing X-POC-TOKEN' });
    }

    logger.debug({ requestId, clientIp }, 'Authentication successful');

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

    const { device_id, events } = validationResult.data;

    logger.debug(
      {
        requestId,
        device_id,
        eventCount: events.length,
        eventIds: events.map((e) => e.id),
      },
      'Request validated, processing events'
    );

    try {
      // Resolve org by DEFAULT_ORG_NAME
      logger.debug({ requestId, orgName: env.DEFAULT_ORG_NAME }, 'Resolving org');
      const org = await getOrCreateOrg(env.DEFAULT_ORG_NAME);
      logger.debug({ requestId, orgId: org.id }, 'Org resolved');

      // Upsert device (org_id immutable for existing devices)
      logger.debug({ requestId, device_id, orgId: org.id }, 'Upserting device');
      await upsertDevice(device_id, org.id);
      logger.debug({ requestId, device_id }, 'Device upserted');

      // Prepare events for insertion
      logger.debug({ requestId, eventCount: events.length }, 'Preparing events for insertion');
      const eventData = events.map((event) => {
        const { known, extra } = separateEventFields(event);

        // tool is already coerced to valid enum or 'unknown' by validation
        // event_type is strictly validated (invalid => 400)

        return {
          id: known.id,
          orgId: org.id,
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

      // Insert events (idempotent)
      logger.debug({ requestId, eventCount: eventData.length }, 'Inserting events into database');
      const result = await insertEvents(eventData);

      logger.info(
        {
          requestId,
          device_id,
          org_id: org.id,
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
