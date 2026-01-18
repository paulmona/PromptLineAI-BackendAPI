import type { FastifyReply, FastifyRequest } from 'fastify';
import { clerkClient, verifyClerkBearerToken } from './clerk.js';
import { getSingleHeaderValue } from './headers.js';
import { ensureOrgByExternalOrgId, ensureUserByExternalUid } from '../db/queries.js';
import logger from '../logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: {
      clerkUserId: string;
      clerkOrgId: string;
      internalOrgId: string;
      orgSlug: string;
      internalUserId: string;
    };
  }
}

async function resolveClerkOrgId(args: { clerkUserId: string; tokenOrgId: string | null }): Promise<string> {
  if (args.tokenOrgId) return args.tokenOrgId;

  // Fallback: if org_id claim is missing, fetch memberships and require exactly one org.
  // This keeps the invariant: each user belongs to exactly one org (no switching UI).
  const memberships = await clerkClient.users.getOrganizationMembershipList({
    userId: args.clerkUserId,
    limit: 10,
  });

  const orgIds: string[] = memberships.data
    .map((m: any) => (m && m.organization && typeof m.organization.id === 'string' ? m.organization.id : null))
    .filter((x: string | null): x is string => typeof x === 'string' && x.length > 0);

  const unique: string[] = Array.from(new Set(orgIds));
  if (unique.length !== 1) {
    throw new Error('User must be assigned to exactly one organization');
  }

  return unique[0];
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

  try {
    const { clerkUserId, tokenOrgId } = await verifyClerkBearerToken(token);
    const clerkOrgId = await resolveClerkOrgId({ clerkUserId, tokenOrgId });

    // Safe constrained org bootstrap: fetch canonical org metadata from Clerk (no guessing).
    const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
    if (!org?.name || !org?.slug) {
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

    request.authContext = {
      clerkUserId,
      clerkOrgId,
      internalOrgId: ensuredOrg.id,
      orgSlug: ensuredOrg.slug ?? org.slug,
      internalUserId: ensuredUser.id,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Clerk authentication failed or org context invalid'
    );

    // Differentiate auth vs authorization:
    // - Invalid token => 401
    // - Valid token but no org/invalid org context => 403
    // We can't reliably distinguish all cases here without Clerk error typing, so:
    // - Missing org membership / multiple orgs => 403
    // - Anything else from verify => 401
    const message = err instanceof Error ? err.message : '';
    if (message.includes('assigned to exactly one organization') || message.includes('Organization metadata')) {
      return void reply.code(403).send({ error: message });
    }
    return void reply.code(401).send({ error: 'Unauthorized' });
  }
}

