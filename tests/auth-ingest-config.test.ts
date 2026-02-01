/**
 * Integration-style tests for /ingest and /config auth behavior.
 * Mocks Clerk/auth and db/queries at the boundary so we exercise real middleware and routes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import {
  mockEnv,
  createAuthenticatedUser,
  createValidIngestPayload,
  createValidEvent,
  createMockOrg,
  createMockPolicyConfig,
} from './helpers/setup.js';

// Mock env to avoid process.exit on missing env vars - must be before route imports
vi.mock('../src/env.js', () => ({
  default: mockEnv,
}));

// Mock db module to prevent actual database connections
vi.mock('../src/db/index.js', () => ({
  db: {
    transaction: vi.fn((callback) => callback({})),
  },
  checkDatabaseConnection: vi.fn().mockResolvedValue(true),
  closeDatabase: vi.fn(),
}));

// Mock rate limiter to always allow
vi.mock('../src/auth/ingest-rate-limit.js', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}));

import { ingestRoutes } from '../src/routes/ingest.js';
import { policyRoutes } from '../src/routes/policy.js';
import { OrgMismatchForUserError } from '../src/db/queries.js';

const mockVerifyToken = vi.fn();
const mockGetOrgByExternalOrgId = vi.fn();
const mockEnsureOrgByExternalOrgId = vi.fn();
const mockEnsureUserByExternalUid = vi.fn();
const mockGetOrgPolicyConfig = vi.fn();
const mockGetOrganizationMembershipList = vi.fn();
const mockGetOrganization = vi.fn();
const mockUpsertDeviceReturningOrgId = vi.fn();
const mockInsertEvents = vi.fn();

vi.mock('../src/auth/clerk.js', () => ({
  verifyClerkBearerToken: (token: string) => mockVerifyToken(token),
  clerkClient: {
    users: {
      getOrganizationMembershipList: (args: unknown) => mockGetOrganizationMembershipList(args),
    },
    organizations: {
      getOrganization: (args: unknown) => mockGetOrganization(args),
    },
  },
}));

vi.mock('../src/db/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/queries.js')>();
  return {
    ...actual,
    getOrgByExternalOrgId: (id: string) => mockGetOrgByExternalOrgId(id),
    ensureOrgByExternalOrgId: (args: unknown) => mockEnsureOrgByExternalOrgId(args),
    ensureUserByExternalUid: (args: unknown) => mockEnsureUserByExternalUid(args),
    getOrgPolicyConfig: (orgId: string) => mockGetOrgPolicyConfig(orgId),
    upsertDeviceReturningOrgId: (_tx: unknown, args: unknown) => mockUpsertDeviceReturningOrgId(args),
    insertEvents: (_tx: unknown, events: unknown) => mockInsertEvents(events),
  };
});

async function buildTestApp() {
  const app = Fastify({
    genReqId: () => randomUUID(),
  });
  await app.register(ingestRoutes);
  await app.register(policyRoutes);
  return app;
}

/**
 * Helper to set up successful auth mocks for a user.
 * Returns the user context for assertions.
 */
function setupSuccessfulAuth(user = createAuthenticatedUser()) {
  const org = createMockOrg({ id: user.internalOrgId });

  mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: user.clerkUserId,
    tokenOrgId: user.clerkOrgId,
  });
  mockGetOrgByExternalOrgId.mockResolvedValueOnce(org);
  mockEnsureUserByExternalUid.mockResolvedValueOnce({
    id: user.internalUserId,
    orgId: user.internalOrgId,
  });
  mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [{ organization: { id: user.clerkOrgId }, role: 'org:member' }],
  });

  return { user, org };
}

