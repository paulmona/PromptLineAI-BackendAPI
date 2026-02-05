# Task 03: Add Desktop Navigation Structure to Header Template

Metadata:
- Dependencies: task-01, task-02 (CSS classes must exist)
- Provides: Desktop navigation HTML structure in header.njk
- Size: Small (1 file)
- Phase: 2 - Template Structure

## Implementation Content

Add the desktop navigation bar HTML structure to `views/partials/header.njk`. This includes the Dashboard dropdown (with Users link), Settings dropdown (admin-only, with Account/Org Profile/Policy links), and Logout button. The CSS classes from Phase 1 will style these elements.

## Target Files
- [x] `views/partials/header.njk` - Add desktop nav HTML structure (~30-40 lines)

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc Component Hierarchy (lines 258-274)
- [x] Review existing header.njk structure (lines 1-71)
- [x] Identify insertion point: After `.header-top` div, before `.header-nav-wrapper`

### 2. Implementation

Add desktop navigation structure inside the `{% if orgSlug %}` block, after the `.header-top` div and before the `.header-nav-wrapper`:

```html
{% if orgSlug %}
<!-- Desktop Navigation Bar -->
<nav class="admin-nav-desktop">
  <ul class="admin-nav-list">
    <!-- Dashboard Dropdown -->
    <li class="admin-nav-item">
      <div class="admin-dropdown">
        <button class="admin-dropdown-trigger" aria-expanded="false" aria-haspopup="true">
          Dashboard
        </button>
        <ul class="admin-dropdown-menu">
          <li><a href="/{{ orgSlug }}/users">Users</a></li>
        </ul>
      </div>
    </li>

    <!-- Settings Dropdown (Admin Only) -->
    <li class="admin-nav-item admin-settings-dropdown is-hidden" id="admin-desktop-settings">
      <div class="admin-dropdown">
        <button class="admin-dropdown-trigger" aria-expanded="false" aria-haspopup="true">
          Settings
        </button>
        <ul class="admin-dropdown-menu">
          <li><a href="#" id="desktop-account-link">Account</a></li>
          <li><a href="#" id="desktop-org-profile-link">Org Profile</a></li>
          <li><a href="/{{ orgSlug }}/policy" id="desktop-policy-link">Policy</a></li>
        </ul>
      </div>
    </li>
  </ul>

  <!-- Logout Button -->
  <button class="admin-nav-logout" id="desktop-logout-btn">Logout</button>
</nav>
{% endif %}
```

- [x] Add `<nav class="admin-nav-desktop">` wrapper inside orgSlug conditional
- [x] Add Dashboard dropdown with Users link
- [x] Add Settings dropdown with Account, Org Profile, Policy links (initially hidden with `is-hidden` class)
- [x] Add Logout button positioned right (via CSS flex margin-left: auto)
- [x] Ensure proper ARIA attributes (aria-expanded, aria-haspopup)

### 3. Verification
- [x] No Nunjucks template syntax errors (server starts without errors)
- [x] Desktop nav visible at viewport >768px
- [x] Hamburger hidden at viewport >768px
- [x] Desktop nav hidden at viewport <=768px
- [x] Settings dropdown initially hidden (controlled by JS role check)

## Completion Criteria
- [x] Desktop navigation HTML renders correctly at >768px viewport
- [x] Hamburger hidden on desktop, visible on mobile
- [x] Dashboard dropdown structure present with Users link
- [x] Settings dropdown structure present with Account, Org Profile, Policy links
- [x] Logout button positioned at right of navigation bar
- [x] No Nunjucks template errors
- [x] Operation verified: L1 (Functional Operation) - Visual inspection at different viewports

## Notes
- Impact scope: All admin pages using header partial (dashboard, users, user-detail, policy)
- Constraints: Do not modify existing hamburger or mobile navigation wrapper structure
- Settings dropdown uses `is-hidden` class initially; JavaScript will show it based on admin role
- Account and Org Profile links use `#` href as they open Clerk modals (handled by JS)
