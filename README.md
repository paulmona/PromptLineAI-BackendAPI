# PromptLineAI Backend API

> **Status:** proof of concept, built January to February 2026, now shelved.
> PromptLineAI gives an organization visibility into how its people use AI
> tools without capturing what they type. This repo is the event ingestion API,
> multi-tenant org and user management (Clerk), and the server-rendered admin
> dashboard. Events come from the
> [browser extension](https://github.com/paulmona/PromptLineAI-extension).

Local-first POC backend for PromptLineAI event ingestion and reporting.

## Tech Stack

- Node.js 20+
- TypeScript
- Fastify
- Zod for validation
- Postgres via node-postgres (pg) + Drizzle ORM
- pnpm for package management

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create `.env` file from `env.example`:
   ```bash
   cp env.example .env
   ```

3. Configure `.env` with your credentials:
   ```
   PORT=8787
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   INGEST_KEY_PEPPER=... # generate: openssl rand -hex 32
   DB_HOST=192.168.0.71
   DB_PORT=5432
   DB_NAME=aicompliance
   DB_USER=promptline
   DB_PASSWORD=your-password
   ```

   Or provide `DATABASE_URL` directly to override the constructed connection string.

4. Ensure the database schema is deployed (see `schema.sql`).

## Platform Admin

Platform administrators can manage all customer organizations through the `/admin` interface.

### Setup

1. **Create Platform Admin Organization in Clerk**:
   - Log into your Clerk Dashboard
   - Create a new organization named "Platform Admin" (or your preferred name)
   - Note the Organization ID (format: `org_xxxxxxxxxxxxx`)

2. **Configure Environment Variable**:
   - Add to `.env`:
     ```
     PLATFORM_ADMIN_CLERK_ORG_ID=org_xxxxxxxxxxxxx
     ```
   - Replace `org_xxxxxxxxxxxxx` with the actual Clerk organization ID

3. **Add Users to Platform Admin Org**:
   - In Clerk Dashboard, add users to the Platform Admin organization
   - Only members of this organization can access `/admin` routes

### Accessing Admin Interface

1. Navigate to `http://127.0.0.1:8787/admin`
2. Sign in with a user account that is a member of the Platform Admin organization
3. You will see a list of all customer organizations

### Admin Capabilities

- **View Organizations**: List all orgs with device/event/key counts
- **Revoke Ingest Keys**: Revoke all active ingest keys for an organization
- **Delete Organization**: Permanently delete an organization and all its data

### ⚠️ Warnings

- **DELETE is Destructive**: Deleting an organization removes ALL data:
  - All devices
  - All events
  - All ingest keys
  - User associations (users remain but are orphaned)
- **Confirmation Required**: DELETE requests require `X-ADMIN-CONFIRM: DELETE` header
- **No Undo**: Deleted organizations cannot be recovered

## Development

Run in development mode with hot reload:
```bash
pnpm dev
```

Build for production:
```bash
pnpm build
```

Run production build:
```bash
pnpm start
```

## API Endpoints

### GET /healthz

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "db": "connected"
}
```

**Example:**
```bash
curl -s http://127.0.0.1:8787/healthz
```

### POST /ingest

Ingest events from the Chrome extension.

**Headers:**
- `Content-Type: application/json`
- `X-INGEST-KEY: <key>` (required)

**Tenant Invariant:**
- Org attribution is derived **exclusively** from `X-INGEST-KEY` (hashed server-side with HMAC + pepper).
- Client-supplied org/user fields are **rejected** if present.
- If the device UUID already exists under a different org, the request is rejected with **409 Conflict**.

**Request Body:**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "unassigned",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ts": "2026-01-16T17:00:00.000Z",
      "tool": "chatgpt",
      "event_type": "visit",
      "url_host": "chatgpt.com",
      "file_ext": null,
      "file_size_kb": null,
      "file_name": null,
      "prompt_len_bucket": null,
      "has_code_block": null,
      "paste_detected": null
    }
  ]
}
```

**Response:**
```json
{
  "attempted": 1,
  "inserted": 1
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'Content-Type: application/json' \
  -H 'X-INGEST-KEY: your-ingest-key' \
  --data @payload.json
```

**Idempotency:** Re-sending the same event UUID will not create duplicate rows. The response will show `inserted: 0` for duplicate events.

### GET /summary

Get summary statistics for events.

**Auth:** `Authorization: Bearer <Clerk session token>` (dashboard only; extension does not use this).

**Query Parameters:**
- `range` (optional): `24h`, `7d`, or `30d` (default: `24h`)

**Response:**
```json
{
  "range": "24h",
  "total_events": 150,
  "unique_devices": 5,
  "tools": [
    { "tool": "chatgpt", "count": 100 },
    { "tool": "claude", "count": 50 }
  ],
  "event_types": [
    { "event_type": "visit", "count": 50 },
    { "event_type": "prompt_submit", "count": 100 }
  ],
  "time_buckets": [
    { "bucket": "2026-01-16 17:00:00+00", "count": 10 },
    { "bucket": "2026-01-16 18:00:00+00", "count": 15 }
  ]
}
```

