import { eq, sql, and, gte, desc, isNotNull, isNull, count, ne } from 'drizzle-orm';
import { db } from './index.js';
import { orgs, users, devices, events, ingestKeys } from './schema.js';
import logger from '../logger.js';
import type { EventInput, PolicyConfig } from '../validation.js';
import { randomUUID } from 'crypto';
import env from '../env.js';
import { clerkClient } from '../auth/clerk.js';

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
 * Thrown when a user (external_uid) already exists linked to a different org.
 * B2B invariant: user never moves org. Middleware maps this to 403 ORG_MISMATCH_FOR_USER.
 */
export class OrgMismatchForUserError extends Error {
  constructor(
    public readonly externalUid: string,
    public readonly existingOrgId: string | null,
    public readonly requestedOrgId: string
  ) {
    super('User is already linked to a different organization');
    this.name = 'OrgMismatchForUserError';
  }
}

/**
 * Build display name from Clerk user (firstName, lastName, username).
 * Falls back to "User" if nothing is set.
 */
function clerkUserDisplayName(clerkUser: { firstName?: string | null; lastName?: string | null; username?: string | null }): string {
  const first = clerkUser.firstName?.trim() ?? '';
  const last = clerkUser.lastName?.trim() ?? '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  const username = clerkUser.username?.trim();
  if (username) return username;
  return 'User';
}

/**
 * Ensures a user row exists for the Clerk user.
 * B2B invariant: if the user already exists with a different org_id, throws OrgMismatchForUserError
 * (do not update org_id). DB trigger also prevents updating users.org_id when external_uid is set.
 * When creating a new user, fetches display name from Clerk once and stores it (no Clerk call on dashboard load).
 */
export async function ensureUserByExternalUid(args: {
  externalUid: string;
  orgId: string;
}): Promise<{ id: string; orgId: string | null }> {
  const existing = await getUserByExternalUid(args.externalUid);
  if (existing) {
    if (existing.orgId !== args.orgId) {
      throw new OrgMismatchForUserError(args.externalUid, existing.orgId, args.orgId);
    }
    return existing;
  }

  let displayName: string | null = null;
  try {
    const clerkUser = await clerkClient.users.getUser(args.externalUid);
    displayName = clerkUserDisplayName(clerkUser);
  } catch (err) {
    logger.warn({ err, externalUid: args.externalUid }, 'Failed to fetch Clerk user for display name; creating user with null name');
  }

  const created = await db
    .insert(users)
    .values({
      id: randomUUID(),
      externalUid: args.externalUid,
      orgId: args.orgId,
      name: displayName,
    })
    .returning({ id: users.id, orgId: users.orgId });

  return created[0];
}

/**
 * List users in an organization (for Users list page).
 * Returns id, optional external_uid, and optional name (from Clerk).
 */
