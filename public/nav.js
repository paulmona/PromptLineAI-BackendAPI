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

    // Close menu when clicking nav links (except Account and Logout which have special handlers)
    const navLinks = navWrapper.querySelectorAll('.nav-links a:not(#nav-account-link):not(#nav-logout-link)');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        navWrapper.classList.remove('menu-open');
      });
    });

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
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
