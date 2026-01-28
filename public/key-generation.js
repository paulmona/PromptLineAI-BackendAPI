// Key Generation page - admin-only access
let authToken = null;
let orgSlug = null;

document.addEventListener('DOMContentLoaded', () => {
  // Hide Settings menu immediately (before auth check) to prevent FOUC
  const settingsContainer = document.getElementById('nav-settings');
  if (settingsContainer) settingsContainer.classList.add('is-hidden');
  
  initAuthAndLoad();
});

async function initAuthAndLoad() {
  try {
    await window.PromptLineAuth.initClerk();
    authToken = await window.PromptLineAuth.getToken();

    if (!authToken) {
      showAuthRequired('Please sign in to view the key generation page.');
      return;
    }

    // Bootstrap + canonical org slug via /me
    const meRes = await fetch('/me', { headers: { Authorization: `Bearer ${authToken}` } });
    if (meRes.status === 401) {
      showAuthRequired('Please sign in to view the key generation page.');
      return;
    }
    if (meRes.status === 403) {
      showAuthRequired('You are signed in, but not assigned to an organization.');
      return;
    }
    if (!meRes.ok) {
      throw new Error(`Failed to load /me: HTTP ${meRes.status}`);
    }
    const me = await meRes.json();
    const canonicalSlug = me?.org?.slug;
    if (!canonicalSlug) {
      showAuthRequired('Organization slug is missing. Please contact your administrator.');
      return;
    }

    const currentSlug = decodeURIComponent(window.location.pathname.replace(/^\/+/, '').split('/')[0] || '');
    if (currentSlug && currentSlug !== canonicalSlug) {
      window.location.href = `/${encodeURIComponent(canonicalSlug)}/key-generation`;
      return;
    }

    const orgPill = document.getElementById('org-pill');
    if (orgPill) {
      orgPill.textContent = me?.org?.name ? `${me.org.name} (${canonicalSlug})` : canonicalSlug;
    }

    // Show/hide Settings menu based on role (admin-only)
    // Defensive: always hide first, then show only if explicitly admin
    const settingsContainer = document.getElementById('nav-settings');
    if (settingsContainer) settingsContainer.classList.add('is-hidden');
    
    const userRole = me?.user?.role;
    if (userRole === 'admin') {
      if (settingsContainer) settingsContainer.classList.remove('is-hidden');
    }

    orgSlug = canonicalSlug;

    // Check admin access via protected endpoint (reuse policy-access endpoint for now)
    const accessRes = await fetch('/admin/policy-access', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (accessRes.status === 403) {
      showForbidden();
      return;
    }
    if (!accessRes.ok) {
      throw new Error(`Failed to check access: HTTP ${accessRes.status}`);
    }

    hideAuthBanner();
    hideForbidden();
    showKeyGenerationContent();
  } catch (err) {
    // On error, ensure Settings menu is hidden
    const settingsContainer = document.getElementById('nav-settings');
    if (settingsContainer) settingsContainer.classList.add('is-hidden');
    
    showAuthRequired(err && err.message ? err.message : String(err));
  }
}

function showAuthRequired(message) {
  const banner = document.getElementById('auth-banner');
  const msg = document.getElementById('auth-message');
  const link = document.getElementById('auth-sign-in-link');
  const keyGenerationContent = document.getElementById('key-generation-content');
  const forbiddenBanner = document.getElementById('forbidden-banner');
  
  if (!banner || !msg || !link) {
    console.error('[Auth] Critical auth elements not found. Message:', message);
    return;
  }
  
  msg.textContent = message;
  link.href = '/';
  banner.classList.remove('hidden');
  
  if (keyGenerationContent) {
    keyGenerationContent.style.display = 'none';
  }
  if (forbiddenBanner) {
    forbiddenBanner.classList.add('hidden');
  }
}

function hideAuthBanner() {
  const banner = document.getElementById('auth-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

function showForbidden() {
  const forbiddenBanner = document.getElementById('forbidden-banner');
  const keyGenerationContent = document.getElementById('key-generation-content');
  const authBanner = document.getElementById('auth-banner');
  
  if (forbiddenBanner) {
    forbiddenBanner.classList.remove('hidden');
  }
  if (keyGenerationContent) {
    keyGenerationContent.style.display = 'none';
  }
  if (authBanner) {
    authBanner.classList.add('hidden');
  }
}

function hideForbidden() {
  const forbiddenBanner = document.getElementById('forbidden-banner');
  if (forbiddenBanner) {
    forbiddenBanner.classList.add('hidden');
  }
}

function showKeyGenerationContent() {
  const keyGenerationContent = document.getElementById('key-generation-content');
  if (keyGenerationContent) {
    keyGenerationContent.style.display = 'block';
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const msg = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  
  if (!banner || !msg) {
    console.error('[Error] Error banner elements not found. Message:', message);
    return;
  }
  
  msg.textContent = message;
  banner.classList.remove('hidden');
  
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}
