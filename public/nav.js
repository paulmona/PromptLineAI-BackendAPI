// Hamburger menu functionality
(function() {
  function initNav() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const navWrapper = document.querySelector('.header-nav-wrapper');
    
    if (!hamburgerBtn || !navWrapper) {
      return; // No hamburger menu on this page
    }

    // Toggle menu on hamburger click
    hamburgerBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      navWrapper.classList.toggle('menu-open');
    });

    // Close menu when clicking nav links (except Account, Settings toggle, Org Profile, Policy, and Logout which have special handlers)
    const navLinks = navWrapper.querySelectorAll('.nav-links a:not(#nav-account-link):not(#nav-settings-toggle):not(#nav-org-profile-link):not(#nav-policy-link):not(#nav-logout-link)');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        navWrapper.classList.remove('menu-open');
      });
    });

    // Handle Settings toggle click
    const settingsToggle = navWrapper.querySelector('#nav-settings-toggle');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const settingsContainer = document.getElementById('nav-settings');
        const submenu = settingsContainer?.querySelector('.nav-settings-submenu');
        if (submenu) {
          submenu.classList.toggle('is-collapsed');
        }
      });
    }

    // Handle Account link click
    const accountLink = navWrapper.querySelector('#nav-account-link');
    if (accountLink) {
      accountLink.addEventListener('click', async function(e) {
        e.preventDefault();
        navWrapper.classList.remove('menu-open');
        try {
          // Ensure Clerk is loaded
          if (window.PromptLineAuth && window.PromptLineAuth.initClerk) {
            await window.PromptLineAuth.initClerk();
          }
          // Open Clerk user profile modal
          if (window.Clerk && window.Clerk.loaded && window.Clerk.openUserProfile) {
            window.Clerk.openUserProfile();
          } else if (window.PromptLineAuth && window.PromptLineAuth.openUserProfile) {
            window.PromptLineAuth.openUserProfile();
          } else {
            console.error('Clerk user profile not available');
          }
        } catch (err) {
          console.error('Account error:', err);
        }
      });
    }

    // Handle Org profile link click (opens Clerk organization profile)
    const orgProfileLink = navWrapper.querySelector('#nav-org-profile-link');
    if (orgProfileLink) {
      orgProfileLink.addEventListener('click', async function(e) {
        e.preventDefault();
        navWrapper.classList.remove('menu-open');
        try {
          // Ensure Clerk is loaded
          if (window.PromptLineAuth && window.PromptLineAuth.initClerk) {
            await window.PromptLineAuth.initClerk();
          }
          // Open Clerk organization profile modal
          if (window.Clerk && window.Clerk.loaded && window.Clerk.openOrganizationProfile) {
            window.Clerk.openOrganizationProfile();
          } else if (window.PromptLineAuth && window.PromptLineAuth.openOrganizationProfile) {
            window.PromptLineAuth.openOrganizationProfile();
          } else {
            console.error('Clerk organization profile not available');
          }
        } catch (err) {
          console.error('Org profile error:', err);
        }
      });
    }

    // Handle Policy link click (internal route)
    const policyLink = navWrapper.querySelector('#nav-policy-link');
    if (policyLink) {
      policyLink.addEventListener('click', function(e) {
        // Let the link navigate naturally, just close the menu
        navWrapper.classList.remove('menu-open');
      });
    }

    // Handle Logout link click
    const logoutLink = navWrapper.querySelector('#nav-logout-link');
    if (logoutLink) {
      logoutLink.addEventListener('click', async function(e) {
        e.preventDefault();
        navWrapper.classList.remove('menu-open');
        try {
          if (window.PromptLineAuth && window.PromptLineAuth.signOut) {
            await window.PromptLineAuth.signOut();
          }
          window.location.href = '/';
        } catch (err) {
          console.error('Logout error:', err);
          // Still redirect even if signOut fails
          window.location.href = '/';
        }
      });
    }

    // Close menu on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && navWrapper.classList.contains('menu-open')) {
        navWrapper.classList.remove('menu-open');
      }
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (navWrapper.classList.contains('menu-open') &&
          !navWrapper.contains(e.target) &&
          !hamburgerBtn.contains(e.target)) {
        navWrapper.classList.remove('menu-open');
      }
    });

    // Initialize desktop dropdowns
    initDesktopDropdowns();
  }

  // Desktop dropdown functionality
  function initDesktopDropdowns() {
    var desktopNav = document.querySelector('.admin-nav-desktop');
    if (!desktopNav) return;

    var dropdownTriggers = desktopNav.querySelectorAll('.admin-dropdown-trigger');

    // Toggle dropdown on click
    dropdownTriggers.forEach(function(trigger) {
      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        var dropdown = this.closest('.admin-dropdown');
        var menu = dropdown.querySelector('.admin-dropdown-menu');
        var isOpen = menu.classList.contains('is-open');

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
    var dropdownLinks = desktopNav.querySelectorAll('.admin-dropdown-menu a');
    dropdownLinks.forEach(function(link) {
      link.addEventListener('click', function() {
        closeAllDropdowns(desktopNav);
      });
    });

    // Show Settings dropdown for admin users
    initAdminSettingsVisibility();

    // Handle desktop Account link
    var accountLink = desktopNav.querySelector('#desktop-account-link');
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
    var orgProfileLink = desktopNav.querySelector('#desktop-org-profile-link');
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
    var logoutBtn = desktopNav.querySelector('#desktop-logout-btn');
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
    var openMenus = navContainer.querySelectorAll('.admin-dropdown-menu.is-open');
    openMenus.forEach(function(menu) {
      menu.classList.remove('is-open');
      var trigger = menu.closest('.admin-dropdown').querySelector('.admin-dropdown-trigger');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Helper: Show Settings dropdown for admin users
  async function initAdminSettingsVisibility() {
    var settingsDropdown = document.getElementById('admin-desktop-settings');
    var mobileSettings = document.getElementById('nav-settings');

    if (!settingsDropdown && !mobileSettings) return;

    try {
      var response = await fetch('/admin/policy-access', {
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
