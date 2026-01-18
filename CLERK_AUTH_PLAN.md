# Clerk Authentication Implementation Plan

## Overview

Add Clerk-based B2B authentication to the existing Fastify + TypeScript backend with static dashboard. Users belong to a single org, no org switching. Uses Clerk Hosted Pages (not embedded UI).

## 1. Clerk Dashboard Configuration Assumptions

### Required Clerk Setup
- **Clerk Dashboard**: Create application with Organizations enabled
- **Hosted Pages URLs**:
  - Sign-in: `https://<your-clerk-domain>.clerk.accounts.dev/sign-in`
  - Sign-up: `https://<your-clerk-domain>.clerk.accounts.dev/sign-up`
  - After sign-in redirect: `http://127.0.0.1:8787/app` (or configured redirect URL)
- **Required Keys**:
  - `CLERK_PUBLISHABLE_KEY`: Frontend key (starts with `pk_`)
  - `CLERK_SECRET_KEY`: Backend key (starts with `sk_`)
- **JWT Template**: Configure session token to include:
  - `sub` (user ID)
  - `org_id` (organization ID from Clerk)
  - Standard claims (iat, exp, etc.)

### Clerk Session Token Structure (Assumed)
```json
{
  "sub": "user_xxx",           // Clerk user ID
  "org_id": "org_xxx",         // Clerk org ID (if user has active org)
  "iat": 1234567890,
  "exp": 1234567890
}
```

## 2. Server-Side Auth Strategy for Fastify

### JWT Verification Approach
- Use `@clerk/fastify` plugin OR manual JWT verification with `@clerk/backend`
- Recommended: Use `@clerk/fastify` for built-in middleware
- Alternative: Manual verification using `@clerk/backend` SDK's `verifyToken()`

### Implementation Pattern
```typescript
// Auth middleware decorator
fastify.decorate('authenticate', async (request, reply) => {
  const token = extractBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'Missing authorization token' });
  }
  
  const payload = await verifyClerkToken(token);
  if (!payload.org_id) {
    return reply.code(403).send({ error: 'No organization context' });
  }
  
  request.auth = {
    userId: payload.sub,
    orgExternalId: payload.org_id
  };
});
```

### Request Auth Object
- Attach to `request.auth` (via Fastify decorator or plugin)
- Type: `{ userId: string, orgExternalId: string }`
- Available in all protected route handlers

## 3. Database Mapping and Migrations

### Current State
- `orgs` table exists (id, name, created_at)
- `users` table exists (referenced in FKs but not in schema.sql dump)
- Need to add Clerk external IDs

### Required Schema Changes

#### Migration 1: Add external_org_id to orgs
```sql
ALTER TABLE public.orgs 
ADD COLUMN external_org_id text;

CREATE UNIQUE INDEX orgs_external_org_id_uq 
ON public.orgs (external_org_id) 
WHERE external_org_id IS NOT NULL;
```

#### Migration 2: Ensure users table has required columns
```sql
-- If users table doesn't exist, create it
CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    external_uid text,
    org_id uuid REFERENCES public.orgs(id) ON DELETE SET NULL,
    email text,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add unique index on external_uid if not exists
CREATE UNIQUE INDEX IF NOT EXISTS users_external_uid_uq 
ON public.users (external_uid) 
WHERE external_uid IS NOT NULL;

-- Add index on org_id if not exists
CREATE INDEX IF NOT EXISTS users_org_id_idx 
ON public.users (org_id);
```

#### Migration 3: Add org slug (optional, for future use)
```sql
ALTER TABLE public.orgs 
ADD COLUMN slug text;

CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_uq 
ON public.orgs (lower(slug)) 
WHERE slug IS NOT NULL;
```

### Drizzle Schema Updates
- Update `src/db/schema.ts`:
  - Add `externalOrgId` to `orgs` table
  - Add `slug` to `orgs` table (optional)
  - Create `users` table schema with `externalUid`, `orgId`, `email`, `name`
  - Add indexes as per migrations

## 4. /me Endpoint Behavior and Bootstrap Logic

### Endpoint: GET /me (Protected)
- **Auth**: Requires valid Clerk session token with org context
- **Response**:
```typescript
{
  user: {
    id: string,           // Internal UUID
    email: string,
    name: string | null
  },
  org: {
    id: string,          // Internal UUID
    name: string,
    slug: string | null
  }
}
```

### Bootstrap Logic Flow
1. Extract `userId` and `orgExternalId` from verified token
2. **Upsert Org**:
   - Lookup org by `external_org_id = orgExternalId`
   - If missing, create org:
     - `external_org_id = orgExternalId`
     - `name = "Organization"` (or fetch from Clerk API if available)
     - `slug = null` (or generate from name)
   - Use `ON CONFLICT (external_org_id) DO UPDATE` for race safety
3. **Upsert User**:
   - Lookup user by `external_uid = userId`
   - If missing, create user:
     - `external_uid = userId`
     - `org_id = <resolved org id>`
     - `email = <from Clerk token or API>`
     - `name = <from Clerk token or API>`
   - If exists but `org_id` is null, update `org_id = <resolved org id>`
   - Use `ON CONFLICT (external_uid) DO UPDATE` for race safety