**Example:**
```bash
curl 'http://127.0.0.1:8787/summary?range=24h' \
  -H 'Authorization: Bearer <clerk-session-token>'
```

### GET /me

Returns the authenticated user + org and the canonical `org.slug` for routing.

**Auth:** `Authorization: Bearer <Clerk session token>`

## Testing

### Sample Payload

Create `payload.json`:
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "unassigned",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ts": "2026-01-16T17:00:00.000Z",
      "tool": "chatgpt",
      "event_type": "visit",
      "url_host": "chatgpt.com",
      "file_ext": null,
      "file_size_kb": null,
      "file_name": null,
      "prompt_len_bucket": null,
      "has_code_block": null,
      "paste_detected": null
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "ts": "2026-01-16T17:00:05.000Z",
      "tool": "chatgpt",
      "event_type": "prompt_submit",
      "url_host": "chatgpt.com",
      "file_ext": null,
      "file_size_kb": null,
      "file_name": null,
      "prompt_len_bucket": "200-1000",
      "has_code_block": true,
      "paste_detected": false
    }
  ]
}
```

### Verify in Database

Connect to Postgres and run:
```sql
-- Count total events
SELECT count(*) FROM events;

-- Count unique devices
SELECT count(DISTINCT device_id) FROM events;

-- View recent events
SELECT * FROM events ORDER BY occurred_at DESC LIMIT 5;
```

## Architecture Notes

- **Schema Authority:** `schema.sql` is the single source of truth for database schema
- **Idempotency:** Events are idempotent via `ON CONFLICT (id) DO NOTHING`
- **Device org guard:** Device `org_id` is never updated; `/ingest` enforces a race-safe device org guard and returns 409 on org mismatch
- **Org Resolution (dashboard):** Server resolves org by Clerk org context (with safe, constrained bootstrap from Clerk)
- **Validation:** Strict validation with forward-compatible `extra` field for unknown event keys
- **Security:** `/summary` and `/me` require Clerk Bearer token; `/ingest` requires `X-INGEST-KEY`

## Chrome Extension Integration Notes (critical)

The Chrome extension (separate repo) sends events to `POST /ingest`.

**Auth method:**
- `X-INGEST-KEY: <org-ingest-key>` (required)
- The backend hashes the key using `HMAC_SHA256(INGEST_KEY_PEPPER, rawKey)` and looks up `ingest_keys.key_hash`.

**Required headers:**
```text
Content-Type: application/json
X-INGEST-KEY: <org-ingest-key>
```

**Org context:**
- Derived **only** from the ingest key → org mapping. The body cannot override tenant.

**Key rotation/revocation:**
- Keys are created via `tsx scripts/create-ingest-key.ts <orgId> [name]` (no HTTP endpoint).
- To rotate: create a new key, update the extension config, then revoke the old key by setting `ingest_keys.revoked_at`.
- `INGEST_KEY_PEPPER` is effectively immutable for this POC. Rotating it will invalidate all existing keys immediately (requires full key rotation).

## Error Handling

- **400:** Validation errors (invalid body, invalid query params, >50 events, invalid event_type)
- **401:** Missing/invalid ingest key or missing/invalid Clerk token (depending on endpoint)
- **403:** Clerk token is valid but org context is missing/invalid
- **409:** Device UUID belongs to a different org
- **429:** Rate limit exceeded for ingest key
- **500:** Database errors

## Frontend Templates

The frontend uses Nunjucks templates for consistent layout and navigation across pages.

### Template Structure

- **Layouts**: `views/layouts/base.njk` - Base template with shared header/footer
- **Partials**: `views/partials/` - Reusable components (header, footer, nav)
- **Pages**: `views/pages/` - Page-specific templates extending the base layout

### Adding a New Page

1. Create a new template in `views/pages/` (e.g., `my-page.njk`):
   ```njk
   {% extends "layouts/base.njk" %}
   
   {% block title %}My Page - PromptLineAI{% endblock %}
   
   {% block pageTitle %}My Page{% endblock %}
   
   {% block content %}
   <div class="container">
     <!-- Your page content here -->
   </div>
   {% endblock %}
   ```

2. Add a route in `src/server.ts`:
   ```typescript
   fastify.get('/my-route', async (request, reply) => {
     return reply.view('pages/my-page.njk', {
       showUserControls: true,  // Show sign-out button if authenticated
       orgSlug: orgSlug,        // Pass orgSlug for navigation links
     });
   });
   ```

### Hamburger Menu

The navigation menu includes a responsive hamburger menu:
- **Mobile (< 769px)**: Hamburger button toggles a dropdown menu
- **Desktop (≥ 769px)**: Navigation links shown inline
- Menu closes on link click, Escape key, or outside click

Navigation links are automatically generated when `orgSlug` is provided to the template context.

## Limitations (POC)

- No user attribution on ingest (`events.user_id` and `devices.user_id` remain NULL in this milestone)
- Server binds to 127.0.0.1 (local only)
- No request body logging for `/ingest` endpoint
