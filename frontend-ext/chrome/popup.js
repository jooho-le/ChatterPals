// popup.js (MV3, module)
const TEXT_API_SERVER = 'http://127.0.0.1:8008';

const $ = (sel) => document.querySelector(sel);
const loginForm = $('#loginForm');
const loginStatus = $('#loginStatus');
const signedIn = $('#signed-in');
const nickname = $('#nickname');
const logoutBtn = $('#logoutBtn');
const username = $('#username');
const password = $('#password');
const staySignedIn = $('#staySignedIn');
const floatingToggle = $('#floatingToggle');
const catToggle = $('#catToggle');
const quickResult = $('#quickResult');
const pingSummaryBtn = $('#pingSummary');
const openSideBtn = $('#openSide');

let auth = { token: null, user: null, exp: null };

init();

async function init() {
  // load saved settings
  const stored = await chrome.storage.local.get([
    'authToken', 'authUser', 'authExp',
    'floatingButtonVisible', 'catVisible'
  ]);
  auth.token = stored.authToken || null;
  auth.user = stored.authUser || null;
  auth.exp = stored.authExp || null;

  floatingToggle.checked = stored.floatingButtonVisible !== false;
  catToggle.checked = stored.catVisible !== false;

  // auto sign-in if token exists
  if (auth.token) {
    try {
      const me = await fetchMe();
      auth.user = me;
      await chrome.storage.local.set({ authUser: me });
      showSignedInUI();
    } catch (e) {
      // token invalid — clear
      await clearAuth(false);
      showSignedOutUI();
    }
  } else {
    showSignedOutUI();
  }

  // events
  loginForm?.addEventListener('submit', onLoginSubmit);
  logoutBtn?.addEventListener('click', handleLogout);
  floatingToggle?.addEventListener('change', onFloatingToggle);
  catToggle?.addEventListener('change', onCatToggle);
  pingSummaryBtn?.addEventListener('click', onPingSummary);
  openSideBtn?.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'openSidebarOnPage' }));
}

function showSignedInUI() {
  loginForm.style.display = 'none';
  signedIn.style.display = 'block';
  nickname.textContent = auth.user?.nickname || auth.user?.username || '사용자';
  loginStatus.textContent = '';
}

function showSignedOutUI() {
  loginForm.style.display = 'block';
  signedIn.style.display = 'none';
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const u = username.value.trim();
  const p = password.value;
  if (!u || !p) {
    loginStatus.textContent = '아이디/비밀번호를 입력하세요.';
    return;
  }
  loginStatus.textContent = '로그인 중...';
  try {
    const payload = new URLSearchParams();
    payload.set('username', u);
    payload.set('password', p);
    const res = await fetch(`${TEXT_API_SERVER}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '로그인 실패');
    }
    const data = await res.json();
    auth.token = data.access_token;
    auth.user = data.user || null;

    // Optional exp if server returns exp (unix sec). Fallback: +6h
    auth.exp = data.exp || Math.floor(Date.now() / 1000) + 6 * 3600;

    await chrome.storage.local.set({
      authToken: auth.token,
      authUser: auth.user,
      authExp: auth.exp,
      staySignedIn: staySignedIn.checked
    });

    // broadcast to content/background
    await chrome.runtime.sendMessage({
      action: 'broadcastAuthUpdate',
      token: auth.token,
      user: auth.user,
      exp: auth.exp
    });

    loginStatus.textContent = '로그인 성공!';
    showSignedInUI();
  } catch (err) {
    loginStatus.textContent = err.message;
    await clearAuth();
    showSignedOutUI();
  }
}

async function handleLogout() {
  await clearAuth();
  loginStatus.textContent = '로그아웃되었습니다.';
  showSignedOutUI();
}

async function clearAuth(broadcast = true) {
  auth = { token: null, user: null, exp: null };
  await chrome.storage.local.remove(['authToken', 'authUser', 'authExp']);
  if (broadcast) {
    await chrome.runtime.sendMessage({ action: 'broadcastAuthUpdate', token: null, user: null, exp: null });
  }
}

async function fetchMe() {
  const headers = {};
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const res = await fetch(`${TEXT_API_SERVER}/auth/me`, { headers });
  if (!res.ok) throw new Error('인증 만료');
  return res.json();
}

async function onFloatingToggle() {
  const visible = floatingToggle.checked;
  await chrome.storage.local.set({ floatingButtonVisible: visible });
  // Notify active tab(s)
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleFloatingButton', visible }).catch(() => {});
    }
  }
}

async function onCatToggle() {
  const visible = catToggle.checked;
  await chrome.storage.local.set({ catVisible: visible });
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleCat', visible }).catch(() => {});
    }
  }
}

async function onPingSummary() {
  quickResult.textContent = '선택 텍스트를 가져오는 중...';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'getSelectionText' }, async (resp) => {
    const text = resp?.text?.trim();
    if (!text) {
      quickResult.textContent = '선택된 텍스트가 없습니다.';
      return;
    }
    quickResult.textContent = '요약 요청 중...';
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      const res = await fetch(`${TEXT_API_SERVER}/questions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, max_questions: 0 })
      });
      if (!res.ok) throw new Error('서버 오류');
      const data = await res.json();
      quickResult.textContent = (data.summary || '').slice(0, 800);
    } catch (e) {
      quickResult.textContent = `실패: ${e.message}`;
    }
  });
}