4. Return user and org data

### Error Cases
- **401**: Missing or invalid token
- **403**: Token valid but no `org_id` in token (user not in org)
- **500**: Database error during bootstrap

## 5. Update /summary to Use Org from Auth

### Current Behavior
- Uses `DEFAULT_ORG_NAME` to resolve org
- No authentication required

### New Behavior
- **Protected**: Requires authentication
- **Org-scoped**: Uses `request.auth.orgExternalId` to resolve internal `org_id`
- **Query**: All `getSummary()` calls filtered by resolved `org_id`

### Implementation Changes
1. Add auth middleware to `/summary` route
2. Replace `getOrCreateOrg(env.DEFAULT_ORG_NAME)` with:
   ```typescript
   const org = await getOrgByExternalId(request.auth.orgExternalId);
   if (!org) {
     return reply.code(403).send({ error: 'Organization not found' });
   }
   ```
3. Update `getSummary()` call to use resolved `org.id`
4. Remove `DEFAULT_ORG_NAME` dependency from summary route

### New Query Helper
```typescript
export async function getOrgByExternalId(externalOrgId: string): Promise<{ id: string } | null> {
  const result = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.externalOrgId, externalOrgId))
    .limit(1);
  
  return result[0] || null;
}
```

## 6. Frontend Flow

### Sign-In Link URL
- Use Clerk Hosted Sign-in URL
- Format: `https://<clerk-domain>.clerk.accounts.dev/sign-in?redirect_url=http://127.0.0.1:8787/app`
- Store `CLERK_PUBLISHABLE_KEY` in env, use in frontend

### Token Acquisition Strategy
1. **Load Clerk.js SDK dynamically** via `public/auth.js`:
   - The `/env.js` endpoint serves `CLERK_JS_URL` (defaults to `http://cdn.clerk.io/clerk.js`)
   - `public/auth.js` dynamically loads Clerk.js from `CLERK_JS_URL` using a script tag with `async` and `crossorigin="anonymous"`
   - Include in HTML:
     ```html
     <script src="/env.js"></script>
     <script src="/assets/auth.js"></script>
     ```
2. **Initialize Clerk**:
   ```javascript
   await window.PromptLineAuth.initClerk();
   ```
3. **Get Session Token** (in-memory only):
   ```javascript
   const token = await window.PromptLineAuth.getToken();
   // Returns null if not authenticated
   ```

