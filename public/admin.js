// Platform Admin page - platform admin only access
let authToken = null;
let currentPage = 1;
let pageSize = 50;
let totalOrgs = 0;

document.addEventListener('DOMContentLoaded', () => {
  initAuthAndLoad();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    hideError();
    loadOrgs();
  });

  document.getElementById('auth-sign-in-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      if (window.PromptLineAuth && window.PromptLineAuth.initClerk) {
        await window.PromptLineAuth.initClerk();
      }
      if (window.Clerk && window.Clerk.loaded && window.Clerk.openSignIn) {
        window.Clerk.openSignIn();
      }
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  });

  document.getElementById('prev-page-btn')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadOrgs();
    }
  });

  document.getElementById('next-page-btn')?.addEventListener('click', () => {
    const totalPages = Math.ceil(totalOrgs / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      loadOrgs();
    }
  });

  document.getElementById('page-size-select')?.addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value, 10);
    currentPage = 1;
    loadOrgs();
  });
}

async function initAuthAndLoad() {
  try {
    // Check if Clerk is available
    if (!window.PromptLineAuth || !window.PromptLineAuth.initClerk) {
      showAuthRequired('Clerk authentication not available. Please refresh the page.');
      return;
    }

    await window.PromptLineAuth.initClerk();

    if (!window.Clerk || !window.Clerk.loaded) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    // Get auth token
    const session = await window.Clerk.session;
    if (!session) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    authToken = await session.getToken();

    // Check platform admin access by calling /admin/orgs
    const accessRes = await fetch('/admin/orgs?limit=1', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (accessRes.status === 401) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    if (accessRes.status === 403) {
      showForbidden();
      return;
    }

    if (!accessRes.ok) {
      throw new Error(`Failed to check access: HTTP ${accessRes.status}`);
    }

    hideAuthBanner();
    hideForbidden();
    showAdminContent();
    await loadOrgs();
  } catch (err) {
    console.error('Auth/load error:', err);
    showError(err instanceof Error ? err.message : 'Failed to initialize');
  }
}

async function loadOrgs() {
  const loadingState = document.getElementById('loading-state');
  const tableContainer = document.getElementById('orgs-table-container');
  const tableBody = document.getElementById('orgs-table-body');

  if (!loadingState || !tableContainer || !tableBody) {
    console.error('Required DOM elements not found');
    return;
  }

  try {
    loadingState.style.display = 'block';
    tableContainer.style.display = 'none';
    hideError();

    const offset = (currentPage - 1) * pageSize;
    const res = await fetch(`/admin/orgs?limit=${pageSize}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    if (res.status === 403) {
      showForbidden();
      return;
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to load organizations' }));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    totalOrgs = data.total || 0;

    // Render table
    tableBody.innerHTML = '';
    if (data.orgs && data.orgs.length > 0) {
      data.orgs.forEach((org) => {
        const row = document.createElement('tr');
        row.className = 'admin-table-row';
        row.innerHTML = `
          <td class="admin-table-cell">${escapeHtml(org.name || '-')}</td>
          <td class="admin-table-cell">${escapeHtml(org.slug || '-')}</td>
          <td class="admin-table-cell">${formatDate(org.created_at)}</td>
          <td class="admin-table-cell" style="text-align: right;">${org.counts.devices_count}</td>
          <td class="admin-table-cell" style="text-align: right;">${org.counts.events_count}</td>
          <td class="admin-table-cell" style="text-align: right;">${org.counts.ingest_keys_count}</td>
          <td class="admin-table-cell admin-actions-cell">
            <button class="admin-action-btn revoke" onclick="revokeIngestKeys('${org.id}', '${escapeHtml(org.name)}')" title="Revoke all ingest keys">
              Revoke Keys
            </button>
            <button class="admin-action-btn delete" onclick="deleteOrg('${org.id}', '${escapeHtml(org.name)}')" title="Delete organization">
              Delete
            </button>
          </td>
        `;
        tableBody.appendChild(row);
      });
    } else {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="7" style="text-align: center; padding: 24px; color: #666;">No organizations found</td>';
      tableBody.appendChild(row);
    }

    // Update pagination
    updatePagination();

    loadingState.style.display = 'none';
    tableContainer.style.display = 'block';
  } catch (err) {
    console.error('Load orgs error:', err);
    loadingState.style.display = 'none';
    showError(err instanceof Error ? err.message : 'Failed to load organizations');
  }
}

function updatePagination() {
  const totalPages = Math.ceil(totalOrgs / pageSize);
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const paginationInfo = document.getElementById('pagination-info');

  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
  if (paginationInfo) {
    paginationInfo.textContent = `Page ${currentPage} of ${totalPages || 1} (${totalOrgs} total)`;
  }
}

async function revokeIngestKeys(orgId, orgName) {
  if (!confirm(`Are you sure you want to revoke all ingest keys for "${orgName}"?\n\nThis will disable all active ingest keys for this organization.`)) {
    return;
  }

  try {
    const res = await fetch(`/admin/orgs/${orgId}/revoke-ingest-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    if (res.status === 403) {
      showForbidden();
      return;
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to revoke keys' }));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    alert(`Successfully revoked ${data.revoked_count} ingest key(s) for "${orgName}"`);
    
    // Reload orgs to update counts
    await loadOrgs();
  } catch (err) {
    console.error('Revoke keys error:', err);
    alert(`Failed to revoke keys: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function deleteOrg(orgId, orgName) {
  const confirmMessage = `⚠️ DANGER: Delete Organization\n\n` +
    `Are you absolutely sure you want to delete "${orgName}"?\n\n` +
    `This will PERMANENTLY delete:\n` +
    `- All devices\n` +
    `- All events\n` +
    `- All ingest keys\n` +
    `- User associations (users will be orphaned)\n\n` +
    `This action CANNOT be undone!\n\n` +
    `Type "DELETE" to confirm:`;

  const userInput = prompt(confirmMessage);
  if (userInput !== 'DELETE') {
    return;
  }

  try {
    const res = await fetch(`/admin/orgs/${orgId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-ADMIN-CONFIRM': 'DELETE'
      }
    });

    if (res.status === 401) {
      showAuthRequired('Please sign in to access the platform admin interface.');
      return;
    }

    if (res.status === 403) {
      showForbidden();
      return;
    }

    if (res.status === 400) {
      const errorData = await res.json().catch(() => ({ error: 'Confirmation required' }));
      alert(`Error: ${errorData.message || errorData.error || 'Confirmation required'}`);
      return;
    }

    if (res.status === 404) {
      alert(`Organization "${orgName}" not found`);
      await loadOrgs(); // Reload in case it was already deleted
      return;
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to delete organization' }));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    alert(`Successfully deleted organization "${orgName}"`);
    
    // Reload orgs
    await loadOrgs();
  } catch (err) {
    console.error('Delete org error:', err);
    alert(`Failed to delete organization: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch {
    return dateString;
  }
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showAuthRequired(message) {
  const banner = document.getElementById('auth-banner');
  const messageEl = document.getElementById('auth-message');
  if (banner) banner.classList.remove('hidden');
  if (messageEl) messageEl.textContent = message;
  hideAdminContent();
  hideForbidden();
}

function hideAuthBanner() {
  const banner = document.getElementById('auth-banner');
  if (banner) banner.classList.add('hidden');
}

function showForbidden() {
  const banner = document.getElementById('forbidden-banner');
  if (banner) banner.classList.remove('hidden');
  hideAdminContent();
  hideAuthBanner();
}

function hideForbidden() {
  const banner = document.getElementById('forbidden-banner');
  if (banner) banner.classList.add('hidden');
}

function showAdminContent() {
  const content = document.getElementById('admin-content');
  if (content) content.style.display = 'block';
}

function hideAdminContent() {
  const content = document.getElementById('admin-content');
  if (content) content.style.display = 'none';
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const messageEl = document.getElementById('error-message');
  if (banner) banner.classList.remove('hidden');
  if (messageEl) messageEl.textContent = message;
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.classList.add('hidden');
}

// Make functions available globally for onclick handlers
window.revokeIngestKeys = revokeIngestKeys;
window.deleteOrg = deleteOrg;
