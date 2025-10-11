// ChatterPals Background Script - Central Controller

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';
let creating; // Promise to prevent multiple offscreen documents

// 수동 시작(우클릭 메뉴) 제거

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
            const activeHttp = (tabs || []).find((t) => t.active && isValid(t.url || ''))
                || (tabs || []).find((t) => isValid(t.url || ''));
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
                const tabId = tabs?.[0]?.id;
                forwardTo(tabId);
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
                chrome.tabs.sendMessage(tab.id, {
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
