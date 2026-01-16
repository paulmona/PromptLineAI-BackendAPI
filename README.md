# PromptLineAI Backend API

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

2. Create `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Configure `.env` with your database credentials:
   ```
   PORT=8787
   POC_TOKEN=your-secret-token-here
   DEFAULT_ORG_NAME=default
   DB_HOST=192.168.0.71
   DB_PORT=5432
   DB_NAME=aicompliance
   DB_USER=promptline
   DB_PASSWORD=your-password
   ```

   Or provide `DATABASE_URL` directly to override the constructed connection string.

4. Ensure the database schema is deployed (see `schema.sql`).

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
- `X-POC-TOKEN: <token>` (required, must match POC_TOKEN from .env)

**Request Body:**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
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
  -H 'X-POC-TOKEN: your-token' \
  --data @payload.json
```

**Idempotency:** Re-sending the same event UUID will not create duplicate rows. The response will show `inserted: 0` for duplicate events.

### GET /summary

Get summary statistics for events.

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
curl 'http://127.0.0.1:8787/summary?range=24h'
```

## Testing

### Sample Payload

Create `payload.json`:
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
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
- **Device Immutability:** Device `org_id` is never updated for existing devices
- **Org Resolution:** Server resolves org by `DEFAULT_ORG_NAME` (client-provided org_id is ignored)
- **Validation:** Strict validation with forward-compatible `extra` field for unknown event keys
- **Security:** Token-based authentication via `X-POC-TOKEN` header (no user auth system yet)

## Error Handling

- **400:** Validation errors (invalid body, invalid query params, >50 events, invalid event_type)
- **401:** Missing or incorrect `X-POC-TOKEN`
- **500:** Database errors or missing default org

## Limitations (POC)

- No user authentication system
- No user concept in ingestion payload
- No frontend UI
- Server binds to 127.0.0.1 (local only)
- No request body logging for `/ingest` endpoint
