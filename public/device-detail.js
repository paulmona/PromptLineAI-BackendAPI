// Chart instances
let toolsChart = null;
let eventTypesChart = null;
let timeChart = null;

// Current range
let currentRange = '24h';
let isLoading = false;
let authToken = null;
let orgSlug = null;
let deviceId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Hide admin items immediately (before auth check) to prevent FOUC
  const orgAdminLink = document.getElementById('nav-org-admin-link');
  const policyLink = document.getElementById('nav-policy-link');
  if (orgAdminLink) orgAdminLink.classList.add('is-hidden');
  if (policyLink) policyLink.classList.add('is-hidden');
  
  setupRangeSelector();
  initAuthAndLoad();
});

function extractDeviceIdFromPath() {
  // Path format: /:orgSlug/devices/:deviceId
  const pathParts = window.location.pathname.split('/').filter(p => p);
  if (pathParts.length >= 3 && pathParts[1] === 'devices') {
    return decodeURIComponent(pathParts[2]);
  }
  return null;
}

async function initAuthAndLoad() {
  try {
    await window.PromptLineAuth.initClerk();
    authToken = await window.PromptLineAuth.getToken();

    if (!authToken) {
      showAuthRequired('Please sign in to view device details.');
      setLoadingState(false);
      return;
    }

    // Extract device ID from URL
    deviceId = extractDeviceIdFromPath();
    if (!deviceId) {
      showError('Invalid device ID in URL');
      return;
    }

    // Bootstrap + canonical org slug via /me
    const meRes = await fetch('/me', { headers: { Authorization: `Bearer ${authToken}` } });
    if (meRes.status === 401) {
      showAuthRequired('Please sign in to view device details.');
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
      window.location.href = `/${encodeURIComponent(canonicalSlug)}/devices/${encodeURIComponent(deviceId)}`;
      return;
    }

    orgSlug = canonicalSlug;

    const orgPill = document.getElementById('org-pill');
    if (orgPill) {
      orgPill.textContent = me?.org?.name ? `${me.org.name} (${canonicalSlug})` : canonicalSlug;
    }

    // Show/hide admin-only menu items based on role
    // Defensive: always hide first, then show only if explicitly admin
    const orgAdminLink = document.getElementById('nav-org-admin-link');
    const policyLink = document.getElementById('nav-policy-link');
    if (orgAdminLink) orgAdminLink.classList.add('is-hidden');
    if (policyLink) policyLink.classList.add('is-hidden');
    
    const userRole = me?.user?.role;
    if (userRole === 'admin') {
      if (orgAdminLink) orgAdminLink.classList.remove('is-hidden');
      if (policyLink) policyLink.classList.remove('is-hidden');
    }

    const backLink = document.getElementById('back-to-devices');
    if (backLink) {
      backLink.href = `/${encodeURIComponent(canonicalSlug)}/devices`;
    }

    hideAuthBanner();
    loadSummary(currentRange);
  } catch (err) {
    // On error, ensure admin items are hidden
    const orgAdminLink = document.getElementById('nav-org-admin-link');
    const policyLink = document.getElementById('nav-policy-link');
    if (orgAdminLink) orgAdminLink.classList.add('is-hidden');
    if (policyLink) policyLink.classList.add('is-hidden');
    
    showAuthRequired(err && err.message ? err.message : String(err));
  }
}

function setupRangeSelector() {
  const select = document.getElementById('range-select');
  if (!select) return;
  
  // Set initial value based on currentRange
  select.value = currentRange;
  
  select.addEventListener('change', () => {
    if (isLoading) {
      // Revert selection if loading
      select.value = currentRange;
      return;
    }
    const range = select.value;
    setActiveRange(range);
    loadSummary(range);
  });
}

function setActiveRange(range) {
  currentRange = range;
  const select = document.getElementById('range-select');
  if (select) {
    select.value = range;
  }
}

