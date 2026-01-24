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

    // Close menu when clicking nav links
    const navLinks = navWrapper.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        navWrapper.classList.remove('menu-open');
      });
    });

    // Handle Logout button click
    const logoutBtn = navWrapper.querySelector('#nav-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function() {
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
