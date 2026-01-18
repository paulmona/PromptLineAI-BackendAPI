(function () {
  async function initClerk() {
    const env = window.__ENV || {};
    const pk = env.CLERK_PUBLISHABLE_KEY;
    if (!pk) {
      throw new Error('Missing CLERK_PUBLISHABLE_KEY (served via /env.js)');
    }
    if (!window.Clerk) {
      throw new Error('Clerk.js failed to load');
    }
    if (window.Clerk.loaded) return;

    // Clerk.js load signature varies slightly across versions; this is the common pattern.
    await window.Clerk.load({ publishableKey: pk });
  }

  async function getToken() {
    if (!window.Clerk || !window.Clerk.loaded) return null;
    const session = window.Clerk.session;
    if (!session) return null;
    const token = await session.getToken();
    return token || null;
  }

  async function signOut() {
    if (!window.Clerk || !window.Clerk.loaded) return;
    await window.Clerk.signOut();
  }

  window.PromptLineAuth = {
    initClerk,
    getToken,
    signOut,
  };
})();

