// content.js
const TEXT_API_SERVER = 'http://127.0.0.1:8008';

let state = {
  authToken: null,
  floatingVisible: true,
  catVisible: true
};

let nodes = {
  fab: null,
  pop: null,
  sidebar: null,
  cat: null
};

init();

async function init() {
  // read initial settings
  const stored = await chrome.storage.local.get(['authToken', 'floatingButtonVisible', 'catVisible']);
  state.authToken = stored.authToken || null;
  state.floatingVisible = stored.floatingButtonVisible !== false;
  state.catVisible = stored.catVisible !== false;

  ensureInlinePopup();
  ensureFab();
  ensureSidebar();
  ensureCat();

  // Selection / Double-click handlers
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('dblclick', handleSelection);

  // Messages from popup/background
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === 'getSelectionText') {
      const sel = window.getSelection()?.toString() || '';
      sendResponse?.({ text: sel });
      return true;
    } else if (msg?.action === 'toggleFloatingButton') {
      state.floatingVisible = !!msg.visible;
      if (nodes.fab) nodes.fab.style.display = state.floatingVisible ? 'flex' : 'none';
    } else if (msg?.action === 'toggleCat') {
      state.catVisible = !!msg.visible;
      if (nodes.cat) nodes.cat.style.display = state.catVisible ? 'block' : 'none';
    } else if (msg?.action === 'openSidebar') {
      openSidebar();
    } else if (msg?.action === 'broadcastAuthUpdate') {
      state.authToken = msg.token || null;
    }
  });
}

/** ---------- Inline Popup ---------- **/
function ensureInlinePopup() {
  if (nodes.pop) return;
  const pop = document.createElement('div');
  pop.className = 'cp-inline-pop';
  pop.innerHTML = `
    <button class="cp-close" title="닫기">✖</button>
    <div class="cp-content"></div>
    <div class="cp-actions">
      <button data-act="summary">요약</button>
      <button data-act="questions">질문 생성</button>
      <button data-act="chat">토론 시작</button>
    </div>
  `;
  document.documentElement.appendChild(pop);
  pop.querySelector('.cp-close').addEventListener('click', () => hidePopup());
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('scroll', () => hidePopup(), { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePopup(); });

  pop.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const action = btn.dataset.act;
    const text = pop.dataset.raw || '';
    if (!text.trim()) return;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;

      if (action === 'summary') {
        setPopContent('요약 요청 중...');
        const res = await fetch(`${TEXT_API_SERVER}/questions`, {
          method: 'POST', headers, body: JSON.stringify({ text, max_questions: 0 })
        });
        const data = await res.json();
        setPopContent(`${escapeHtml(text)}\n\n—\n요약: ${escapeHtml((data.summary || '').slice(0, 600))}`);
      } else if (action === 'questions') {
        setPopContent('질문 생성 중...');
        const res = await fetch(`${TEXT_API_SERVER}/questions`, {
          method: 'POST', headers, body: JSON.stringify({ text, max_questions: 3 })
        });
        const data = await res.json();
        const qs = (data.questions || []).map((q, i) => `${i+1}. ${typeof q==='object'?q.question:q}`).join('\n');
        setPopContent(`${escapeHtml(text)}\n\n—\n질문:\n${escapeHtml(qs)}`);
      } else if (action === 'chat') {
        setPopContent('토론 세션 시작 중...');
        const res = await fetch(`${TEXT_API_SERVER}/chat/start`, {
          method: 'POST', headers, body: JSON.stringify({ text, max_questions: 5 })
        });
        const data = await res.json();
        setPopContent(`토론 시작됨. 세션: ${data.session_id?.slice(0,8) || '-'}\n첫 질문: ${data.question}`);
      }
    } catch (err) {
      setPopContent(`오류: ${err.message}`);
    }

    // Extension sidebar iframe -> page URL 요청 처리
    if (record && record.source === 'chatter-ext' && record.type === 'REQUEST_PAGE_URL') {
      try {
        const url = window.location?.href || '';
        event.source?.postMessage({ source: 'chatter-page', type: 'RESPONSE_PAGE_URL', url }, '*');
      } catch {
        event.source?.postMessage({ source: 'chatter-page', type: 'RESPONSE_PAGE_URL', url: '' }, '*');
      }
    }
  });

  nodes.pop = pop;
}

function setPopContent(text) {
  const content = nodes.pop.querySelector('.cp-content');
  content.textContent = text;
}

