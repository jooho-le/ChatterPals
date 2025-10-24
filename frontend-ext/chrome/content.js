// content.js
// -----------------------------------------------------------------------------
// ChatterPals Content Script
// - Injects floating FAB (drag to reposition & save)
// - Handles sidebar (iframe) open/close
// - Manages popup -> background -> content messaging
// - Extracts page/selection text
// -----------------------------------------------------------------------------
(() => {
  const SIDEBAR_IFRAME_ID = 'chatterpals-sidebar-iframe';
  const FAB_ID = 'chatterpals-fab';
  const SIDEBAR_URL = chrome.runtime.getURL('popup.html?context=sidebar');
  const AUTH_MESSAGE_TYPE = 'AUTH_UPDATE';
  const AUTH_SOURCE_WEB = 'chatter-web';
  const AUTH_SOURCE_EXTENSION = 'chatter-extension';
  const API_BASE = 'https://chatterpals-1gbe.onrender.com/api';
  const ANSWER_ENDPOINT = `${API_BASE}/check-answer`;
  const TEXT_API_BASE = 'https://chatterpals-1gbe.onrender.com';
  const QUIZ_ENDPOINT = `${TEXT_API_BASE}/quiz/cloze`;
  const QUESTION_PROMPT = '하이라이트된 표현에 들어갈 영어 단어를 골라보세요.';

  let sidebarIframe = null;
  let fabEl = null;
  // ---------------------------
  // 초기화: 플로팅 버튼 가시성 반영 + 위치 복원
  // ---------------------------
  chrome.storage.local.get(['floatingButtonVisible'], (res) => {
    const visible = res.floatingButtonVisible !== false; // 기본 true
    updateFABVisibility(visible);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, 'authToken') &&
        !Object.prototype.hasOwnProperty.call(changes, 'authUser')) {
      return;
    }
    chrome.storage.local.get(['authToken', 'authUser'], (stored) => {
      const token = typeof stored.authToken === 'string' ? stored.authToken : null;
      const user = stored.authUser ?? null;
      console.log('[content] storage change detected, syncing to page', token);
      syncAuthToPage(token, user);
    });
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
    sidebarIframe.src = SIDEBAR_URL;
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

    if (request.action === 'openSidebarFromContext') {
      openSidebar();
      sendResponse?.({ ok: true });
      return true;
    }

    if (request.action === 'triggerFloatingHint') {
      // (1) 외부에서 텍스트가 들어온 경우 우선 저장
      if (typeof request.contextText === 'string' && request.contextText.trim()) {
        overlayState.contextText = request.contextText.trim();
      }

      // (2) 앵커 rect/엘리먼트(선택) 정보 초기 준비
      let rectDoc = null;
      let anchorEl = null;
      if (request.anchor && typeof request.anchor === 'object') {
        const anchor = request.anchor;
        if (typeof anchor.top === 'number' && typeof anchor.left === 'number') {
          rectDoc = {
            top: anchor.top,
            left: anchor.left,
            width:  typeof anchor.width  === 'number' ? anchor.width  : 240,
            height: typeof anchor.height === 'number' ? anchor.height : 60,
          };
        }
        if (typeof anchor.elementSelector === 'string') {
          anchorEl = document.querySelector(anchor.elementSelector) || null;
        }
      }

      // (3) 현재 선택 영역 정보 가져오기 (없으면 null)
      const info = getSelectionInfo();

      // (4) 기존 마스크 제거 (중복 감싸기 방지)
      removeMaskSpan?.();
      overlayState.maskSpanEl = null;

      // (5) 선택 영역이 있고, 하나의 텍스트 노드 안에서 범위가 유효하면 그대로 마스크 span 적용
      //     - 좌표 기반이 아니라 실제 텍스트를 감싸므로 스크롤/리플로우에도 안정적
      let spanApplied = false;
      try {
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const sameNode = range.startContainer === range.endContainer;
          if (
            sameNode &&
            range.startContainer &&
            range.startContainer.nodeType === Node.TEXT_NODE &&
            range.startOffset < range.endOffset
          ) {
            const textNode = range.startContainer;
            const startOffset = range.startOffset;
            const endOffset = range.endOffset;

            // 5-1) 실제로 선택 범위를 <span class="chatterpals-mask">로 감싼다
            const span = applyMaskSpan?.(textNode, startOffset, endOffset);
            if (span) {
              spanApplied = true;
              overlayState.maskSpanEl = span;
              anchorEl = span; // 앵커를 span으로 전환

              // 상태값도 선택 기반으로 갱신
              const raw = textNode.textContent || '';
              const selectedSegment = raw.slice(startOffset, endOffset);
              overlayState.maskRawText = selectedSegment;
              overlayState.maskText = normalizeText(selectedSegment) || selectedSegment.trim();
              overlayState.maskStart = startOffset;
              overlayState.maskEnd = endOffset;

              // 문장/문맥은 들어온 contextText 우선, 없으면 선택 텍스트 사용
              const selectedText = sel.toString().trim();
              overlayState.fullSentence =
                overlayState.contextText ||
                selectedText ||
                overlayState.fullSentence ||
                '';
              overlayState.maskedSentence = overlayState.fullSentence
                ? overlayState.fullSentence.replace(overlayState.maskText, ' _____ ')
                : '';

              // 위치는 span 기준으로 다시 계산
              overlayState.maskRect = null;
              refreshMaskRect?.();
            }
          }
        }
      } catch (e) {
        console.warn('triggerFloatingHint: selection span apply failed', e);
      }

      // (6) 선택 기반 span 적용이 실패한 경우, 기존 로직으로 보정
      if (!spanApplied && info) {
        // 선택 정보에서 얻은 데이터 반영
        if (!overlayState.contextText && info.text) {
          overlayState.contextText = info.text;
        }
        rectDoc = rectDoc || info.rect;
        anchorEl = anchorEl || info.element || null;

        // (선택 영역에 마스크 범위 정보가 없는 구조라면) 전체 문장 추출/마스크는 자동 타깃 로직에 위임 가능
        // 여기서는 UI가 비지 않도록 최소한의 기본값만 세팅
        overlayState.fullSentence   = overlayState.fullSentence || overlayState.contextText || '';
        overlayState.maskedSentence = overlayState.maskedSentence || overlayState.fullSentence || '';
        overlayState.maskRawText    = overlayState.maskRawText || info.maskRawText || '';
        if (!overlayState.maskText && info.maskText) {
          overlayState.maskText = info.maskText;
        }
        overlayState.maskStart      = overlayState.maskStart ?? null;
        overlayState.maskEnd        = overlayState.maskEnd   ?? null;

        // 커버 사각형
        overlayState.maskRect = overlayState.maskRect || rectDoc || info.rect || null;
      }

      // (7) 모드 결정
      const mode =
        overlayState.maskText
          ? 'question'
          : shouldUseQuestionMode(overlayState.fullSentence) ? 'question' : 'tease';

      // (8) 표시용 rect: span 기준이 있으면 그걸 우선 사용
      const rectForShow = overlayState.maskRect || rectDoc || (info && info.rect) || {
        // 최후의 안전값: 뷰포트 중앙
        top: window.scrollY + window.innerHeight / 2 - 30,
        left: window.scrollX + (window.innerWidth - 240) / 2,
        width: 240,
        height: 60,
      };

      // (9) 오버레이 표시
      overlayState.usageCount = 0;
      showHintOverlay(
        rectForShow,
        mode,
        'message',
        anchorEl
      );

      sendResponse?.({ ok: true });
      return true;
    }

    if (request.action === 'hideFloatingHint') {
      hideHintOverlay();
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
  });

  // ESC로 사이드바 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // ---------------------------
  // FAB 드래그 & 클릭 처리
  // ---------------------------
  function enableFabDragAndClick() {
    if (!fabEl) return;

    let isDragging = false;
    let didDrag = false;
    let startX = 0, startY = 0;
    let offsetX = 0, offsetY = 0;

    const onMouseDown = (e) => {
      isDragging = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = fabEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      fabEl.style.transition = 'none';   // 드래그 중엔 트랜지션 제거
      // 좌표계: 드래그 시작 시 left/top 모드로 전환
      fabEl.style.right = 'auto';
      fabEl.style.bottom = 'auto';
      fabEl.style.position = 'fixed';

      // 선택 방지
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;

      // 드래그 감지(클릭과 구분)
      const moved = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);
      if (moved > 3) didDrag = true;

      // 새 좌표 계산
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const elW = fabEl.offsetWidth || 48;
      const elH = fabEl.offsetHeight || 48;

      let newLeft = e.clientX - offsetX;
      let newTop  = e.clientY - offsetY;

      // 뷰포트 안에서만 이동되도록 클램프
      newLeft = Math.max(4, Math.min(newLeft, vw - elW - 4));
      newTop  = Math.max(4, Math.min(newTop, vh - elH - 4));

      fabEl.style.left = `${newLeft}px`;
      fabEl.style.top  = `${newTop}px`;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;

      // 위치 저장
      persistFabPosition();

      // 원래 트랜지션 복원
      fabEl.style.transition = '';

      // 선택 방지 해제
      document.body.style.userSelect = '';

      // 드래그가 아니었다면 클릭으로 간주 → 사이드바 열기
      if (!didDrag) {
        openSidebar();
      }
    };

    // 클릭 핸들러는 드래그와 충돌하지 않도록 제거(위 onMouseUp에서 처리)
    fabEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // 터치 지원
    fabEl.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      onMouseDown({ clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      onMouseMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      onMouseUp();
    }, { passive: true });
  }

  function persistFabPosition() {
    if (!fabEl) return;
    const rect = fabEl.getBoundingClientRect();
    const pos = { left: rect.left, top: rect.top };
    chrome.storage.local.set({ fabPosition: pos });
  }

  function restoreFabPosition() {
    chrome.storage.local.get(['fabPosition'], (res) => {
      const pos = res.fabPosition;
      if (!fabEl) return;

      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        // 저장된 좌표가 뷰포트 밖이면 보정
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        const elW = 48, elH = 48;

        let left = Math.max(4, Math.min(pos.left, vw - elW - 4));
        let top  = Math.max(4, Math.min(pos.top,  vh - elH - 4));

        fabEl.style.position = 'fixed';
        fabEl.style.left = `${left}px`;
        fabEl.style.top  = `${top}px`;
        fabEl.style.right = 'auto';
        fabEl.style.bottom = 'auto';
      } else {
        // 저장된 값이 없으면 CSS 기본(right/bottom) 사용
        fabEl.style.left = '';
        fabEl.style.top = '';
        fabEl.style.right = '';
        fabEl.style.bottom = '';
      }
    });

    // 윈도우 리사이즈 시, 화면 밖으로 나가있으면 살짝 안쪽으로 보정
    window.addEventListener('resize', () => {
      if (!fabEl) return;
      const rect = fabEl.getBoundingClientRect();
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const elW = fabEl.offsetWidth || 48;
      const elH = fabEl.offsetHeight || 48;

      let left = rect.left;
      let top  = rect.top;

      let changed = false;
      if (left < 4) { left = 4; changed = true; }
      if (top  < 4) { top  = 4; changed = true; }
      if (left > vw - elW - 4) { left = vw - elW - 4; changed = true; }
      if (top  > vh - elH - 4) { top  = vh - elH - 4; changed = true; }

      if (changed) {
        fabEl.style.position = 'fixed';
        fabEl.style.left = `${left}px`;
        fabEl.style.top  = `${top}px`;
        fabEl.style.right = 'auto';
        fabEl.style.bottom = 'auto';
        chrome.storage.local.set({ fabPosition: { left, top } });
      }
    });
  }

  function syncAuthToPage(token, user) {
    try {
      if (token) {
        window.localStorage.setItem('chatter_token', token);
        console.log('[content] Synced token into page localStorage')
      } else {
        window.localStorage.removeItem('chatter_token');
        console.log('[content] Removed token from page localStorage')
      }
    } catch (error) {
      console.warn('Failed to sync auth to page', error);
    }
    window.postMessage(
      {
        source: AUTH_SOURCE_EXTENSION,
        type: AUTH_MESSAGE_TYPE,
        token,
        user,
      },
      '*',
    );
  }

  function bootstrapAuthState() {
    try {
      chrome.storage.local.get(['authToken', 'authUser'], (stored) => {
        const token = typeof stored.authToken === 'string' ? stored.authToken : null;
        const user = stored.authUser ?? null;
        if (token) {
          console.log('[content] Bootstrapping existing extension token into page')
          syncAuthToPage(token, user);
        } else {
          try {
            const pageToken = window.localStorage.getItem('chatter_token');
            if (pageToken && (!stored || stored.authToken !== pageToken)) {
              console.log('[content] Found page token during bootstrap, copying into extension storage')
              chrome.storage.local.set({ authToken: pageToken });
            }
          } catch (storageError) {
            console.warn('Failed to read page token during bootstrap', storageError);
          }
        }
      });
    } catch (error) {
      console.warn('Failed to bootstrap auth state', error);
    }
  }
})();
