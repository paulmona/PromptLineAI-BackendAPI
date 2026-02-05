# Task 06: Add Keyboard Navigation Support

Metadata:
- Dependencies: task-05 (dropdown handlers must exist)
- Provides: Accessible keyboard navigation for desktop dropdowns
- Size: Small (1 file)
- Phase: 3 - JavaScript Handlers

## Implementation Content

Enhance the desktop dropdown handlers with keyboard navigation support for accessibility (WCAG compliance). This includes Tab navigation through menu items, Enter key to open dropdown, Escape key to close dropdown, and proper focus management.

## Target Files
- [x] `public/nav.js` - Add keyboard navigation handlers (~25-30 lines)

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc Accessibility Testing (lines 468-472)
- [x] Review existing Escape key handler for mobile menu (lines 127-132)
- [x] Review WCAG keyboard navigation requirements

### 2. Implementation

Add keyboard handlers inside the `initDesktopDropdowns` function:

```javascript
// Keyboard navigation for desktop dropdowns
function initDropdownKeyboardNav(desktopNav) {
  // Escape key closes open dropdown
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const openDropdown = desktopNav.querySelector('.admin-dropdown-menu.is-open');
      if (openDropdown) {
        closeAllDropdowns(desktopNav);
        // Return focus to the trigger that opened the dropdown
        const trigger = openDropdown.closest('.admin-dropdown').querySelector('.admin-dropdown-trigger');
        if (trigger) {
          trigger.focus();
        }
      }
    }
  });

  // Enter key on trigger opens dropdown
  const dropdownTriggers = desktopNav.querySelectorAll('.admin-dropdown-trigger');
  dropdownTriggers.forEach(trigger => {
    trigger.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click(); // Trigger the existing click handler
      }
    });
  });

  // Arrow key navigation within open dropdown
  desktopNav.addEventListener('keydown', function(e) {
    const openMenu = desktopNav.querySelector('.admin-dropdown-menu.is-open');
    if (!openMenu) return;

    const menuItems = Array.from(openMenu.querySelectorAll('a'));
    const currentIndex = menuItems.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentIndex < 0) {
        // Focus first item
        menuItems[0]?.focus();
      } else if (currentIndex < menuItems.length - 1) {
        // Focus next item
        menuItems[currentIndex + 1].focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        // Focus previous item
        menuItems[currentIndex - 1].focus();
      } else if (currentIndex === 0) {
        // Return to trigger
        const trigger = openMenu.closest('.admin-dropdown').querySelector('.admin-dropdown-trigger');
        trigger?.focus();
      }
    } else if (e.key === 'Tab') {
      // Close dropdown when tabbing out
      const lastItem = menuItems[menuItems.length - 1];
      const firstItem = menuItems[0];

      if (!e.shiftKey && document.activeElement === lastItem) {
        closeAllDropdowns(desktopNav);
      } else if (e.shiftKey && document.activeElement === firstItem) {
        closeAllDropdowns(desktopNav);
      }
    }
  });
}
```

Add visible focus styles to CSS (if not already present):

```css
/* Focus styles for keyboard navigation */
.admin-dropdown-trigger:focus,
.admin-dropdown-menu a:focus {
  outline: 2px solid #007bff;
  outline-offset: 2px;
}
```

- [x] Add `initDropdownKeyboardNav` function
- [x] Add Escape key handler to close dropdown and return focus
- [x] Add Enter/Space key handler for dropdown triggers
- [x] Add ArrowDown/ArrowUp navigation within open dropdown
- [x] Add Tab key handling to close dropdown when tabbing out
- [x] Call `initDropdownKeyboardNav(desktopNav)` from `initDesktopDropdowns()`
- [x] Add focus styles to dashboard.css (if not already present)

### 3. Verification
- [x] Tab navigates through menu items correctly
- [x] Enter key opens dropdown when trigger is focused
- [x] Escape key closes open dropdown and returns focus to trigger
- [x] ArrowDown moves focus to next menu item
- [x] ArrowUp moves focus to previous menu item
- [x] aria-expanded updates correctly on open/close
- [x] Visible focus indicator present on focused elements
- [x] No JavaScript errors in console

## Completion Criteria
- [x] Escape key closes open dropdown
- [x] Tab navigation works through all menu items
- [x] Enter key opens dropdown
- [x] ArrowDown/ArrowUp navigation works within dropdown
- [x] aria-expanded updates correctly
- [x] Visible focus indicator for keyboard navigation
- [x] Mobile hamburger handlers still functional
- [x] No JavaScript errors in console
- [x] Operation verified: L1 (Functional Operation) - Keyboard accessibility test

## Notes
- Impact scope: Keyboard accessibility for desktop navigation
- Constraints: Do not break mouse/touch interaction behavior
- Focus management is important for screen reader users
- WCAG 2.1 requires keyboard operability for all interactive elements
