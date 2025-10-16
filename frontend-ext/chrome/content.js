// content.js
// -----------------------------------------------------------------------------
// ChatterPals Content Script
// - 페이지에 플로팅 버튼(FAB) 주입 (드래그로 위치 이동 & 위치 저장)
// - 사이드바(iframe) 열기/닫기
// - popup → background → content 메시지 처리
// - 페이지/선택 텍스트 추출
// -----------------------------------------------------------------------------

(() => {
  const SIDEBAR_IFRAME_ID = 'chatterpals-sidebar-iframe';
  const FAB_ID = 'chatterpals-fab';
  const SIDEBAR_URL = chrome.runtime.getURL('popup.html?context=sidebar');
  const AUTH_MESSAGE_TYPE = 'AUTH_UPDATE';
  const AUTH_SOURCE_WEB = 'chatter-web';
  const AUTH_SOURCE_EXTENSION = 'chatter-extension';
  const HINT_API_BASE = 'http://127.0.0.1:8000/api';
  const HINT_ENDPOINT = `${HINT_API_BASE}/hints`;
  const ANSWER_ENDPOINT = `${HINT_API_BASE}/check-answer`;

  let sidebarIframe = null;
  let fabEl = null;

  const TEASE_LINES = ['Need a nudge?', 'Want some help?'];
  const QUESTION_LINES = ['Fill the blank in English!', 'Try guessing first!'];

  const HINT_ACTIONS = [
    { level: 'starter', label: '영어 힌트' },
    { level: 'translation', label: '한글 문장 보기' },
  ];

  const SKIP_ANCESTOR_SELECTOR =
    'script, style, noscript, code, pre, textarea, input, select, button, option, svg, math, head, iframe, canvas, video, audio, picture';
  const MAX_TEXT_NODE_SCAN = 1200;
  const MIN_SENTENCE_LENGTH = 32;

  let contentMutationObserver = null;
  let autoHintRescanTimer = null;

  const overlayState = {
    visible: false,
    mode: 'tease',
    reason: 'auto',
    contextText: '',
    fullSentence: '',
    maskedSentence: '',
    maskText: '',
    usageCount: 0,
    loadingLevel: null,
    hintPreview: '',
    playfulRemark: '',
    lines: [...TEASE_LINES],
    anchorRect: null,
    anchorElement: null,
    anchorTextNode: null,
    anchorSignature: null,
    maskRect: null,
    maskStart: null,
    maskEnd: null,
    observers: {
      mutation: null,
      resize: null,
      intersection: null,
    },
    visibilityState: 'visible',
    answerText: '',
    answerFeedback: null,
    answerIsCorrect: null,
    answerScore: null,
    answerModelAnswer: null,
    isCheckingAnswer: false,
    locked: false,
  };

  const overlayElements = {
    cover: null,
    coverInner: null,
    coverPrompt: null,
    coverInput: null,
    helper: null,
    linesContainer: null,
    preview: null,
    previewWrapper: null,
    usage: null,
    actions: null,
    closeBtn: null,
    character: null,
    questionContainer: null,
    questionText: null,
    answerContainer: null,
    answerButton: null,
    answerHint: null,
    answerFeedback: null,
    answerScore: null,
    answerReference: null,
  };

  let overlayPositionRaf = null;

  bootstrapAuthState();

  function resolveAnchorElement(candidate) {
    if (!candidate) return null;
    if (candidate instanceof HTMLElement) return candidate;
    if (candidate instanceof Node && candidate.nodeType === Node.TEXT_NODE) {
      return candidate.parentElement;
    }
    return null;
  }

  function computeAnchorRect(element, fallbackRect = null) {
    const resolved = resolveAnchorElement(element);
    if (!resolved) {
      return fallbackRect;
    }

    const rects = resolved.getClientRects?.();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    let bestRect = null;

    if (rects && rects.length) {
      for (const rect of rects) {
        if (!rect || rect.width === 0 || rect.height === 0) continue;
        if (rect.right < 0 || rect.left > viewportWidth) continue;

        const fullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
        if (fullyVisible) {
          bestRect = rect;
          break;
        }

        if (!bestRect) {
          bestRect = rect;
          continue;
        }

        const currentDistance = Math.min(
          Math.abs(bestRect.top),
          Math.abs(bestRect.bottom - viewportHeight),
        );
        const candidateDistance = Math.min(
          Math.abs(rect.top),
          Math.abs(rect.bottom - viewportHeight),
        );
        if (candidateDistance < currentDistance) {
          bestRect = rect;
        }
      }
    }

    const targetRect = bestRect || resolved.getBoundingClientRect?.();
    if (!targetRect || (targetRect.width === 0 && targetRect.height === 0)) {
      return fallbackRect;
    }

    return {
      top: targetRect.top + window.scrollY,
      left: targetRect.left + window.scrollX,
      width: targetRect.width,
      height: targetRect.height,
    };
  }

  function shouldSkipElement(element) {
    if (!element) return true;
    if (!(element instanceof HTMLElement)) return true;
    if (element.closest(SKIP_ANCESTOR_SELECTOR)) return true;
    if (element.closest('#chatterpals-hint-helper')) return true;
    if (element.closest('.chatterpals-hint-helper')) return true;
    if (element.closest('.chatterpals-hint-cover')) return true;
    if (element.dataset && element.dataset.chatterIgnore === 'true') return true;
    if (element.closest('[contenteditable="true"]')) return true;
    if (element.hasAttribute('contenteditable')) return true;
    return false;
  }

  function measureTextNodeRect(node) {
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      let chosen = null;
      const rects = range.getClientRects();
      if (rects && rects.length) {
        for (const rect of rects) {
          if (!rect) continue;
          if (rect.width === 0 && rect.height === 0) continue;
          if (!chosen || rect.width * rect.height > chosen.width * chosen.height) {
            chosen = rect;
          }
        }
      }
      let rect = chosen || range.getBoundingClientRect();
      range.detach?.();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        return null;
      }
      return {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      };
    } catch {
      return null;
    }
  }

  function measureSubstringRect(node, startOffset, endOffset) {
    if (!node) return null;
    const length = node.textContent?.length ?? 0;
    if (length === 0) return null;
    const safeStart = Math.max(0, Math.min(length, startOffset));
    const safeEnd = Math.max(safeStart + 1, Math.min(length, endOffset));
    try {
      const range = document.createRange();
      range.setStart(node, safeStart);
      range.setEnd(node, safeEnd);
      const rects = range.getClientRects();
      let targetRect = null;
      if (rects && rects.length) {
        let minLeft = Number.POSITIVE_INFINITY;
        let minTop = Number.POSITIVE_INFINITY;
        let maxRight = Number.NEGATIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        rects.forEach((rect) => {
          if (!rect || (rect.width === 0 && rect.height === 0)) return;
          minLeft = Math.min(minLeft, rect.left);
          minTop = Math.min(minTop, rect.top);
          maxRight = Math.max(maxRight, rect.right);
          maxBottom = Math.max(maxBottom, rect.bottom);
        });
        if (Number.isFinite(minLeft) && Number.isFinite(minTop)) {
          targetRect = {
            left: minLeft,
            top: minTop,
            width: Math.max(1, maxRight - minLeft),
            height: Math.max(1, maxBottom - minTop),
          };
        }
      }
      if (!targetRect) {
        const fallback = range.getBoundingClientRect();
        if (fallback && !(fallback.width === 0 && fallback.height === 0)) {
          targetRect = {
            left: fallback.left,
            top: fallback.top,
            width: Math.max(1, fallback.width),
            height: Math.max(1, fallback.height),
          };
        }
      }
      range.detach?.();
      if (!targetRect) return null;
      return {
        top: targetRect.top + window.scrollY,
        left: targetRect.left + window.scrollX,
        width: targetRect.width,
        height: targetRect.height,
      };
    } catch {
      return null;
    }
  }

  function buildMaskInfo(node, rawText, fallbackRect) {
    const length = rawText.length;
    if (!length) return null;

    const leadingMatch = rawText.match(/^\s*/);
    const trailingMatch = rawText.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0].length : 0;
    const trailing = trailingMatch ? trailingMatch[0].length : 0;
    const coreStart = leading;
    const coreEnd = Math.max(coreStart + 1, length - trailing);
    const coreText = rawText.slice(coreStart, coreEnd);
    const coreLength = coreText.length;
    if (coreLength < 6) return null;

    let maskLength;
    if (coreLength <= 18) {
      maskLength = Math.max(3, Math.floor(coreLength * 0.35));
    } else if (coreLength <= 40) {
      maskLength = Math.max(5, Math.floor(coreLength * 0.32));
    } else if (coreLength <= 80) {
      maskLength = Math.max(7, Math.floor(coreLength * 0.28));
    } else {
      maskLength = Math.max(9, Math.floor(coreLength * 0.24));
    }
    maskLength = Math.min(maskLength, coreLength - 2);

    let maskStartInCore = Math.max(0, Math.floor((coreLength - maskLength) / 2));
    let maskEndInCore = maskStartInCore + maskLength;

    const adjustLeft = coreText.lastIndexOf(' ', maskStartInCore);
    if (adjustLeft !== -1 && maskStartInCore - adjustLeft <= 6) {
      maskStartInCore = adjustLeft + 1;
    }

    const adjustRight = coreText.indexOf(' ', maskEndInCore);
    if (adjustRight !== -1 && adjustRight - maskEndInCore <= 6) {
      maskEndInCore = adjustRight;
    }

    if (maskEndInCore - maskStartInCore < 3) {
      maskEndInCore = Math.min(coreLength, maskStartInCore + Math.max(3, Math.floor(coreLength * 0.25)));
    }

    const maskStart = coreStart + maskStartInCore;
    const maskEnd = coreStart + maskEndInCore;
    if (maskEnd <= maskStart) return null;

    const maskRect = measureSubstringRect(node, maskStart, maskEnd) || fallbackRect;
    if (!maskRect) return null;

    const maskTextRaw = rawText.slice(maskStart, maskEnd);
    const maskText = maskTextRaw.trim();
    if (!normalizeText(maskText)) return null;

    const maskedSentenceCore =
      coreText.slice(0, maskStartInCore) + ' _____ ' + coreText.slice(maskEndInCore);
    const fullSentence = rawText.trim();
    const maskedSentence = maskedSentenceCore.trim();

    return {
      maskRect,
      maskText,
      maskedSentence,
      fullSentence,
      maskStart,
      maskEnd,
    };
  }

  function resolveAnchorTextNode() {
    if (
      overlayState.anchorTextNode &&
      document.contains(overlayState.anchorTextNode) &&
      overlayState.anchorTextNode.textContent
    ) {
      return overlayState.anchorTextNode;
    }

    if (!overlayState.anchorElement) return null;
    const target = normalizeText(overlayState.maskText);
    const walker = document.createTreeWalker(
      overlayState.anchorElement,
      NodeFilter.SHOW_TEXT,
      null,
    );
    while (walker.nextNode()) {
      const current = walker.currentNode;
      const text = normalizeText(current.textContent || '');
      if (!text) continue;
      if (!target || text.includes(target)) {
        overlayState.anchorTextNode = current;
        return current;
      }
    }
    return null;
  }

  function refreshMaskRect() {
    const textNode = resolveAnchorTextNode();
    if (!textNode) {
      overlayState.maskRect = overlayState.anchorRect;
      return;
    }

    let rect = null;
    if (
      typeof overlayState.maskStart === 'number' &&
      typeof overlayState.maskEnd === 'number' &&
      overlayState.maskEnd > overlayState.maskStart
    ) {
      rect = measureSubstringRect(textNode, overlayState.maskStart, overlayState.maskEnd);
    }

    if (!rect && overlayState.maskText) {
      const raw = textNode.textContent || '';
      const index = raw.indexOf(overlayState.maskText);
      if (index !== -1) {
        overlayState.maskStart = index;
        overlayState.maskEnd = index + overlayState.maskText.length;
        rect = measureSubstringRect(textNode, overlayState.maskStart, overlayState.maskEnd);
      }
    }

    if (!rect) {
      rect = measureTextNodeRect(textNode);
    }

    overlayState.maskRect = rect || overlayState.anchorRect;
  }

  function analyzeTextNode(node) {
    if (!node || !node.parentElement) return null;
    const element = resolveAnchorElement(node);
    if (!element || shouldSkipElement(element)) return null;
    const helper = overlayElements.helper;
    const cover = overlayElements.cover;
    if (helper && helper.contains(element)) return null;
    if (cover && cover.contains(element)) return null;

  const rawText = node.textContent || '';
  const normalized = normalizeText(rawText);
  if (!normalized || normalized.length < MIN_SENTENCE_LENGTH) return null;

  const rect = measureTextNodeRect(node);
  if (!rect) return null;

  const maskInfo = buildMaskInfo(node, rawText, rect);
  if (!maskInfo) return null;

  return {
    element,
    rect,
    contextText: maskInfo.fullSentence,
    rawText,
    node,
    maskRect: maskInfo.maskRect,
    maskText: maskInfo.maskText,
    maskedSentence: maskInfo.maskedSentence,
    fullSentence: maskInfo.fullSentence,
    maskStart: maskInfo.maskStart,
    maskEnd: maskInfo.maskEnd,
  };
}

  function scheduleAutoHintRescan(delay = 400) {
    if (!contentMutationObserver && document.body) {
      startContentObserver();
    }
    if (autoHintRescanTimer !== null) {
      window.clearTimeout(autoHintRescanTimer);
    }
    autoHintRescanTimer = window.setTimeout(() => {
      autoHintRescanTimer = null;
      if (!overlayState.visible) {
        runAutoHintWithRetry(0);
      }
    }, delay);
  }

  function startContentObserver() {
    if (contentMutationObserver || !document.body) return;
    contentMutationObserver = new MutationObserver((mutations) => {
      if (overlayState.visible) return;
      const helper = overlayElements.helper;
      const cover = overlayElements.cover;

      for (const mutation of mutations) {
        const target = mutation.target;
        if (helper && (helper === target || helper.contains(target))) continue;
        if (cover && (cover === target || cover.contains(target))) continue;

        if (mutation.type === 'characterData') {
          const snippet = (target.textContent || '').slice(0, 320);
          if (normalizeText(snippet).length >= MIN_SENTENCE_LENGTH) {
            scheduleAutoHintRescan();
            return;
          }
        }

        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              const snippet = (node.textContent || '').slice(0, 320);
              if (normalizeText(snippet).length >= MIN_SENTENCE_LENGTH) {
                scheduleAutoHintRescan();
                return;
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              if (shouldSkipElement(element)) continue;
              const snippet = (element.textContent || '').slice(0, 320);
              if (normalizeText(snippet).length >= MIN_SENTENCE_LENGTH) {
                scheduleAutoHintRescan();
                return;
              }
            }
          }
        }
      }
    });

    contentMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function createAnchorSignature(element) {
    const resolved = resolveAnchorElement(element);
    if (!resolved) return null;

    const existingId = resolved.getAttribute('data-chatter-anchor-id');
    const signatureId =
      existingId ||
      `chatter-anchor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!existingId) {
      resolved.setAttribute('data-chatter-anchor-id', signatureId);
    }

    return {
      id: signatureId,
      tag: resolved.tagName,
      text: normalizeText(resolved.textContent || '').slice(0, 160),
    };
  }

function cleanupAnchorSignature() {
    if (overlayState.anchorElement) {
      overlayState.anchorElement.removeAttribute('data-chatter-anchor-id');
    }
    overlayState.anchorSignature = null;
    overlayState.anchorElement = null;
    overlayState.anchorTextNode = null;
    overlayState.maskRect = null;
    overlayState.maskStart = null;
    overlayState.maskEnd = null;
  }

  function cleanupAnchorObservers() {
    if (overlayState.observers.mutation) {
      overlayState.observers.mutation.disconnect();
      overlayState.observers.mutation = null;
    }
    if (overlayState.observers.resize) {
      overlayState.observers.resize.disconnect();
      overlayState.observers.resize = null;
    }
    if (overlayState.observers.intersection) {
      overlayState.observers.intersection.disconnect();
      overlayState.observers.intersection = null;
    }
  }

  function containsHangul(text) {
    return /[\u3131-\uD79D]/.test(text || '');
  }

  function reAnchorUsingSignature() {
    const signature = overlayState.anchorSignature;
    if (!signature) {
      return false;
    }

    if (signature.id) {
      const byId = document.querySelector(`[data-chatter-anchor-id="${signature.id}"]`);
      if (byId) {
        overlayState.anchorElement = byId;
        overlayState.anchorRect = computeAnchorRect(byId, overlayState.anchorRect);
        overlayState.anchorSignature = {
          ...signature,
          text: normalizeText(byId.textContent || '').slice(0, 160),
          tag: byId.tagName,
        };
        refreshMaskRect();
        setupAnchorObservers(byId);
        return true;
      }
    }

    if (!signature.text) {
      return false;
    }

    const normalizedTarget = normalizeText(signature.text);
    if (!normalizedTarget) {
      return false;
    }

    const tag = signature.tag ? signature.tag.toLowerCase() : '*';
    const candidates = Array.from(document.querySelectorAll(tag));
    const match = candidates.find((el) => normalizeText(el.textContent || '').includes(normalizedTarget));
    if (match) {
      match.setAttribute('data-chatter-anchor-id', signature.id);
      overlayState.anchorElement = match;
      overlayState.anchorRect = computeAnchorRect(match, overlayState.anchorRect);
      overlayState.anchorSignature = {
        ...signature,
        text: normalizeText(match.textContent || '').slice(0, 160),
        tag: match.tagName,
      };
      refreshMaskRect();
      setupAnchorObservers(match);
      return true;
    }

    return false;
  }

  function setupAnchorObservers(element) {
    cleanupAnchorObservers();
    if (!(element instanceof HTMLElement)) return;

    const mutation = new MutationObserver((mutations) => {
      const helper = overlayElements.helper;
      const cover = overlayElements.cover;
      const shouldIgnore = mutations.every((mutationRecord) => {
        const target = mutationRecord.target;
        if (!target) return false;
        if (helper && (helper === target || helper.contains(target))) return true;
        if (cover && (cover === target || cover.contains(target))) return true;
        return false;
      });
      if (shouldIgnore) return;

      if (!overlayState.anchorElement || !document.contains(overlayState.anchorElement)) {
        if (!reAnchorUsingSignature()) {
          hideHintOverlay();
          scheduleAutoHintRescan(300);
        }
        return;
      }

      overlayState.anchorRect = computeAnchorRect(
        overlayState.anchorElement,
        overlayState.anchorRect,
      );
      if (overlayState.anchorSignature && overlayState.anchorElement) {
        overlayState.anchorSignature.text = normalizeText(
          overlayState.anchorElement.textContent || '',
        ).slice(0, 160);
        overlayState.anchorSignature.tag = overlayState.anchorElement.tagName;
      }
      refreshMaskRect();
      updateOverlayPosition();
    });
    if (document.body) {
      mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
      overlayState.observers.mutation = mutation;
    }

    try {
      const resize = new ResizeObserver(() => {
        if (!overlayState.anchorElement) return;
        overlayState.anchorRect = computeAnchorRect(
          overlayState.anchorElement,
          overlayState.anchorRect,
        );
        if (overlayState.anchorSignature && overlayState.anchorElement) {
          overlayState.anchorSignature.text = normalizeText(
            overlayState.anchorElement.textContent || '',
          ).slice(0, 160);
          overlayState.anchorSignature.tag = overlayState.anchorElement.tagName;
        }
        refreshMaskRect();
        updateOverlayPosition();
      });
      resize.observe(element);
      overlayState.observers.resize = resize;
    } catch {
      overlayState.observers.resize = null;
    }

    const intersection = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      overlayState.visibilityState = entry.isIntersecting ? 'visible' : 'out-of-view';
      overlayState.anchorRect = computeAnchorRect(element, overlayState.anchorRect);
      if (overlayState.anchorSignature && element) {
        overlayState.anchorSignature.text = normalizeText(element.textContent || '').slice(0, 160);
        overlayState.anchorSignature.tag = element.tagName;
      }
      refreshMaskRect();
      if (entry.isIntersecting) {
        updateOverlayPosition();
      }
    });
    intersection.observe(element);
    overlayState.observers.intersection = intersection;
  }

  function ensureOverlayElements() {
    if (!overlayElements.cover) {
      const cover = document.createElement('div');
      cover.id = 'chatterpals-hint-cover';
      cover.className = 'chatterpals-hint-cover';
      cover.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      const coverInner = document.createElement('div');
      coverInner.className = 'chatterpals-cover-inner';

      const coverPrompt = document.createElement('div');
      coverPrompt.className = 'chatterpals-cover-prompt';
      coverInner.appendChild(coverPrompt);

      const coverInput = document.createElement('textarea');
      coverInput.className = 'chatterpals-cover-input';
      coverInput.placeholder = 'Type your answer in English';
      coverInput.rows = 2;
      coverInput.addEventListener('input', () => {
        overlayState.answerText = coverInput.value;
        overlayState.answerFeedback = null;
        overlayState.answerIsCorrect = null;
        overlayState.answerScore = null;
        overlayState.answerModelAnswer = null;
        renderOverlayContent();
      });
      coverInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void gradeCurrentAnswer();
        }
      });
      coverInner.appendChild(coverInput);

      cover.appendChild(coverInner);

      overlayElements.cover = cover;
      overlayElements.coverInner = coverInner;
      overlayElements.coverPrompt = coverPrompt;
      overlayElements.coverInput = coverInput;
    }

    if (!overlayElements.helper) {
      const helper = document.createElement('div');
      helper.id = 'chatterpals-hint-helper';
      helper.className = 'chatterpals-hint-helper';

      const character = document.createElement('div');
      character.className = 'chatterpals-hint-character';
      character.textContent = '😜';

      const bubble = document.createElement('div');
      bubble.className = 'chatterpals-hint-bubble';
      bubble.setAttribute('role', 'dialog');
      bubble.setAttribute('aria-live', 'polite');

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'chatterpals-hint-close';
      closeBtn.setAttribute('aria-label', 'Close hint');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => {
        hideHintOverlay();
      });

      const questionContainer = document.createElement('div');
      questionContainer.className = 'chatterpals-question hidden';
      const questionLabel = document.createElement('span');
      questionLabel.className = 'chatterpals-question-label';
      questionLabel.textContent = 'Sentence with blank';
      const questionText = document.createElement('p');
      questionText.className = 'chatterpals-question-text';
      questionContainer.appendChild(questionLabel);
      questionContainer.appendChild(questionText);

      const linesContainer = document.createElement('div');
      linesContainer.className = 'chatterpals-hint-lines';

      const previewWrapper = document.createElement('div');
      previewWrapper.className = 'chatterpals-hint-preview hidden';
      const preview = document.createElement('pre');
      previewWrapper.appendChild(preview);

      const usage = document.createElement('p');
      usage.className = 'chatterpals-hint-usage hidden';

      const actions = document.createElement('div');
      actions.className = 'chatterpals-hint-actions';

      HINT_ACTIONS.forEach((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.level = action.level;
        btn.textContent = action.label;
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          requestHintForLevel(action.level);
        });
        actions.appendChild(btn);
      });

      const answerContainer = document.createElement('div');
      answerContainer.className = 'chatterpals-answer hidden';

      const answerControls = document.createElement('div');
      answerControls.className = 'chatterpals-answer-controls';

      const answerHint = document.createElement('span');
      answerHint.className = 'chatterpals-answer-hint';
      answerHint.textContent = 'Type your answer in English here';

      const answerButton = document.createElement('button');
      answerButton.type = 'button';
      answerButton.className = 'chatterpals-answer-submit';
      answerButton.textContent = 'Check Answer';
      answerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void gradeCurrentAnswer();
      });

      answerControls.appendChild(answerHint);
      answerControls.appendChild(answerButton);

      const answerFeedback = document.createElement('p');
      answerFeedback.className = 'chatterpals-answer-feedback hidden';

      const answerScore = document.createElement('p');
      answerScore.className = 'chatterpals-answer-score hidden';

      const answerReference = document.createElement('p');
      answerReference.className = 'chatterpals-answer-reference hidden';

      answerContainer.appendChild(answerControls);
      answerContainer.appendChild(answerFeedback);
      answerContainer.appendChild(answerScore);
      answerContainer.appendChild(answerReference);

      bubble.appendChild(closeBtn);
      bubble.appendChild(questionContainer);
      bubble.appendChild(linesContainer);
      bubble.appendChild(previewWrapper);
      bubble.appendChild(usage);
      bubble.appendChild(actions);
      bubble.appendChild(answerContainer);

      helper.appendChild(character);
      helper.appendChild(bubble);

      helper.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      helper.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      helper.addEventListener('mouseenter', () => {
        overlayState.locked = true;
      });
      helper.addEventListener('mouseleave', () => {
        overlayState.locked = false;
      });

      overlayElements.helper = helper;
      overlayElements.character = character;
      overlayElements.linesContainer = linesContainer;
      overlayElements.previewWrapper = previewWrapper;
      overlayElements.preview = preview;
      overlayElements.usage = usage;
      overlayElements.actions = actions;
      overlayElements.closeBtn = closeBtn;
      overlayElements.questionContainer = questionContainer;
      overlayElements.questionText = questionText;
      overlayElements.answerContainer = answerContainer;
      overlayElements.answerButton = answerButton;
      overlayElements.answerHint = answerHint;
      overlayElements.answerFeedback = answerFeedback;
      overlayElements.answerScore = answerScore;
      overlayElements.answerReference = answerReference;
    }
  }

  function removeOverlayElements() {
    if (overlayElements.cover?.parentNode) {
      overlayElements.cover.parentNode.removeChild(overlayElements.cover);
    }
    if (overlayElements.helper?.parentNode) {
      overlayElements.helper.parentNode.removeChild(overlayElements.helper);
    }
  }

  function renderOverlayContent() {
    if (!overlayState.visible) return;
    ensureOverlayElements();

    const helper = overlayElements.helper;
    if (!helper) return;

    helper.classList.toggle('mode-question', overlayState.mode === 'question');
    helper.classList.toggle('mode-tease', overlayState.mode !== 'question');
    if (overlayElements.character) {
      overlayElements.character.textContent = overlayState.mode === 'question' ? '🤔' : '😜';
    }

    if (overlayElements.linesContainer) {
      overlayElements.linesContainer.innerHTML = '';
      const lines = overlayState.playfulRemark
        ? [overlayState.playfulRemark]
        : overlayState.lines;
      lines.forEach((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        overlayElements.linesContainer.appendChild(p);
      });
    }

    if (overlayElements.previewWrapper && overlayElements.preview) {
      if (overlayState.hintPreview) {
        overlayElements.previewWrapper.classList.remove('hidden');
        overlayElements.preview.textContent = overlayState.hintPreview;
      } else {
        overlayElements.previewWrapper.classList.add('hidden');
        overlayElements.preview.textContent = '';
      }
    }

    if (overlayElements.usage) {
      if (overlayState.usageCount > 0) {
        overlayElements.usage.classList.remove('hidden');
        overlayElements.usage.textContent = `Hints used: ${overlayState.usageCount}`;
      } else {
        overlayElements.usage.classList.add('hidden');
        overlayElements.usage.textContent = '';
      }
    }

    if (overlayElements.actions) {
      const buttons = overlayElements.actions.querySelectorAll('button');
      buttons.forEach((btn) => {
        const level = btn.dataset.level;
        if (level && overlayState.loadingLevel === level) {
          btn.disabled = true;
          btn.textContent = '…';
        } else {
          btn.disabled = !!overlayState.loadingLevel;
          const action = HINT_ACTIONS.find((item) => item.level === level);
          btn.textContent = action ? action.label : btn.textContent;
        }
      });
    }

    if (overlayElements.coverPrompt) {
      const promptVisible = overlayState.mode === 'question';
      overlayElements.coverPrompt.classList.toggle('hidden', !promptVisible);
      if (promptVisible) {
        const maskInfo = overlayState.maskText
          ? ` (hidden ${overlayState.maskText.length} chars)`
          : '';
        const promptSuffix = maskInfo ? ` ${maskInfo}` : '';
        overlayElements.coverPrompt.textContent = `Type your answer in English${promptSuffix} (Ctrl+Enter to submit)`.trim();
      } else {
        overlayElements.coverPrompt.textContent = '';
      }
    }

    if (overlayElements.coverInput) {
      const inputVisible = overlayState.mode === 'question';
      overlayElements.coverInput.classList.toggle('hidden', !inputVisible);
      if (inputVisible) {
        if (overlayElements.coverInput.value !== overlayState.answerText) {
          const { selectionStart, selectionEnd } = overlayElements.coverInput;
          overlayElements.coverInput.value = overlayState.answerText;
          if (document.activeElement === overlayElements.coverInput) {
            overlayElements.coverInput.setSelectionRange(selectionStart, selectionEnd);
          }
        }
        overlayElements.coverInput.disabled = overlayState.isCheckingAnswer;
      } else {
        overlayElements.coverInput.value = '';
      }
    }

    if (overlayElements.questionContainer && overlayElements.questionText) {
      let questionText = '';
      const sentence =
        overlayState.maskedSentence || overlayState.fullSentence || overlayState.contextText;
      if (containsHangul(sentence)) {
        const lengthInfo = overlayState.maskText ? `Hidden Korean expression length: ${overlayState.maskText.length}` : 'Hidden Korean expression';
        questionText = `${lengthInfo}. Translate it into natural English.`;
      } else if (sentence) {
        questionText = sentence;
      }
      const hasQuestion = Boolean(questionText);
      overlayElements.questionContainer.classList.toggle('hidden', !hasQuestion);
      overlayElements.questionText.textContent = hasQuestion ? questionText : '';
    }

    if (overlayElements.answerContainer) {
      const showAnswer = overlayState.mode === 'question';
      overlayElements.answerContainer.classList.toggle('hidden', !showAnswer);
      if (showAnswer) {
        if (overlayElements.answerButton) {
          overlayElements.answerButton.disabled =
            overlayState.isCheckingAnswer || !overlayState.answerText.trim();
          overlayElements.answerButton.textContent = overlayState.isCheckingAnswer
            ? 'Checking...'
            : 'Check Answer';
        }
        if (overlayElements.answerHint) {
          const lengthInfo = overlayState.maskText ? ` (hidden ${overlayState.maskText.length} chars)` : '';
          overlayElements.answerHint.textContent = overlayState.isCheckingAnswer
            ? 'Checking...'
            : `Answer in English${lengthInfo}`;
          overlayElements.answerHint.classList.toggle('hidden', overlayState.isCheckingAnswer);
        }
        if (overlayElements.answerFeedback) {
          if (overlayState.answerFeedback) {
            overlayElements.answerFeedback.textContent = overlayState.answerFeedback;
            overlayElements.answerFeedback.classList.remove('hidden');
            overlayElements.answerFeedback.classList.toggle(
              'is-correct',
              overlayState.answerIsCorrect === true,
            );
            overlayElements.answerFeedback.classList.toggle(
              'is-incorrect',
              overlayState.answerIsCorrect === false,
            );
          } else {
            overlayElements.answerFeedback.textContent = '';
            overlayElements.answerFeedback.classList.add('hidden');
            overlayElements.answerFeedback.classList.remove('is-correct', 'is-incorrect');
          }
        }
        if (overlayElements.answerScore) {
          if (typeof overlayState.answerScore === 'number') {
            const percent = Math.round(overlayState.answerScore * 100);
            overlayElements.answerScore.textContent = `Score: ${percent}%`;
            overlayElements.answerScore.classList.remove('hidden');
          } else {
            overlayElements.answerScore.textContent = '';
            overlayElements.answerScore.classList.add('hidden');
          }
        }
        if (overlayElements.answerReference) {
          if (overlayState.answerModelAnswer) {
            overlayElements.answerReference.textContent = `Model answer: ${overlayState.answerModelAnswer}`;
            overlayElements.answerReference.classList.remove('hidden');
          } else {
            overlayElements.answerReference.textContent = '';
            overlayElements.answerReference.classList.add('hidden');
          }
        }
      }
    }
  }

  async function gradeCurrentAnswer() {
    if (overlayState.mode !== 'question') return;
    if (overlayState.isCheckingAnswer) return;

    const answer = overlayState.answerText.trim();
    if (!answer) {
      overlayState.answerFeedback = 'Please enter your answer in English first.';
      overlayState.answerIsCorrect = null;
      overlayState.answerScore = null;
      overlayState.answerModelAnswer = null;
      renderOverlayContent();
      return;
    }

    overlayState.isCheckingAnswer = true;
    overlayState.answerFeedback = null;
    overlayState.answerIsCorrect = null;
    overlayState.answerScore = null;
    overlayState.answerModelAnswer = null;
    renderOverlayContent();

    try {
      const fullSentence = overlayState.fullSentence || overlayState.contextText || '';
      const maskedSentence = overlayState.maskedSentence || overlayState.contextText || '';
      const hiddenAnswer = overlayState.maskText || '';
      const response = await fetch(ANSWER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: containsHangul(fullSentence)
            ? `Translate the following Korean sentence into natural English and fill the blank in English:\n${maskedSentence || '___'}`
            : `Fill in the blank with the correct English expression:\n${maskedSentence || fullSentence}`,
          user_answer: answer,
          context: `Original Korean sentence: ${fullSentence}\nHidden answer: ${hiddenAnswer}`.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Answer check failed: ${response.status}`);
      }

      const data = await response.json();
      overlayState.answerIsCorrect = Boolean(data.is_correct);
      overlayState.answerFeedback =
        (typeof data.feedback === 'string' && data.feedback.trim()) ||
        (overlayState.answerIsCorrect ? 'Great job!' : 'Keep trying in English.');
      overlayState.answerScore =
        typeof data.score === 'number' ? Math.max(0, Math.min(1, data.score)) : null;
      overlayState.answerModelAnswer = (() => {
        let raw = data.model_answer;
        if (typeof raw !== 'string') return null;
        raw = raw.trim();
        if (!raw) return null;
        if (containsHangul(raw) && hiddenExpression) {
          return `Expected in English: ${hiddenExpression}`;
        }
        return raw;
      })();

      if (overlayState.answerIsCorrect) {
        overlayState.playfulRemark = null;
        overlayState.lines = ['Correct! Great job!', 'Ready for the next one?'];
      } else {
        overlayState.lines = ['Not quite yet.', 'Maybe try a hint or rephrase in English.'];
      }
    } catch (error) {
      console.warn('Answer check failed:', error);
      overlayState.answerFeedback = 'Something went wrong while checking. Please try again soon.';
      overlayState.answerIsCorrect = null;
      overlayState.answerScore = null;
      overlayState.answerModelAnswer = null;
    } finally {
      overlayState.isCheckingAnswer = false;
      renderOverlayContent();
    }
  }

  function applyOverlayPosition() {
    if (!overlayState.visible) return;

    if (overlayState.anchorElement && !document.contains(overlayState.anchorElement)) {
      hideHintOverlay();
      return;
    }

    if (overlayState.anchorElement) {
      overlayState.anchorRect = computeAnchorRect(
        overlayState.anchorElement,
        overlayState.anchorRect,
      );
      refreshMaskRect();
    }

    const targetRect = overlayState.maskRect || overlayState.anchorRect;
    if (!targetRect) return;

    ensureOverlayElements();
    const { cover, helper } = overlayElements;
    if (!cover || !helper) return;

    const viewportLeft = targetRect.left - window.scrollX;
    const viewportTop = targetRect.top - window.scrollY;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const anchorWidth = Math.max(targetRect.width || 1, 1);
    const anchorHeight = Math.max(targetRect.height || 1, 1);
    const paddingX = 6;
    const paddingY = 4;

    let highlightLeft = viewportLeft - paddingX;
    let highlightTop = viewportTop - paddingY;
    let highlightWidth = anchorWidth + paddingX * 2;
    let highlightHeight = anchorHeight + paddingY * 2;

    if (highlightLeft < 8) {
      highlightWidth -= 8 - highlightLeft;
      highlightLeft = 8;
    }
    if (highlightTop < 8) {
      highlightHeight -= 8 - highlightTop;
      highlightTop = 8;
    }
    if (highlightLeft + highlightWidth > viewportWidth - 8) {
      highlightWidth = Math.max(16, viewportWidth - 8 - highlightLeft);
    }
    if (highlightTop + highlightHeight > viewportHeight - 8) {
      highlightHeight = Math.max(16, viewportHeight - 8 - highlightTop);
    }

    cover.style.left = `${highlightLeft}px`;
    cover.style.top = `${highlightTop}px`;
    cover.style.width = `${highlightWidth}px`;
    cover.style.height = `${highlightHeight}px`;

    const helperCenterX = highlightLeft + highlightWidth / 2;
    const helperOffsetAbove = highlightTop - 16;
    let helperTop = helperOffsetAbove;
    let helperPosition = 'above';
    if (helperTop < 16) {
      helperTop = highlightTop + highlightHeight + 16;
      helperPosition = 'below';
    }

    helper.style.left = `${helperCenterX}px`;
    helper.style.top = `${helperTop}px`;
    helper.dataset.position = helperPosition;
  }

  function updateOverlayPosition() {
    if (overlayPositionRaf !== null) return;
    overlayPositionRaf = window.requestAnimationFrame(() => {
      overlayPositionRaf = null;
      applyOverlayPosition();
    });
  }

  function showHintOverlay(rectDoc, mode = 'tease', reason = 'selection', anchorElement = null) {
    overlayState.visible = true;
    overlayState.mode = mode;
    overlayState.reason = reason;
    overlayState.lines = mode === 'question' ? [...QUESTION_LINES] : [...TEASE_LINES];
    overlayState.playfulRemark = '';
    overlayState.loadingLevel = null;
    overlayState.hintPreview = '';
    overlayState.answerText = '';
    overlayState.answerFeedback = null;
    overlayState.answerIsCorrect = null;
    overlayState.answerScore = null;
    overlayState.answerModelAnswer = null;
    overlayState.isCheckingAnswer = false;
    const previousAnchor = overlayState.anchorElement;
    const resolvedAnchor = resolveAnchorElement(anchorElement);
    if (previousAnchor && previousAnchor !== resolvedAnchor) {
      previousAnchor.removeAttribute('data-chatter-anchor-id');
    }
    cleanupAnchorObservers();
    overlayState.anchorElement = resolvedAnchor;
    overlayState.anchorSignature = resolvedAnchor ? createAnchorSignature(resolvedAnchor) : null;
    overlayState.anchorRect = computeAnchorRect(resolvedAnchor, rectDoc);
    if (overlayState.anchorElement) {
      refreshMaskRect();
      setupAnchorObservers(overlayState.anchorElement);
    } else {
      cleanupAnchorObservers();
    }
    if (!overlayState.maskRect && overlayState.anchorRect) {
      overlayState.maskRect = overlayState.anchorRect;
    }

    ensureOverlayElements();

    if (overlayElements.cover && !overlayElements.cover.parentNode) {
      document.body.appendChild(overlayElements.cover);
    }
    if (overlayElements.helper && !overlayElements.helper.parentNode) {
      document.body.appendChild(overlayElements.helper);
    }

    updateOverlayPosition();
    renderOverlayContent();
    if (overlayState.mode === 'question') {
      window.setTimeout(() => {
        overlayElements.coverInput?.focus();
      }, 120);
    }
  }

  function hideHintOverlay() {
    overlayState.visible = false;
    overlayState.contextText = '';
    overlayState.fullSentence = '';
    overlayState.maskedSentence = '';
    overlayState.maskText = '';
    cleanupAnchorObservers();
    cleanupAnchorSignature();
    overlayState.answerText = '';
    overlayState.answerFeedback = null;
    overlayState.answerIsCorrect = null;
    overlayState.answerScore = null;
    overlayState.answerModelAnswer = null;
    overlayState.isCheckingAnswer = false;
    if (overlayPositionRaf !== null) {
      window.cancelAnimationFrame(overlayPositionRaf);
      overlayPositionRaf = null;
    }
    overlayState.anchorRect = null;
    overlayState.maskRect = null;
    overlayState.loadingLevel = null;
    overlayState.hintPreview = '';
    overlayState.playfulRemark = '';
    overlayState.usageCount = 0;
    removeOverlayElements();
  }

  function getSelectionInfo() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text || text.length < 5) return null;

    let range;
    try {
      range = selection.getRangeAt(0).cloneRange();
    } catch {
      return null;
    }

    if (range.collapsed) return null;

    const anchorElement = resolveAnchorElement(range.commonAncestorContainer);

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const rects = range.getClientRects();
      if (!rects || rects.length === 0) return null;
      const firstRect = rects[0];
      return {
        text,
        element: anchorElement,
        rect: {
          top: firstRect.top + window.scrollY,
          left: firstRect.left + window.scrollX,
          width: firstRect.width,
          height: firstRect.height,
        },
      };
    }

    return {
      text,
      element: anchorElement,
      rect: {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  function shouldUseQuestionMode(text) {
    if (!text) return false;
    const normalized = text.trim();
    const lengthScore = normalized.length >= 80;
    const questionMarks = (normalized.match(/\?/g) || []).length;
    const hasList = normalized.includes('\n') || normalized.includes('1.') || normalized.includes('•');
    return lengthScore || questionMarks > 0 || hasList;
  }

  async function requestHintForLevel(level) {
    const sentence = overlayState.fullSentence || overlayState.contextText || '';
    const maskedSentence = overlayState.maskedSentence || sentence;
    const hiddenExpression = overlayState.maskText || '';

    if (!sentence || overlayState.loadingLevel) return;

    if (level === 'translation') {
      overlayState.hintPreview = sentence;
      overlayState.playfulRemark = '원문 한국어 문장을 보여줄게요.';
      overlayState.lines = ['원문 한국어 문장을 보여줄게요.'];
      overlayState.usageCount += 1;
      renderOverlayContent();
      return sentence;
    }

    overlayState.loadingLevel = level;
    renderOverlayContent();

    const contextPayload = (() => {
      if (level === 'starter') {
        return `[Sentence]\n${sentence}\n\n[Masked Sentence]\n${maskedSentence}\n\n[Hidden Expression]\n${hiddenExpression || '(unknown)'}\n\nPlease give short English hints that guide the learner toward the hidden expression.`;
      }
      if (level === 'keywords') {
        return `문장: ${sentence}\n숨긴 표현: ${hiddenExpression || '(미상)'}\n위 표현을 떠올리는 데 도움이 되는 한국어 핵심 단어 3개를 제시해줘.`;
      }
      return sentence;
    })();

    try {
      const response = await fetch(HINT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: contextPayload,
          level,
          usage_count: overlayState.usageCount,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hint request failed: ${response.status}`);
      }

      const data = await response.json();
      overlayState.usageCount += 1;
      overlayState.hintPreview = formatHintPreview(data);

      if (data.playful_remark) {
        overlayState.playfulRemark = data.playful_remark;
        overlayState.lines = [data.playful_remark];
      } else if (overlayState.usageCount >= 3) {
        overlayState.playfulRemark = 'Try yourself first next time!';
        overlayState.lines = [overlayState.playfulRemark];
      } else {
        overlayState.playfulRemark = '';
        overlayState.lines = overlayState.mode === 'question' ? [...QUESTION_LINES] : [...TEASE_LINES];
      }
    } catch (error) {
      console.warn(error);
      overlayState.playfulRemark = '';
      overlayState.hintPreview = '';
      overlayState.lines = ['Could not fetch a hint.', 'Please try again shortly.'];
    } finally {
      overlayState.loadingLevel = null;
      renderOverlayContent();
    }
  }

  function formatHintPreview(data) {
    if (!data) return '';
    if (Array.isArray(data.keywords) && data.keywords.length) {
      return data.keywords.map((keyword) => `• ${keyword}`).join('\n');
    }
    return typeof data.hint_text === 'string' ? data.hint_text : '';
  }

  function showOverlayAtViewportCenter() {
    const width = Math.min(260, window.innerWidth - 40);
    const height = 60;
    const rect = {
      top: window.scrollY + window.innerHeight / 2 - height,
      left: window.scrollX + window.innerWidth / 2 - width / 2,
      width,
      height,
    };
    overlayState.contextText = overlayState.contextText || '';
    overlayState.usageCount = 0;
    showHintOverlay(rect, overlayState.mode, overlayState.reason, overlayState.anchorElement);
  }

  function extractPrimarySentence(text) {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const sentenceMatch = normalized.match(/[^.!?]{20,}[.!?](\s|$)/);
    if (sentenceMatch) {
      return sentenceMatch[0].trim();
    }
    return normalized.slice(0, 180).trim();
  }

  function findAutoHintTarget() {
    if (!document.body) return null;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
          const text = normalizeText(node.textContent || '');
          if (!text || text.length < 8) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let fallback = null;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0;
    let processed = 0;
    let node = walker.nextNode();
    while (node && processed < MAX_TEXT_NODE_SCAN) {
      processed += 1;
      const info = analyzeTextNode(node);
      if (info) {
        const viewportTop = info.rect.top - window.scrollY;
        const viewportBottom = viewportTop + info.rect.height;
        const inViewport = viewportBottom > 0 && viewportTop < viewportHeight;

        if (!fallback) {
          fallback = { ...info, needsScroll: !inViewport };
        }

        if (inViewport) {
          return { ...info, needsScroll: false };
        }
      }
      node = walker.nextNode();
    }

    return fallback;
  }

  function runAutoHintWithRetry(attempt = 0) {
    const info = findAutoHintTarget();
    if (info) {
      if (info.needsScroll && attempt < 3) {
        const targetTop = Math.max(0, info.rect.top - 120);
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
        window.setTimeout(() => runAutoHintWithRetry(attempt + 1), 650);
        return;
      }
      overlayState.contextText = info.fullSentence || info.contextText || '';
      overlayState.fullSentence = info.fullSentence || overlayState.contextText;
      overlayState.maskedSentence = info.maskedSentence || '';
      overlayState.maskText = info.maskText || '';
      overlayState.maskRect = info.maskRect || info.rect;
      overlayState.maskStart = typeof info.maskStart === 'number' ? info.maskStart : null;
      overlayState.maskEnd = typeof info.maskEnd === 'number' ? info.maskEnd : null;
      overlayState.anchorTextNode = info.node || null;
      overlayState.usageCount = 0;
      const mode = info.maskText
        ? 'question'
        : shouldUseQuestionMode(overlayState.fullSentence) ? 'question' : 'tease';
      showHintOverlay(info.rect, mode, 'auto', info.element ?? null);
      return;
    }
    if (attempt < 3) {
      window.setTimeout(() => runAutoHintWithRetry(attempt + 1), 500);
    }
  }

  function initializeAutoHint() {
    const invoke = () => {
      startContentObserver();
      window.setTimeout(() => runAutoHintWithRetry(0), 600);
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      invoke();
    } else {
      document.addEventListener('DOMContentLoaded', invoke, { once: true });
    }
  }

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape') {
      hideHintOverlay();
    }
  });

  window.addEventListener('scroll', () => {
    if (!overlayState.visible) return;
    requestAnimationFrame(() => {
      updateOverlayPosition();
    });
  }, true);

  window.addEventListener('resize', () => {
    if (!overlayState.visible) return;
    requestAnimationFrame(() => {
      updateOverlayPosition();
    });
  });

  initializeAutoHint();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const record = data;
    if (record.source === AUTH_SOURCE_WEB && record.type === AUTH_MESSAGE_TYPE) {
      const token = typeof record.token === 'string' ? record.token : null;
      const user = record.user ?? null;
      console.log('[content] Received auth update from web context', token)
      if (token) {
        chrome.storage.local.set({ authToken: token, authUser: user ?? null }, () => {
          console.log('[content] Saved auth token from web, broadcasting to extension tabs')
          chrome.runtime.sendMessage({
            action: 'broadcastAuthUpdate',
            token,
            user,
          });
        });
      } else {
        chrome.storage.local.remove(['authToken', 'authUser'], () => {
          console.log('[content] Cleared auth data from web, broadcasting logout')
          chrome.runtime.sendMessage({
            action: 'broadcastAuthUpdate',
            token: null,
            user: null,
          });
        });
      }
    }
  });

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
      if (typeof request.contextText === 'string' && request.contextText.trim()) {
        overlayState.contextText = request.contextText.trim();
      }

      let rectDoc = null;
      let anchorEl = null;
      if (request.anchor && typeof request.anchor === 'object') {
        const anchor = request.anchor;
        if (
          typeof anchor.top === 'number' &&
          typeof anchor.left === 'number'
        ) {
          rectDoc = {
            top: anchor.top,
            left: anchor.left,
            width: typeof anchor.width === 'number' ? anchor.width : 240,
            height: typeof anchor.height === 'number' ? anchor.height : 60,
          };
        }
        if (anchor.elementSelector && typeof anchor.elementSelector === 'string') {
          anchorEl = document.querySelector(anchor.elementSelector);
        }
      }

      const info = getSelectionInfo();
      if (info) {
        if (!overlayState.contextText) {
          overlayState.contextText = info.text;
        }
        rectDoc = rectDoc || info.rect;
        anchorEl = anchorEl || info.element || null;
        overlayState.fullSentence = info.fullSentence || info.contextText || overlayState.fullSentence || overlayState.contextText || '';
        overlayState.maskedSentence = info.maskedSentence || overlayState.maskedSentence || info.contextText || '';
        overlayState.maskText = info.maskText || overlayState.maskText || '';
        overlayState.maskStart = typeof info.maskStart === 'number' ? info.maskStart : overlayState.maskStart;
        overlayState.maskEnd = typeof info.maskEnd === 'number' ? info.maskEnd : overlayState.maskEnd;
        overlayState.maskRect = info.maskRect || overlayState.maskRect || rectDoc || info.rect || null;
        overlayState.anchorTextNode = info.node || overlayState.anchorTextNode;
      }

      if (rectDoc && !overlayState.maskRect) {
        overlayState.maskRect = rectDoc;
      }

      const mode = request.mode === 'question' || request.mode === 'tease'
        ? request.mode
        : overlayState.maskText
          ? 'question'
          : shouldUseQuestionMode(overlayState.fullSentence) ? 'question' : 'tease';

      const reason = request.reason || 'message';

      if (rectDoc) {
        showHintOverlay(rectDoc, mode, reason, anchorEl);
      } else if (info) {
        showHintOverlay(info.rect, mode, reason, info.element ?? null);
      } else {
        overlayState.mode = mode;
        overlayState.reason = reason;
        showOverlayAtViewportCenter();
      }

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
