# Clerk Authentication Implementation Plan (Revised)

## Overview

Add Clerk-based B2B authentication with end-to-end tenant isolation. Users belong to exactly one org. Org slug routing (`/:orgSlug`). Both `/ingest` and `/summary` are protected and tenant-scoped. Chrome extension integration via Clerk session tokens.

## 1. Clerk Dashboard Configuration

### Required Settings
- **Organizations**: Enabled
- **User Organization Creation**: Disabled (vendor creates orgs, users cannot)
- **Allowed Redirect URLs** (for localhost POC):
  - `http://127.0.0.1:8787/`
  - `http://127.0.0.1:8787/*` (wildcard for org slugs)
- **Session Token Template**: Include `org_id` claim when user has active org

### Required Keys
- `CLERK_PUBLISHABLE_KEY`: Frontend key (starts with `pk_`)
- `CLERK_SECRET_KEY`: Backend key (starts with `sk_`)

### Hosted Pages URLs
- Sign-in: `https://<your-clerk-domain>.clerk.accounts.dev/sign-in?redirect_url=http://127.0.0.1:8787/`
- Sign-up: `https://<your-clerk-domain>.clerk.accounts.dev/sign-up?redirect_url=http://127.0.0.1:8787/`

### Clerk Session Token Structure (Assumed)
```json
{
  "sub": "user_xxx",           // Clerk user ID
  "org_id": "org_xxx",         // Clerk org ID (present if user has active org)
  "iat": 1234567890,
  "exp": 1234567890
}
```

## 2. Database Schema Analysis

### Current State (from schema.sql)
- `orgs` table: `id` (uuid), `name` (text), `created_at` (timestamptz)
- `users` table: Referenced in FKs but not defined in dump (assumed to exist)
- `devices` table: `id`, `org_id`, `user_id`, ...
- `events` table: `id`, `org_id`, `device_id`, `user_id`, ...

### Required Migrations

#### Migration 1: Add external_org_id to orgs
```sql
ALTER TABLE public.orgs 
ADD COLUMN external_org_id text;

CREATE UNIQUE INDEX orgs_external_org_id_uq 
ON public.orgs (external_org_id) 
WHERE external_org_id IS NOT NULL;
```

#### Migration 2: Add slug to orgs (for routing)
```sql
ALTER TABLE public.orgs 
ADD COLUMN slug text;

CREATE UNIQUE INDEX orgs_slug_uq 
ON public.orgs (lower(slug)) 
WHERE slug IS NOT NULL;
```

#### Migration 3: Ensure users table has required columns
```sql
-- Check if users table exists, if not create it
-- Since it's referenced in FKs, it likely exists but verify structure

-- Add external_uid if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'external_uid'
  ) THEN
    ALTER TABLE public.users ADD COLUMN external_uid text;
  END IF;
END $$;

-- Add unique index on external_uid if missing
CREATE UNIQUE INDEX IF NOT EXISTS users_external_uid_uq 
ON public.users (external_uid) 
WHERE external_uid IS NOT NULL;

-- Ensure org_id exists (required for single-org membership)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE public.users ADD COLUMN org_id uuid REFERENCES public.orgs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index on org_id if missing
CREATE INDEX IF NOT EXISTS users_org_id_idx 
ON public.users (org_id);
```

**Note**: These migrations use `DO $$` blocks to safely check column existence before adding, following PostgreSQL best practices.

## 3. Server-Side Auth Strategy

### Approach: Use @clerk/fastify Plugin
- Install `@clerk/fastify` package
- Register plugin with `CLERK_SECRET_KEY`
- Plugin provides `request.auth` with Clerk user/org context

### Alternative: Manual Verification with @clerk/backend
If plugin doesn't work well, use `@clerk/backend` SDK:
```typescript
import { clerkClient } from '@clerk/backend';

const authResult = await clerkClient.authenticateRequest(request, {
  secretKey: env.CLERK_SECRET_KEY,
});
```

