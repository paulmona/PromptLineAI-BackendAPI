# Overall Design Document: Admin Dashboard Navigation Redesign

Generation Date: 2026-02-04
Target Plan Document: 20260204-refactor-admin-dashboard-navigation-redesign.md

## Project Overview

### Purpose and Goals
Replace the desktop hamburger menu with a modern top header navigation featuring dropdown menus while preserving mobile hamburger navigation at the 768px breakpoint. Additionally, complete the removal of the deprecated Key Generation feature from both frontend and backend.

### Background and Context
The current admin dashboard uses a hamburger menu on all screen sizes, which is suboptimal for desktop users who have ample screen real estate. This work modernizes the navigation UX by:
1. Showing always-visible top navigation on desktop (>768px)
2. Organizing menu items into logical dropdown groups (Dashboard > Users, Settings > Account/Org Profile/Policy)
3. Removing the deprecated Key Generation feature entirely
4. Maintaining mobile-friendly hamburger navigation (<=768px)

## Task Division Design

### Division Policy
**Approach**: Horizontal Slice (Foundation-driven) as specified in Design Doc
**Rationale**: CSS media queries and desktop navigation styles must be in place before JavaScript handlers can be tested. Template changes depend on CSS classes being defined. Mobile functionality must be preserved throughout.

### Verifiability Level Distribution
- Phase 1 (CSS): L3 (Build Success) - CSS classes can be verified via browser dev tools
- Phase 2 (Templates): L1 (Functional Operation) - Visual verification in browser
- Phase 3 (JavaScript): L1 (Functional Operation) - Interactive behavior verification
- Phase 4 (Backend): L2 (Test Operation) - TypeScript compilation + 404 verification
- Phase 5 (QA): L1 (Functional Operation) - Full acceptance criteria verification

### Inter-task Relationship Map
```
Task 01: CSS desktop navigation styles -> Deliverable: Updated dashboard.css with .admin-* classes
  |
Task 02: CSS media queries and state styles -> Deliverable: Complete CSS foundation
  |
  v (depends on CSS classes)
Task 03: Template desktop navigation structure -> Deliverable: Updated header.njk with desktop nav
  |
Task 04: Template mobile menu cleanup -> Deliverable: Updated nav.njk without Key Gen link
  |
  v (depends on DOM elements)
Task 05: JavaScript desktop dropdown handlers -> Deliverable: Updated nav.js with dropdown logic
  |
Task 06: JavaScript keyboard navigation -> Deliverable: Updated nav.js with accessibility support
  |
  v (frontend complete)
Task 07: Backend Key Generation removal -> Deliverable: Removed routes and deleted files
  |
  v (all implementation complete)
Phase 5 Completion: Quality assurance verification
```

### Interface Change Impact Analysis
| Existing Interface | New Interface | Conversion Required | Corresponding Task |
|-------------------|---------------|---------------------|-------------------|
| `.hamburger-btn` | Hidden at >768px | Media query | Task 02 |
| N/A | `.admin-nav-desktop` | New component | Task 01, 03 |
| N/A | `.admin-dropdown` | New component | Task 01, 03 |
| `#nav-settings-toggle` | `.admin-dropdown-trigger` | Parallel (mobile preserved) | Task 05 |
| `GET /:orgSlug/key-generation` | 404 | Route removal | Task 07 |
| `POST /:orgSlug/key-generation` | 404 | Route removal | Task 07 |

### Common Processing Points
- Logout button handler: Already exists in nav.js, will be reused for desktop nav
- Clerk auth integration: Unchanged, used for role-based Settings visibility
- Media query breakpoint: 768px/769px used consistently across all CSS changes

## Implementation Considerations

### Principles to Maintain Throughout
1. Mobile hamburger functionality must remain working at all phases
2. CSS class naming follows `.admin-` prefix convention for new desktop nav
3. All interactive elements must support keyboard navigation (WCAG compliance)
4. Settings menu visibility controlled by admin role check

### Risks and Countermeasures
- Risk: CSS cascade conflicts between mobile and desktop styles
  Countermeasure: Use specific `.admin-` prefixed classes; test at each phase

- Risk: JavaScript event handler conflicts during menu transitions
  Countermeasure: Use event delegation pattern; verify handlers work at both breakpoints

- Risk: Mobile navigation regression
  Countermeasure: Preserve existing CSS classes; test mobile behavior at each phase

### Impact Scope Management
- Allowed change scope:
  - `public/dashboard.css` - Add desktop nav styles
  - `views/partials/header.njk` - Add desktop nav HTML
  - `views/partials/nav.njk` - Remove Key Gen link
  - `public/nav.js` - Add dropdown handlers
  - `src/server.ts` - Remove key-generation GET route
  - `src/routes/policy.ts` - Remove key-generation POST route
  - `views/pages/key-generation.njk` - Delete file
  - `public/key-generation.js` - Delete file

- No-change areas:
  - Authentication flow (Clerk.js integration)
  - Public page navigation (landing, pricing, login)
  - Other backend API routes
  - Dashboard content and data visualization
  - Existing URL structure (except key-generation removal)

## Task Summary

| Task | Phase | Description | Files | Size |
|------|-------|-------------|-------|------|
| 01 | 1 | Add desktop navigation CSS styles | dashboard.css | Small |
| 02 | 1 | Add media queries and dropdown states | dashboard.css | Small |
| 03 | 2 | Add desktop nav structure to header | header.njk | Small |
| 04 | 2 | Update mobile nav and remove Key Gen link | nav.njk | Small |
| 05 | 3 | Add desktop dropdown click handlers | nav.js | Small |
| 06 | 3 | Add keyboard navigation support | nav.js | Small |
| 07 | 4 | Remove Key Generation backend routes and files | server.ts, policy.ts, key-generation.njk, key-generation.js | Medium |
| P1 | 1 | Phase 1 completion verification | - | - |
| P2 | 2 | Phase 2 completion verification | - | - |
| P3 | 3 | Phase 3 completion verification | - | - |
| P4 | 4 | Phase 4 completion verification | - | - |
| P5 | 5 | Final quality assurance | - | - |

## Execution Order

1. `task-01` - CSS desktop navigation styles
2. `task-02` - CSS media queries and dropdown states
3. `phase1-completion` - Verify Phase 1
4. `task-03` - Template desktop navigation structure
5. `task-04` - Template mobile menu cleanup
6. `phase2-completion` - Verify Phase 2
7. `task-05` - JavaScript desktop dropdown handlers
8. `task-06` - JavaScript keyboard navigation
9. `phase3-completion` - Verify Phase 3
10. `task-07` - Backend Key Generation removal
11. `phase4-completion` - Verify Phase 4
12. `phase5-completion` - Final quality assurance
