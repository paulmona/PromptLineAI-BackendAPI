# PromptLineAI Backend – Cursor Rules (Fastify + Drizzle + Postgres POC)

## 1) Scope and Change Control
- Do not add features beyond the request. If you see enhancements, list them as “Optional Next” instead of implementing.
- Keep diffs minimal and targeted. Do not refactor unrelated code.
- Do not change API contracts described in `API.md` unless explicitly requested.
- Do not change the database schema or migrations unless explicitly requested. Treat `schema.sql` as authoritative.

## 2) Dependencies and Upgrades
- Do not add new dependencies unless absolutely necessary.
- Do not upgrade Node/TypeScript/Fastify/Drizzle/pg or any dependency without asking.
- If a dependency is required, justify it briefly and prefer the most common, minimal option.
- Use pnpm and commit `pnpm-lock.yaml`. Do not regenerate lockfile unless dependencies change.

## 3) Security and Safety Defaults
- Bind server to `127.0.0.1` by default.
- Require `X-POC-TOKEN` for `/ingest` and return 401 if missing/invalid.
- Do not log request bodies for `/ingest` (payload may contain sensitive metadata like file names).
- Validate all inputs strictly (Zod `.strict()`), reject unknown keys.
- Always use parameterized queries via Drizzle (no string concatenation).

## 4) Data Handling and Privacy
- Never store prompt text or file contents.
- Store only the fields described in `API.md`. If extra fields appear, reject them (strict validation).
- Treat filenames as potentially sensitive; do not add any additional collection beyond what is already in the payload.

## 5) Database Rules (Postgres + Drizzle)
- Treat `schema.sql` as source of truth. Drizzle schema definitions must match it exactly.
- Ingest must be idempotent:
  - Events use the extension’s UUID as PK.
  - On conflict, do nothing (no duplicate rows).
- Use transactions for ingest:
  - Resolve org_id (default org)
  - Upsert device (update last_seen_at)
  - Insert events (bulk insert with conflict handling)
- Do not mutate `org_id` for an existing device.
- Summary queries must leverage indexes and avoid full-table scans where possible.

## 6) API Design Rules
- Implement only:
  - GET `/healthz`
  - POST `/ingest`
  - GET `/summary?range=24h|7d|30d`
- Use clear, consistent error responses:
  - 400 for validation errors
  - 401 for missing/invalid token
  - 413 for too many events in payload
  - 500 for unexpected server/db errors
- Do not introduce additional routes without asking.

## 7) Code Quality Rules
- TypeScript strict mode on. Avoid `any`.
- Separate concerns:
  - `src/validation.ts` for Zod schemas
  - `src/db/schema.ts` for Drizzle schema definitions
  - `src/routes/*` for route handlers
  - `src/db/queries.ts` for DB query helpers
- Keep modules small and single-purpose. No “god files.”
- Prefer explicit, readable code over abstraction.

## 8) Logging and Observability
- Use Fastify logger (pino).
- Log only:
  - request id
  - endpoint name
  - inserted/ignored counts
  - high-level error messages (no payload echo)
- Add a `DEBUG` env flag if verbose logging is needed, but default quiet.

## 9) Formatting
- Keep formatting consistent:
  - 2-space indentation
  - single quotes where reasonable
  - trailing commas where valid
  - keep lines ~100 chars
- Do not add ESLint/Prettier unless explicitly requested.

## 10) Testing Expectations (POC)
- No heavy test framework required.
- Provide curl examples and a sample payload for manual testing.
- Include a short “psql verification” section in README to confirm rows inserted and idempotency.

## Stop-and-Ask Triggers
Stop and ask before doing any of the following:
- Adding auth flows (sessions/OAuth/Cognito)
- Adding new endpoints beyond the three specified
- Changing schema.sql or introducing migrations
- Adding dependencies
- Collecting additional user data or content
- Binding to 0.0.0.0 or exposing the API publicly by default