describe('POST /ingest and GET /config auth', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ==================== AUTH ERROR TESTS ====================

  it('returns 401 with code AUTH_REQUIRED when Authorization header is missing (POST /ingest)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: createValidIngestPayload(),
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string; request_id?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 with code AUTH_REQUIRED when Authorization header is missing (GET /config)', async () => {
    const res = await app.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 with code AUTH_REQUIRED when Bearer token is invalid (verify throws)', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('Token verification failed'));
    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer invalid-token' },
      payload: createValidIngestPayload(),
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).toHaveBeenCalledWith('invalid-token');
  });

  it('returns 403 with code ORG_CONTEXT_REQUIRED when token has no org and Clerk API returns 0 orgs', async () => {
    mockVerifyToken.mockResolvedValueOnce({ clerkUserId: 'user_abc', tokenOrgId: null });
    mockGetOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer some-token' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('ORG_CONTEXT_REQUIRED');
  });

  it('returns 403 with code ORG_MISMATCH_FOR_USER when user already linked to different org', async () => {
    const user = createAuthenticatedUser();
    const otherOrgId = randomUUID();
    mockVerifyToken.mockResolvedValueOnce({ clerkUserId: user.clerkUserId, tokenOrgId: user.clerkOrgId });
    mockGetOrgByExternalOrgId.mockResolvedValueOnce(createMockOrg({ id: user.internalOrgId }));
    mockEnsureUserByExternalUid.mockRejectedValueOnce(
      new OrgMismatchForUserError(user.clerkUserId, otherOrgId, user.internalOrgId)
    );
    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('ORG_MISMATCH_FOR_USER');
  });

  // ==================== GET /config HAPPY PATH ====================

  it('returns 200 and config when token is valid and user/org ensured', async () => {
    const { user } = setupSuccessfulAuth();
    const policyConfig = createMockPolicyConfig();
    mockGetOrgPolicyConfig.mockResolvedValueOnce(policyConfig);

    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('llms');
    expect(body).toHaveProperty('fileUpload');
    expect(mockGetOrgPolicyConfig).toHaveBeenCalledWith(user.internalOrgId);
  });

  // ==================== POST /ingest HAPPY PATH ====================

  it('returns 200 and ingests events when auth is valid', async () => {
    const { user, org } = setupSuccessfulAuth();
    const payload = createValidIngestPayload();

    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: org.id });
    mockInsertEvents.mockResolvedValueOnce({ attempted: 1, inserted: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { attempted: number; inserted: number };
    expect(body).toEqual({ attempted: 1, inserted: 1 });
    expect(mockUpsertDeviceReturningOrgId).toHaveBeenCalled();
    expect(mockInsertEvents).toHaveBeenCalled();
  });

  it('returns 200 and ingests multiple events', async () => {
    const { user, org } = setupSuccessfulAuth();
    const events = [
      createValidEvent({ tool: 'chatgpt', event_type: 'visit' }),
      createValidEvent({ tool: 'claude', event_type: 'prompt_submit' }),
      createValidEvent({ tool: 'gemini', event_type: 'file_selected', file_name: 'test.pdf' }),
    ];
    const payload = createValidIngestPayload({ events });

    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: org.id });
    mockInsertEvents.mockResolvedValueOnce({ attempted: 3, inserted: 3 });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { attempted: number; inserted: number };
    expect(body).toEqual({ attempted: 3, inserted: 3 });
  });

  it('returns correct count when some events are duplicates (idempotency)', async () => {
    const { org } = setupSuccessfulAuth();
    const payload = createValidIngestPayload();

    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: org.id });
    // Simulate 1 event attempted but 0 inserted (duplicate)
    mockInsertEvents.mockResolvedValueOnce({ attempted: 1, inserted: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { attempted: number; inserted: number };
    expect(body).toEqual({ attempted: 1, inserted: 0 });
  });
});

// ==================== VALIDATION ERROR TESTS ====================

describe('POST /ingest validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when events array is empty', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload({ events: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when device_id is missing', async () => {
    setupSuccessfulAuth();
    const payload = {
      device_name: 'test-device',
      events: [createValidEvent()],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when device_id is not a valid UUID', async () => {
    setupSuccessfulAuth();
    const payload = {
      device_id: 'not-a-uuid',
      device_name: 'test-device',
      events: [createValidEvent()],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when device_name is empty', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload({ device_name: '' });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when event has invalid event_type', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload({
      events: [createValidEvent({ event_type: 'invalid_type' })],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when event id is not a valid UUID', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload({
      events: [createValidEvent({ id: 'not-a-uuid' })],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when event timestamp is invalid', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload({
      events: [createValidEvent({ ts: 'not-a-timestamp' })],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when events exceed max limit of 50', async () => {
    setupSuccessfulAuth();
    const events = Array.from({ length: 51 }, () => createValidEvent());
    const payload = createValidIngestPayload({ events });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it('maps unknown tool values to "unknown" (does not reject)', async () => {
    const { org } = setupSuccessfulAuth();
    const payload = createValidIngestPayload({
      events: [createValidEvent({ tool: 'some-future-tool' })],
    });

    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: org.id });
    mockInsertEvents.mockResolvedValueOnce({ attempted: 1, inserted: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    // Should succeed - unknown tools are mapped to 'unknown', not rejected
    expect(res.statusCode).toBe(200);
  });
});

// ==================== DATABASE FAILURE TESTS ====================

describe('database failure handling', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 500 when database insert fails on /ingest', async () => {
    const { org } = setupSuccessfulAuth();
    const payload = createValidIngestPayload();

    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: org.id });
    mockInsertEvents.mockRejectedValueOnce(new Error('Connection lost'));

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Internal server error');
  });

  it('returns 500 when device upsert fails on /ingest', async () => {
    setupSuccessfulAuth();
    const payload = createValidIngestPayload();

    mockUpsertDeviceReturningOrgId.mockRejectedValueOnce(new Error('Database unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(500);
  });

  it('returns 409 when device belongs to different organization', async () => {
    const { org } = setupSuccessfulAuth();
    const differentOrgId = randomUUID();
    const payload = createValidIngestPayload();

    // Device returns a different org_id than expected
    mockUpsertDeviceReturningOrgId.mockResolvedValueOnce({ orgId: differentOrgId });

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer valid-token' },
      payload,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { code: string };
    expect(body.code).toBe('DEVICE_ORG_MISMATCH');
  });

  it('returns 500 when getOrgPolicyConfig fails on /config', async () => {
    setupSuccessfulAuth();
    mockGetOrgPolicyConfig.mockRejectedValueOnce(new Error('Query timeout'));

    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(500);
  });

  it('returns default config when getOrgPolicyConfig returns null', async () => {
    setupSuccessfulAuth();
    mockGetOrgPolicyConfig.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });

    // Should return 200 with default config, not error
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('llms');
    expect(body).toHaveProperty('fileUpload');
  });
});
