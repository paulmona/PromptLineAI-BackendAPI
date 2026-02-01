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
