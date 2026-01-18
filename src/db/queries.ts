import { eq, sql, and, gte, desc, isNotNull } from 'drizzle-orm';
import { db } from './index.js';
import { orgs, devices, events } from './schema.js';
import logger from '../logger.js';
import type { EventInput } from '../validation.js';

/**
 * Lookup or create org by name (exact match).
 * Uses ON CONFLICT DO NOTHING for race safety since schema has unique index on lower(name).
 */
export async function getOrCreateOrg(orgName: string): Promise<{ id: string }> {
  logger.debug({ orgName }, 'Looking up org');
  // Try to find existing org (exact match on name)
  const existing = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.name, orgName))
    .limit(1);

  if (existing.length > 0) {
    logger.debug({ orgName, orgId: existing[0].id }, 'Found existing org');
    return existing[0];
  }

  logger.debug({ orgName }, 'Org not found, attempting to create');
  // Try to create (race-safe with ON CONFLICT)
  // Since schema has unique index on lower(name), we use ON CONFLICT DO NOTHING
  try {
    await db
      .insert(orgs)
      .values({ name: orgName })
      .onConflictDoNothing();
    logger.debug({ orgName }, 'Org insert attempted (may have been created by another process)');
  } catch (err) {
    logger.error({ err, orgName }, 'Failed to insert org');
    throw err;
  }

  // Re-select to get the org_id (handles race condition where another process created it)
  const created = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.name, orgName))
    .limit(1);

  if (created.length === 0) {
    logger.error({ orgName }, 'Failed to create or find org after insert attempt');
    throw new Error(`Failed to create or find org with name: ${orgName}`);
  }

  logger.info({ orgName, orgId: created[0].id }, 'Org created or found');
  return created[0];
}

/**
 * Upsert device. Updates last_seen_at and optionally user_agent.
 * org_id is NEVER updated for existing devices (immutable).
 */
export async function upsertDevice(
  deviceId: string,
  orgId: string,
  userAgent?: string | null
): Promise<void> {
  logger.debug({ deviceId, orgId, hasUserAgent: !!userAgent }, 'Upserting device');
  try {
    await db
      .insert(devices)
      .values({
        id: deviceId,
        orgId,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          lastSeenAt: new Date(),
          // Only update user_agent if a non-null value is provided
          ...(userAgent !== undefined && userAgent !== null ? { userAgent } : {}),
          // org_id is never updated
        },
      });
    logger.debug({ deviceId, orgId }, 'Device upserted successfully');
  } catch (err) {
    logger.error({ err, deviceId, orgId }, 'Failed to upsert device');
    throw err;
  }
}

/**
 * Insert events with idempotency (ON CONFLICT DO NOTHING).
 * Maps invalid tool values to 'unknown'.
 * Returns { attempted, inserted } counts.
 */
