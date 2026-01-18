# Clerk Authentication + Ingest Key Implementation Plan (Final)

## Overview

Add Clerk-based B2B authentication for dashboard endpoints (`/me`, `/summary`) and org-scoped ingest keys for `/ingest`. End-to-end tenant isolation. Org slug routing (`/:orgSlug`). Chrome extension uses `X-INGEST-KEY` header (no Clerk tokens required).

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

#### Migration 1: Add external_org_id and slug to orgs
```sql
ALTER TABLE public.orgs 
ADD COLUMN external_org_id text;

CREATE UNIQUE INDEX orgs_external_org_id_uq 
ON public.orgs (external_org_id) 
WHERE external_org_id IS NOT NULL;

ALTER TABLE public.orgs 
ADD COLUMN slug text;

CREATE UNIQUE INDEX orgs_slug_uq 
ON public.orgs (lower(slug)) 
WHERE slug IS NOT NULL;
```

#### Migration 2: Ensure users table has required columns
```sql
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

#### Migration 3: Create ingest_keys table
```sql
CREATE TABLE public.ingest_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    key_hash text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);

CREATE UNIQUE INDEX ingest_keys_key_hash_uq 
ON public.ingest_keys (key_hash);

CREATE INDEX ingest_keys_org_id_idx 
ON public.ingest_keys (org_id);

