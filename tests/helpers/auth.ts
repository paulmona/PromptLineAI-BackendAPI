/**
 * Authentication helpers for testing.
 * Provides preset user configurations for test scenarios.
 */

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
