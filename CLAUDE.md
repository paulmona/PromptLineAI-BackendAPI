# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Development with hot reload (tsx watch)
pnpm build            # TypeScript compilation
pnpm start            # Run production build
pnpm typecheck        # Type check without emit
pnpm test             # Run all tests (vitest)
pnpm test:watch       # Run tests in watch mode
```

Run a single test file:
```bash
pnpm test tests/healthz.test.ts
```

## Architecture Overview

**Tech Stack**: Fastify + TypeScript + Drizzle ORM + Postgres + Clerk authentication + Nunjucks templates

### Authentication

All endpoints use Clerk authentication via Bearer token. Org context is resolved from token claims or Clerk API fallback.

### Request Flow

```
Chrome Extension:
  POST /ingest + Bearer token → requireClerkAuth() → resolve org → insert events

Dashboard:
  GET /summary + Bearer token → requireClerkAuth() → resolve org → query data
```

### Key Source Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Fastify setup, route registration, template routes |
| `src/auth/middleware.ts` | `requireClerkAuth`, `requireOrgAdmin`, `requirePlatformAdmin` |
| `src/auth/ingest-rate-limit.ts` | Rate limiting per organization |
| `src/db/queries.ts` | Database queries (org/user/device resolution) |
| `src/validation.ts` | Zod schemas for request validation |
| `src/routes/*.ts` | Route handlers |

### Frontend Templates

- `views/layouts/base.njk` - Base HTML template
- `views/partials/header.njk` - Header with desktop/mobile navigation
- `views/partials/nav.njk` - Mobile hamburger menu
- `views/pages/*.njk` - Page templates
- `public/nav.js` - Navigation JavaScript (dropdowns, Clerk integration)
- `public/dashboard.css` - All CSS styles

### Database

`schema.sql` is the source of truth. Key tables:
- `organizations` - Tenant orgs (linked to Clerk orgs)
- `users` - Users (linked to Clerk users)
- `devices` - Chrome extension instances
- `events` - Telemetry events (idempotent via UUID PK)

Device org assignment is immutable - `/ingest` returns 409 if device UUID belongs to different org.

## Git Workflow

**Always create a feature branch before making changes. Never commit directly to main.**

```bash
git checkout -b feature/description-of-change
# ... make changes ...
git push -u origin feature/description-of-change
# Create PR via gh pr create
```

## Change Control Rules

From `.cursor/rules/001-cursor-rules.md`:

- Do not add features beyond the request
- Do not change API contracts or database schema without asking
- Do not add dependencies without justification
- Do not upgrade Node/TypeScript/Fastify/Drizzle without asking
- Keep diffs minimal and targeted
- Use strict Zod validation (`.strict()`)
- Use parameterized queries only (no string concatenation)
- Never store prompt text or file contents
- Server binds to `127.0.0.1` by default

## Stop-and-Ask Triggers

Always ask before:
- Adding new endpoints
- Changing `schema.sql`
- Adding dependencies
- Collecting additional user data
- Binding to `0.0.0.0`
