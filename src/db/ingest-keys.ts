import { and, eq, isNull } from 'drizzle-orm';
import { createHmac, randomBytes } from 'crypto';
import env from '../env.js';
import { db } from './index.js';
import { ingestKeys } from './schema.js';

export function hashIngestKey(rawKey: string): string {
  // Fail fast if env misconfigured (prevents silent 401s that are hard to debug)
  if (!env.INGEST_KEY_PEPPER) {
    throw new Error('INGEST_KEY_PEPPER is required');
  }

  return createHmac('sha256', env.INGEST_KEY_PEPPER).update(rawKey).digest('hex');
}

export async function resolveOrgIdFromIngestKey(rawKey: string): Promise<{ orgId: string; keyId: string } | null> {
  const keyHash = hashIngestKey(rawKey);
  return resolveOrgIdFromIngestKeyHash(keyHash);
}

export async function resolveOrgIdFromIngestKeyHash(keyHash: string): Promise<{ orgId: string; keyId: string } | null> {
  const rows = await db
    .select({ orgId: ingestKeys.orgId, keyId: ingestKeys.id })
    .from(ingestKeys)
    .where(and(eq(ingestKeys.keyHash, keyHash), isNull(ingestKeys.revokedAt)))
    .limit(1);

  return rows[0] ?? null;
}

export async function createIngestKey(
  orgId: string,
  name?: string
): Promise<{ key: string; id: string; createdAt: Date }> {
  // Generate 32 bytes, base64url (no padding) - same as script
  const rawKey = randomBytes(32).toString('base64url');
  const keyHash = hashIngestKey(rawKey);

  const inserted = await db
    .insert(ingestKeys)
    .values({
      orgId,
      keyHash,
      name: name ?? null,
    })
    .returning({ id: ingestKeys.id, createdAt: ingestKeys.createdAt });

  // Return raw key ONLY ONCE - never store it
  return {
    key: rawKey,
    id: inserted[0].id,
    createdAt: inserted[0].createdAt,
  };
}

