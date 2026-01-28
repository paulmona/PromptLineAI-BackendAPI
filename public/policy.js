// Policy page - admin-only access
let authToken = null;
let orgSlug = null;
let currentConfig = null;
let hasUnsavedChanges = false;

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
      showAuthRequired('Please sign in to view the policy page.');
      return;
    }

    // Bootstrap + canonical org slug via /me
    const meRes = await fetch('/me', { headers: { Authorization: `Bearer ${authToken}` } });
    if (meRes.status === 401) {
      showAuthRequired('Please sign in to view the policy page.');
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
      window.location.href = `/${encodeURIComponent(canonicalSlug)}/policy`;
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

    // Check admin access via protected endpoint
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
    showPolicyContent();
    
    // Load policy configuration and setup UI
    await loadPolicyConfig();
    setupToggleListeners();
    setupSaveButton();
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
  const policyContent = document.getElementById('policy-content');
  const forbiddenBanner = document.getElementById('forbidden-banner');
  
  if (!banner || !msg || !link) {
    console.error('[Auth] Critical auth elements not found. Message:', message);
    return;
  }
  
  msg.textContent = message;
  link.href = '/';
  banner.classList.remove('hidden');
  
  if (policyContent) {
    policyContent.style.display = 'none';
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
  const policyContent = document.getElementById('policy-content');
  const authBanner = document.getElementById('auth-banner');
  
  if (forbiddenBanner) {
    forbiddenBanner.classList.remove('hidden');
  }
  if (policyContent) {
    policyContent.style.display = 'none';
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

function showPolicyContent() {
  const policyContent = document.getElementById('policy-content');
  if (policyContent) {
    policyContent.style.display = 'block';
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

function showSuccess(message) {
  const banner = document.getElementById('success-banner');
  const msg = document.getElementById('success-message');
  if (banner && msg) {
    msg.textContent = message;
    banner.classList.remove('hidden');
  }
}

function hideSuccess() {
  const banner = document.getElementById('success-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

async function loadPolicyConfig() {
  try {
    const res = await fetch(`/${orgSlug}/policy/config`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (!res.ok) {
      throw new Error(`Failed to load config: HTTP ${res.status}`);
    }
    
    currentConfig = await res.json();
    populateUI(currentConfig);
    hasUnsavedChanges = false;
    updateSaveButton();
  } catch (err) {
    showError(err.message);
  }
}

function populateUI(config) {
  const chatgptToggle = document.getElementById('toggle-chatgpt');
  const geminiToggle = document.getElementById('toggle-gemini');
  const logFileNamesToggle = document.getElementById('toggle-log-file-names');
  
  if (chatgptToggle) chatgptToggle.checked = config.llms.chatgpt;
  if (geminiToggle) geminiToggle.checked = config.llms.gemini;
  if (logFileNamesToggle) logFileNamesToggle.checked = config.fileUpload.logFileNames;
}

function setupToggleListeners() {
  const toggles = ['toggle-chatgpt', 'toggle-gemini', 'toggle-log-file-names'];
  toggles.forEach(id => {
    const toggle = document.getElementById(id);
    if (toggle) {
      toggle.addEventListener('change', () => {
        hasUnsavedChanges = true;
        updateSaveButton();
      });
    }
  });
}

function setupSaveButton() {
  const saveBtn = document.getElementById('save-policy-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', savePolicyConfig);
  }
}

function updateSaveButton() {
  const saveBtn = document.getElementById('save-policy-btn');
  if (saveBtn) {
    saveBtn.disabled = !hasUnsavedChanges;
  }
}

async function savePolicyConfig() {
  const chatgptToggle = document.getElementById('toggle-chatgpt');
  const geminiToggle = document.getElementById('toggle-gemini');
  const logFileNamesToggle = document.getElementById('toggle-log-file-names');
  
  if (!chatgptToggle || !geminiToggle || !logFileNamesToggle) {
    showError('Failed to read toggle states');
    return;
  }
  
  const config = {
    llms: {
      chatgpt: chatgptToggle.checked,
      gemini: geminiToggle.checked,
    },
    fileUpload: {
      logFileNames: logFileNamesToggle.checked,
    },
  };
  
  // Show loading state
  const saveBtn = document.getElementById('save-policy-btn');
  const saveBtnText = document.getElementById('save-btn-text');
  const saveBtnSpinner = document.getElementById('save-btn-spinner');
  
  if (!saveBtn || !saveBtnText || !saveBtnSpinner) {
    showError('Save button elements not found');
    return;
  }
  
  saveBtn.disabled = true;
  saveBtnText.textContent = 'Saving...';
  saveBtnSpinner.classList.remove('hidden');
  hideError();
  hideSuccess();
  
  try {
    const res = await fetch(`/${orgSlug}/policy/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(config),
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    
    currentConfig = await res.json();
    hasUnsavedChanges = false;
    updateSaveButton();
    showSuccess('Settings saved successfully!');
    
    // Auto-hide success message after 3 seconds
    setTimeout(() => {
      hideSuccess();
    }, 3000);
  } catch (err) {
    showError(err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtnText.textContent = 'Save Settings';
    saveBtnSpinner.classList.add('hidden');
  }
}
