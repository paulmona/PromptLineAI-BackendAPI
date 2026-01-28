import type { FastifyReply, FastifyRequest } from 'fastify';
import { clerkClient, verifyClerkBearerToken } from './clerk.js';
import { getSingleHeaderValue } from './headers.js';
import { ensureOrgByExternalOrgId, ensureUserByExternalUid } from '../db/queries.js';
import logger from '../logger.js';
import env from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: {
      clerkUserId: string;
      clerkOrgId: string;
      internalOrgId: string;
      orgSlug: string;
      internalUserId: string;
      role: 'admin' | 'member';
    };
  }
}

async function resolveClerkOrgId(args: { clerkUserId: string; tokenOrgId: string | null }): Promise<string> {
  if (args.tokenOrgId) {
    logger.debug({ clerkUserId: args.clerkUserId, hasTokenOrgId: true }, 'Organization ID found in token, using it');
    return args.tokenOrgId;
  }

  // Fallback: if org_id claim is missing, fetch memberships and require exactly one org.
  // This keeps the invariant: each user belongs to exactly one org (no switching UI).
  logger.debug({ clerkUserId: args.clerkUserId }, 'Organization ID not in token, fetching from Clerk API (fallback)');
  
  const memberships = await clerkClient.users.getOrganizationMembershipList({
    userId: args.clerkUserId,
    limit: 10,
  });

  logger.debug(
    { 
      clerkUserId: args.clerkUserId,
      membershipCount: memberships.data?.length || 0,
    },
    'Fetched organization memberships from Clerk'
  );

  const orgIds: string[] = memberships.data
    .map((m: any) => (m && m.organization && typeof m.organization.id === 'string' ? m.organization.id : null))
    .filter((x: string | null): x is string => typeof x === 'string' && x.length > 0);

  const unique: string[] = Array.from(new Set(orgIds));
  
  logger.debug(
    { 
      clerkUserId: args.clerkUserId,
      uniqueOrgCount: unique.length,
      orgIds: unique,
    },
    'Resolved organization IDs from memberships'
  );

  if (unique.length !== 1) {
    throw new Error(`User must be assigned to exactly one organization, found ${unique.length}`);
  }

  logger.debug({ clerkUserId: args.clerkUserId, resolvedOrgId: unique[0] }, 'Resolved organization ID from Clerk API');
  return unique[0];
}

async function deriveUserRole(args: { clerkUserId: string; clerkOrgId: string }): Promise<'admin' | 'member'> {
  try {
    // Fetch user's memberships and find the one for this org
    const memberships = await clerkClient.users.getOrganizationMembershipList({
      userId: args.clerkUserId,
      limit: 10,
    });

    // Find membership for this specific org
    const membership = memberships.data?.find(
      (m: any) => m?.organization?.id === args.clerkOrgId
    );

    if (!membership) {
      logger.warn({ clerkUserId: args.clerkUserId, clerkOrgId: args.clerkOrgId }, 'No membership found for org, defaulting to member');
      return 'member';
    }

    // Clerk membership roles: typically "org:admin", "org:member", or just "admin", "member"
    const role = membership.role;
    const roleStr = typeof role === 'string' ? role.toLowerCase() : '';
    
    // Map Clerk roles to our app roles
    // If role contains "admin" (case-insensitive), treat as admin
    if (roleStr.includes('admin')) {
      logger.debug({ clerkUserId: args.clerkUserId, clerkOrgId: args.clerkOrgId, clerkRole: role }, 'User role derived as admin');
      return 'admin';
    }

    logger.debug({ clerkUserId: args.clerkUserId, clerkOrgId: args.clerkOrgId, clerkRole: role }, 'User role derived as member');
    return 'member';
  } catch (err) {
    logger.error({ err, clerkUserId: args.clerkUserId, clerkOrgId: args.clerkOrgId }, 'Failed to fetch membership role, defaulting to member');
    // Fail-safe: default to member if we can't determine role
    return 'member';
  }
}

