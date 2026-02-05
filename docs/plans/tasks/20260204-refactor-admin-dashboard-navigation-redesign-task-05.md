# Task 05: Add Desktop Dropdown Click Handlers

Metadata:
- Dependencies: task-03 (DOM elements must exist for event binding)
- Provides: Interactive desktop dropdown behavior
- Size: Small (1 file)
- Phase: 3 - JavaScript Handlers

## Implementation Content

Update `public/nav.js` to add click handlers for the desktop navigation dropdowns. This includes toggle behavior for opening/closing dropdowns, closing when clicking outside, closing other dropdowns when opening a new one, and handling link clicks within dropdowns.

## Target Files
- [x] `public/nav.js` - Add desktop dropdown handlers (~40-50 lines)

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc State Transitions (lines 360-377)
- [x] Review existing nav.js structure (IIFE pattern, event delegation)
- [x] Review existing handler patterns for hamburger, Settings toggle

### 2. Implementation

Add desktop dropdown handlers inside the `initNav` function, after the existing hamburger and mobile menu handlers:

```javascript
// Desktop dropdown functionality
function initDesktopDropdowns() {
  const desktopNav = document.querySelector('.admin-nav-desktop');
  if (!desktopNav) return;

  const dropdownTriggers = desktopNav.querySelectorAll('.admin-dropdown-trigger');

  // Toggle dropdown on click
  dropdownTriggers.forEach(trigger => {
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      const dropdown = this.closest('.admin-dropdown');
      const menu = dropdown.querySelector('.admin-dropdown-menu');
      const isOpen = menu.classList.contains('is-open');

      // Close all other dropdowns first
      closeAllDropdowns(desktopNav);

      // Toggle current dropdown
      if (!isOpen) {
        menu.classList.add('is-open');
        this.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    if (!desktopNav.contains(e.target)) {
      closeAllDropdowns(desktopNav);
    }
  });

  // Handle dropdown menu link clicks
  const dropdownLinks = desktopNav.querySelectorAll('.admin-dropdown-menu a');
  dropdownLinks.forEach(link => {
    link.addEventListener('click', function() {
      closeAllDropdowns(desktopNav);
    });
  });

  // Show Settings dropdown for admin users
  initAdminSettingsVisibility();

  // Handle desktop Account link
  const accountLink = desktopNav.querySelector('#desktop-account-link');
  if (accountLink) {
    accountLink.addEventListener('click', async function(e) {
      e.preventDefault();
      closeAllDropdowns(desktopNav);
      try {
        if (window.PromptLineAuth && window.PromptLineAuth.initClerk) {
          await window.PromptLineAuth.initClerk();
        }
        if (window.Clerk && window.Clerk.loaded && window.Clerk.openUserProfile) {
          window.Clerk.openUserProfile();
        } else if (window.PromptLineAuth && window.PromptLineAuth.openUserProfile) {
          window.PromptLineAuth.openUserProfile();
        }
      } catch (err) {
        console.error('Account error:', err);
      }
    });
  }

  // Handle desktop Org Profile link
  const orgProfileLink = desktopNav.querySelector('#desktop-org-profile-link');
  if (orgProfileLink) {
    orgProfileLink.addEventListener('click', async function(e) {
      e.preventDefault();
      closeAllDropdowns(desktopNav);
      try {
        if (window.PromptLineAuth && window.PromptLineAuth.initClerk) {
          await window.PromptLineAuth.initClerk();
        }
        if (window.Clerk && window.Clerk.loaded && window.Clerk.openOrganizationProfile) {
          window.Clerk.openOrganizationProfile();
        } else if (window.PromptLineAuth && window.PromptLineAuth.openOrganizationProfile) {
          window.PromptLineAuth.openOrganizationProfile();
        }
      } catch (err) {
        console.error('Org profile error:', err);
      }
    });
  }

  // Handle desktop Logout button
  const logoutBtn = desktopNav.querySelector('#desktop-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      try {
        if (window.PromptLineAuth && window.PromptLineAuth.signOut) {
          await window.PromptLineAuth.signOut();
        }
        window.location.href = '/';
      } catch (err) {
        console.error('Logout error:', err);
        window.location.href = '/';
      }
    });
  }
}

// Helper: Close all dropdowns in a nav container
function closeAllDropdowns(navContainer) {
  const openMenus = navContainer.querySelectorAll('.admin-dropdown-menu.is-open');
  openMenus.forEach(menu => {
    menu.classList.remove('is-open');
    const trigger = menu.closest('.admin-dropdown').querySelector('.admin-dropdown-trigger');
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

// Helper: Show Settings dropdown for admin users
async function initAdminSettingsVisibility() {
  const settingsDropdown = document.getElementById('admin-desktop-settings');
  const mobileSettings = document.getElementById('nav-settings');

  if (!settingsDropdown && !mobileSettings) return;

  try {
    const response = await fetch('/admin/policy-access', {
      credentials: 'include'
    });

    if (response.ok) {
      // User is admin - show Settings
      if (settingsDropdown) {
        settingsDropdown.classList.remove('is-hidden');
      }
      if (mobileSettings) {
        mobileSettings.classList.remove('is-hidden');
      }
    }
    // If not OK, Settings stays hidden (defensive default)
  } catch (err) {
    console.error('Failed to check admin status:', err);
    // On error, Settings stays hidden (defensive default)
  }
}
```

- [x] Add `initDesktopDropdowns` function
- [x] Add `closeAllDropdowns` helper function
- [x] Add `initAdminSettingsVisibility` helper function
- [x] Add click handlers for dropdown triggers (toggle behavior)
- [x] Add click-outside handler to close dropdowns
- [x] Add handlers for Account, Org Profile links (Clerk modals)
- [x] Add handler for Logout button
- [x] Call `initDesktopDropdowns()` from `initNav()`
- [x] Remove Key Generation link handler (if present, lines 90-97)

### 3. Verification
- [ ] No JavaScript syntax errors (console clear)
- [ ] Desktop dropdowns toggle on click
- [ ] Only one dropdown open at a time
- [ ] Click outside closes dropdown
- [ ] Clicking dropdown item closes dropdown
- [ ] Account link opens Clerk user profile modal
- [ ] Org Profile link opens Clerk organization modal
- [ ] Logout button redirects to landing page
- [ ] Mobile hamburger still works

## Completion Criteria
- [ ] Desktop dropdown toggles on click
- [ ] Only one dropdown open at a time
- [ ] Click outside closes dropdown
- [ ] Settings visibility controlled by admin role check
- [ ] Mobile hamburger toggle still functional
- [ ] No JavaScript errors in console
- [ ] Operation verified: L1 (Functional Operation) - Interactive behavior test

## Notes
- Impact scope: Desktop navigation interactive behavior
- Constraints: Do not break existing mobile hamburger handlers
- The admin role check uses existing `/admin/policy-access` endpoint
- Key Generation link handler removal may already be absent if link was removed from template
