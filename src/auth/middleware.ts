import type { FastifyReply, FastifyRequest } from 'fastify';
import { clerkClient, verifyClerkBearerToken } from './clerk.js';
import { getSingleHeaderValue } from './headers.js';
import {
  ensureOrgByExternalOrgId,
  ensureUserByExternalUid,
  getOrgByExternalOrgId,
  OrgMismatchForUserError,
} from '../db/queries.js';
import logger from '../logger.js';
import env from '../env.js';

/** Short-lived cache for org resolution fallback (token lacked org claim). Key: clerkUserId, Value: { orgId, expiresAt }. TTL 90s. */
const orgResolutionCache = new Map<
  string,
  { orgId: string; expiresAt: number }
>();
const ORG_CACHE_TTL_MS = 90_000;

function getCachedOrgId(clerkUserId: string): string | null {
  const entry = orgResolutionCache.get(clerkUserId);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) orgResolutionCache.delete(clerkUserId);
    return null;
  }
  return entry.orgId;
}

function setCachedOrgId(clerkUserId: string, orgId: string): void {
  orgResolutionCache.set(clerkUserId, { orgId, expiresAt: Date.now() + ORG_CACHE_TTL_MS });
}

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
    logger.debug({ hasTokenOrgId: true }, 'Organization ID found in token, using it');
    return args.tokenOrgId;
  }

  const cached = getCachedOrgId(args.clerkUserId);
  if (cached) {
    logger.debug({ hasCachedOrg: true }, 'Organization ID from cache');
    return cached;
  }

  // Fallback: if org_id claim is missing, fetch memberships and require exactly one org.
  logger.debug({}, 'Organization ID not in token or cache, fetching from Clerk API (fallback)');

  const memberships = await clerkClient.users.getOrganizationMembershipList({
    userId: args.clerkUserId,
    limit: 10,
  });

  logger.debug({ membershipCount: memberships.data?.length || 0 }, 'Fetched organization memberships from Clerk');

  const orgIds: string[] = memberships.data
    .map((m: any) => (m && m.organization && typeof m.organization.id === 'string' ? m.organization.id : null))
    .filter((x: string | null): x is string => typeof x === 'string' && x.length > 0);

  const unique: string[] = Array.from(new Set(orgIds));
  
  logger.debug({ uniqueOrgCount: unique.length }, 'Resolved organization IDs from memberships');

  if (unique.length === 0) {
    throw new Error('ORG_CONTEXT_REQUIRED: User must be assigned to exactly one organization, found 0');
  }
  if (unique.length > 1) {
    throw new Error('ORG_CONTEXT_REQUIRED: User must be assigned to exactly one organization, found multiple');
  }

  const resolvedOrgId = unique[0];
  setCachedOrgId(args.clerkUserId, resolvedOrgId);
  logger.debug({}, 'Resolved organization ID from Clerk API, cached');
  return resolvedOrgId;
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
      logger.warn({}, 'No membership found for org, defaulting to member');
      return 'member';
    }

    const role = membership.role;
    const roleStr = typeof role === 'string' ? role.toLowerCase() : '';
    if (roleStr.includes('admin')) {
      logger.debug({ clerkRole: role }, 'User role derived as admin');
      return 'admin';
    }
    logger.debug({ clerkRole: role }, 'User role derived as member');
    return 'member';
  } catch (err) {
    logger.error({ err }, 'Failed to fetch membership role, defaulting to member');
    // Fail-safe: default to member if we can't determine role
    return 'member';
  }
}

function send401(reply: FastifyReply, requestId?: string): void {
  const body = requestId ? { code: 'AUTH_REQUIRED' as const, request_id: requestId } : { code: 'AUTH_REQUIRED' as const };
  reply.code(401).send(body);
}

function send403(reply: FastifyReply, code: 'ORG_CONTEXT_REQUIRED' | 'ORG_MISMATCH_FOR_USER', requestId?: string): void {
  const body = requestId ? { code, request_id: requestId } : { code };
  reply.code(403).send(body);
}

export async function requireClerkAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const requestId = (request as { id?: string }).id;
  const authHeader = getSingleHeaderValue(request.headers.authorization);
  if (!authHeader.ok) {
    return void send401(reply, requestId);
  }
  if (!authHeader.value.toLowerCase().startsWith('bearer ')) {
    return void send401(reply, requestId);
  }

  const token = authHeader.value.slice('bearer '.length).trim();
  if (!token) {
    return void send401(reply, requestId);
  }

  logger.debug({ path: request.url, tokenLength: token.length }, 'Processing authentication request');

  try {
    const { clerkUserId, tokenOrgId } = await verifyClerkBearerToken(token);
    logger.debug({ hasTokenOrgId: !!tokenOrgId }, 'Token verified, resolving organization ID');

    const clerkOrgId = await resolveClerkOrgId({ clerkUserId, tokenOrgId });
    logger.debug({}, 'Organization ID resolved');

    // Use local org when it exists; fetch Clerk org metadata only when creating a new org.
    let ensuredOrg: { id: string; slug: string | null; name: string };
    const existingOrg = await getOrgByExternalOrgId(clerkOrgId);
    if (existingOrg) {
      ensuredOrg = existingOrg;
    } else {
      const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
      if (!org?.name || !org?.slug) {
        logger.warn({}, 'Organization metadata missing in Clerk');
        return void send403(reply, 'ORG_CONTEXT_REQUIRED', requestId);
      }
      ensuredOrg = await ensureOrgByExternalOrgId({
        externalOrgId: clerkOrgId,
        name: org.name,
        slug: org.slug,
      });
    }

    const ensuredUser = await ensureUserByExternalUid({
      externalUid: clerkUserId,
      orgId: ensuredOrg.id,
    });

    const role = await deriveUserRole({ clerkUserId, clerkOrgId });

    request.authContext = {
      clerkUserId,
      clerkOrgId,
      internalOrgId: ensuredOrg.id,
      orgSlug: ensuredOrg.slug ?? ensuredOrg.name,
      internalUserId: ensuredUser.id,
      role,
    };
  } catch (err) {
    const errorType = err?.constructor?.name;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ errorType, message, path: request.url, requestId }, 'Clerk authentication failed or org context invalid');

    if (err instanceof OrgMismatchForUserError) {
      return void send403(reply, 'ORG_MISMATCH_FOR_USER', requestId);
    }
    if (message.includes('ORG_CONTEXT_REQUIRED') || message.includes('assigned to exactly one organization') || message.includes('Organization metadata')) {
      return void send403(reply, 'ORG_CONTEXT_REQUIRED', requestId);
    }

    return void send401(reply, requestId);
  }
}

export async function requireOrgAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = request.authContext;
  if (!ctx) {
    return void reply.code(401).send({ error: 'Unauthorized' });
  }

  if (ctx.role !== 'admin') {
    logger.debug({ internalUserId: ctx.internalUserId, role: ctx.role }, 'Access denied: admin role required');
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

  if (ctx.clerkOrgId !== env.PLATFORM_ADMIN_CLERK_ORG_ID) {
    logger.debug({ internalUserId: ctx.internalUserId, internalOrgId: ctx.internalOrgId }, 'Access denied: platform admin org membership required');
    return void reply.code(403).send({ error: 'Forbidden: platform admin access required' });
  }
}

