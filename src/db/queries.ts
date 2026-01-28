import { eq, sql, and, gte, desc, isNotNull, isNull, count } from 'drizzle-orm';
import { db } from './index.js';
import { orgs, users, devices, events, ingestKeys } from './schema.js';
import logger from '../logger.js';
import type { EventInput } from '../validation.js';
import { randomUUID } from 'crypto';

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

export async function getOrgByExternalOrgId(externalOrgId: string): Promise<{ id: string; slug: string | null; name: string } | null> {
  const rows = await db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.externalOrgId, externalOrgId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Safe constrained org bootstrap: creates org ONLY when provided canonical values from Clerk.
 * Slug is immutable once set:
 * - If slug exists, we never change it
 * - If slug is NULL, we will fill it once
 */
export async function ensureOrgByExternalOrgId(args: {
  externalOrgId: string;
  name: string;
  slug: string;
}): Promise<{ id: string; slug: string | null; name: string }> {
  // Check if org already exists
  const existing = await db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.externalOrgId, args.externalOrgId))
    .limit(1);

  if (existing.length > 0) {
    // Org exists - update name, but preserve slug if it already exists (immutability)
    const currentSlug = existing[0].slug;
    const updated = await db
      .update(orgs)
      .set({
        name: args.name,
        // slug immutability: only fill when currently NULL
        slug: currentSlug ?? args.slug,
      })
      .where(eq(orgs.id, existing[0].id))
      .returning({ id: orgs.id, slug: orgs.slug, name: orgs.name });

    return updated[0];
  }

  // Org doesn't exist - insert it
  const inserted = await db
    .insert(orgs)
    .values({
      externalOrgId: args.externalOrgId,
      name: args.name,
      slug: args.slug,
    })
    .returning({ id: orgs.id, slug: orgs.slug, name: orgs.name });

  return inserted[0];
}

