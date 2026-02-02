/**
 * Authentication helpers and Clerk mock utilities for testing.
 * Provides preset user configurations and mock setup functions.
 */
import { vi } from 'vitest';

/**
 * Test user configurations with predefined roles.
 *
 * UUIDs are deterministic (not random) to make debugging easier:
 * - Search logs for these exact UUIDs
 * - Consistent between test runs
 * - Easy to identify which test user generated a log entry
 */
export const testUsers = {
  regularMember: {
    clerkUserId: 'user_regular_member',
    clerkOrgId: 'org_regular',
    // Deterministic UUIDs: "11111111" prefix = regular member
    internalUserId: '11111111-1111-1111-1111-111111111111',
    internalOrgId: '11111111-2222-2222-2222-222222222222',
    orgSlug: 'test-org',
    orgName: 'Test Organization',
  },
  orgAdmin: {
    clerkUserId: 'user_org_admin',
    clerkOrgId: 'org_admin_org',
    // Deterministic UUIDs: "22222222" prefix = org admin
    internalUserId: '22222222-1111-1111-1111-111111111111',
    internalOrgId: '22222222-2222-2222-2222-222222222222',
    orgSlug: 'admin-org',
    orgName: 'Admin Organization',
  },
  platformAdmin: {
    clerkUserId: 'user_platform_admin',
    clerkOrgId: 'org_test', // Matches PLATFORM_ADMIN_CLERK_ORG_ID in mockEnv
    // Deterministic UUIDs: "33333333" prefix = platform admin
    internalUserId: '33333333-1111-1111-1111-111111111111',
    internalOrgId: '33333333-2222-2222-2222-222222222222',
    orgSlug: 'platform-admin',
    orgName: 'Platform Admin Org',
  },
  noOrgUser: {
    clerkUserId: 'user_no_org',
    clerkOrgId: null,
    // Deterministic UUIDs: "44444444" prefix = no org user
    internalUserId: '44444444-1111-1111-1111-111111111111',
    internalOrgId: null,
    orgSlug: null,
    orgName: null,
  },
};

/**
 * Creates a mock Bearer token string.
 * Returns a fake JWT-like string for testing.
 */
export function createBearerToken(userId: string = 'test_user'): string {
  // Create a fake JWT structure (header.payload.signature)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString('base64url');
  const signature = Buffer.from('fake_signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Interface for mock functions used in auth testing.
 */
export interface AuthMocks {
  mockVerifyToken: ReturnType<typeof vi.fn>;
  mockGetOrgByExternalOrgId: ReturnType<typeof vi.fn>;
  mockEnsureOrgByExternalOrgId: ReturnType<typeof vi.fn>;
  mockEnsureUserByExternalUid: ReturnType<typeof vi.fn>;
  mockGetOrganizationMembershipList: ReturnType<typeof vi.fn>;
  mockGetOrganization: ReturnType<typeof vi.fn>;
}

/**
 * Setup mocks for an authenticated user with org context.
 */
export function setupAuthenticatedUser(
  mocks: AuthMocks,
  user: typeof testUsers.regularMember = testUsers.regularMember
): { user: typeof user; token: string } {
  const token = createBearerToken(user.clerkUserId);

  mocks.mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: user.clerkUserId,
    tokenOrgId: user.clerkOrgId,
  });

  if (user.clerkOrgId) {
    mocks.mockGetOrgByExternalOrgId.mockResolvedValueOnce({
      id: user.internalOrgId,
      slug: user.orgSlug,
      name: user.orgName,
    });

    mocks.mockEnsureUserByExternalUid.mockResolvedValueOnce({
      id: user.internalUserId,
      orgId: user.internalOrgId,
    });

    mocks.mockGetOrganizationMembershipList.mockResolvedValueOnce({
      data: [{ organization: { id: user.clerkOrgId }, role: 'org:member' }],
    });
  }

  return { user, token };
}

/**
 * Setup mocks for a platform admin user.
 */
export function setupPlatformAdmin(
  mocks: AuthMocks
): { user: typeof testUsers.platformAdmin; token: string } {
  return setupAuthenticatedUser(mocks, testUsers.platformAdmin);
}

/**
 * Setup mocks for an unauthenticated request (token verification fails).
 */
export function setupUnauthenticated(mocks: AuthMocks): void {
  mocks.mockVerifyToken.mockRejectedValueOnce(new Error('Token verification failed'));
}

/**
 * Setup mocks for a user with no org membership.
 */
export function setupUserWithNoOrg(mocks: AuthMocks): { token: string } {
  const token = createBearerToken(testUsers.noOrgUser.clerkUserId);

  mocks.mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: testUsers.noOrgUser.clerkUserId,
    tokenOrgId: null,
  });

  mocks.mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [],
  });

  return { token };
}

/**
 * Setup mocks for a user with multiple orgs (ambiguous context).
 */
export function setupUserWithMultipleOrgs(mocks: AuthMocks): { token: string } {
  const token = createBearerToken('user_multi_org');

  mocks.mockVerifyToken.mockResolvedValueOnce({
    clerkUserId: 'user_multi_org',
    tokenOrgId: null,
  });

  mocks.mockGetOrganizationMembershipList.mockResolvedValueOnce({
    data: [
      { organization: { id: 'org_1' }, role: 'org:member' },
      { organization: { id: 'org_2' }, role: 'org:admin' },
    ],
  });

  return { token };
}

/**
 * Create a fresh set of auth mocks.
 * Call this in beforeEach to get clean mocks for each test.
 */
export function createAuthMocks(): AuthMocks {
  return {
    mockVerifyToken: vi.fn(),
    mockGetOrgByExternalOrgId: vi.fn(),
    mockEnsureOrgByExternalOrgId: vi.fn(),
    mockEnsureUserByExternalUid: vi.fn(),
    mockGetOrganizationMembershipList: vi.fn(),
    mockGetOrganization: vi.fn(),
  };
}
