/**
 * One-time backfill: set users.name from Clerk for users where name IS NULL and external_uid IS NOT NULL.
 * Run with: tsx scripts/backfill-user-names.ts
 */
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { clerkClient } from '../src/auth/clerk.js';
import logger from '../src/logger.js';

function clerkUserDisplayName(clerkUser: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string {
  const first = clerkUser.firstName?.trim() ?? '';
  const last = clerkUser.lastName?.trim() ?? '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  const username = clerkUser.username?.trim();
  if (username) return username;
  return 'User';
}

async function main() {
  const rows = await db
    .select({ id: users.id, externalUid: users.externalUid })
    .from(users)
    .where(and(isNull(users.name), isNotNull(users.externalUid)));

  logger.info({ count: rows.length }, 'Backfilling user names from Clerk');

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const externalUid = row.externalUid;
    if (!externalUid) continue;

    try {
      const clerkUser = await clerkClient.users.getUser(externalUid);
      const displayName = clerkUserDisplayName(clerkUser);

      await db.update(users).set({ name: displayName }).where(eq(users.id, row.id));

      updated++;
      logger.debug({ userId: row.id, name: displayName }, 'Updated user name');
    } catch (err) {
      failed++;
      logger.warn({ err, userId: row.id, externalUid }, 'Failed to fetch Clerk user for backfill');
    }
  }

  logger.info({ updated, failed, total: rows.length }, 'Backfill user names complete');
  await closeDatabase();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Backfill user names failed');
    process.exit(1);
  });