export async function insertEvents(
  eventData: Array<{
    id: string;
    orgId: string;
    deviceId: string;
    occurredAt: Date;
    tool: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'unknown';
    eventType: 'visit' | 'prompt_submit' | 'file_selected';
    urlHost: string;
    fileExt?: string | null;
    fileSizeKb?: number | null;
    fileName?: string | null;
    promptLenBucket?: '0-200' | '200-1000' | '1000+' | null;
    hasCodeBlock?: boolean | null;
    pasteDetected?: boolean | null;
    extra?: Record<string, unknown> | null;
  }>
): Promise<{ attempted: number; inserted: number }> {
  if (eventData.length === 0) {
    return { attempted: 0, inserted: 0 };
  }

  const attempted = eventData.length;

  logger.debug(
    {
      attempted,
      deviceId: eventData[0]?.deviceId,
      orgId: eventData[0]?.orgId,
      eventTypes: [...new Set(eventData.map((e) => e.eventType))],
      tools: [...new Set(eventData.map((e) => e.tool))],
    },
    'Inserting events into database'
  );

  try {
    const result = await db
      .insert(events)
      .values(
        eventData.map((e) => ({
          id: e.id,
          orgId: e.orgId,
          deviceId: e.deviceId,
          occurredAt: e.occurredAt,
          tool: e.tool,
          eventType: e.eventType,
          urlHost: e.urlHost,
          fileExt: e.fileExt ?? null,
          fileSizeKb: e.fileSizeKb ?? null,
          fileName: e.fileName ?? null,
          promptLenBucket: e.promptLenBucket ?? null,
          hasCodeBlock: e.hasCodeBlock ?? null,
          pasteDetected: e.pasteDetected ?? null,
          extra: e.extra ?? null,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: events.id });

    const inserted = result.length;
    const ignored = attempted - inserted;

    logger.info(
      {
        attempted,
        inserted,
        ignored,
        deviceId: eventData[0]?.deviceId,
        orgId: eventData[0]?.orgId,
      },
      'Events insert completed'
    );

    return {
      attempted,
      inserted,
    };
  } catch (err) {
    logger.error(
      {
        err,
        attempted,
        deviceId: eventData[0]?.deviceId,
        orgId: eventData[0]?.orgId,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        errorStack: err instanceof Error ? err.stack : undefined,
      },
      'Failed to insert events - database error'
    );
    throw err;
  }
}

/**
 * Get summary statistics for an org within a time range.
 * All queries are filtered by org_id.
 */
export async function getSummary(orgId: string, range: '24h' | '7d' | '30d') {
  const now = new Date();
  let startTime: Date;
  let bucketFormat: 'hour' | 'day';

  switch (range) {
    case '24h':
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      bucketFormat = 'hour';
      break;
    case '7d':
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      bucketFormat = 'day';
      break;
    case '30d':
      startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      bucketFormat = 'day';
      break;
  }

  // Total events
  const totalEventsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.orgId, orgId), gte(events.occurredAt, startTime)));

  const totalEvents = totalEventsResult[0]?.count ?? 0;

  // Unique devices
  const uniqueDevicesResult = await db
    .select({ count: sql<number>`count(distinct ${events.deviceId})::int` })
    .from(events)
    .where(and(eq(events.orgId, orgId), gte(events.occurredAt, startTime)));

  const uniqueDevices = uniqueDevicesResult[0]?.count ?? 0;

  // Tools count
  const toolsResult = await db
    .select({
      tool: events.tool,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(and(eq(events.orgId, orgId), gte(events.occurredAt, startTime)))
    .groupBy(events.tool)
    .orderBy(events.tool);

  // Event types count
  const eventTypesResult = await db
    .select({
      eventType: events.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(and(eq(events.orgId, orgId), gte(events.occurredAt, startTime)))
    .groupBy(events.eventType)
    .orderBy(events.eventType);

  // Time buckets
  const bucketExpr =
    bucketFormat === 'hour'
      ? sql`date_trunc('hour', ${events.occurredAt})`
      : sql`date_trunc('day', ${events.occurredAt})`;

  const timeBucketsResult = await db
    .select({
      bucket: sql<string>`${bucketExpr}::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(and(eq(events.orgId, orgId), gte(events.occurredAt, startTime)))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr);

  // File uploads (only file_selected events with file_name)
  const filesResult = await db
    .select({
      fileName: events.fileName,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(
      and(
        eq(events.orgId, orgId),
        gte(events.occurredAt, startTime),
        eq(events.eventType, 'file_selected' as const),
        isNotNull(events.fileName)
      )
    )
    .groupBy(events.fileName)
    .orderBy(sql`count(*) DESC`, events.fileName);

  return {
    range,
    total_events: totalEvents,
    unique_devices: uniqueDevices,
    tools: toolsResult.map((r) => ({ tool: r.tool, count: r.count })),
    event_types: eventTypesResult.map((r) => ({ event_type: r.eventType, count: r.count })),
    time_buckets: timeBucketsResult.map((r) => ({ bucket: r.bucket, count: r.count })),
    files: filesResult.map((r) => ({ file_name: r.fileName!, count: r.count })),
  };
}
