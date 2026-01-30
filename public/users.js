let authToken = null;
let orgSlug = null;
let isLoading = false;

// Initialize on page load
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
      showAuthRequired('Please sign in to view users.');
      setLoadingState(false);
      return;
    }

    // Bootstrap + canonical org slug via /me
    const meRes = await fetch('/me', { headers: { Authorization: `Bearer ${authToken}` } });
    if (meRes.status === 401) {
      showAuthRequired('Please sign in to view users.');
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
      window.location.href = `/${encodeURIComponent(canonicalSlug)}/users`;
      return;
    }

    orgSlug = canonicalSlug;

    const orgPill = document.getElementById('org-pill');
    if (orgPill) {
      orgPill.textContent = me?.org?.name ? `${me.org.name} (${canonicalSlug})` : canonicalSlug;
    }

    // Show/hide Settings menu based on role (admin-only)
    const settingsContainer = document.getElementById('nav-settings');
    if (settingsContainer) settingsContainer.classList.add('is-hidden');

    const userRole = me?.user?.role;
    if (userRole === 'admin') {
      if (settingsContainer) settingsContainer.classList.remove('is-hidden');
    }

    const backLink = document.getElementById('back-to-dashboard');
    if (backLink) {
      backLink.href = `/${encodeURIComponent(canonicalSlug)}`;
    }

    hideAuthBanner();
    loadUsers();
  } catch (err) {
    const settingsContainer = document.getElementById('nav-settings');
    if (settingsContainer) settingsContainer.classList.add('is-hidden');

    showAuthRequired(err && err.message ? err.message : String(err));
  }
}

async function fetchUsers() {
  const response = await fetch('/users', {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
  });

  if (!response.ok) {
    if (response.status === 401) {
      showAuthRequired('Please sign in to view users.');
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

async function loadUsers() {
  if (isLoading) return;

  isLoading = true;
  setLoadingState(true);
  hideError();

  try {
    const data = await fetchUsers();
    renderUsers(data.users || []);
  } catch (err) {
    showError(err.message);
  } finally {
    isLoading = false;
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  if (loading) {
    const tbody = document.querySelector('#users-table tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
    }
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const errorMsg = document.getElementById('error-message');
  if (banner && errorMsg) {
    errorMsg.textContent = message;
    banner.classList.remove('hidden');

    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.onclick = () => loadUsers();
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
  const content = document.getElementById('users-content');
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
  const content = document.getElementById('users-content');
  if (banner) {
    banner.classList.add('hidden');
  }
  if (content) {
    content.style.display = '';
  }
}

function renderUsers(users) {
  const tbody = document.querySelector('#users-table tbody');

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const label = `User ${user.id.slice(0, 8)}…`;
    const userUrl = `/${encodeURIComponent(orgSlug)}/users/${encodeURIComponent(user.id)}`;

    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td><a href="${userUrl}" class="retry-btn" style="text-decoration:none; padding: 4px 8px; font-size: 0.9rem;">View activity</a></td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