function hidePopup() {
  if (!nodes.pop) return;
  nodes.pop.style.display = 'none';
  nodes.pop.dataset.raw = '';
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { hidePopup(); return; }
  const text = sel.toString().trim();
  if (!text) { hidePopup(); return; }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) { hidePopup(); return; }

  const top = Math.max(8, window.scrollY + rect.top - 10 - 16);
  const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 340);

  nodes.pop.style.display = 'block';
  nodes.pop.style.top = `${top}px`;
  nodes.pop.style.left = `${left}px`;
  nodes.pop.dataset.raw = text;
  setPopContent(text.length > 240 ? `${text.slice(0,240)}…` : text);
}

/** ---------- Floating button (optional) ---------- **/
function ensureFab() {
  if (nodes.fab) return;
  const fab = document.createElement('div');
  fab.className = 'cp-fab';
  fab.title = '선택/더블클릭으로 단어 위 팝업을 띄울 수 있어요';
  fab.textContent = '✨';
  fab.style.display = state.floatingVisible ? 'flex' : 'none';
  fab.addEventListener('click', () => {
    // Show small help
    nodes.pop.style.display = 'block';
    nodes.pop.style.top = `${window.scrollY + window.innerHeight - 140}px`;
    nodes.pop.style.left = `${window.scrollX + window.innerWidth - 360}px`;
    nodes.pop.dataset.raw = 'TIP';
    setPopContent('페이지에서 텍스트를 드래그하거나 더블클릭하면 여기 위에 팝업이 떠요!');
  });
  document.documentElement.appendChild(fab);
  nodes.fab = fab;
}

/** ---------- Sidebar (simple panel) ---------- **/
function ensureSidebar() {
  if (nodes.sidebar) return;
  const panel = document.createElement('div');
  panel.className = 'cp-sidebar';
  panel.innerHTML = `
    <header>
      <strong>ChatterPals</strong>
      <button class="btn-close" title="닫기">✖</button>
    </header>
    <main>
      <p>오른쪽 패널입니다. 선택 텍스트 요약/질문을 이곳에서도 표시하도록 확장 가능합니다.</p>
    </main>
  `;
  panel.querySelector('.btn-close').addEventListener('click', () => panel.classList.remove('open'));
  document.documentElement.appendChild(panel);
  nodes.sidebar = panel;
}
function openSidebar() { nodes.sidebar?.classList.add('open'); }

