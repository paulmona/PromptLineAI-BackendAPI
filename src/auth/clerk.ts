import { createClerkClient, verifyToken } from '@clerk/backend';
import env from '../env.js';

export const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
});

export type ClerkVerified = {
  clerkUserId: string;
  tokenOrgId: string | null;
};

export async function verifyClerkBearerToken(token: string): Promise<ClerkVerified> {
  // NOTE: We intentionally do not log tokens.
  const verified = await verifyToken(token, {
    secretKey: env.CLERK_SECRET_KEY,
  });

  // `verifyToken` returns a payload with standard claims; Clerk adds `org_id` when active org is set.
  const payload = verified.payload as Record<string, unknown>;

  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) {
    throw new Error('Invalid Clerk token: missing sub');
  }

  const orgId = payload.org_id;
  const tokenOrgId = typeof orgId === 'string' && orgId ? orgId : null;

  return { clerkUserId: sub, tokenOrgId };
}