### Request Auth Object
After verification, attach to Fastify request:
```typescript
request.auth = {
  clerkUserId: string,    // From token.sub
  clerkOrgId: string | null  // From token.org_id (may be null)
}
```

### Auth Middleware Pattern
```typescript
// Decorator or plugin that adds authenticate helper
fastify.decorate('authenticate', async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyClerkToken(token);
  
  if (!payload.org_id) {
    return reply.code(403).send({ error: 'No organization context in token' });
  }
  
  request.auth = {
    clerkUserId: payload.sub,
    clerkOrgId: payload.org_id
  };
});
```

## 4. Database Query Helpers

### New Functions in src/db/queries.ts

#### getOrgByExternalId
```typescript
export async function getOrgByExternalId(externalOrgId: string): Promise<{ id: string; slug: string | null } | null> {
  const result = await db
    .select({ id: orgs.id, slug: orgs.slug })
    .from(orgs)
    .where(eq(orgs.externalOrgId, externalOrgId))
    .limit(1);
  
  return result[0] || null;
}
```

#### upsertOrgByExternalId
```typescript
export async function upsertOrgByExternalId(
  externalOrgId: string,
  name?: string,
  slug?: string
): Promise<{ id: string; slug: string | null }> {
  // Try to find existing
  const existing = await getOrgByExternalId(externalOrgId);
  if (existing) {
    return existing;
  }
  
  // Create new org
  const slugValue = slug || generateSlugFromName(name || 'Organization');
  const result = await db
    .insert(orgs)
    .values({
      externalOrgId: externalOrgId,
      name: name || 'Organization',
      slug: slugValue,
    })
    .onConflictDoUpdate({
      target: orgs.externalOrgId,
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
      },
    })
    .returning({ id: orgs.id, slug: orgs.slug });
  
  return result[0];
}
```

#### getUserByExternalUid
```typescript
export async function getUserByExternalUid(externalUid: string): Promise<{ id: string; orgId: string | null } | null> {
  const result = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(eq(users.externalUid, externalUid))
    .limit(1);
  
  return result[0] || null;
}
```

#### upsertUserByExternalUid
```typescript
export async function upsertUserByExternalUid(
  externalUid: string,
  orgId: string,
  email?: string,
  name?: string
): Promise<{ id: string }> {
  const result = await db
    .insert(users)
    .values({
      externalUid: externalUid,
      orgId: orgId,
      email: email || null,
      name: name || null,
    })
    .onConflictDoUpdate({
      target: users.externalUid,
      set: {
        orgId: sql`excluded.org_id`,
        email: sql`excluded.email`,
        name: sql`excluded.name`,
      },
    })
    .returning({ id: users.id });
  
  return result[0];
}
```

#### getOrgBySlug
```typescript
export async function getOrgBySlug(slug: string): Promise<{ id: string; externalOrgId: string | null } | null> {
  const result = await db
    .select({ id: orgs.id, externalOrgId: orgs.externalOrgId })
    .from(orgs)
    .where(eq(orgs.slug, slug))
    .limit(1);
  
  return result[0] || null;
}
```

## 5. Endpoint Implementations

### GET /me (Protected)

**Purpose**: Return authenticated user and org info, including org slug for routing.

**Auth**: Requires valid Clerk session token with org context.

**Response**:
```typescript
{
  user: {
    id: string,           // Internal UUID
    email: string | null,
    name: string | null
  },
  org: {
    id: string,          // Internal UUID
    name: string,
    slug: string        // For routing to /:orgSlug
  }
}
```

**Implementation Flow**:
1. Verify Clerk token (via auth middleware)
2. Extract `clerkUserId` and `clerkOrgId` from `request.auth`
3. **Bootstrap Org**:
   - Lookup org by `external_org_id = clerkOrgId`
   - If missing, create org:
     - `external_org_id = clerkOrgId`
     - `name = "Organization"` (or fetch from Clerk API if available)
     - `slug = generateSlugFromName(name)` (e.g., "organization" -> "organization")
   - Use `upsertOrgByExternalId()`