export async function requireClerkAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = getSingleHeaderValue(request.headers.authorization);
  if (!authHeader.ok) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }
  if (!authHeader.value.toLowerCase().startsWith('bearer ')) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }

  const token = authHeader.value.slice('bearer '.length).trim();
  if (!token) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }

  // Log token prefix for debugging (first 20 chars only)
  const tokenPrefix = token.length > 20 ? `${token.substring(0, 20)}...` : token.substring(0, token.length);
  logger.debug({ tokenPrefix, tokenLength: token.length, path: request.url }, 'Processing authentication request');

  try {
    const { clerkUserId, tokenOrgId } = await verifyClerkBearerToken(token);
    logger.debug(
      { 
        clerkUserId,
        hasTokenOrgId: !!tokenOrgId,
        tokenOrgIdPrefix: tokenOrgId ? tokenOrgId.substring(0, 20) + '...' : null,
      },
      'Token verified, resolving organization ID'
    );
    
    const clerkOrgId = await resolveClerkOrgId({ clerkUserId, tokenOrgId });
    logger.debug({ clerkUserId, clerkOrgId }, 'Organization ID resolved');

    // Safe constrained org bootstrap: fetch canonical org metadata from Clerk (no guessing).
    const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
    if (!org?.name || !org?.slug) {
      logger.warn({ clerkOrgId }, 'Organization metadata missing in Clerk');
      return void reply.code(403).send({ error: 'Organization metadata missing in Clerk' });
    }

    const ensuredOrg = await ensureOrgByExternalOrgId({
      externalOrgId: clerkOrgId,
      name: org.name,
      slug: org.slug,
    });

    const ensuredUser = await ensureUserByExternalUid({
      externalUid: clerkUserId,
      orgId: ensuredOrg.id,
    });

    // Derive user role from Clerk org membership
    const role = await deriveUserRole({ clerkUserId, clerkOrgId });

    request.authContext = {
      clerkUserId,
      clerkOrgId,
      internalOrgId: ensuredOrg.id,
      orgSlug: ensuredOrg.slug ?? org.slug,
      internalUserId: ensuredUser.id,
      role,
    };
  } catch (err) {
    // Log full error details for debugging
    const errorDetails = {
      errorType: err?.constructor?.name,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      tokenPrefix,
      path: request.url,
    };
    
    logger.warn(errorDetails, 'Clerk authentication failed or org context invalid');

    // Differentiate auth vs authorization:
    // - Invalid token => 401
    // - Valid token but no org/invalid org context => 403
    // We can't reliably distinguish all cases here without Clerk error typing, so:
    // - Missing org membership / multiple orgs => 403
    // - Token verification errors => 401
    // - Organization-related errors => 403
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('assigned to exactly one organization') ||
      message.includes('Organization metadata') ||
      message.includes('org')
    ) {
      return void reply.code(403).send({ error: message });
    }
    return void reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireOrgAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = request.authContext;
  if (!ctx) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }

  if (ctx.role !== 'admin') {
    logger.debug({ clerkUserId: ctx.clerkUserId, role: ctx.role }, 'Access denied: admin role required');
    return void reply.code(403).send({ error: 'Forbidden: admin access required' });
  }
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // First ensure Clerk auth is valid (populates authContext)
  await requireClerkAuth(request, reply);
  
  // If requireClerkAuth already sent a response, stop here
  if (reply.sent) {
    return;
  }

  const ctx = request.authContext;
  if (!ctx) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }

  // Check if user's org matches the platform admin org ID
  if (ctx.clerkOrgId !== env.PLATFORM_ADMIN_CLERK_ORG_ID) {
    logger.debug(
      { clerkUserId: ctx.clerkUserId, clerkOrgId: ctx.clerkOrgId, expectedOrgId: env.PLATFORM_ADMIN_CLERK_ORG_ID },
      'Access denied: platform admin org membership required'
    );
    return void reply.code(403).send({ error: 'Forbidden: platform admin access required' });
  }
}

