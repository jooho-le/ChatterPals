// ChatterPals Background Script - Central Controller

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';
let creating; // Promise to prevent multiple offscreen documents

// 안전한 메시지 전송 유틸 (컨텐츠 스크립트 미주입 탭 전송 시 에러 무시)
function safeTabsSendMessage(tabId, message) {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      // 컨텐츠 스크립트가 없으면 lastError 설정됨. 동작에는 영향 없으니 무시.
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // 호출 자체 실패도 무시
  }
}

// --- 오른쪽 클릭 메뉴 설정 ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "chatterpals_analyze",
    title: "ChatterPals로 텍스트 분석하기",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "chatterpals_analyze" && tab?.id) {
    chrome.storage.local.set({ contextDataForSidebar: { text: info.selectionText } }, () => {
        safeTabsSendMessage(tab.id, { action: 'openSidebarFromContext' });
    });
  }
});

// --- 중앙 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'getTextFromPage') {
        if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, request, (response) => {
                if (!chrome.runtime.lastError) {
                    sendResponse(response);
                }
            });
        }
        return true; 
    // 사이드바 닫기
    } else if (request.action === 'closeSidebar') {
        const forward = (tabId) => {
            if (tabId) safeTabsSendMessage(tabId, { action: 'closeSidebar' });
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



    } else if (request.action === 'requestMicrophonePermission') {
        handlePermissionRequest();
        return true;

    } else if (request.action === 'startRecording' || request.action === 'stopRecording') {
        forwardToOffscreen(request.action);
        return true;

    } else if (request.action === 'recordingStopped' || request.action === 'recordingError') {
        chrome.runtime.sendMessage(request);
        closeOffscreenDocument();

    } else if (request.action === 'broadcastAuthUpdate') {
        console.log('[background] Broadcasting auth update to tabs', request.token ? 'login' : 'logout');
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
                if (!tab.id || (tab.url && tab.url.startsWith('chrome://'))) return;
                console.log('[background] Forwarding auth update to tab', tab.id, tab.url);
                safeTabsSendMessage(tab.id, {
                    action: 'authUpdate',
                    token: request.token ?? null,
                    user: request.user ?? null,
                });
            });
        });
        sendResponse?.({ ok: true });
        return true;

    } else if (request.action === 'permissionResult') {
        chrome.runtime.sendMessage(request);
    }
});

async function handlePermissionRequest() {
    try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        if (permissionStatus.state === 'granted') {
            chrome.runtime.sendMessage({ action: 'permissionResult', success: true });
        } else if (permissionStatus.state === 'prompt') {
            chrome.windows.create({
                url: chrome.runtime.getURL('permission.html'),
                type: 'popup', width: 400, height: 200,
            });
        } else { // 'denied'
            chrome.runtime.sendMessage({ action: 'permissionResult', success: false, error: 'denied' });
        }
    } catch (e) {
        console.error("Permission query failed:", e);
        chrome.runtime.sendMessage({ action: 'permissionResult', success: false, error: 'query_failed' });
    }
}

async function forwardToOffscreen(action) {
    if (!(await hasOffscreenDocument())) {
        if (creating) {
            await creating;
        } else {
            creating = chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: ['USER_MEDIA'],
                justification: '마이크 녹음을 위해 필요합니다.',
            });
            await creating;
            creating = null;
        }
    }
    chrome.runtime.sendMessage({ action, target: 'offscreen' });
}

async function hasOffscreenDocument() {
    if ('getContexts' in chrome.runtime) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        return !!contexts.length;
    } else { 
        const clients = await self.clients.matchAll();
        return clients.some(c => c.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
    }
}

async function closeOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        chrome.offscreen.closeDocument();
    }
}
