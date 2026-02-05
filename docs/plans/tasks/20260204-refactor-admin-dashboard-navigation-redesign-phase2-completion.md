# Phase 2 Completion: Template Structure Verification

Metadata:
- Dependencies: task-03, task-04
- Provides: Verified HTML structure for Phase 3 JavaScript work
- Phase: 2 - Template Structure

## Phase Completion Checklist

### Task Completion
- [ ] Task 03: Desktop navigation structure added to header.njk
- [ ] Task 04: Key Generation link removed from nav.njk

### Template Structure Verification

**Desktop Navigation (header.njk):**
- [ ] `<nav class="admin-nav-desktop">` element present
- [ ] Dashboard dropdown with "Users" link
- [ ] Settings dropdown with Account, Org Profile, Policy links
- [ ] Settings dropdown has `is-hidden` class initially
- [ ] Logout button with class `admin-nav-logout`
- [ ] Proper ARIA attributes (aria-expanded, aria-haspopup)

**Mobile Navigation (nav.njk):**
- [ ] Key Generation link removed from Settings submenu
- [ ] Org profile link present in Settings submenu
- [ ] Policy link present in Settings submenu
- [ ] All other menu items unchanged

### Quality Checks
- [ ] No Nunjucks template syntax errors (server starts cleanly)
- [ ] No JavaScript errors in browser console
- [ ] Templates render without errors

## Operational Verification Procedures

### Procedure 1: Desktop Navigation Display
1. Start development server: `npm run dev`
2. Navigate to admin dashboard (e.g., `/{orgSlug}` while logged in)
3. Resize browser to width >768px (e.g., 1024px)
4. Verify: Top header navigation bar is visible
5. Verify: "Dashboard" menu item visible
6. Verify: Logout button visible at right side
7. Verify: Hamburger button is hidden

### Procedure 2: Desktop Dropdown Structure
1. At viewport >768px, inspect Dashboard dropdown element
2. Verify: Contains "Users" link with correct href
3. Inspect Settings dropdown element (may be hidden)
4. Verify: Contains Account, Org Profile, Policy links
5. Note: Dropdowns won't open on click yet (JS added in Phase 3)

### Procedure 3: Mobile Navigation
1. Resize browser to width <=768px (e.g., 375px)
2. Verify: Hamburger button is visible
3. Verify: Desktop navigation is hidden
4. Click hamburger button
5. Verify: Slide-out menu appears
6. Verify: Dashboard, Users links visible
7. Click Settings toggle
8. Verify: Settings submenu shows Org profile and Policy
9. Verify: "Key Generation" link is NOT present

### Procedure 4: Key Generation Removal Check
1. Search codebase: `grep -r "key-generation" views/`
2. Expected: Only key-generation.njk file reference (deleted in Phase 4)
3. Verify nav.njk does not contain "key-generation"

## Phase Exit Criteria
- [ ] Desktop navigation HTML renders correctly at >768px
- [ ] Hamburger hidden on desktop, visible on mobile
- [ ] Key Generation link no longer appears in any navigation menu
- [ ] Settings dropdown structure includes Account, Org Profile, Policy
- [ ] No Nunjucks template errors
- [ ] Mobile hamburger menu still functions

## Notes
- Phase 3 can begin once all checklist items are verified
- DOM elements are required for JavaScript event handler binding
- Settings visibility will be controlled by JavaScript role check in Phase 3