export async function getUserByExternalUid(externalUid: string): Promise<{ id: string; orgId: string | null } | null> {
  const rows = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(eq(users.externalUid, externalUid))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Ensures a user row exists for the Clerk user.
 * We intentionally generate our own UUID for id to avoid relying on unknown users table defaults.
 */
export async function ensureUserByExternalUid(args: {
  externalUid: string;
  orgId: string;
}): Promise<{ id: string; orgId: string | null }> {
  const existing = await getUserByExternalUid(args.externalUid);
  if (existing) {
    // Keep org in sync with invariant: user belongs to exactly one org
    if (existing.orgId !== args.orgId) {
      const updated = await db
        .update(users)
        .set({ orgId: args.orgId })
        .where(eq(users.id, existing.id))
        .returning({ id: users.id, orgId: users.orgId });
      return updated[0];
    }
    return existing;
  }

  const created = await db
    .insert(users)
    .values({
      id: randomUUID(),
      externalUid: args.externalUid,
      orgId: args.orgId,
    })
    .returning({ id: users.id, orgId: users.orgId });

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
 * Race-safe device upsert guard:
 * - Single statement insert/upsert returning org_id
 * - Caller MUST compare returned org_id against expected org_id and abort if mismatched
 */
export async function upsertDeviceReturningOrgId(
  dbOrTx: typeof db,
  args: { deviceId: string; orgId: string; deviceName: string; userAgent?: string | null }
): Promise<{ orgId: string }> {
  const rows = await dbOrTx
    .insert(devices)
    .values({
      id: args.deviceId,
      orgId: args.orgId,
      deviceName: args.deviceName,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      userAgent: args.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: devices.id,
      set: {
        lastSeenAt: new Date(),
        deviceName: args.deviceName,
        ...(args.userAgent !== undefined && args.userAgent !== null ? { userAgent: args.userAgent } : {}),
        // org_id is never updated
      },
    })
    .returning({ orgId: devices.orgId });

  return rows[0];
}

/**
 * Insert events with idempotency (ON CONFLICT DO NOTHING).
 * Maps invalid tool values to 'unknown'.
 * Returns { attempted, inserted } counts.
 */
export async function insertEvents(
  dbOrTx: typeof db,
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

  logger.debug({ attempted, deviceId: eventData[0]?.deviceId, orgId: eventData[0]?.orgId }, 'Inserting events into database');

  try {
    const result = await dbOrTx
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

    logger.info({ attempted, inserted, ignored, deviceId: eventData[0]?.deviceId, orgId: eventData[0]?.orgId }, 'Events insert completed');

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
 * All queries are filtered by org_id, optionally by device_id.
 * When device_id is provided, also returns device_name for display.
 */
export async function getSummary(orgId: string, range: '24h' | '7d' | '30d', deviceId?: string) {
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

  // Build base where conditions
  const baseConditions = [eq(events.orgId, orgId), gte(events.occurredAt, startTime)];
  if (deviceId) {
    baseConditions.push(eq(events.deviceId, deviceId));
  }
  const whereClause = and(...baseConditions);

  // Get device_name if device_id is provided
  let deviceName: string | undefined;
  if (deviceId) {
    const deviceResult = await db
      .select({ deviceName: devices.deviceName })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId)))
      .limit(1);
    deviceName = deviceResult[0]?.deviceName;
  }

  // Total events
  const totalEventsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(whereClause);

  const totalEvents = totalEventsResult[0]?.count ?? 0;

  // Unique devices (only meaningful when not filtering by device)
  let uniqueDevices = 0;
  if (!deviceId) {
    const uniqueDevicesResult = await db
      .select({ count: sql<number>`count(distinct ${events.deviceId})::int` })
      .from(events)
      .where(whereClause);
    uniqueDevices = uniqueDevicesResult[0]?.count ?? 0;
  } else {
    uniqueDevices = 1;
  }

  // Tools count
  const toolsResult = await db
    .select({
      tool: events.tool,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(whereClause)
    .groupBy(events.tool)
    .orderBy(events.tool);

  // Event types count
  const eventTypesResult = await db
    .select({
      eventType: events.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(whereClause)
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
    .where(whereClause)
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
        ...baseConditions,
        eq(events.eventType, 'file_selected' as const),
        isNotNull(events.fileName)
      )
    )
    .groupBy(events.fileName)
    .orderBy(sql`count(*) DESC`, events.fileName);

  const result: {
    range: string;
    total_events: number;
    unique_devices: number;
    tools: Array<{ tool: string; count: number }>;
    event_types: Array<{ event_type: string; count: number }>;
    time_buckets: Array<{ bucket: string; count: number }>;
    files: Array<{ file_name: string; count: number }>;
    device_name?: string;
  } = {
    range,
    total_events: totalEvents,
    unique_devices: uniqueDevices,
    tools: toolsResult.map((r) => ({ tool: r.tool, count: r.count })),
    event_types: eventTypesResult.map((r) => ({ event_type: r.eventType, count: r.count })),
    time_buckets: timeBucketsResult.map((r) => ({ bucket: r.bucket, count: r.count })),
    files: filesResult.map((r) => ({ file_name: r.fileName!, count: r.count })),
  };

  if (deviceName) {
    result.device_name = deviceName;
  }

  return result;
}

/**
 * Get paginated list of organizations with counts (devices, events, ingest keys).
 * Used by platform admin interface.
 */
export async function getOrgsList(args: { limit: number; offset: number }) {
  const { limit, offset } = args;

  // Get total count
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgs);
  const total = totalResult[0]?.count ?? 0;

  // Get orgs with counts using subqueries
  const orgsList = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      externalOrgId: orgs.externalOrgId,
      createdAt: orgs.createdAt,
    })
    .from(orgs)
    .orderBy(desc(orgs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get counts for each org
  const orgsWithCounts = await Promise.all(
    orgsList.map(async (org) => {
      // Count devices
      const devicesCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(devices)
        .where(eq(devices.orgId, org.id));
      const devicesCount = devicesCountResult[0]?.count ?? 0;

      // Count events
      const eventsCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(eq(events.orgId, org.id));
      const eventsCount = eventsCountResult[0]?.count ?? 0;

      // Count ingest keys (active only, where revoked_at IS NULL)
      const ingestKeysCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ingestKeys)
        .where(and(eq(ingestKeys.orgId, org.id), isNull(ingestKeys.revokedAt)));
      const ingestKeysCount = ingestKeysCountResult[0]?.count ?? 0;

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        external_org_id: org.externalOrgId,
        created_at: org.createdAt.toISOString(),
        counts: {
          devices_count: devicesCount,
          events_count: eventsCount,
          ingest_keys_count: ingestKeysCount,
        },
      };
    })
  );

  return {
    orgs: orgsWithCounts,
    total,
    limit,
    offset,
  };
}

/**
 * Get organization detail with counts.
 * Used by platform admin interface.
 */
export async function getOrgDetail(orgId: string) {
  const orgResult = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      externalOrgId: orgs.externalOrgId,
      createdAt: orgs.createdAt,
    })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);

  if (orgResult.length === 0) {
    return null;
  }

  const org = orgResult[0];

  // Count devices
  const devicesCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(eq(devices.orgId, org.id));
  const devicesCount = devicesCountResult[0]?.count ?? 0;

  // Count events
  const eventsCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.orgId, org.id));
  const eventsCount = eventsCountResult[0]?.count ?? 0;

  // Count ingest keys (active only, where revoked_at IS NULL)
  const ingestKeysCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ingestKeys)
    .where(and(eq(ingestKeys.orgId, org.id), isNull(ingestKeys.revokedAt)));
  const ingestKeysCount = ingestKeysCountResult[0]?.count ?? 0;

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    external_org_id: org.externalOrgId,
    created_at: org.createdAt.toISOString(),
    counts: {
      devices_count: devicesCount,
      events_count: eventsCount,
      ingest_keys_count: ingestKeysCount,
    },
  };
}

/**
 * Revoke all active ingest keys for an organization.
 * Sets revoked_at = now() for all keys where revoked_at IS NULL.
 * Returns the count of revoked keys.
 */
export async function revokeOrgIngestKeys(orgId: string): Promise<number> {
  const now = new Date();
  const result = await db
    .update(ingestKeys)
    .set({ revokedAt: now })
    .where(and(eq(ingestKeys.orgId, orgId), isNull(ingestKeys.revokedAt)))
    .returning({ id: ingestKeys.id });

  const revokedCount = result.length;
  logger.info({ orgId, revokedCount }, 'Revoked ingest keys for organization');
  return revokedCount;
}