### Fetch Wrapper
```javascript
async function authenticatedFetch(url, options = {}) {
  const session = await clerk.session;
  const token = await session?.getToken();
  
  if (!token) {
    throw new Error('Not authenticated');
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

### Redirect Logic

#### GET / (Landing Page)
- **File**: `public/index.html` (or new `public/landing.html`)
- **Logic**:
  1. Check if user is signed in via `clerk.user`
  2. If signed in:
     - Call `GET /me` to verify org access
     - If successful, redirect to `/app`
     - If 403 (no org), show "Not assigned to organization"
  3. If signed out:
     - Show landing page with "Sign in" button
     - Button links to Clerk Hosted Sign-in with redirect to `/app`

#### GET /app (Dashboard)
- **File**: `public/app.html` (rename current `index.html` or create new)
- **Logic**:
  1. Check if user is signed in
  2. If signed out: Show message + "Sign in" link
  3. If signed in:
     - Call `GET /me` to get org context
     - If 403 (no org): Show "Not assigned to an organization"
     - If 200: Render dashboard, call `/summary` with auth header
  4. Include "Sign out" button that calls `clerk.signOut()` and redirects to `/`

### Sign Out Flow
```javascript
async function signOut() {
  await clerk.signOut();
  window.location.href = '/';
}
```

## 7. File Structure Changes

### New Files
- `src/auth/clerk.ts`: Clerk token verification logic
- `src/auth/middleware.ts`: Fastify auth decorator/middleware
- `src/routes/me.ts`: GET /me endpoint
- `src/db/queries.ts`: Add `getOrgByExternalId()`, `upsertOrgByExternalId()`, `upsertUserByExternalId()`
- `public/landing.html`: Landing page (or update `index.html`)
- `public/app.html`: Dashboard page (rename from `index.html` or create new)
- `public/auth.js`: Frontend auth logic (Clerk initialization, token management)
- `migrations/001_add_clerk_mapping.sql`: Database migration

### Modified Files
- `src/server.ts`: Register auth middleware, register `/me` route, protect `/summary`
- `src/routes/summary.ts`: Add auth requirement, use org from auth
- `src/db/schema.ts`: Add external IDs, users table
- `src/env.ts`: Add Clerk env vars
- `package.json`: Add `@clerk/fastify` or `@clerk/backend` dependency
- `.env.example`: Add Clerk keys

## 8. Environment Configuration

### New Env Vars
```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_SIGN_IN_URL=https://your-app.clerk.accounts.dev/sign-in
CLERK_SIGN_UP_URL=https://your-app.clerk.accounts.dev/sign-up
```

### Env Schema Update
```typescript
const envSchema = z.object({
  // ... existing vars
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_SIGN_IN_URL: z.string().url().optional(),
  CLERK_SIGN_UP_URL: z.string().url().optional(),
});
```

## 9. Implementation Steps

### Phase 1: Backend Auth Infrastructure
1. Install `@clerk/fastify` or `@clerk/backend`
2. Add Clerk env vars to `env.ts`
3. Create `src/auth/clerk.ts` with token verification
4. Create `src/auth/middleware.ts` with Fastify decorator
5. Register auth middleware in `server.ts`

### Phase 2: Database Migrations
1. Create migration SQL file
2. Update Drizzle schema (`src/db/schema.ts`)
3. Add query helpers for org/user upserts by external ID

### Phase 3: /me Endpoint
1. Create `src/routes/me.ts`
2. Implement bootstrap logic (upsert org/user)
3. Register route in `server.ts`
4. Test with valid Clerk token

### Phase 4: Protect /summary
1. Add auth requirement to `/summary` route
2. Replace `DEFAULT_ORG_NAME` lookup with org from auth
3. Update `getSummary()` to use provided org_id (no lookup needed)
4. Test with authenticated request

### Phase 5: Frontend Auth
1. Add Clerk.js SDK to HTML
2. Create `public/auth.js` with auth utilities
3. Update `public/index.html` → `public/landing.html` (landing page)
4. Create `public/app.html` (dashboard, move current dashboard code)
5. Update `dashboard.js` to use authenticated fetch
6. Add sign-in/sign-out buttons

### Phase 6: Routing Updates
1. Update `server.ts` to serve `landing.html` for `/`
2. Update `server.ts` to serve `app.html` for `/app`
3. Test redirect flow

## 10. Acceptance Criteria

### Signed-Out User
- [ ] Visiting `/` shows landing page with "Sign in" button
- [ ] Clicking "Sign in" redirects to Clerk Hosted Sign-in
- [ ] After signing in, user is redirected to `/app`
- [ ] Visiting `/app` while signed out shows "Please sign in" message

### Signed-In User (With Org)
- [ ] After sign-in, user is redirected to `/app`
- [ ] Dashboard loads and calls `GET /me` successfully
- [ ] `GET /me` returns user and org data
- [ ] Dashboard calls `GET /summary` with Authorization header
- [ ] `GET /summary` returns org-scoped data (only events for user's org)
- [ ] Sign out button works and redirects to `/`

### Signed-In User (Without Org)
- [ ] After sign-in, user sees "Not assigned to an organization" message
- [ ] `GET /me` returns 403 with appropriate error
- [ ] Dashboard does not attempt to load data

### Security
- [ ] Tokens are never stored in localStorage
- [ ] Tokens are kept in memory only
- [ ] Auth tokens are not logged
- [ ] Unauthenticated requests to `/summary` return 401
- [ ] Authenticated requests without org context return 403
- [ ] Each org only sees their own data (tenant isolation)

### Backward Compatibility
- [ ] `/ingest` endpoint continues to work without auth (unchanged)
- [ ] `/healthz` endpoint remains public

## 11. Testing Strategy

### Manual Testing Checklist
1. **Sign-in Flow**:
   - Sign in via Clerk Hosted Pages
   - Verify redirect to `/app`
   - Verify dashboard loads

2. **Auth Protection**:
   - Try accessing `/summary` without token → 401
   - Try accessing `/summary` with invalid token → 401
   - Try accessing `/summary` with valid token but no org → 403

3. **Multi-Tenant Isolation**:
   - Sign in as User A (Org 1)
   - Verify dashboard shows only Org 1 data
   - Sign out, sign in as User B (Org 2)
   - Verify dashboard shows only Org 2 data

4. **Bootstrap Logic**:
   - Sign in as new user (not in DB)
   - Verify org and user are created in DB
   - Verify `/me` returns correct data

### Test Data Setup
- Create test orgs in Clerk dashboard
- Invite test users to orgs
- Verify org IDs are available in session tokens

## 12. Security Considerations

### Token Handling
- Never log full tokens (log only first/last few chars if needed for debugging)
- Validate token expiration server-side
- Use HTTPS in production (POC can use HTTP for localhost)

### Org Isolation
- Always filter queries by `org_id` derived from authenticated token
- Never trust client-provided org identifiers
- Use parameterized queries to prevent SQL injection

### Error Messages
- Don't leak org existence in error messages
- Generic "Unauthorized" for auth failures
- Generic "Forbidden" for org access failures

## 13. Rollback Plan

If issues arise:
1. Remove auth middleware from `/summary` (temporary)
2. Revert to `DEFAULT_ORG_NAME` lookup
3. Keep `/me` endpoint for testing
4. Frontend can continue working without auth (graceful degradation)

## 14. Future Enhancements (Out of Scope)

- Org switching (users stay in single org)
- Role-based access control (all users have same permissions)
- Embedded Clerk UI (using Hosted Pages for POC)
- Custom org creation (vendor-only)
- User profile management