async function fetchSummary(range) {
  const url = `/summary?range=${range}&device_id=${encodeURIComponent(deviceId)}`;
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      showAuthRequired('Please sign in to view device details.');
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

async function loadSummary(range) {
  if (isLoading) return;
  
  isLoading = true;
  setLoadingState(true);
  hideError();

  try {
    const data = await fetchSummary(range);
    renderDashboard(data);
  } catch (err) {
    showError(err.message);
  } finally {
    isLoading = false;
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  const select = document.getElementById('range-select');
  if (select) {
    select.disabled = loading;
  }

  if (loading) {
    const totalEventsEl = document.getElementById('total-events');
    if (totalEventsEl) {
      totalEventsEl.textContent = 'Loading...';
    }
    const toolsTbody = document.querySelector('#tools-table tbody');
    if (toolsTbody) {
      toolsTbody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
    }
    const eventTypesTbody = document.querySelector('#event-types-table tbody');
    if (eventTypesTbody) {
      eventTypesTbody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
    }
    const filesTbody = document.querySelector('#files-table tbody');
    if (filesTbody) {
      filesTbody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
    }
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const errorMsg = document.getElementById('error-message');
  if (!banner || !errorMsg) {
    console.error('Error banner elements not found. Error message:', message);
    return;
  }
  
  errorMsg.textContent = message;
  banner.classList.remove('hidden');

  // Setup retry button
  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.onclick = () => loadSummary(currentRange);
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
  const dashboardContent = document.getElementById('dashboard-content');
  
  if (!banner || !msg || !link) {
    console.error('Auth banner elements not found. Auth message:', message);
    return;
  }
  
  msg.textContent = message;
  link.href = '/';
  banner.classList.remove('hidden');
  
  if (dashboardContent) {
    dashboardContent.style.display = 'none';
  }
}

function hideAuthBanner() {
  const banner = document.getElementById('auth-banner');
  const dashboardContent = document.getElementById('dashboard-content');
  
  if (banner) {
    banner.classList.add('hidden');
  }
  if (dashboardContent) {
    dashboardContent.style.display = '';
  }
}

function renderDashboard(data) {
  // Update device name in header span if available (preserving "PromptLineAI - " prefix)
  if (data.device_name) {
    const deviceNameSpan = document.getElementById('device-name-header');
    if (deviceNameSpan) {
      deviceNameSpan.textContent = data.device_name;
    }
  }

  // Summary cards
  const totalEventsEl = document.getElementById('total-events');
  if (totalEventsEl) {
    totalEventsEl.textContent = data.total_events.toLocaleString();
  }

  // Tools breakdown
  renderTools(data.tools);

  // Event types breakdown
  renderEventTypes(data.event_types);

  // Time series chart
  renderTimeChart(data.time_buckets, data.range);

  // File uploads table
  renderFiles(data.files);
}

function renderTools(tools) {
  const tbody = document.querySelector('#tools-table tbody');
  
  if (tools.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">No data</td></tr>';
    return;
  }

  tbody.innerHTML = tools.map(t => `
    <tr>
      <td>${t.tool}</td>
      <td>${t.count.toLocaleString()}</td>
    </tr>
  `).join('');

  // Chart
  const ctx = document.getElementById('tools-chart').getContext('2d');
  if (toolsChart) {
    toolsChart.destroy();
  }

  toolsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tools.map(t => t.tool),
      datasets: [{
        label: 'Events',
        data: tools.map(t => t.count),
        backgroundColor: 'rgba(52, 152, 219, 0.8)',
        borderColor: 'rgba(52, 152, 219, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderEventTypes(eventTypes) {
  const tbody = document.querySelector('#event-types-table tbody');
  
  if (eventTypes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">No data</td></tr>';
    return;
  }

  tbody.innerHTML = eventTypes.map(e => `
    <tr>
      <td>${e.event_type}</td>
      <td>${e.count.toLocaleString()}</td>
    </tr>
  `).join('');

  // Chart
  const ctx = document.getElementById('event-types-chart').getContext('2d');
  if (eventTypesChart) {
    eventTypesChart.destroy();
  }

  eventTypesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: eventTypes.map(e => e.event_type),
      datasets: [{
        label: 'Events',
        data: eventTypes.map(e => e.count),
        backgroundColor: 'rgba(46, 204, 113, 0.8)',
        borderColor: 'rgba(46, 204, 113, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderTimeChart(timeBuckets, range) {
  if (timeBuckets.length === 0) {
    if (timeChart) {
      timeChart.destroy();
      timeChart = null;
    }
    return;
  }

  // Parse bucket strings and format labels
  const labels = timeBuckets.map(b => {
    const date = new Date(b.bucket);
    if (range === '24h') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  });

  const data = timeBuckets.map(b => b.count);

  const ctx = document.getElementById('time-chart').getContext('2d');
  if (timeChart) {
    timeChart.destroy();
  }

  const chartType = range === '24h' ? 'line' : 'bar';

  timeChart = new Chart(ctx, {
    type: chartType,
    data: {
      labels: labels,
      datasets: [{
        label: 'Events',
        data: data,
        backgroundColor: range === '24h' ? 'rgba(155, 89, 182, 0.2)' : 'rgba(155, 89, 182, 0.8)',
        borderColor: 'rgba(155, 89, 182, 1)',
        borderWidth: 2,
        fill: range === '24h',
        tension: range === '24h' ? 0.4 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderFiles(files) {
  const tbody = document.querySelector('#files-table tbody');
  
  if (!files || files.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">No files uploaded</td></tr>';
    return;
  }

  tbody.innerHTML = files.map(f => `
    <tr>
      <td>${f.file_name}</td>
      <td>${f.count.toLocaleString()}</td>
    </tr>
  `).join('');
}
