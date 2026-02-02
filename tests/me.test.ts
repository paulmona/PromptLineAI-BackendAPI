/**
 * Tests for GET /me endpoint.
 * Returns authenticated user and organization information.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { mockEnv, createMockOrg } from './helpers/setup.js';
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
const mockEnsureOrgByExternalOrgId = vi.fn();
const mockEnsureUserByExternalUid = vi.fn();
const mockGetOrganizationMembershipList = vi.fn();
const mockGetOrganization = vi.fn();

vi.mock('../src/auth/clerk.js', () => ({
  verifyClerkBearerToken: (token: string) => mockVerifyToken(token),
  clerkClient: {
    users: {
      getOrganizationMembershipList: (args: unknown) => mockGetOrganizationMembershipList(args),
      getUser: vi.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User' }),
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
  };
});

import { meRoutes } from '../src/routes/me.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ genReqId: () => randomUUID() });
  await app.register(meRoutes);
  return app;
}

/**
 * Sets up mocks for successful authentication.
 *
 * IMPORTANT: getOrgByExternalOrgId is called TWICE:
 * 1. First call: by requireClerkAuth middleware (to populate authContext)
 * 2. Second call: by the /me route handler (to get fresh org data)
 *
 * By default, this function mocks BOTH calls to return the same org.
 * For edge cases where the route handler should receive different data,
 * use the `routeOrgResponse` parameter.
 */
function setupSuccessfulAuth(
  user = testUsers.regularMember,
  routeOrgResponse?: ReturnType<typeof createMockOrg> | null
) {
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

  // First call: middleware uses this to populate authContext
  mockGetOrgByExternalOrgId.mockResolvedValueOnce(org);

  mockEnsureUserByExternalUid.mockResolvedValueOnce({
    id: user.internalUserId,
    orgId: user.internalOrgId,
  });

  mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [{ organization: { id: user.clerkOrgId }, role: 'org:member' }],
  });

  // Second call: route handler uses this to get org details for response
  // Use routeOrgResponse if provided, otherwise use the same org
  const routeOrg = routeOrgResponse !== undefined ? routeOrgResponse : org;
  mockGetOrgByExternalOrgId.mockResolvedValueOnce(routeOrg);

  return { user, org, token };
}

describe('GET /me', () => {
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
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 401 when Authorization header is missing');

      const res = await app.inject({
        method: 'GET',
        url: '/me',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when Bearer token is invalid', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 401 when Bearer token is invalid');

      mockVerifyToken.mockRejectedValueOnce(new Error('Token verification failed'));

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when user has no org membership', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 403 when user has no org membership');

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
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('success cases', () => {
    it('returns 200 with user and org when authenticated', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 200 with user and org when authenticated');

      // setupSuccessfulAuth now mocks both middleware and route handler calls
      const { token, user } = setupSuccessfulAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('user');
      expect(body).toHaveProperty('org');
      expect(body.org.slug).toBe(user.orgSlug);
      expect(body.org.name).toBe(user.orgName);
    });

    it('returns org details with correct structure', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns org details with correct structure');

      // setupSuccessfulAuth now mocks both middleware and route handler calls
      const { token } = setupSuccessfulAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Verify response structure matches OpenAPI spec
      expect(body.user).toHaveProperty('id');
      expect(body.org).toHaveProperty('id');
      expect(body.org).toHaveProperty('name');
      expect(body.org).toHaveProperty('slug');
    });
  });

  describe('edge cases', () => {
    it('returns 403 when org has no slug', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 403 when org has no slug');

      // Use routeOrgResponse to simulate org without slug in route handler response
      const orgWithoutSlug = {
        id: randomUUID(),
        name: 'Test Org',
        slug: null,
        externalOrgId: 'org_test',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { token } = setupSuccessfulAuth(testUsers.regularMember, orgWithoutSlug);

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain('not provisioned');
    });

    it('returns 403 when org not found', async () => {
      recordEndpointTest('GET', '/me', 'me.test.ts', 'returns 403 when org not found');

      // Use routeOrgResponse=null to simulate org not found in route handler
      const { token } = setupSuccessfulAuth(testUsers.regularMember, null);

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
