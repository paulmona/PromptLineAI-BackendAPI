import { pgTable, uuid, text, varchar, timestamp, integer, boolean, jsonb, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums exactly as in schema.sql
export const aiToolEnum = pgEnum('ai_tool', ['chatgpt', 'claude', 'gemini', 'grok', 'unknown']);
export const aiEventTypeEnum = pgEnum('ai_event_type', ['visit', 'prompt_submit', 'file_selected']);
export const promptLenBucketEnum = pgEnum('prompt_len_bucket', ['0-200', '200-1000', '1000+']);

export const orgs = pgTable('orgs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  externalOrgId: text('external_org_id'),
  slug: text('slug'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  policyConfig: jsonb('policy_config').default({
    llms: { chatgpt: true, gemini: true },
    fileUpload: { logFileNames: true }
  }),
});

// NOTE: `users` table is referenced by existing FKs in schema.sql but not included in the dump.
// We only model the columns we read/write in this POC, and migrations add them if missing.
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  externalUid: text('external_uid'),
  orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'set null' }),
});

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  userAgent: text('user_agent'),
  notes: text('notes'),
  deviceName: varchar('device_name', { length: 64 }).notNull().default('unassigned'),
});

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    tool: aiToolEnum('tool').notNull(),
    eventType: aiEventTypeEnum('event_type').notNull(),
    urlHost: text('url_host').notNull(),
    fileExt: text('file_ext'),
    fileSizeKb: integer('file_size_kb'),
    fileName: text('file_name'),
    promptLenBucket: promptLenBucketEnum('prompt_len_bucket'),
    hasCodeBlock: boolean('has_code_block'),
    pasteDetected: boolean('paste_detected'),
    extra: jsonb('extra'),
  },
  (table) => ({
    fileSizeNonnegCheck: check('events_file_size_nonneg_chk', sql`(${table.fileSizeKb} IS NULL OR ${table.fileSizeKb} >= 0)`),
  })
);

export const ingestKeys = pgTable('ingest_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