export async function listUsersByOrgId(orgId: string): Promise<Array<{ id: string; external_uid: string | null; name: string | null }>> {
  const rows = await db
    .select({ id: users.id, external_uid: users.externalUid, name: users.name })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(users.id);
  return rows.map((r) => ({ id: r.id, external_uid: r.external_uid, name: r.name }));
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
 * - Optional userId: sets devices.user_id so device is associated with the user who sent ingest
 */
export async function upsertDeviceReturningOrgId(
  dbOrTx: typeof db,
  args: {
    deviceId: string;
    orgId: string;
    deviceName: string;
    userAgent?: string | null;
    userId?: string | null;
  }
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
      userId: args.userId ?? null,
    })
    .onConflictDoUpdate({
      target: devices.id,
      set: {
        lastSeenAt: new Date(),
        deviceName: args.deviceName,
        ...(args.userAgent !== undefined && args.userAgent !== null ? { userAgent: args.userAgent } : {}),
        ...(args.userId !== undefined ? { userId: args.userId ?? null } : {}),
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
    userId?: string | null;
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
          userId: e.userId ?? null,
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
 * All queries are filtered by org_id, optionally by device_id and/or user_id.
 * When device_id is provided, also returns device_name for display.
 * When not filtering by user, returns unique_users (distinct user_id, excluding nulls).
 */
export async function getSummary(
  orgId: string,
  range: '24h' | '7d' | '30d',
  deviceId?: string,
  userId?: string
) {
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
  if (userId) {
    baseConditions.push(eq(events.userId, userId));
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

  // Get user name if user_id is provided (for user-detail page)
  let userName: string | null = null;
  if (userId) {
    const userResult = await db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);
    userName = userResult[0]?.name ?? null;
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

  // Unique users (only when not filtering by user; count distinct user_id excluding nulls)
  let uniqueUsers = 0;
  if (!userId) {
    const uniqueUsersResult = await db
      .select({ count: sql<number>`count(distinct ${events.userId})::int` })
      .from(events)
      .where(and(whereClause, isNotNull(events.userId)));
    uniqueUsers = uniqueUsersResult[0]?.count ?? 0;
  } else {
    uniqueUsers = 1;
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
    unique_users: number;
    tools: Array<{ tool: string; count: number }>;
    event_types: Array<{ event_type: string; count: number }>;
    time_buckets: Array<{ bucket: string; count: number }>;
    files: Array<{ file_name: string; count: number }>;
    device_name?: string;
    user_id?: string;
    user_name?: string | null;
  } = {
    range,
    total_events: totalEvents,
    unique_devices: uniqueDevices,
    unique_users: uniqueUsers,
    tools: toolsResult.map((r) => ({ tool: r.tool, count: r.count })),
    event_types: eventTypesResult.map((r) => ({ event_type: r.eventType, count: r.count })),
    time_buckets: timeBucketsResult.map((r) => ({ bucket: r.bucket, count: r.count })),
    files: filesResult.map((r) => ({ file_name: r.fileName!, count: r.count })),
  };

  if (deviceName) {
    result.device_name = deviceName;
  }
  if (userId) {
    result.user_id = userId;
    result.user_name = userName;
  }

  return result;
}

/**
 * Get policy configuration for an organization
 */
export async function getOrgPolicyConfig(orgId: string): Promise<PolicyConfig | null> {
  const rows = await db
    .select({ policyConfig: orgs.policyConfig })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  
  if (rows.length === 0 || !rows[0].policyConfig) {
    return null;
  }
  
  // Return with defaults if config is null/empty
  const config = rows[0].policyConfig as PolicyConfig;
  return {
    llms: {
      chatgpt: config.llms?.chatgpt ?? true,
      gemini: config.llms?.gemini ?? true,
    },
    fileUpload: {
      logFileNames: config.fileUpload?.logFileNames ?? true,
    },
  };
}

/**
 * Get paginated list of organizations with counts (devices, events, ingest keys).
 * Used by platform admin interface.
 */
export async function getOrgsList(args: { limit: number; offset: number }) {
  const { limit, offset } = args;

  // Exclude Platform Admin org from queries
  const excludePlatformAdmin = ne(orgs.externalOrgId, env.PLATFORM_ADMIN_CLERK_ORG_ID);

  // Get total count (excluding Platform Admin)
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgs)
    .where(excludePlatformAdmin);
  const total = totalResult[0]?.count ?? 0;

  // Get orgs with counts (excluding Platform Admin)
  const orgsList = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      externalOrgId: orgs.externalOrgId,
      createdAt: orgs.createdAt,
    })
    .from(orgs)
    .where(excludePlatformAdmin)
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
 * Update policy configuration for an organization
 */
export async function updateOrgPolicyConfig(
  orgId: string,
  config: PolicyConfig
): Promise<PolicyConfig> {
  const updated = await db
    .update(orgs)
    .set({ policyConfig: config })
    .where(eq(orgs.id, orgId))
    .returning({ policyConfig: orgs.policyConfig });
  
  if (updated.length === 0) {
    throw new Error(`Organization ${orgId} not found`);
  }
  
  return updated[0].policyConfig as PolicyConfig;
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