4. **Bootstrap User**:
   - Lookup user by `external_uid = clerkUserId`
   - If missing, create user:
     - `external_uid = clerkUserId`
     - `org_id = <resolved org id>`
     - `email = <from Clerk token or null>`
     - `name = <from Clerk token or null>`
   - If exists but `org_id` is null or different, update `org_id = <resolved org id>`
   - Use `upsertUserByExternalUid()`
5. Return user and org data with slug

**Error Cases**:
- **401**: Missing or invalid token
- **403**: Token valid but no `org_id` in token
- **500**: Database error

### GET /summary?range=24h|7d|30d (Protected, Tenant-Scoped)

**Changes from Current**:
- Remove `DEFAULT_ORG_NAME` dependency
- Require authentication
- Use org from `request.auth.clerkOrgId`

**Implementation**:
1. Auth middleware extracts `clerkOrgId` from token
2. Map `clerkOrgId` -> internal `org_id` via `getOrgByExternalId()`
3. If org not found, return 403
4. Call `getSummary(orgId, range)` with resolved `org_id`
5. All queries in `getSummary()` already filter by `org_id` (no changes needed)

**Error Cases**:
- **401**: Missing or invalid token
- **403**: No org context or org not found
- **400**: Invalid range parameter
- **500**: Database error

### POST /ingest (Protected, Tenant-Isolated, User-Attributed)

**Major Changes**:
- Remove `X-POC-TOKEN` authentication
- Require `Authorization: Bearer <Clerk session token>`
- Derive tenant from auth context only
- Attribute events to authenticated user

**Request Headers**:
- `Authorization: Bearer <Clerk session token>` (required)
- `Content-Type: application/json` (required)

**Request Body**: Unchanged (same as current API.md)

**Implementation Flow**:
1. **Auth Verification**:
   - Extract Bearer token from `Authorization` header
   - Verify token using Clerk server-side verification
   - Extract `clerkUserId` and `clerkOrgId` from verified token
   - If no `clerkOrgId`, return 403

2. **Tenant Resolution**:
   - Map `clerkOrgId` -> internal `org_id` via `getOrgByExternalId()`
   - If org not found, bootstrap via `upsertOrgByExternalId()` (or return 403 if bootstrap not allowed)
   - Map `clerkUserId` -> internal `user_id` via `getUserByExternalUid()`
   - If user not found, bootstrap via `upsertUserByExternalUid()` with resolved `org_id`

3. **Device Upsert**:
   - Use resolved `org_id` (never from client body)
   - Optionally set `user_id` from resolved internal user_id
   - Call `upsertDevice(deviceId, orgId, userAgent, userId)`

4. **Event Insertion**:
   - For each event:
     - Set `org_id` from resolved internal org_id (never from client)
     - Set `user_id` from resolved internal user_id (never from client)
     - Set `device_id` from request body (as before)
     - All other fields from request body (as before)
   - Call `insertEvents()` with tenant/user-attributed data

5. **Idempotency**: Preserved via `ON CONFLICT (id) DO NOTHING`

**Reject Rules**:
- **401**: Missing or invalid `Authorization` header
- **401**: Token verification fails
- **403**: Token valid but no `org_id` in token
- **403**: `clerkOrgId` cannot be mapped to internal org (after bootstrap attempt)
- **400**: Invalid request body (validation errors)
- **500**: Database error

**Updated upsertDevice Signature**:
```typescript
export async function upsertDevice(
  deviceId: string,
  orgId: string,
  userAgent?: string | null,
  userId?: string | null  // New parameter
): Promise<void>
```

## 6. Frontend Flow

