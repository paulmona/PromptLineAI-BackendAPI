import { randomBytes } from 'crypto';
import env from '../src/env.js';
import logger from '../src/logger.js';
import { db } from '../src/db/index.js';
import { ingestKeys } from '../src/db/schema.js';
import { hashIngestKey } from '../src/db/ingest-keys.js';

function usage(): never {
  console.error('Usage: tsx scripts/create-ingest-key.ts <orgId> [name]');
  process.exit(2);
}

const [, , orgId, name] = process.argv;
if (!orgId) usage();

async function main() {
  // Generate 32 bytes, base64url (no padding)
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

  // IMPORTANT: Only print the raw key once. Never store it.
  console.log(JSON.stringify({ keyId: inserted[0].id, key: rawKey }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Failed to create ingest key');
    process.exit(1);
  });