/** ---------- Cat mascot (random walk + drag) ---------- **/
function ensureCat() {
  if (nodes.cat) return;
  const img = document.createElement('img');
  img.className = 'cp-cat';
  img.src = chrome.runtime.getURL('cat-48.png');
  img.alt = 'cat';
  img.style.left = '20px';
  img.style.top = '20px';
  img.style.display = state.catVisible ? 'block' : 'none';
  document.documentElement.appendChild(img);
  nodes.cat = img;

  let vx = 1, vy = 1;
  let dragging = false, dragDX = 0, dragDY = 0, rafId = null;

  const step = () => {
    if (dragging || nodes.cat.style.display === 'none') {
      rafId = requestAnimationFrame(step);
      return;
    }
    const r = nodes.cat.getBoundingClientRect();
    let x = r.left + window.scrollX, y = r.top + window.scrollY;

    // Random jitter
    vx += (Math.random() - 0.5) * 0.6;
    vy += (Math.random() - 0.5) * 0.6;
    vx = Math.max(-3, Math.min(3, vx));
    vy = Math.max(-3, Math.min(3, vy));
    x += vx; y += vy;

    const pad = 10;
    const maxX = window.scrollX + document.documentElement.clientWidth - r.width - pad;
    const maxY = window.scrollY + document.documentElement.clientHeight - r.height - pad;
    const minX = window.scrollX + pad, minY = window.scrollY + pad;

    if (x < minX) { x = minX; vx = Math.abs(vx); }
    if (y < minY) { y = minY; vy = Math.abs(vy); }
    if (x > maxX) { x = maxX; vx = -Math.abs(vx); }
    if (y > maxY) { y = maxY; vy = -Math.abs(vy); }

    nodes.cat.style.left = `${x}px`;
    nodes.cat.style.top = `${y}px`;

    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  // Drag
  img.addEventListener('mousedown', (e) => {
    dragging = true;
    img.style.transform = 'scale(1.07)';
    const rect = img.getBoundingClientRect();
    dragDX = e.clientX - rect.left;
    dragDY = e.clientY - rect.top;
    e.preventDefault();
  });

  // ---------------------------
  // 플로팅 버튼
  // ---------------------------
  function injectFAB() {
    if (document.getElementById(FAB_ID)) {
      fabEl = document.getElementById(FAB_ID);
      return;
    }
    fabEl = document.createElement('button');
    fabEl.id = FAB_ID;
    fabEl.type = 'button';
    fabEl.setAttribute('aria-label', 'Open ChatterPals sidebar');
    fabEl.textContent = ''; // 아이콘은 CSS background-image 사용

    // 위치 복원
    restoreFabPosition();

    // 클릭(사이드바 열기) + 드래그 이동 로직
    enableFabDragAndClick();

    document.documentElement.appendChild(fabEl);
  }

  function removeFAB() {
    if (fabEl && fabEl.parentNode) {
      fabEl.parentNode.removeChild(fabEl);
    }
    fabEl = null;
  }

  function updateFABVisibility(visible) {
    if (visible) injectFAB();
    else removeFAB();
  }

  // ---------------------------
  // 사이드바
  // ---------------------------
  function openSidebar() {
    if (sidebarIframe && document.getElementById(SIDEBAR_IFRAME_ID)) {
      try { sidebarIframe.focus(); } catch {}
      return;
    }
    sidebarIframe = document.createElement('iframe');
    sidebarIframe.id = SIDEBAR_IFRAME_ID;
    // 현재 페이지 URL을 쿼리로 전달하여 사이드바가 직접 사용하도록 함
    let pageUrl = '';
    try { pageUrl = window.location?.href || ''; } catch {}
    const joiner = SIDEBAR_URL.includes('?') ? '&' : '?';
    const srcWithUrl = pageUrl ? `${SIDEBAR_URL}${joiner}page_url=${encodeURIComponent(pageUrl)}` : SIDEBAR_URL;
    sidebarIframe.src = srcWithUrl;
    document.documentElement.appendChild(sidebarIframe);

    // CSS 트랜지션을 위해 다음 프레임에 visible 추가
    requestAnimationFrame(() => {
      sidebarIframe?.classList.add('visible');
    });
  }

  function closeSidebar() {
    const iframe = document.getElementById(SIDEBAR_IFRAME_ID);
    if (!iframe) return;
    iframe.classList.remove('visible');
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      sidebarIframe = null;
    }, 300);
  }

  // ---------------------------
  // 텍스트 추출
  // ---------------------------
  function getSelectionText() {
    try {
      const sel = window.getSelection ? window.getSelection().toString() : '';
      return (sel || '').trim();
    } catch {
      return '';
    }
  }

  function getFullPageText(limit = 20000) {
    let text = '';
    try {
      text = (document.body?.innerText || document.documentElement?.innerText || '').trim();
    } catch {}
    if (text.length > limit) text = text.slice(0, limit);
    return text;
  }

  // ---------------------------
  // 메시지 핸들러
  // ---------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 팝업/백그라운드 → 컨텐츠 스크립트

    if (request.action === 'toggleFloatingButton') {
      updateFABVisibility(!!request.visible);
      sendResponse?.({ ok: true });
      return true;
    }

    if (request.action === 'getTextFromPage') {
      const type = request.type || 'selection';
      const text = type === 'fullPage' ? getFullPageText() : getSelectionText();
      sendResponse?.({ text });
      return true;
    }

    if (request.action === 'getPageUrl') {
      try {
        const url = window.location?.href || '';
        sendResponse?.({ url });
      } catch {
        sendResponse?.({ url: '' });
      }
      return true;
    }

    if (request.action === 'openSidebarFromContext') {
      openSidebar();
      sendResponse?.({ ok: true });
      return true;
    }

    if (request.action === 'closeSidebar') {
      // ✖ 버튼 → popup.js → background.js → (여기)
      closeSidebar();
      sendResponse?.({ status: 'sidebar closed' });
      return true;
    }

    if (request.action === 'authUpdate') {
      const token = typeof request.token === 'string' ? request.token : null;
      const user = request.user ?? null;
      console.log('[content] Received authUpdate message from background', token)
      syncAuthToPage(token, user);
      sendResponse?.({ ok: true });
      return true;
    }

    return false;
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = e.clientX - dragDX + window.scrollX;
    const y = e.clientY - dragDY + window.scrollY;
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    img.style.transform = 'scale(1.0)';
  });

  // Toggle visibility on click (double click-ish UX)
  let lastClick = 0;
  img.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastClick < 350) {
      // double click => hide/show
      if (img.style.display === 'none') img.style.display = 'block';
      else img.style.display = 'none';
    }
    lastClick = now;
  });
}

/** ---------- Utils ---------- **/
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