### Routing Structure
- **GET /**: Landing page (sign-in prompt if not authenticated)
- **GET /:orgSlug**: Org dashboard (e.g., `/acme-corp`, `/example-org`)

### Landing Page (GET /)

**File**: `public/index.html` (or `public/landing.html`)

**Logic**:
1. Initialize Clerk.js SDK with `CLERK_PUBLISHABLE_KEY`
2. Check if user is signed in via `clerk.user`
3. **If signed in**:
   - Call `GET /me` with auth header
   - If 200: Extract `org.slug` and redirect to `/${org.slug}`
   - If 403: Show "Not assigned to an organization" message
   - If 401: Redirect to sign-in
4. **If signed out**:
   - Show landing page with "Sign in" button
   - Button links to Clerk Hosted Sign-in with redirect to `/`

### Org Dashboard (GET /:orgSlug)

**File**: `public/dashboard.html` (rename from current `index.html`)

**Route Handler**: Add to `server.ts`:
```typescript
fastify.get('/:orgSlug', async (request, reply) => {
  const { orgSlug } = request.params as { orgSlug: string };
  // Verify org slug exists and user has access (optional: check auth here too)
  return reply.sendFile('dashboard.html', path.join(__dirname, '../public'));
});
```

**Frontend Logic**:
1. Extract `orgSlug` from URL path
2. Check if user is signed in
3. **If signed out**: Show "Please sign in" message + sign-in link
4. **If signed in**:
   - Call `GET /me` to verify org access
   - If 200: Check that returned `org.slug` matches URL `orgSlug`
     - If match: Render dashboard, call `/summary` with auth
     - If mismatch: Redirect to `/${org.slug}` (correct slug)
   - If 403: Show "Not assigned to an organization"
   - If 401: Redirect to sign-in

### Authenticated Fetch Wrapper
```javascript
async function authenticatedFetch(url, options = {}) {
  const session = await clerk.session;
  if (!session) {
    throw new Error('Not authenticated');
  }
  
  const token = await session.getToken();
  if (!token) {
    throw new Error('Failed to get session token');
  }
  
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
}
```

### Sign Out Flow
```javascript
async function signOut() {
  await clerk.signOut();
  window.location.href = '/';
}
```

## 7. openapi.yaml Updates

### Security Schemes
Replace `POCToken` with `BearerAuth`:
```yaml
securitySchemes:
  BearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
    description: Clerk session token (JWT)
```

### /ingest Endpoint Updates
- **Security**: Change from `POCToken` to `BearerAuth`
- **Description**: Update to reflect Clerk auth and tenant isolation
- **Request Body**: Add note that org/user identifiers in body are ignored
- **Responses**: Update 401/403 descriptions for auth failures
- **Remove**: Any mention of `X-POC-TOKEN`

### /summary Endpoint Updates
- **Security**: Add `BearerAuth` requirement
- **Description**: Update to reflect tenant-scoped data (remove DEFAULT_ORG_NAME mention)
- **Responses**: Add 401/403 for auth failures

### New /me Endpoint
Add complete endpoint definition with:
- Security: `BearerAuth`
- Response schema: `MeResponse`
- Error responses: 401, 403, 500

### New Schemas
```yaml
MeResponse:
  type: object
  required:
    - user
    - org
  properties:
    user:
      type: object
      required:
        - id
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          nullable: true
        name:
          type: string
          nullable: true
    org:
      type: object
      required:
        - id
        - name
        - slug
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        slug:
          type: string
          description: Org slug for routing (e.g., "acme-corp")
```

## 8. Extension Integration Notes (README Section)

### Chrome Extension Integration

The `/ingest` endpoint requires Clerk authentication. The Chrome extension must obtain a Clerk session token and include it in the request.

#### Authentication Method
- **Type**: Bearer token authentication
- **Header**: `Authorization: Bearer <Clerk session token>`
- **Token Source**: Clerk session token obtained via Clerk.js SDK in the extension

#### Required Headers
```
Authorization: Bearer <clerk-session-token>
Content-Type: application/json
```

#### Request Body
The request body format is unchanged from the current API specification. However, note:
- **Org/User Attribution**: The backend derives `org_id` and `user_id` exclusively from the authenticated Clerk session token. Any org or user identifiers in the request body are ignored.
- **Tenant Isolation**: Events are automatically written to the org associated with the authenticated user's Clerk organization.

#### Token Handling
- **Storage**: Tokens must be kept in memory only. Do not store tokens in `localStorage`, `sessionStorage`, or any persistent storage.
- **Refresh**: Tokens expire. The extension should handle token refresh via Clerk.js SDK.
- **Error Handling**: 
  - `401 Unauthorized`: Token missing, invalid, or expired. Re-authenticate user.
  - `403 Forbidden`: Token valid but user has no organization context, or org not found. User may need to be assigned to an organization.

#### Example Request
```javascript
const session = await clerk.session;
const token = await session?.getToken();

const response = await fetch('http://127.0.0.1:8787/ingest', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    device_id: 'b70e507e-b843-4979-be70-eea4f175bb05',
    events: [/* ... */]
  })
});
```

## 9. File Structure Changes

### New Files
- `src/auth/clerk.ts`: Clerk token verification logic
- `src/auth/middleware.ts`: Fastify auth decorator/plugin
- `src/routes/me.ts`: GET /me endpoint
- `migrations/001_add_clerk_mapping.sql`: Database migrations
- `public/dashboard.html`: Dashboard page (rename from index.html)
- `public/auth.js`: Frontend auth utilities (Clerk initialization, token management)
- `public/landing.html`: Landing page (or keep index.html as landing)

### Modified Files
- `src/server.ts`: Register auth middleware, add `/:orgSlug` route, protect endpoints
- `src/routes/ingest.ts`: Replace X-POC-TOKEN with Clerk auth, add tenant/user attribution
- `src/routes/summary.ts`: Add auth requirement, use org from auth
- `src/db/queries.ts`: Add org/user lookup/upsert by external IDs, add slug lookup
- `src/db/schema.ts`: Add external IDs, slug, users table schema
- `src/env.ts`: Add Clerk env vars
- `package.json`: Add `@clerk/fastify` or `@clerk/backend` dependency
- `openapi.yaml`: Update security schemes, endpoint definitions, add /me
- `README.md`: Add extension integration notes section
- `.env.example`: Add Clerk keys

## 10. Implementation Steps

### Phase 1: Dependencies and Environment
1. Install `@clerk/fastify` (or `@clerk/backend`)
2. Add Clerk env vars to `env.ts` and `.env.example`
3. Update `package.json`

### Phase 2: Database Migrations
1. Create `migrations/001_add_clerk_mapping.sql`
2. Update `src/db/schema.ts` with new columns and users table
3. Run migrations (manual step for user)

### Phase 3: Auth Infrastructure
1. Create `src/auth/clerk.ts` with token verification
2. Create `src/auth/middleware.ts` with Fastify decorator
3. Register auth middleware in `server.ts`
4. Add query helpers for org/user by external IDs

### Phase 4: /me Endpoint
1. Create `src/routes/me.ts`
2. Implement bootstrap logic (upsert org/user)
3. Register route in `server.ts`
4. Test with valid Clerk token

### Phase 5: Protect /summary
1. Add auth requirement to `/summary` route
2. Replace `DEFAULT_ORG_NAME` with org from auth
3. Test tenant isolation

### Phase 6: Protect /ingest
1. Remove `X-POC-TOKEN` check
2. Add Clerk auth verification
3. Add tenant/user attribution logic
4. Update `upsertDevice()` to accept `userId`
5. Update `insertEvents()` to include `userId` in event data
6. Test tenant isolation

### Phase 7: Frontend Auth
1. Add Clerk.js SDK to HTML pages
2. Create `public/auth.js` with auth utilities
3. Update landing page (`index.html`) with sign-in flow
4. Create/rename dashboard page (`dashboard.html`)
5. Update `dashboard.js` to use authenticated fetch
6. Add org slug routing logic

### Phase 8: Routing Updates
1. Add `/:orgSlug` route handler in `server.ts`
2. Update static file serving to handle slug routes
3. Test redirect flow: `/` -> `/:orgSlug`

### Phase 9: openapi.yaml Update
1. Update security schemes
2. Update `/ingest` endpoint definition
3. Update `/summary` endpoint definition
4. Add `/me` endpoint definition
5. Add new response schemas

### Phase 10: Documentation
1. Add extension integration notes to README
2. Update API documentation
3. Test all acceptance criteria

## 11. Acceptance Criteria

### Authentication Flow
- [ ] Visiting `/` while signed out shows landing page with "Sign in" button
- [ ] Clicking "Sign in" redirects to Clerk Hosted Sign-in
- [ ] After signing in, user is redirected to `/:orgSlug` (e.g., `/acme-corp`)
- [ ] Visiting `/:orgSlug` while signed out shows "Please sign in" message
- [ ] Visiting `/:orgSlug` while signed in loads dashboard

### Tenant Isolation - Reads
- [ ] User A (Org 1) sees only Org 1 data in `/summary`
- [ ] User B (Org 2) sees only Org 2 data in `/summary`
- [ ] User A cannot access Org 2 data via `/summary`
- [ ] `/summary` returns 401 without auth token
- [ ] `/summary` returns 403 with valid token but no org context

### Tenant Isolation - Writes
- [ ] User A (Org 1) ingests events → events written to Org 1
- [ ] User B (Org 2) ingests events → events written to Org 2
- [ ] User A cannot write events to Org 2 (even if attempting to manipulate request)
- [ ] `/ingest` returns 401 without auth token
- [ ] `/ingest` returns 403 with valid token but no org context
- [ ] Events are attributed to correct user (`events.user_id` set from auth)

### /me Endpoint
- [ ] `/me` returns user and org data with slug
- [ ] `/me` bootstraps org if missing (creates in DB)
- [ ] `/me` bootstraps user if missing (creates in DB)
- [ ] `/me` returns 401 without auth token
- [ ] `/me` returns 403 with valid token but no org context

### Org Slug Routing
- [ ] After login, user is redirected to `/${org.slug}`
- [ ] Dashboard loads correctly at `/:orgSlug` route
- [ ] Mismatched slug redirects to correct slug

### Backward Compatibility
- [ ] `/healthz` remains public (no auth required)
- [ ] `/ingest` no longer accepts `X-POC-TOKEN` (returns 401)

### Security
- [ ] Tokens never stored in localStorage
- [ ] Auth tokens not logged
- [ ] Ingest payload bodies not logged
- [ ] Client-supplied org/user IDs are ignored
- [ ] All queries filtered by authenticated org_id

## 12. Testing Strategy

### Manual Test Scenarios

1. **Two-Org Isolation Test**:
   - Create Org A and Org B in Clerk
   - Invite User 1 to Org A, User 2 to Org B
   - Sign in as User 1, ingest events, verify events in Org A only
   - Sign in as User 2, ingest events, verify events in Org B only
   - Sign in as User 1, view dashboard, verify only Org A data
   - Sign in as User 2, view dashboard, verify only Org B data

2. **Auth Failure Tests**:
   - Call `/ingest` without token → 401
   - Call `/ingest` with invalid token → 401
   - Call `/ingest` with valid token but no org → 403
   - Call `/summary` without token → 401
   - Call `/summary` with invalid token → 401

3. **Bootstrap Tests**:
   - Sign in as new user (not in DB) → verify org/user created
   - Call `/me` → verify returns correct org slug
   - Verify redirect to `/:orgSlug` works

## 13. Security Considerations

### Token Security
- Never log full tokens (log only first/last few chars if needed)
- Validate token expiration server-side
- Use HTTPS in production (HTTP acceptable for localhost POC)

### Tenant Isolation
- Always derive `org_id` from authenticated token (never from client)
- Always derive `user_id` from authenticated token (never from client)
- Filter all queries by `org_id` from auth context
- Use parameterized queries (Drizzle handles this)

### Error Messages
- Don't leak org existence in error messages
- Generic "Unauthorized" for 401
- Generic "Forbidden" for 403

## 14. Rollback Considerations

If critical issues arise:
1. Can temporarily revert `/ingest` to accept `X-POC-TOKEN` (keep both auth methods)
2. Keep `/summary` with `DEFAULT_ORG_NAME` fallback (check auth first, fallback if missing)
3. Frontend can gracefully degrade (show error if auth fails)

However, for POC, full implementation is preferred.
