# Task 02: Add CSS Media Queries and Dropdown States

Metadata:
- Dependencies: task-01 (CSS base classes must exist)
- Provides: Complete CSS foundation with media queries for 768px breakpoint and dropdown state styles
- Size: Small (1 file)
- Phase: 1 - CSS Foundation

## Implementation Content

Add media queries to show/hide desktop navigation vs hamburger menu based on viewport width, and add the dropdown open state class. The 768px/769px breakpoint follows the existing project convention.

## Target Files
- [x] `public/dashboard.css` - Add media queries and state styles (~30-40 lines)

## Implementation Steps

### 1. Preparation
- [x] Confirm skill constraints: Verify Design Doc Media Query section (lines 321-333)
- [x] Review existing media queries in dashboard.css (lines 522, 1313 use 768px)
- [x] Identify insertion point for new media queries

### 2. Implementation

Add dropdown state class:
```css
/* Dropdown Open State */
.admin-dropdown-menu.is-open {
  display: block;
}

.admin-dropdown-trigger[aria-expanded="true"]::after {
  transform: rotate(-135deg);
  margin-bottom: -2px;
}
```

Add media queries for responsive behavior:
```css
/* Desktop Navigation - Show at 769px and above */
@media (min-width: 769px) {
  .admin-nav-desktop {
    display: flex;
  }

  /* Hide hamburger on desktop */
  .hamburger-btn {
    display: none !important;
  }

  /* Hide mobile nav overlay on desktop */
  .header-nav-wrapper {
    display: none !important;
  }
}

/* Mobile Navigation - 768px and below */
@media (max-width: 768px) {
  .admin-nav-desktop {
    display: none !important;
  }

  /* Hamburger remains visible (existing styles) */
  /* Mobile nav wrapper remains functional (existing styles) */
}
```

- [x] Add dropdown open state (.admin-dropdown-menu.is-open)
- [x] Add aria-expanded styling for dropdown trigger
- [x] Add desktop media query (min-width: 769px) to show desktop nav and hide hamburger
- [x] Add mobile media query (max-width: 768px) to hide desktop nav

### 3. Verification
- [x] Open browser dev tools at width >768px: verify `.admin-nav-desktop { display: flex }` is active
- [x] Resize to <=768px: verify `.admin-nav-desktop { display: none }` is active
- [x] At desktop width: hamburger styles show `display: none`
- [x] At mobile width: hamburger styles show original `display: flex`
- [x] No CSS errors in browser console

## Completion Criteria
- [x] `.is-open` state class defined for dropdown visibility
- [x] Media queries correctly toggle visibility at 768px/769px boundary
- [x] CSS passes syntax validation
- [x] No changes to existing hamburger styles functionality (mobile preserved)
- [x] Operation verified: L3 (Build Success) - CSS applies correctly in dev tools

## Notes
- Impact scope: Media queries affect both new .admin-* classes and existing hamburger elements
- Constraints: Use `!important` sparingly but necessary here to override existing hamburger styles at desktop breakpoint
- The 768px/769px boundary follows existing project conventions (dashboard.css lines 522, 1313)
