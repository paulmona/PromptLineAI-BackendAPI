// Key Generation page - admin-only access
let authToken = null;
let orgSlug = null;
let generatedKey = null;
let isKeyVisible = false;
let isGenerating = false;

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
    setupKeyGenerationHandlers();
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

function setupKeyGenerationHandlers() {
  const generateBtn = document.getElementById('generate-key-btn');
  const toggleVisibilityBtn = document.getElementById('toggle-key-visibility-btn');
  const copyBtn = document.getElementById('copy-key-btn');

  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerateKey);
  }

  if (toggleVisibilityBtn) {
    toggleVisibilityBtn.addEventListener('click', toggleKeyVisibility);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copyKeyToClipboard);
  }
}

async function handleGenerateKey() {
  if (isGenerating) return;

  const nameInput = document.getElementById('key-name-input');
  const name = nameInput?.value?.trim() || undefined;

  await generateKey(name);
}

async function generateKey(name) {
  if (isGenerating || !orgSlug) return;

  isGenerating = true;
  hideError();

  const generateBtn = document.getElementById('generate-key-btn');
  const generateBtnText = document.getElementById('generate-btn-text');
  const generateBtnSpinner = document.getElementById('generate-btn-spinner');

  if (generateBtn) generateBtn.disabled = true;
  if (generateBtnText) generateBtnText.textContent = 'Generating...';
  if (generateBtnSpinner) generateBtnSpinner.classList.remove('hidden');

  try {
    const res = await fetch(`/${orgSlug}/key-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ name }),
    });

    if (res.status === 401) {
      showAuthRequired('Please sign in to generate keys.');
      return;
    }
    if (res.status === 403) {
      showForbidden();
      return;
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    generatedKey = data.key;
    isKeyVisible = false; // Start with key hidden

    // Show the generated key section
    const keySection = document.getElementById('generated-key-section');
    if (keySection) {
      keySection.classList.remove('hidden');
    }

    // Update key display (masked initially)
    updateKeyDisplay();

    // Update metadata
    const keyIdValue = document.getElementById('key-id-value');
    const keyCreatedValue = document.getElementById('key-created-value');
    const keyNameValue = document.getElementById('key-name-value');
    const keyNameMetadata = document.getElementById('key-name-metadata');

    if (keyIdValue) keyIdValue.textContent = data.keyId;
    if (keyCreatedValue) {
      const createdDate = new Date(data.createdAt);
      keyCreatedValue.textContent = createdDate.toLocaleString();
    }
    if (data.name) {
      if (keyNameValue) keyNameValue.textContent = data.name;
      if (keyNameMetadata) keyNameMetadata.style.display = 'block';
    } else {
      if (keyNameMetadata) keyNameMetadata.style.display = 'none';
    }

    // Scroll to the generated key section
    if (keySection) {
      keySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    showError(err.message || 'Failed to generate key');
  } finally {
    isGenerating = false;
    if (generateBtn) generateBtn.disabled = false;
    if (generateBtnText) generateBtnText.textContent = 'Generate New Key';
    if (generateBtnSpinner) generateBtnSpinner.classList.add('hidden');
  }
}

function toggleKeyVisibility() {
  if (!generatedKey) return;

  isKeyVisible = !isKeyVisible;
  updateKeyDisplay();
}

function updateKeyDisplay() {
  const keyText = document.getElementById('key-text');
  const eyeIcon = document.getElementById('eye-icon');

  if (!keyText) return;

  if (isKeyVisible && generatedKey) {
    keyText.textContent = generatedKey;
  } else {
    // Show masked version (all dots)
    keyText.textContent = '•'.repeat(43); // Approximate length for base64url 32 bytes
  }

  // Update eye icon (optional: could use different icons for show/hide)
  if (eyeIcon) {
    eyeIcon.textContent = isKeyVisible ? '🙈' : '👁️';
  }
}

async function copyKeyToClipboard() {
  if (!generatedKey) return;

  try {
    await navigator.clipboard.writeText(generatedKey);
    showCopySuccess();
  } catch (err) {
    // Fallback for older browsers or clipboard API errors
    const textArea = document.createElement('textarea');
    textArea.value = generatedKey;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showCopySuccess();
    } catch (fallbackErr) {
      showError('Failed to copy key. Please select and copy manually.');
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

function showCopySuccess() {
  const successMsg = document.getElementById('copy-success-message');
  if (successMsg) {
    successMsg.classList.remove('hidden');
    // Auto-hide after 3 seconds
    setTimeout(() => {
      successMsg.classList.add('hidden');
    }, 3000);
  }
}

function maskKey(key) {
  // Return masked version (all dots)
  return '•'.repeat(key.length);
}
