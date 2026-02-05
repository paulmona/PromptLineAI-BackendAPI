# Task 07: Remove Key Generation Backend Routes and Delete Files

Metadata:
- Dependencies: task-04 (frontend Key Gen link removed), Phase 3 complete (frontend no longer references Key Gen)
- Provides: Complete removal of Key Generation feature from codebase
- Size: Medium (4 files: 2 modifications, 2 deletions)
- Phase: 4 - Backend Cleanup

## Implementation Content

Complete the removal of the deprecated Key Generation feature by:
1. Removing the GET route from server.ts
2. Removing the POST route from policy.ts
3. Deleting the template file key-generation.njk
4. Deleting the client script key-generation.js

## Target Files
- [x] `src/server.ts` - Remove GET route (~7 lines)
- [x] `src/routes/policy.ts` - Remove POST route (~37 lines)
- [x] `views/pages/key-generation.njk` - Delete file
- [x] `public/key-generation.js` - Delete file

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc Key Generation Removal requirements (lines 90-95)
- [x] Review key-generation GET route in server.ts (lines 177-183)
- [x] Review key-generation POST route in policy.ts (lines 113-149)
- [x] Verify nav.njk no longer references key-generation (Task 04 completed)

### 2. Implementation

**Step 2.1: Remove GET route from server.ts**

Remove the following code block (lines 177-183):
```typescript
fastify.get<{ Params: { orgSlug: string } }>('/:orgSlug/key-generation', async (request: FastifyRequest<{ Params: { orgSlug: string } }>, reply: FastifyReply) => {
  const orgSlug = decodeURIComponent(request.params.orgSlug);
  return (reply as any).view('pages/key-generation.njk', getTemplateContext({
    showUserControls: true,
    orgSlug,
  }));
});
```

- [x] Remove GET `/:orgSlug/key-generation` route from server.ts

**Step 2.2: Remove POST route from policy.ts**

Remove the following code block (lines 113-149):
```typescript
// POST /:orgSlug/key-generation - Generate a new ingest key
fastify.post<{ Params: { orgSlug: string }; Body: { name?: string } }>(
  '/:orgSlug/key-generation',
  { preHandler: [requireClerkAuth, requireOrgAdmin] },
  async (request: FastifyRequest<{ Params: { orgSlug: string }; Body: { name?: string } }>, reply: FastifyReply) => {
    // ... entire handler body ...
  }
);
```

Also check if `createIngestKey` import is still needed. If not used elsewhere, remove:
```typescript
import { createIngestKey } from '../db/ingest-keys.js';
```

- [x] Remove POST `/:orgSlug/key-generation` route from policy.ts
- [x] Remove unused `createIngestKey` import if no longer needed

**Step 2.3: Delete template and JS files**

- [x] Delete `views/pages/key-generation.njk`
- [x] Delete `public/key-generation.js`

### 3. Verification
- [x] TypeScript compiles without errors: `npm run build`
- [ ] Server starts successfully: `npm run dev`
- [ ] GET `/{orgSlug}/key-generation` returns 404
- [ ] POST `/{orgSlug}/key-generation` returns 404
- [x] Lint checks pass
- [x] Search codebase for "key-generation" returns no active references

## Completion Criteria
- [x] TypeScript compiles without errors
- [ ] Server starts successfully
- [ ] GET `/:orgSlug/key-generation` returns 404
- [ ] POST `/:orgSlug/key-generation` returns 404
- [x] No references to key-generation in active codebase
- [x] Lint checks pass
- [ ] Operation verified: L2 (Test Operation) - Compile success + 404 verification

## Notes
- Impact scope: Backend routes and unused template/JS files
- Constraints: Do not modify other routes in server.ts or policy.ts
- The `createIngestKey` function in `db/ingest-keys.js` may still be used by other code - check before removing import
- Git preserves deleted files in history if needed for reference
