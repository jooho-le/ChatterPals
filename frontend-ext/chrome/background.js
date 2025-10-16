// background.js (MV3, module)

const TEXT_API_SERVER = 'http://127.0.0.1:8008';

// --- 중앙 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'getPageUrl') {
    const isValid = (u) => u && /^https?:/i.test(u);

    // 1) sender.tab.url 사용
    const fromSender = sender?.tab?.url || '';
    if (isValid(fromSender)) {
      sendResponse({ url: fromSender });
      return true;
    }

    // 2) tabs 권한으로 최근 포커스된 창의 active http(s) 탭 찾기
    chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
      const activeHttp =
        (tabs || []).find((t) => t.active && isValid(t.url || '')) ||
        (tabs || []).find((t) => isValid(t.url || ''));
      if (activeHttp && isValid(activeHttp.url)) {
        sendResponse({ url: activeHttp.url });
        return;
      }

      // 3) 컨텐츠 스크립트로 위임 + 1회 재시도(레이스 대비)
      const tabId = activeHttp?.id || sender?.tab?.id || (tabs?.[0]?.id);
      if (!tabId) {
        sendResponse({ url: '' });
        return;
      }
      const askContent = (retry = false) => {
        chrome.tabs.sendMessage(tabId, { action: 'getPageUrl' }, (resp) => {
          if (!chrome.runtime.lastError && resp && isValid(resp.url)) {
            sendResponse({ url: resp.url });
          } else if (!retry) {
            setTimeout(() => askContent(true), 300);
          } else {
            sendResponse({ url: '' });
          }
        });
      };
      askContent(false);
    });
    return true;
  }

  if (request.action === 'getTextFromPage') {
    const forwardTo = (tabId) => {
      if (!tabId) return sendResponse({});
      chrome.tabs.sendMessage(tabId, request, (response) => {
        if (!chrome.runtime.lastError) {
          sendResponse(response);
        } else {
          sendResponse({});
        }
      });
    };
    if (sender.tab?.id) {
      forwardTo(sender.tab.id);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        forwardTo(tabs?.[0]?.id);
      });
    }
    return true;

  // 사이드바 닫기
  } else if (request.action === 'closeSidebar') {
    const forward = (tabId) => {
      if (tabId) chrome.tabs.sendMessage(tabId, { action: 'closeSidebar' });
    };
    if (sender.tab?.id) {
      forward(sender.tab.id);
    } else {
      // 팝업/확장 페이지에서 온 경우: 현재 창의 활성 탭으로 전달
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        forward(tabs?.[0]?.id);
      });
    }
    sendResponse && sendResponse({ ok: true });
    return true;
  }
}); // ✅ onMessage 리스너 닫기

let auth = { token: null, user: null, exp: null, stay: true };
let authTimer = null;

// 설치/업데이트 시: 플로팅 버튼 기본 ON 보장 + 인증 로드
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.local.set({ floatingButtonVisible: true });
  } catch {}
  await loadAuth();
});

// 브라우저 시작 시 인증 로드
chrome.runtime.onStartup.addListener(loadAuth);

async function loadAuth() {
  const stored = await chrome.storage.local.get(['authToken', 'authUser', 'authExp', 'staySignedIn']);
  auth.token = stored.authToken || null;
  auth.user  = stored.authUser  || null;
  auth.exp   = stored.authExp   || null;
  auth.stay  = stored.staySignedIn !== false;

  scheduleAuthCheck();
}

function scheduleAuthCheck() {
  if (authTimer) clearTimeout(authTimer);
  if (!auth.token || !auth.stay) return;

  const now = Math.floor(Date.now() / 1000);
  const refreshIn = Math.max(30, (auth.exp || now + 600) - now - 60); // 만료 60초 전 확인
  authTimer = setTimeout(async () => {
    try {
      // Soft-check token by calling /auth/me
      const res = await fetch(`${TEXT_API_SERVER}/auth/me`, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      if (!res.ok) throw new Error('token invalid');
      const me = await res.json();
      await chrome.storage.local.set({ authUser: me });

      // 서버가 exp를 주지 않는 경우를 대비해 30분 연장
      const newExp = (auth.exp || Math.floor(Date.now() / 1000) + 3600) + 1800;
      auth.exp = newExp;
      await chrome.storage.local.set({ authExp: newExp });
    } catch (e) {
      // token invalid -> clear (refresh 토큰 플로우가 없다면)
      await chrome.storage.local.remove(['authToken', 'authUser', 'authExp']);
      auth.token = null; auth.user = null; auth.exp = null;
    } finally {
      scheduleAuthCheck();
    }
  }, refreshIn * 1000);
}

// 브로드캐스트 수신 및 사이드바 열기
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.action === 'broadcastAuthUpdate') {
    auth.token = msg.token || null;
    auth.user  = msg.user  || null;
    auth.exp   = msg.exp   || null;
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
