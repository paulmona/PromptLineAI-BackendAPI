(function () {
  function loadScript(src, publishableKey) {
    return new Promise((resolve, reject) => {
      console.log(`[Clerk.js Loader] Loading script from: ${src}`);
      
      // Check if script is already loaded
      if (window.Clerk && window.Clerk.loaded) {
        console.log(`[Clerk.js Loader] Clerk.js already loaded`);
        resolve();
        return;
      }
      
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous'; // Required per Clerk.com documentation
      s.type = 'text/javascript';
      
      // Add publishable key as data attribute (required per Clerk.com documentation)
      if (publishableKey) {
        s.setAttribute('data-clerk-publishable-key', publishableKey);
      }
      
      let resolved = false;
      let timeoutId = null;
      
      s.onload = async () => {
        console.log(`[Clerk.js Loader] Script tag loaded, initializing Clerk...`);
        
        try {
          // Per Clerk.com documentation: must call Clerk.load() after script loads
          if (window.Clerk && typeof window.Clerk.load === 'function') {
            await window.Clerk.load();
            console.log(`[Clerk.js Loader] Clerk.load() completed successfully`);
            
            if (timeoutId) clearTimeout(timeoutId);
            resolved = true;
            resolve();
          } else if (window.Clerk) {
            // Clerk is available but load() method doesn't exist - might already be initialized
            console.log(`[Clerk.js Loader] window.Clerk is available but load() method not found`);
            if (timeoutId) clearTimeout(timeoutId);
            resolved = true;
            resolve();
          } else {
            throw new Error('window.Clerk is not available after script load');
          }
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId);
          resolved = true;
          console.error(`[Clerk.js Loader] Failed to initialize Clerk:`, error);
          reject(new Error(`Failed to initialize Clerk: ${error.message}`));
        }
      };
      
      s.onerror = (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        const errorMsg = `Failed to load script: ${src}`;
        console.error(`[Clerk.js Loader] Script load error:`, errorMsg, event);
        reject(new Error(errorMsg));
      };
      
      document.head.appendChild(s);
      
      // Overall timeout after 10 seconds
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error(`[Clerk.js Loader] Script load timeout after 10s: ${src}`);
          reject(new Error(`Script load timeout: ${src}`));
        }
      }, 10000);
    });
  }


  async function initClerk() {
    console.log('[Clerk.js Loader] Initializing Clerk...');
    
    const env = window.__ENV || {};
    const pk = env.CLERK_PUBLISHABLE_KEY;
    if (!pk) {
      const error = 'Missing CLERK_PUBLISHABLE_KEY (served via /env.js)';
      console.error(`[Clerk.js Loader] ${error}`);
      throw new Error(error);
    }
    const clerkJsUrl = env.CLERK_JS_URL;
    if (!clerkJsUrl) {
      const error = 'Missing CLERK_JS_URL (served via /env.js)';
      console.error(`[Clerk.js Loader] ${error}`);
      throw new Error(error);
    }
    
    console.log(`[Clerk.js Loader] Clerk.js URL: ${clerkJsUrl}`);
    console.log(`[Clerk.js Loader] Publishable key present: ${pk ? 'yes' : 'no'}`);

    if (!window.Clerk || !window.Clerk.loaded) {
      try {
        // Load script with publishable key attribute and initialize via Clerk.load()
        // Per Clerk.com documentation: script tag needs data-clerk-publishable-key
        // and Clerk.load() must be called after script loads
        await loadScript(clerkJsUrl, pk);
      } catch (error) {
        console.error('[Clerk.js Loader] Script loading/initialization failed:', error);
        
        // Provide helpful error message
        const errorMsg = `Failed to load or initialize Clerk.js from ${clerkJsUrl}. ` +
          `Error: ${error.message}. ` +
          `Check browser console and network tab for details.`;
        console.error(`[Clerk.js Loader] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
    
    if (!window.Clerk) {
      const error = 'Clerk.js failed to load - window.Clerk is not available after script load and initialization';
      console.error(`[Clerk.js Loader] ${error}`);
      throw new Error(error);
    }
    
    console.log('[Clerk.js Loader] Clerk.js loaded and initialized successfully');
    
    if (window.Clerk.loaded) {
      return;
    }
    
    // If loaded is false, Clerk might still be initializing
    console.warn('[Clerk.js Loader] window.Clerk.loaded is false, but Clerk object exists');
  }

  async function getToken() {
    if (!window.Clerk || !window.Clerk.loaded) return null;
    const session = window.Clerk.session;
    if (!session) return null;
    const token = await session.getToken();
    
    if (token) {
      // Log token format for debugging (first 30 chars only, never log full token)
      const tokenPrefix = token.length > 30 ? `${token.substring(0, 30)}...` : token.substring(0, token.length);
      const parts = token.split('.');
      console.log('[Clerk.js Loader] Token obtained:', {
        length: token.length,
        prefix: tokenPrefix,
        parts: parts.length,
        isJWT: parts.length === 3,
        sessionExists: !!session,
      });
    }
    
    return token || null;
  }

  async function signOut() {
    if (!window.Clerk || !window.Clerk.loaded) return;
    await window.Clerk.signOut();
  }

  function mountSignIn(containerElement, options = {}) {
    if (!window.Clerk || !window.Clerk.loaded) {
      console.error('[Clerk.js Loader] Cannot mount sign-in: Clerk is not loaded');
      return;
    }
    
    if (!containerElement) {
      console.error('[Clerk.js Loader] Cannot mount sign-in: container element is required');
      return;
    }
    
    if (typeof window.Clerk.mountSignIn !== 'function') {
      const error = new Error(`window.Clerk.mountSignIn is not a function. Type: ${typeof window.Clerk.mountSignIn}`);
      console.error('[Clerk.js Loader]', error);
      throw error;
    }
    
    try {
      window.Clerk.mountSignIn(containerElement, options);
    } catch (error) {
      console.error('[Clerk.js Loader] Failed to mount sign-in component:', error);
      throw error;
    }
  }

  function mountSignUp(containerElement, options = {}) {
    if (!window.Clerk || !window.Clerk.loaded) {
      console.error('[Clerk.js Loader] Cannot mount sign-up: Clerk is not loaded');
      return;
    }
    
    if (!containerElement) {
      console.error('[Clerk.js Loader] Cannot mount sign-up: container element is required');
      return;
    }
    
    if (typeof window.Clerk.mountSignUp !== 'function') {
      const error = new Error(`window.Clerk.mountSignUp is not a function. Type: ${typeof window.Clerk.mountSignUp}`);
      console.error('[Clerk.js Loader]', error);
      throw error;
    }
    
    try {
      window.Clerk.mountSignUp(containerElement, options);
    } catch (error) {
      console.error('[Clerk.js Loader] Failed to mount sign-up component:', error);
      throw error;
    }
  }

  function openUserProfile() {
    if (!window.Clerk || !window.Clerk.loaded) {
      console.error('[Clerk.js Loader] Cannot open user profile: Clerk is not loaded');
      return;
    }
    
    if (typeof window.Clerk.openUserProfile !== 'function') {
      console.error('[Clerk.js Loader] Clerk.openUserProfile is not available');
      return;
    }
    
    try {
      window.Clerk.openUserProfile();
    } catch (error) {
      console.error('[Clerk.js Loader] Failed to open user profile:', error);
      throw error;
    }
  }

  function openOrganizationProfile() {
    if (!window.Clerk || !window.Clerk.loaded) {
      console.error('[Clerk.js Loader] Cannot open organization profile: Clerk is not loaded');
      return;
    }
    
    // Try openOrganizationProfile first (preferred - opens as modal)
    if (typeof window.Clerk.openOrganizationProfile === 'function') {
      try {
        window.Clerk.openOrganizationProfile();
        return;
      } catch (error) {
        console.error('[Clerk.js Loader] Failed to open organization profile:', error);
        throw error;
      }
    }
    
    // Fallback: If openOrganizationProfile doesn't exist, use mountOrganizationProfile
    // This requires creating a modal container (more complex)
    console.warn('[Clerk.js Loader] openOrganizationProfile not available, falling back to mountOrganizationProfile');
    
    // Check if mountOrganizationProfile is available
    if (typeof window.Clerk.mountOrganizationProfile !== 'function') {
      console.error('[Clerk.js Loader] Neither openOrganizationProfile nor mountOrganizationProfile is available');
      return;
    }
    
    // Create or get modal container
    let modalContainer = document.getElementById('org-profile-container');
    let modal = document.getElementById('org-profile-modal');
    
    if (!modalContainer) {
      // Create modal structure if it doesn't exist
      modal = document.createElement('div');
      modal.id = 'org-profile-modal';
      modal.className = 'org-profile-modal';
      
      const modalContent = document.createElement('div');
      modalContent.className = 'org-profile-modal-content';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'org-profile-modal-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
      
      modalContainer = document.createElement('div');
      modalContainer.id = 'org-profile-container';
      
      modalContent.appendChild(closeBtn);
      modalContent.appendChild(modalContainer);
      modal.appendChild(modalContent);
      
      // Close modal when clicking outside
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      });
      
      document.body.appendChild(modal);
    }
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Mount organization profile
    try {
      window.Clerk.mountOrganizationProfile(modalContainer, {});
    } catch (error) {
      console.error('[Clerk.js Loader] Failed to mount organization profile:', error);
      modal.classList.add('hidden');
      throw error;
    }
  }

  window.PromptLineAuth = {
    initClerk,
    getToken,
    signOut,
    mountSignIn,
    mountSignUp,
    openUserProfile,
    openOrganizationProfile,
  };
})();

