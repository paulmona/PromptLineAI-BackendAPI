/**
 * Tests for admin endpoints.
 * All admin endpoints require platform admin authorization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { mockEnv, createMockOrg, createMockOrgListResponse, createMockOrgDetail, createMockRevokeKeysResponse } from './helpers/setup.js';
import { testUsers, createBearerToken } from './helpers/auth.js';
import { recordEndpointTest } from './helpers/coverage.js';

// Mock env before importing routes
vi.mock('../src/env.js', () => ({
  default: mockEnv,
}));

// Mock db module
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation(async (fn) => fn({
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    })),
  },
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
const mockDeleteOrganization = vi.fn();
const mockGetOrgsList = vi.fn();
const mockGetOrgDetail = vi.fn();
const mockRevokeOrgIngestKeys = vi.fn();

vi.mock('../src/auth/clerk.js', () => ({
  verifyClerkBearerToken: (token: string) => mockVerifyToken(token),
  clerkClient: {
    users: {
      getOrganizationMembershipList: (args: unknown) => mockGetOrganizationMembershipList(args),
      getUser: vi.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User' }),
    },
    organizations: {
      getOrganization: (args: unknown) => mockGetOrganization(args),
      deleteOrganization: (id: string) => mockDeleteOrganization(id),
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
    getOrgsList: (args: unknown) => mockGetOrgsList(args),
    getOrgDetail: (id: string) => mockGetOrgDetail(id),
    revokeOrgIngestKeys: (id: string) => mockRevokeOrgIngestKeys(id),
  };
});

import { adminRoutes } from '../src/routes/admin.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ genReqId: () => randomUUID() });
  await app.register(adminRoutes);
  return app;
}

function setupPlatformAdminAuth() {
  const user = testUsers.platformAdmin;
  const token = createBearerToken(user.clerkUserId);
  const org = createMockOrg({
    id: user.internalOrgId!,
    slug: user.orgSlug!,
    name: user.orgName!,
  });

  mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: user.clerkUserId,
    tokenOrgId: user.clerkOrgId, // org_test matches PLATFORM_ADMIN_CLERK_ORG_ID
  });

  mockGetOrgByExternalOrgId.mockResolvedValueOnce(org);

  mockEnsureUserByExternalUid.mockResolvedValueOnce({
    id: user.internalUserId,
    orgId: user.internalOrgId,
  });

  mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [{ organization: { id: user.clerkOrgId }, role: 'org:admin' }],
  });

  return { user, org, token };
}

function setupNonAdminAuth() {
  const user = testUsers.regularMember;
  const token = createBearerToken(user.clerkUserId);
  const org = createMockOrg({
    id: user.internalOrgId!,
    slug: user.orgSlug!,
    name: user.orgName!,
  });

  mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: user.clerkUserId,
    tokenOrgId: user.clerkOrgId, // org_regular does NOT match PLATFORM_ADMIN_CLERK_ORG_ID
  });

  mockGetOrgByExternalOrgId.mockResolvedValueOnce(org);

  mockEnsureUserByExternalUid.mockResolvedValueOnce({
    id: user.internalUserId,
    orgId: user.internalOrgId,
  });

  mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [{ organization: { id: user.clerkOrgId }, role: 'org:member' }],
  });

  return { user, org, token };
}

describe('Admin endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /admin/orgs', () => {
    it('returns 401 when Authorization header is missing', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 401 when Authorization header is missing');

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('AUTH_REQUIRED');
    });

    it('returns 403 when user is not platform admin', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 403 when user is not platform admin');

      const { token } = setupNonAdminAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain('platform admin');
    });

    it('returns 200 with default pagination', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 200 with default pagination');

      const { token } = setupPlatformAdminAuth();
      const mockResponse = createMockOrgListResponse();
      mockGetOrgsList.mockResolvedValueOnce(mockResponse);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('orgs');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.orgs)).toBe(true);
      expect(mockGetOrgsList).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });

    it('returns 200 with custom limit and offset', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 200 with custom limit and offset');

      const { token } = setupPlatformAdminAuth();
      const mockResponse = createMockOrgListResponse({ limit: 10, offset: 20 });
      mockGetOrgsList.mockResolvedValueOnce(mockResponse);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs?limit=10&offset=20',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(mockGetOrgsList).toHaveBeenCalledWith({ limit: 10, offset: 20 });
    });

    it('returns 400 for invalid query parameters', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 400 for invalid query parameters');

      const { token } = setupPlatformAdminAuth();

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs?limit=invalid',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid query parameters');
    });

    it('returns 500 when database query fails', async () => {
      recordEndpointTest('GET', '/admin/orgs', 'admin.test.ts', 'returns 500 when database query fails');

      const { token } = setupPlatformAdminAuth();
      mockGetOrgsList.mockRejectedValueOnce(new Error('Database error'));

      const res = await app.inject({
        method: 'GET',
        url: '/admin/orgs',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('GET /admin/orgs/:orgId', () => {
    it('returns 200 with org detail', async () => {
      recordEndpointTest('GET', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 200 with org detail');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      const mockOrg = createMockOrgDetail({ id: orgId });
      mockGetOrgDetail.mockResolvedValueOnce(mockOrg);

      const res = await app.inject({
        method: 'GET',
        url: `/admin/orgs/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(orgId);
      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('slug');
    });

    it('returns 404 when org not found', async () => {
      recordEndpointTest('GET', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 404 when org not found');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      mockGetOrgDetail.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/admin/orgs/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Organization not found');
    });

    it('returns 500 when database query fails', async () => {
      recordEndpointTest('GET', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 500 when database query fails');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      mockGetOrgDetail.mockRejectedValueOnce(new Error('Connection lost'));

      const res = await app.inject({
        method: 'GET',
        url: `/admin/orgs/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /admin/orgs/:orgId/revoke-ingest-keys', () => {
    it('returns 200 with revoked count', async () => {
      recordEndpointTest('POST', '/admin/orgs/{orgId}/revoke-ingest-keys', 'admin.test.ts', 'returns 200 with revoked count');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      const mockOrg = createMockOrgDetail({ id: orgId });
      mockGetOrgDetail.mockResolvedValueOnce(mockOrg);
      mockRevokeOrgIngestKeys.mockResolvedValueOnce(3);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/orgs/${orgId}/revoke-ingest-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revoked_count).toBe(3);
    });

    it('returns 404 when org not found', async () => {
      recordEndpointTest('POST', '/admin/orgs/{orgId}/revoke-ingest-keys', 'admin.test.ts', 'returns 404 when org not found');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      mockGetOrgDetail.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/orgs/${orgId}/revoke-ingest-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Organization not found');
    });

    it('returns 500 when database operation fails', async () => {
      recordEndpointTest('POST', '/admin/orgs/{orgId}/revoke-ingest-keys', 'admin.test.ts', 'returns 500 when database operation fails');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      const mockOrg = createMockOrgDetail({ id: orgId });
      mockGetOrgDetail.mockResolvedValueOnce(mockOrg);
      mockRevokeOrgIngestKeys.mockRejectedValueOnce(new Error('Transaction failed'));

      const res = await app.inject({
        method: 'POST',
        url: `/admin/orgs/${orgId}/revoke-ingest-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('DELETE /admin/orgs/:orgId', () => {
    it('returns 400 when X-ADMIN-CONFIRM header is missing', async () => {
      recordEndpointTest('DELETE', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 400 when X-ADMIN-CONFIRM header is missing');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/orgs/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Confirmation required');
      expect(body.message).toContain('X-ADMIN-CONFIRM');
    });

    it('returns 400 when X-ADMIN-CONFIRM header has wrong value', async () => {
      recordEndpointTest('DELETE', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 400 when X-ADMIN-CONFIRM header has wrong value');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/orgs/${orgId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-admin-confirm': 'WRONG',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Confirmation required');
    });

    it('returns 404 when org not found', async () => {
      recordEndpointTest('DELETE', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 404 when org not found');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();

      // Mock the db.select chain to return empty array (org not found)
      const mockDb = await import('../src/db/index.js');
      vi.mocked(mockDb.db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any);

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/orgs/${orgId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-admin-confirm': 'DELETE',
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Organization not found');
    });

    it('returns 204 on successful deletion', async () => {
      recordEndpointTest('DELETE', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 204 on successful deletion');

      const { token } = setupPlatformAdminAuth();
      const orgId = randomUUID();
      const externalOrgId = `org_${randomUUID().substring(0, 8)}`;

      // Mock the db.select chain to return the org
      const mockDb = await import('../src/db/index.js');
      vi.mocked(mockDb.db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: orgId, externalOrgId }]),
          }),
        }),
      } as any);

      // Mock transaction
      vi.mocked(mockDb.db.transaction).mockImplementation(async (fn) => {
        return fn({
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        } as any);
      });

      // Mock Clerk organization lookup and deletion
      mockGetOrganization.mockResolvedValueOnce({ id: externalOrgId, name: 'Test Org' });
      mockDeleteOrganization.mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/orgs/${orgId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-admin-confirm': 'DELETE',
        },
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 403 when user is not platform admin', async () => {
      recordEndpointTest('DELETE', '/admin/orgs/{orgId}', 'admin.test.ts', 'returns 403 when user is not platform admin');

      const { token } = setupNonAdminAuth();
      const orgId = randomUUID();

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/orgs/${orgId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-admin-confirm': 'DELETE',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toContain('platform admin');
    });
  });
});
