import { createClerkClient, verifyToken } from '@clerk/backend';
import env from '../env.js';
import logger from '../logger.js';

export const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
});

export type ClerkVerified = {
  clerkUserId: string;
  tokenOrgId: string | null;
};

export async function verifyClerkBearerToken(token: string): Promise<ClerkVerified> {
  // NOTE: We intentionally do not log full tokens.
  // Log token prefix for debugging (first 20 chars + "..." if longer)
  const tokenPrefix = token.length > 20 ? `${token.substring(0, 20)}...` : token.substring(0, token.length);
  logger.debug({ tokenPrefix, tokenLength: token.length }, 'Verifying Clerk token');

  // Validate token format (should be a JWT: three base64 parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid token format: expected JWT with 3 parts, got ${parts.length}`);
  }

  let verified;
  try {
    verified = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });
  } catch (err) {
    logger.error({ err, tokenPrefix }, 'Token verification failed');
    throw new Error(`Token verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!verified) {
    throw new Error('Token verification returned null/undefined');
  }

  // Log the structure of what verifyToken returned for debugging
  logger.debug(
    {
      hasPayload: 'payload' in verified,
      hasSub: 'sub' in verified,
      keys: Object.keys(verified || {}),
    },
    'verifyToken return structure'
  );

  // `verifyToken` may return payload directly or nested under `.payload`
  // Handle both cases for compatibility
  let payload: Record<string, unknown>;
  if ('payload' in verified && verified.payload) {
    payload = verified.payload as Record<string, unknown>;
  } else if (typeof verified === 'object' && verified !== null) {
    // Payload might be at the top level
    payload = verified as Record<string, unknown>;
  } else {
    throw new Error(`Invalid token verification result: expected object with payload, got ${typeof verified}`);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`Invalid payload: expected object, got ${typeof payload}`);
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) {
    throw new Error(`Invalid Clerk token: missing or invalid 'sub' claim. Payload keys: ${Object.keys(payload).join(', ')}`);
  }

  // Detailed logging for organization ID extraction
  logger.debug(
    {
      hasO: 'o' in payload,
      oValue: payload.o,
      oType: typeof payload.o,
      oIsString: typeof payload.o === 'string',
      oLength: typeof payload.o === 'string' ? payload.o.length : 'N/A',
      hasOrgId: 'org_id' in payload,
      orgIdValue: payload.org_id,
      orgIdType: typeof payload.org_id,
    },
    'Organization ID extraction details'
  );

  // Clerk JWT tokens use "o" for organization ID, fallback to "org_id" for compatibility
  const orgId = payload.o || payload.org_id;
  const tokenOrgId = typeof orgId === 'string' && orgId ? orgId : null;
  
  // Log which key was found for debugging
  if (tokenOrgId) {
    logger.debug(
      { 
        foundIn: payload.o ? 'o' : 'org_id',
        orgId: tokenOrgId.substring(0, 20) + '...' // Log first 20 chars only
      },
      'Organization ID extracted from token'
    );
  } else {
    logger.debug(
      { 
        payloadKeys: Object.keys(payload),
        oValue: payload.o,
        orgIdValue: payload.org_id,
      },
      'No organization ID found in token payload'
    );
  }

  return { clerkUserId: sub, tokenOrgId };
}