CREATE INDEX ingest_keys_revoked_at_idx 
ON public.ingest_keys (revoked_at) 
WHERE revoked_at IS NOT NULL;
```

## 3. Server-Side Auth Strategy

### Dashboard Endpoints (Clerk Auth)
- Use `@clerk/fastify` plugin OR `@clerk/backend` SDK
- Verify `Authorization: Bearer <Clerk session token>`
- Extract `clerkUserId` and `clerkOrgId` from verified token
- Attach to request: `request.auth = { clerkUserId, clerkOrgId }`

### Ingest Endpoint (Ingest Key Auth)
- Extract `X-INGEST-KEY` header
- Hash the key using secure hash (SHA-256 or bcrypt)
- Lookup in `ingest_keys` table by `key_hash`
- Verify key is not revoked (`revoked_at IS NULL`)
- Resolve `org_id` from key's `org_id` foreign key
- Attach to request: `request.ingestAuth = { orgId }`

### Auth Middleware Pattern
```typescript
// For Clerk-protected routes
fastify.decorate('authenticateClerk', async (request, reply) => {
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

// For ingest key-protected routes
fastify.decorate('authenticateIngestKey', async (request, reply) => {
  const ingestKey = request.headers['x-ingest-key'];
  if (!ingestKey) {
    return reply.code(401).send({ error: 'Missing X-INGEST-KEY header' });
  }
  
  const orgId = await resolveOrgFromIngestKey(ingestKey);
  if (!orgId) {
    return reply.code(401).send({ error: 'Invalid or revoked ingest key' });
  }
  
  request.ingestAuth = { orgId };
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

#### hashIngestKey
```typescript
import { createHash } from 'crypto';

export function hashIngestKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
```

#### resolveOrgFromIngestKey
```typescript
export async function resolveOrgFromIngestKey(ingestKey: string): Promise<string | null> {
  const keyHash = hashIngestKey(ingestKey);
  
  const result = await db
    .select({ orgId: ingestKeys.orgId })
    .from(ingestKeys)
    .where(
      and(
        eq(ingestKeys.keyHash, keyHash),
        isNull(ingestKeys.revokedAt)
      )
    )
    .limit(1);
  
  return result[0]?.orgId || null;
}
```

#### createIngestKey (Admin/Management Function)
```typescript
export async function createIngestKey(
  orgId: string,
  name?: string
): Promise<{ key: string; id: string }> {
  // Generate random key (e.g., 32 bytes, base64 encoded)
  const key = crypto.randomBytes(32).toString('base64url');
  const keyHash = hashIngestKey(key);
  
  const result = await db
    .insert(ingestKeys)
    .values({
      orgId,
      keyHash,
      name: name || null,
    })
    .returning({ id: ingestKeys.id });
  
  return { key, id: result[0].id };
}
```

#### revokeIngestKey
```typescript
export async function revokeIngestKey(keyId: string): Promise<void> {
  await db
    .update(ingestKeys)
    .set({ revokedAt: new Date() })
    .where(eq(ingestKeys.id, keyId));
}
```

## 5. Endpoint Implementations

### GET /me (Protected by Clerk)

**Purpose**: Return authenticated user and org info, including org slug for routing.

**Auth**: Requires `Authorization: Bearer <Clerk session token>` with org context.

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
     - `slug = generateSlugFromName(name)`
   - Use `upsertOrgByExternalId()`
4. **Bootstrap User**:
   - Lookup user by `external_uid = clerkUserId`
   - If missing, create user with resolved `org_id`
   - If exists but `org_id` is null/different, update `org_id`
   - Use `upsertUserByExternalUid()`
5. Return user and org data with slug

**Error Cases**:
- **401**: Missing or invalid token
- **403**: Token valid but no `org_id` in token
- **500**: Database error

### GET /summary?range=24h|7d|30d (Protected by Clerk)

**Changes from Current**:
- Remove `DEFAULT_ORG_NAME` dependency
- Require Clerk authentication
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

### POST /ingest (Protected by X-INGEST-KEY, Tenant-Isolated)

**Major Changes**:
- Remove `X-POC-TOKEN` authentication
- Require `X-INGEST-KEY` header
- Derive tenant from ingest key only
- User attribution: `user_id` remains NULL (not implemented in this milestone)

**Request Headers**:
- `X-INGEST-KEY: <random key>` (required)
- `Content-Type: application/json` (required)

**Request Body**: Unchanged (same as current API.md)

**Implementation Flow**:
1. **Key Verification**:
   - Extract `X-INGEST-KEY` header
   - Hash the key using SHA-256
   - Lookup in `ingest_keys` table by `key_hash`
   - Verify `revoked_at IS NULL`
   - If not found or revoked, return 401

2. **Tenant Resolution**:
   - Extract `org_id` from `ingest_keys.org_id` (foreign key)
   - This is the ONLY source of org_id (never from client body)

3. **Device Upsert**:
   - Use resolved `org_id` (never from client body)
   - `user_id` remains NULL (not set in this milestone)
   - Call `upsertDevice(deviceId, orgId, userAgent, null)`

4. **Event Insertion**:
   - For each event:
     - Set `org_id` from resolved org_id (never from client)
     - Set `user_id` to NULL (not implemented in this milestone)
     - Set `device_id` from request body (as before)
     - All other fields from request body (as before)
   - Call `insertEvents()` with tenant-attributed data

5. **Idempotency**: Preserved via `ON CONFLICT (id) DO NOTHING`

**Reject Rules**:
- **401**: Missing `X-INGEST-KEY` header
- **401**: Invalid key (hash not found in database)
- **401**: Key revoked (`revoked_at IS NOT NULL`)
- **400**: Invalid request body (validation errors)
- **500**: Database error

**Updated upsertDevice Signature**:
```typescript
export async function upsertDevice(
  deviceId: string,
  orgId: string,
  userAgent?: string | null,
  userId?: string | null  // Optional, remains NULL for ingest in this milestone
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
  // Optional: Verify org slug exists (can be done in frontend too)
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
Replace `POCToken` with two schemes:
```yaml
securitySchemes:
  BearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
    description: Clerk session token (JWT) for dashboard endpoints
  ApiKeyAuth:
    type: apiKey
    in: header
    name: X-INGEST-KEY
    description: Org-scoped ingest key for /ingest endpoint
```

### /ingest Endpoint Updates
- **Security**: Change from `POCToken` to `ApiKeyAuth`
- **Description**: Update to reflect X-INGEST-KEY auth and tenant isolation
  - Note that org is derived from ingest key, not request body
  - Note that user_id is not set in this milestone
- **Request Body**: Add note that org/user identifiers in body are ignored
- **Responses**: 
  - Update 401 description: "Invalid, missing, or revoked X-INGEST-KEY"
  - Remove mention of X-POC-TOKEN

### /summary Endpoint Updates
- **Security**: Add `BearerAuth` requirement
- **Description**: Update to reflect tenant-scoped data via Clerk auth (remove DEFAULT_ORG_NAME mention)
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

The `/ingest` endpoint uses org-scoped ingest keys for authentication. The Chrome extension must include the ingest key in the request header.

#### Authentication Method
- **Type**: API key authentication
- **Header**: `X-INGEST-KEY: <ingest-key>`
- **Key Source**: Ingest keys are generated by the backend/vendor and provided to the extension

#### Required Headers
```
X-INGEST-KEY: <your-org-ingest-key>
Content-Type: application/json
```

#### Request Body
The request body format is unchanged from the current API specification. However, note:
- **Org Attribution**: The backend derives `org_id` exclusively from the `X-INGEST-KEY` header. Any org identifiers in the request body are ignored.
- **User Attribution**: User attribution is not implemented in this milestone. `events.user_id` and `devices.user_id` remain NULL.
- **Tenant Isolation**: Events are automatically written to the org associated with the ingest key.

#### Key Handling
- **Storage**: Keys should be stored securely in the extension (e.g., in extension storage with appropriate permissions).
- **Rotation**: Keys can be revoked/rotated by the vendor. The extension should handle 401 responses gracefully and prompt for key update.
- **Error Handling**: 
  - `401 Unauthorized`: Key missing, invalid, or revoked. Check key configuration.
  - `400 Bad Request`: Invalid request body (validation errors).

#### Key Rotation/Revocation
- Keys can be revoked by setting `revoked_at` timestamp in the database
- To rotate a key: Create a new key for the org, update extension configuration, then revoke the old key
- Revoked keys immediately return 401

#### Example Request
```javascript
const response = await fetch('http://127.0.0.1:8787/ingest', {
  method: 'POST',
  headers: {
    'X-INGEST-KEY': 'your-org-ingest-key-here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    device_id: 'b70e507e-b843-4979-be70-eea4f175bb05',
    events: [/* ... */]
  })
});
```

#### Security Notes
- Never log the ingest key in extension logs
- Store keys securely (use extension storage, not localStorage if possible)
- Handle key rotation gracefully (detect 401, prompt for new key)

## 9. File Structure Changes

### New Files
- `src/auth/clerk.ts`: Clerk token verification logic
- `src/auth/middleware.ts`: Fastify auth decorators (Clerk + Ingest Key)
- `src/routes/me.ts`: GET /me endpoint
- `src/db/ingest-keys.ts`: Ingest key management functions (create, revoke, resolve)
- `migrations/001_add_clerk_mapping.sql`: Database migrations
- `migrations/002_create_ingest_keys.sql`: Ingest keys table migration
- `public/dashboard.html`: Dashboard page (rename from index.html)
- `public/auth.js`: Frontend auth utilities (Clerk initialization, token management)
- `public/landing.html`: Landing page (or keep index.html as landing)

### Modified Files
- `src/server.ts`: Register auth middleware, add `/:orgSlug` route, protect endpoints
- `src/routes/ingest.ts`: Replace X-POC-TOKEN with X-INGEST-KEY, add tenant resolution
- `src/routes/summary.ts`: Add Clerk auth requirement, use org from auth
- `src/db/queries.ts`: Add org/user lookup/upsert by external IDs, add slug lookup
- `src/db/schema.ts`: Add external IDs, slug, users table, ingest_keys table
- `src/env.ts`: Add Clerk env vars (remove POC_TOKEN if no longer needed)
- `package.json`: Add `@clerk/fastify` or `@clerk/backend` dependency, add `crypto` (Node built-in)
- `openapi.yaml`: Update security schemes, endpoint definitions, add /me
- `README.md`: Add extension integration notes section
- `.env.example`: Add Clerk keys, remove POC_TOKEN

## 10. Implementation Steps

### Phase 1: Dependencies and Environment
1. Install `@clerk/fastify` (or `@clerk/backend`)
2. Add Clerk env vars to `env.ts` and `.env.example`
3. Remove `POC_TOKEN` from env (or keep for backward compat during transition)
4. Update `package.json`

### Phase 2: Database Migrations
1. Create `migrations/001_add_clerk_mapping.sql`
2. Create `migrations/002_create_ingest_keys.sql`
3. Update `src/db/schema.ts` with new columns, users table, ingest_keys table
4. Run migrations (manual step for user)

### Phase 3: Auth Infrastructure
1. Create `src/auth/clerk.ts` with token verification
2. Create `src/auth/middleware.ts` with Fastify decorators
3. Create `src/db/ingest-keys.ts` with key hashing and resolution
4. Register auth middleware in `server.ts`
5. Add query helpers for org/user by external IDs

### Phase 4: /me Endpoint
1. Create `src/routes/me.ts`
2. Implement bootstrap logic (upsert org/user)
3. Register route in `server.ts`
4. Test with valid Clerk token

### Phase 5: Protect /summary
1. Add Clerk auth requirement to `/summary` route
2. Replace `DEFAULT_ORG_NAME` with org from auth
3. Test tenant isolation

### Phase 6: Protect /ingest with Ingest Keys
1. Remove `X-POC-TOKEN` check
2. Add `X-INGEST-KEY` verification
3. Add tenant resolution from key hash
4. Update `upsertDevice()` signature (userId optional, remains NULL)
5. Update `insertEvents()` to set user_id to NULL
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
1. Update security schemes (BearerAuth + ApiKeyAuth)
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

### Tenant Isolation - Reads (Clerk Auth)
- [ ] User A (Org 1) sees only Org 1 data in `/summary`
- [ ] User B (Org 2) sees only Org 2 data in `/summary`
- [ ] User A cannot access Org 2 data via `/summary`
- [ ] `/summary` returns 401 without auth token
- [ ] `/summary` returns 403 with valid token but no org context

### Tenant Isolation - Writes (Ingest Keys)
- [ ] Ingest Key A (Org 1) ingests events → events written to Org 1
- [ ] Ingest Key B (Org 2) ingests events → events written to Org 2
- [ ] Ingest Key A cannot write events to Org 2 (key determines org, body cannot override)
- [ ] `/ingest` returns 401 without `X-INGEST-KEY` header
- [ ] `/ingest` returns 401 with invalid key (hash not found)
- [ ] `/ingest` returns 401 with revoked key
- [ ] Events are NOT user-attributed (`user_id` is NULL)

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

### Ingest Key Management
- [ ] Keys can be created for an org
- [ ] Keys are hashed before storage (raw key never stored)
- [ ] Keys can be revoked (set `revoked_at`)
- [ ] Revoked keys return 401
- [ ] Keys map to exactly one org

### Backward Compatibility
- [ ] `/healthz` remains public (no auth required)
- [ ] `/ingest` no longer accepts `X-POC-TOKEN` (returns 401)

### Security
- [ ] Tokens never stored in localStorage
- [ ] Auth tokens not logged
- [ ] Ingest keys not logged
- [ ] Ingest payload bodies not logged
- [ ] Client-supplied org/user IDs are ignored
- [ ] All queries filtered by authenticated org_id or ingest key org_id

## 12. Testing Strategy

### Manual Test Scenarios

1. **Two-Org Isolation Test (Dashboard)**:
   - Create Org A and Org B in Clerk
   - Invite User 1 to Org A, User 2 to Org B
   - Sign in as User 1, view dashboard, verify only Org A data
   - Sign in as User 2, view dashboard, verify only Org B data

2. **Two-Org Isolation Test (Ingest)**:
   - Create Ingest Key A for Org A, Ingest Key B for Org B
   - Use Key A to ingest events, verify events in Org A only
   - Use Key B to ingest events, verify events in Org B only
   - Attempt to use Key A with manipulated body → still writes to Org A

3. **Auth Failure Tests (Dashboard)**:
   - Call `/summary` without token → 401
   - Call `/summary` with invalid token → 401
   - Call `/summary` with valid token but no org → 403

4. **Auth Failure Tests (Ingest)**:
   - Call `/ingest` without `X-INGEST-KEY` → 401
   - Call `/ingest` with invalid key → 401
   - Call `/ingest` with revoked key → 401

5. **Key Revocation Test**:
   - Create key, ingest events successfully
   - Revoke key (set `revoked_at`)
   - Attempt to ingest with revoked key → 401

6. **Bootstrap Tests**:
   - Sign in as new user (not in DB) → verify org/user created
   - Call `/me` → verify returns correct org slug
   - Verify redirect to `/:orgSlug` works

## 13. Security Considerations

### Token Security
- Never log full tokens (log only first/last few chars if needed)
- Never log ingest keys (log only that key was provided/valid)
- Validate token expiration server-side
- Use HTTPS in production (HTTP acceptable for localhost POC)

### Key Security
- Keys are hashed with SHA-256 before storage
- Raw keys are never stored in database
- Keys are shown only once when created (vendor must store securely)
- Revocation is immediate (no grace period)

### Tenant Isolation
- Always derive `org_id` from authenticated context (Clerk org or ingest key)
- Never trust client-supplied org identifiers
- Filter all queries by `org_id` from auth context
- Use parameterized queries (Drizzle handles this)

### Error Messages
- Don't leak org existence in error messages
- Generic "Unauthorized" for 401
- Generic "Forbidden" for 403

## 14. Key Generation and Management

### Key Format
- Generate 32 random bytes, encode as base64url (URL-safe, no padding)
- Example: `xK9mP2qR7vT4wY8zA1bC3dE5fG6hI0jK`

### Key Creation Flow (Vendor/Admin)
1. Admin creates key via management function or script
2. Key is generated, hashed, stored in `ingest_keys` table
3. Raw key is returned once (must be stored securely by vendor)
4. Key is provided to extension team/user

### Key Rotation Flow
1. Create new key for org
2. Update extension configuration with new key
3. Revoke old key (set `revoked_at`)
4. Old key immediately stops working

### Key Revocation
- Set `revoked_at = now()` in database
- Revoked keys are excluded from lookup queries
- No soft delete needed (revoked_at IS NULL check is sufficient)

## 15. Rollback Considerations

If critical issues arise:
1. Can temporarily keep both `X-POC-TOKEN` and `X-INGEST-KEY` (check both, prefer ingest key)
2. Keep `/summary` with `DEFAULT_ORG_NAME` fallback (check auth first, fallback if missing)
3. Frontend can gracefully degrade (show error if auth fails)

However, for POC, full implementation is preferred.
