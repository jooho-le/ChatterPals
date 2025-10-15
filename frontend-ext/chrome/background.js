// background.js (MV3, module)

const TEXT_API_SERVER = 'http://127.0.0.1:8008';

let auth = { token: null, user: null, exp: null, stay: true };
let authTimer = null;

// Load auth on startup
chrome.runtime.onInstalled.addListener(loadAuth);
chrome.runtime.onStartup.addListener(loadAuth);

async function loadAuth() {
  const stored = await chrome.storage.local.get(['authToken', 'authUser', 'authExp', 'staySignedIn']);
  auth.token = stored.authToken || null;
  auth.user = stored.authUser || null;
  auth.exp = stored.authExp || null;
  auth.stay = stored.staySignedIn !== false;

  scheduleAuthCheck();
}

function scheduleAuthCheck() {
  if (authTimer) clearTimeout(authTimer);
  if (!auth.token || !auth.stay) return;

  const now = Math.floor(Date.now() / 1000);
  const refreshIn = Math.max(30, (auth.exp || now + 600) - now - 60); // 60s before exp
  authTimer = setTimeout(async () => {
    try {
      // Soft-check token by calling /auth/me
      const res = await fetch(`${TEXT_API_SERVER}/auth/me`, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      if (!res.ok) throw new Error('token invalid');
      // If server returns exp in body, update it
      const me = await res.json();
      await chrome.storage.local.set({ authUser: me });
      // Keep current exp or extend by 30 min
      const newExp = (auth.exp || Math.floor(Date.now()/1000) + 3600) + 1800;
      auth.exp = newExp;
      await chrome.storage.local.set({ authExp: newExp });
    } catch (e) {
      // token invalid -> clear unless you have refresh token route
      await chrome.storage.local.remove(['authToken', 'authUser', 'authExp']);
      auth.token = null; auth.user = null; auth.exp = null;
    } finally {
      scheduleAuthCheck();
    }
  }, refreshIn * 1000);
}

// Receive broadcasts
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.action === 'broadcastAuthUpdate') {
    auth.token = msg.token || null;
    auth.user = msg.user || null;
    auth.exp = msg.exp || null;
    scheduleAuthCheck();
  } else if (msg?.action === 'openSidebarOnPage') {
    openSidebarOnActiveTab();
  }
});

async function openSidebarOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // Tell content to open sidebar panel (we render a slim panel div)
  chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' }).catch(() => {});
}
