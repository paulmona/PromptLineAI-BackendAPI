let authToken = null;
let orgSlug = null;
let isLoading = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initAuthAndLoad();
});

async function initAuthAndLoad() {
  try {
    await window.PromptLineAuth.initClerk();
    authToken = await window.PromptLineAuth.getToken();

    if (!authToken) {
      showAuthRequired('Please sign in to view devices.');
      setLoadingState(false);
      return;
    }

    // Bootstrap + canonical org slug via /me
    const meRes = await fetch('/me', { headers: { Authorization: `Bearer ${authToken}` } });
    if (meRes.status === 401) {
      showAuthRequired('Please sign in to view devices.');
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
      window.location.href = `/${encodeURIComponent(canonicalSlug)}/devices`;
      return;
    }

    orgSlug = canonicalSlug;

    const orgPill = document.getElementById('org-pill');
    if (orgPill) {
      orgPill.textContent = me?.org?.name ? `${me.org.name} (${canonicalSlug})` : canonicalSlug;
    }

    const backLink = document.getElementById('back-to-dashboard');
    if (backLink) {
      backLink.href = `/${encodeURIComponent(canonicalSlug)}`;
    }

    hideAuthBanner();
    loadDevices();
  } catch (err) {
    showAuthRequired(err && err.message ? err.message : String(err));
  }
}

async function fetchDevices() {
  const response = await fetch('/devices', {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      showAuthRequired('Please sign in to view devices.');
      throw new Error('Unauthorized');
    }
    if (response.status === 403) {
      showAuthRequired('You are signed in, but not assigned to an organization.');
      throw new Error('Forbidden');
    }
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
}

async function loadDevices() {
  if (isLoading) return;
  
  isLoading = true;
  setLoadingState(true);
  hideError();

  try {
    const data = await fetchDevices();
    renderDevices(data.devices || []);
  } catch (err) {
    showError(err.message);
  } finally {
    isLoading = false;
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  if (loading) {
    const tbody = document.querySelector('#devices-table tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
    }
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const errorMsg = document.getElementById('error-message');
  if (banner && errorMsg) {
    errorMsg.textContent = message;
    banner.classList.remove('hidden');

    // Setup retry button
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.onclick = () => loadDevices();
    }
  }
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

function showAuthRequired(message) {
  const banner = document.getElementById('auth-banner');
  const msg = document.getElementById('auth-message');
  const link = document.getElementById('auth-sign-in-link');
  const content = document.getElementById('devices-content');
  if (banner && msg && link) {
    msg.textContent = message;
    link.href = '/';
    banner.classList.remove('hidden');
    if (content) {
      content.style.display = 'none';
    }
  }
}

function hideAuthBanner() {
  const banner = document.getElementById('auth-banner');
  const content = document.getElementById('devices-content');
  if (banner) {
    banner.classList.add('hidden');
  }
  if (content) {
    content.style.display = '';
  }
}

function renderDevices(devices) {
  const tbody = document.querySelector('#devices-table tbody');
  
  if (devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No devices found</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(device => {
    const lastSeen = new Date(device.last_seen_at);
    const lastSeenFormatted = lastSeen.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const deviceUrl = `/${encodeURIComponent(orgSlug)}/devices/${encodeURIComponent(device.device_id)}`;
    
    return `
      <tr>
        <td>${escapeHtml(device.device_name)}</td>
        <td>${lastSeenFormatted}</td>
        <td><a href="${deviceUrl}" class="retry-btn" style="text-decoration:none; padding: 4px 8px; font-size: 0.9rem;">View Details</a></td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
