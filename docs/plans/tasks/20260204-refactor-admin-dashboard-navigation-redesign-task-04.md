# Task 04: Update Mobile Navigation and Remove Key Generation Link

Metadata:
- Dependencies: task-03 (desktop nav structure should be in place)
- Provides: Updated nav.njk without Key Generation link
- Size: Small (1 file)
- Phase: 2 - Template Structure

## Implementation Content

Update `views/partials/nav.njk` to remove the Key Generation link from the Settings submenu. This completes the frontend removal of the deprecated Key Generation feature. The mobile menu structure will continue to work with the existing hamburger behavior.

## Target Files
- [x] `views/partials/nav.njk` - Remove Key Generation link, move Account into Settings submenu

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc Key Generation Removal requirements
- [x] Review current nav.njk structure (lines 1-28)
- [x] Identify Key Generation link at line 18

### 2. Implementation

Remove the Key Generation link from the Settings submenu:

**Current code (line 18):**
```html
<li><a href="/{{ orgSlug }}/key-generation" id="nav-key-generation-link" class="nav-key-generation-link">Key Generation</a></li>
```

**After removal:** The line should be deleted entirely.

The resulting Settings submenu should look like:
```html
<ul class="nav-settings-submenu is-collapsed">
  <li><a href="#" id="nav-account-link" class="nav-account-link">Account</a></li>
  <li><a href="#" id="nav-org-profile-link" class="nav-org-profile-link">Org profile</a></li>
  <li><a href="/{{ orgSlug }}/policy" id="nav-policy-link" class="nav-policy-link">Policy</a></li>
</ul>
```

- [x] Remove Key Generation link from Settings submenu (line 18)
- [x] Move Account link into Settings submenu (to match desktop navigation structure)
- [x] Verify no other references to key-generation in nav.njk

### 3. Verification
- [x] No Nunjucks template syntax errors
- [x] Mobile menu no longer shows "Key Generation" link
- [x] Settings submenu still shows Org profile and Policy links
- [x] Mobile hamburger menu still functions correctly
- [x] Search for "key-generation" in nav.njk returns no results

## Completion Criteria
- [x] Key Generation link removed from nav.njk
- [x] Mobile navigation still functional
- [x] Settings submenu contains Account, Org profile, and Policy (matching desktop)
- [x] No template syntax errors
- [x] Operation verified: L1 (Functional Operation) - Mobile menu inspection

## Notes
- Impact scope: Mobile navigation menu (hamburger slide-out)
- Constraints: Do not modify other menu items or the Settings toggle behavior
- The backend routes for key-generation will be removed in Phase 4
- The key-generation.njk template and JS file will be deleted in Phase 4

## Implementation Summary
- Removed Key Generation link from nav.njk Settings submenu
- Moved Account link from standalone position into Settings submenu (matching desktop structure)
- Mobile menu structure now matches desktop: Dashboard, Users, Settings (Account, Org profile, Policy), Logout
- All existing tests pass (68/68)
- Build succeeds without errors
- Verified skill fidelity: Implementation matches Design Doc specifications
