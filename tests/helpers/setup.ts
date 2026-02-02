/**
 * Shared test utilities and mock configurations.
 * Import these in test files to reduce duplication.
 */
import { randomUUID } from 'crypto';

/**
 * Mock environment configuration for tests.
 * Use this to mock ../src/env.js in test files.
 */
export const mockEnv = {
  PORT: 8787,
  CLERK_PUBLISHABLE_KEY: 'test_pk',
  CLERK_SECRET_KEY: 'test_sk',
  CLERK_FAPI_URL: 'https://test.clerk.accounts.dev',
  INGEST_KEY_PEPPER: 'test_pepper_that_is_at_least_32_chars_long',
  PLATFORM_ADMIN_CLERK_ORG_ID: 'org_test',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_NAME: 'testdb',
  DB_USER: 'testuser',
  DB_PASSWORD: 'testpass',
  DATABASE_URL: 'postgres://testuser:testpass@localhost:5432/testdb',
};

/**
 * Creates a mock authenticated user context.
 * Use for setting up auth-related tests.
 */
export function createAuthenticatedUser(overrides: Partial<{
  clerkUserId: string;
  clerkOrgId: string;
  internalOrgId: string;
  internalUserId: string;
}> = {}) {
  return {
    clerkUserId: overrides.clerkUserId ?? 'user_abc',
    clerkOrgId: overrides.clerkOrgId ?? 'org_clerk_123',
    internalOrgId: overrides.internalOrgId ?? randomUUID(),
    internalUserId: overrides.internalUserId ?? randomUUID(),
  };
}

/**
 * Creates a valid ingest request payload.
 * Use for POST /ingest tests.
 */
export function createValidIngestPayload(overrides: Partial<{
  device_id: string;
  device_name: string;
  events: Array<{
    id: string;
    ts: string;
    tool: string;
    event_type: string;
    url_host: string;
    [key: string]: unknown;
  }>;
}> = {}) {
  return {
    device_id: overrides.device_id ?? randomUUID(),
    device_name: overrides.device_name ?? 'test-device',
    events: overrides.events ?? [createValidEvent()],
  };
}

/**
 * Creates a valid event object.
 * Use for building ingest payloads.
 */
export function createValidEvent(overrides: Partial<{
  id: string;
  ts: string;
  tool: string;
  event_type: string;
  url_host: string;
  file_ext: string | null;
  file_size_kb: number | null;
  file_name: string | null;
  prompt_len_bucket: string | null;
  has_code_block: boolean | null;
  paste_detected: boolean | null;
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    ts: overrides.ts ?? new Date().toISOString(),
    tool: overrides.tool ?? 'chatgpt',
    event_type: overrides.event_type ?? 'visit',
    url_host: overrides.url_host ?? 'chat.openai.com',
    ...(overrides.file_ext !== undefined && { file_ext: overrides.file_ext }),
    ...(overrides.file_size_kb !== undefined && { file_size_kb: overrides.file_size_kb }),
    ...(overrides.file_name !== undefined && { file_name: overrides.file_name }),
    ...(overrides.prompt_len_bucket !== undefined && { prompt_len_bucket: overrides.prompt_len_bucket }),
    ...(overrides.has_code_block !== undefined && { has_code_block: overrides.has_code_block }),
    ...(overrides.paste_detected !== undefined && { paste_detected: overrides.paste_detected }),
  };
}

/**
 * Creates a mock org object as returned by getOrgByExternalOrgId.
 */
export function createMockOrg(overrides: Partial<{
  id: string;
  slug: string;
  name: string;
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    slug: overrides.slug ?? 'test-org',
    name: overrides.name ?? 'Test Org',
  };
}

/**
 * Creates a mock policy config as returned by getOrgPolicyConfig.
 */
export function createMockPolicyConfig(overrides: Partial<{
  llms: { chatgpt: boolean; gemini: boolean };
  fileUpload: { logFileNames: boolean };
}> = {}) {
  return {
    llms: overrides.llms ?? { chatgpt: true, gemini: true },
    fileUpload: overrides.fileUpload ?? { logFileNames: true },
  };
}

/**
 * Creates a mock /me response.
 */
export function createMockMeResponse(overrides: Partial<{
  user: { id: string };
  org: { id: string; name: string; slug: string };
}> = {}) {
  return {
    user: overrides.user ?? { id: randomUUID() },
    org: overrides.org ?? {
      id: randomUUID(),
      name: 'Test Organization',
      slug: 'test-org',
    },
  };
}

/**
 * Creates a mock summary response.
 */
export function createMockSummaryResponse(overrides: Partial<{
  range: '24h' | '7d' | '30d';
  total_events: number;
  unique_users: number;
  tools: Array<{ tool: string; count: number }>;
  event_types: Array<{ event_type: string; count: number }>;
  time_buckets: Array<{ bucket: string; count: number }>;
  files: Array<{ file_name: string; count: number }>;
}> = {}) {
  return {
    range: overrides.range ?? '24h',
    total_events: overrides.total_events ?? 100,
    unique_users: overrides.unique_users ?? 5,
    tools: overrides.tools ?? [
      { tool: 'chatgpt', count: 60 },
      { tool: 'claude', count: 40 },
    ],
    event_types: overrides.event_types ?? [
      { event_type: 'visit', count: 50 },
      { event_type: 'prompt_submit', count: 50 },
    ],
    time_buckets: overrides.time_buckets ?? [
      { bucket: '2026-01-16 17:00:00+00', count: 25 },
      { bucket: '2026-01-16 18:00:00+00', count: 25 },
    ],
    files: overrides.files ?? [],
  };
}

/**
 * Creates a mock org list item for /admin/orgs response.
 */
export function createMockOrgListItem(overrides: Partial<{
  id: string;
  name: string;
  slug: string | null;
  external_org_id: string | null;
  created_at: string;
  counts: {
    users_count: number;
    events_count: number;
    ingest_keys_count: number;
  };
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? 'Test Organization',
    slug: overrides.slug ?? 'test-org',
    external_org_id: overrides.external_org_id ?? `org_${randomUUID().substring(0, 8)}`,
    created_at: overrides.created_at ?? new Date().toISOString(),
    counts: overrides.counts ?? {
      users_count: 5,
      events_count: 100,
      ingest_keys_count: 2,
    },
  };
}

/**
 * Creates a mock org detail for /admin/orgs/{orgId} response.
 */
export function createMockOrgDetail(overrides: Partial<{
  id: string;
  name: string;
  slug: string | null;
  external_org_id: string | null;
  created_at: string;
  counts: {
    users_count: number;
    events_count: number;
    ingest_keys_count: number;
  };
}> = {}) {
  return createMockOrgListItem(overrides);
}

/**
 * Creates a mock org list response for /admin/orgs.
 */
export function createMockOrgListResponse(overrides: Partial<{
  orgs: ReturnType<typeof createMockOrgListItem>[];
  total: number;
  limit: number;
  offset: number;
}> = {}) {
  const orgs = overrides.orgs ?? [
    createMockOrgListItem({ name: 'Org 1', slug: 'org-1' }),
    createMockOrgListItem({ name: 'Org 2', slug: 'org-2' }),
  ];
  return {
    orgs,
    total: overrides.total ?? orgs.length,
    limit: overrides.limit ?? 50,
    offset: overrides.offset ?? 0,
  };
}

/**
 * Creates a mock revoke keys response.
 */
export function createMockRevokeKeysResponse(overrides: Partial<{
  revoked_count: number;
}> = {}) {
  return {
    revoked_count: overrides.revoked_count ?? 3,
  };
}
