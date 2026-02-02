/**
 * Tests for GET /summary endpoint.
 * Returns summary statistics for events within a time range.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { mockEnv, createMockOrg, createMockSummaryResponse } from './helpers/setup.js';
import { testUsers, createBearerToken } from './helpers/auth.js';
import { recordEndpointTest } from './helpers/coverage.js';

// Mock env before importing routes
vi.mock('../src/env.js', () => ({
  default: mockEnv,
}));

// Mock db module
vi.mock('../src/db/index.js', () => ({
  db: {},
  checkDatabaseConnection: vi.fn().mockResolvedValue(true),
  closeDatabase: vi.fn(),
}));

// Mock rate limiter
vi.mock('../src/auth/ingest-rate-limit.js', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}));

const mockVerifyToken = vi.fn();
const mockGetOrgByExternalOrgId = vi.fn();
const mockEnsureUserByExternalUid = vi.fn();
const mockGetOrganizationMembershipList = vi.fn();
const mockGetSummary = vi.fn();

vi.mock('../src/auth/clerk.js', () => ({
  verifyClerkBearerToken: (token: string) => mockVerifyToken(token),
  clerkClient: {
    users: {
      getOrganizationMembershipList: (args: unknown) => mockGetOrganizationMembershipList(args),
      getUser: vi.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User' }),
    },
    organizations: {
      getOrganization: vi.fn(),
    },
  },
}));

vi.mock('../src/db/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/queries.js')>();
  return {
    ...actual,
    getOrgByExternalOrgId: (id: string) => mockGetOrgByExternalOrgId(id),
    ensureUserByExternalUid: (args: unknown) => mockEnsureUserByExternalUid(args),
    getSummary: (orgId: string, range: string, userId?: string) => mockGetSummary(orgId, range, userId),
  };
});

import { summaryRoutes } from '../src/routes/summary.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ genReqId: () => randomUUID() });
  await app.register(summaryRoutes);
  return app;
}

function setupSuccessfulAuth(user = testUsers.regularMember, role = 'member') {
  const token = createBearerToken(user.clerkUserId);
  const org = createMockOrg({
    id: user.internalOrgId!,
    slug: user.orgSlug!,
    name: user.orgName!,
  });

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
    data: [{ organization: { id: user.clerkOrgId }, role: role === 'admin' ? 'org:admin' : 'org:member' }],
  });

  return { user, org, token };
}

describe('GET /summary', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('returns 401 when Authorization header is missing', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 401 when Authorization header is missing');

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when Bearer token is invalid', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 401 when Bearer token is invalid');

      mockVerifyToken.mockRejectedValueOnce(new Error('Token verification failed'));

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when user has no org membership', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 403 when user has no org membership');

      const token = createBearerToken('user_no_org');

      mockVerifyToken.mockResolvedValueOnce({
        clerkUserId: 'user_no_org',
        tokenOrgId: null,
      });

      mockGetOrganizationMembershipList.mockResolvedValueOnce({
        data: [],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('range parameter', () => {
    it('returns 200 with default range (24h) when no range specified', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 200 with default range (24h)');

      const { token, user } = setupSuccessfulAuth();
      const summaryData = createMockSummaryResponse({ range: '24h' });
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.range).toBe('24h');
      expect(mockGetSummary).toHaveBeenCalledWith(user.internalOrgId, '24h', undefined);
    });

    it('returns 200 with range=7d', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 200 with range=7d');

      const { token, user } = setupSuccessfulAuth();
      const summaryData = createMockSummaryResponse({ range: '7d' });
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: '/summary?range=7d',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.range).toBe('7d');
      expect(mockGetSummary).toHaveBeenCalledWith(user.internalOrgId, '7d', undefined);
    });

    it('returns 200 with range=30d', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 200 with range=30d');

      const { token, user } = setupSuccessfulAuth();
      const summaryData = createMockSummaryResponse({ range: '30d' });
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: '/summary?range=30d',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.range).toBe('30d');
      expect(mockGetSummary).toHaveBeenCalledWith(user.internalOrgId, '30d', undefined);
    });

    it('returns 400 for invalid range parameter', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 400 for invalid range parameter');

      const { token } = setupSuccessfulAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/summary?range=invalid',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid query parameters');
    });
  });

  describe('user_id filtering', () => {
    it('returns 200 when user requests their own stats', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 200 when user requests their own stats');

      const { token, user } = setupSuccessfulAuth();
      const summaryData = createMockSummaryResponse({ range: '24h' });
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: `/summary?user_id=${user.internalUserId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(mockGetSummary).toHaveBeenCalledWith(user.internalOrgId, '24h', user.internalUserId);
    });

    it('returns 403 when non-admin requests another user stats', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 403 when non-admin requests another user stats');

      // Explicitly use 'member' role to ensure this is a non-admin
      const { token } = setupSuccessfulAuth(testUsers.regularMember, 'member');
      const otherUserId = randomUUID();

      const res = await app.inject({
        method: 'GET',
        url: `/summary?user_id=${otherUserId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('returns 200 when admin requests another user stats', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 200 when admin requests another user stats');

      // Setup as org admin - this should allow viewing other users' stats
      const { token, user } = setupSuccessfulAuth(testUsers.orgAdmin, 'admin');
      const otherUserId = randomUUID();
      const summaryData = createMockSummaryResponse({ range: '24h' });
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: `/summary?user_id=${otherUserId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      // Verify getSummary was called with the other user's ID
      expect(mockGetSummary).toHaveBeenCalledWith(user.internalOrgId, '24h', otherUserId);
    });

    it('returns 400 when user_id is not a valid UUID', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 400 when user_id is not a valid UUID');

      const { token } = setupSuccessfulAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/summary?user_id=not-a-uuid',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid query parameters');
    });
  });

  describe('response structure', () => {
    it('returns summary with correct structure', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns summary with correct structure');

      const { token } = setupSuccessfulAuth();
      const summaryData = createMockSummaryResponse();
      mockGetSummary.mockResolvedValueOnce(summaryData);

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Verify response structure matches OpenAPI spec
      expect(body).toHaveProperty('range');
      expect(body).toHaveProperty('total_events');
      expect(body).toHaveProperty('unique_users');
      expect(body).toHaveProperty('tools');
      expect(body).toHaveProperty('event_types');
      expect(body).toHaveProperty('time_buckets');
      expect(body).toHaveProperty('files');

      expect(Array.isArray(body.tools)).toBe(true);
      expect(Array.isArray(body.event_types)).toBe(true);
      expect(Array.isArray(body.time_buckets)).toBe(true);
      expect(Array.isArray(body.files)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns 500 when database query fails', async () => {
      recordEndpointTest('GET', '/summary', 'summary.test.ts', 'returns 500 when database query fails');

      const { token } = setupSuccessfulAuth();
      mockGetSummary.mockRejectedValueOnce(new Error('Database connection lost'));

      const res = await app.inject({
        method: 'GET',
        url: '/summary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe('Internal server error');
    });
  });
});
