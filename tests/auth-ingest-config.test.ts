/**
 * Integration-style tests for /ingest and /config auth behavior.
 * Mocks Clerk/auth and db/queries at the boundary so we exercise real middleware and routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'crypto';
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

describe('POST /ingest and GET /config auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 with code AUTH_REQUIRED when Authorization header is missing (POST /ingest)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: {
        device_id: randomUUID(),
        device_name: 'test',
        events: [
          {
            id: randomUUID(),
            ts: new Date().toISOString(),
            tool: 'chatgpt',
            event_type: 'visit',
            url_host: 'chat.openai.com',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string; request_id?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 401 with code AUTH_REQUIRED when Authorization header is missing (GET /config)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 401 with code AUTH_REQUIRED when Bearer token is invalid (verify throws)', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('Token verification failed'));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { authorization: 'Bearer invalid-token' },
      payload: {
        device_id: randomUUID(),
        device_name: 'test',
        events: [
          {
            id: randomUUID(),
            ts: new Date().toISOString(),
            tool: 'chatgpt',
            event_type: 'visit',
            url_host: 'chat.openai.com',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mockVerifyToken).toHaveBeenCalledWith('invalid-token');
    await app.close();
  });

  it('returns 403 with code ORG_CONTEXT_REQUIRED when token has no org and Clerk API returns 0 orgs', async () => {
    mockVerifyToken.mockResolvedValueOnce({ clerkUserId: 'user_abc', tokenOrgId: null });
    mockGetOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer some-token' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('ORG_CONTEXT_REQUIRED');
    await app.close();
  });

  it('returns 403 with code ORG_MISMATCH_FOR_USER when user already linked to different org', async () => {
    const clerkUserId = 'user_abc';
    const clerkOrgId = 'org_clerk_123';
    const internalOrgId = randomUUID();
    const otherOrgId = randomUUID();
    mockVerifyToken.mockResolvedValueOnce({ clerkUserId, tokenOrgId: clerkOrgId });
    mockGetOrgByExternalOrgId.mockResolvedValueOnce({
      id: internalOrgId,
      slug: 'test-org',
      name: 'Test Org',
    });
    mockEnsureUserByExternalUid.mockRejectedValueOnce(
      new OrgMismatchForUserError(clerkUserId, otherOrgId, internalOrgId)
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code?: string };
    expect(body.code).toBe('ORG_MISMATCH_FOR_USER');
    await app.close();
  });

  it('returns 200 and config when token is valid and user/org ensured', async () => {
    const clerkUserId = 'user_abc';
    const clerkOrgId = 'org_clerk_123';
    const internalOrgId = randomUUID();
    const internalUserId = randomUUID();
    mockVerifyToken.mockResolvedValueOnce({ clerkUserId, tokenOrgId: clerkOrgId });
    mockGetOrgByExternalOrgId.mockResolvedValueOnce({
      id: internalOrgId,
      slug: 'test-org',
      name: 'Test Org',
    });
    mockEnsureUserByExternalUid.mockResolvedValueOnce({ id: internalUserId, orgId: internalOrgId });
    mockGetOrganizationMembershipList.mockResolvedValueOnce({
      data: [{ organization: { id: clerkOrgId }, role: 'org:member' }],
    });
    mockGetOrgPolicyConfig.mockResolvedValueOnce({
      llms: { chatgpt: true, gemini: true },
      fileUpload: { logFileNames: true },
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('llms');
    expect(body).toHaveProperty('fileUpload');
    expect(mockGetOrgPolicyConfig).toHaveBeenCalledWith(internalOrgId);
    await app.close();
  });
});
