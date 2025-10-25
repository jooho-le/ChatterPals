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
  const QUIZ_ENDPOINT = `${TEXT_API_BASE}/text/quiz/cloze`;
  const QUESTION_PROMPT = '하이라이트된 표현에 들어갈 영어 단어를 골라보세요.';

  let sidebarIframe = null;
  let fabEl = null;

  const TEASE_LINES = ['Need a nudge?', 'Want some help?'];
  const QUESTION_LINES = ['Fill the blank in English!', 'Try guessing first!'];

  const SKIP_ANCESTOR_SELECTOR =
    'script, style, noscript, code, pre, textarea, input, select, button, option, svg, math, head, iframe, canvas, video, audio, picture';
  const AD_LIKE_SELECTOR = [
    '*[id*="ad" i]', '*[class*="ad" i]', '*[class*="ads" i]', '*[class*="banner" i]', '*[class*="promo" i]',
    '*[class*="promotion" i]', '*[class*="sponsor" i]', 'aside', '[role="complementary"]', '[aria-label*="ad" i]'
  ].join(',');
  const ARTICLE_ROOT_SELECTORS = [
    'article', 'main', '#dic_area', '#newsEndContents', '#content-area',
    '[id*="content" i]', '[class*="content" i]', '[class*="article" i]', '[class*="story" i]', '[class*="post" i]'
  ];
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
    maskRawText: '',
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
    maskSpanEl: null, // <-- 마스크로 감싼 <span> 참조
    answerExpanded: false,
    positionLocked: false,
    quizData: null,
    quizSelection: null,
    quizFeedback: '',
  };

  const overlayElements = {
    cover: null,
    helper: null,
    statementSummary: null,
    statementSentence: null,
    hintPreview: null,
    actions: null,
    answerToggle: null,
    answerContainer: null,
    answerInput: null,
    answerButton: null,
    answerHint: null,
    answerFeedback: null,
    answerScore: null,
    answerReference: null,
    closeBtn: null,
  };

  function resetQuizState() {
    overlayState.quizData = null;
    overlayState.quizSelection = null;
    overlayState.quizFeedback = '';
  }

  function applyQuizResult(result) {
    if (!result) {
      resetQuizState();
      return;
    }
    overlayState.quizData = result;
    overlayState.quizSelection = null;
    overlayState.quizFeedback = '';
  }

  function sanitizeOption(option) {
    if (typeof option !== 'string') return '';
    const normalized = option.normalize ? option.normalize('NFKC') : option;
    const cleaned = normalized.replace(/[^A-Za-z'\-\s]/g, '');
    const collapsed = cleaned.replace(/\s+/g, ' ').trim();
    return collapsed.slice(0, 48);
  }

  function normalizeServerQuiz(payload) {
    if (!payload || !Array.isArray(payload.options)) return null;

    const options = [];
    const map = new Map();
    let answerIndex = typeof payload.answer_index === 'number' ? payload.answer_index : 0;

    payload.options.forEach((raw, idx) => {
      const sanitized = sanitizeOption(raw);
      if (!sanitized) return;
      const lower = sanitized.toLowerCase();
      if (map.has(lower)) {
        if (idx === answerIndex) {
          answerIndex = map.get(lower);
        }
        return;
      }
      map.set(lower, options.length);
      if (idx === answerIndex) {
        answerIndex = options.length;
      }
      options.push(sanitized);
    });

    if (!options.length) return null;

    const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
      ? payload.prompt.trim()
      : QUESTION_PROMPT;
    const explanation = typeof payload.explanation === 'string' ? payload.explanation.trim() : null;
    const boundedAnswer = Math.max(0, Math.min(answerIndex, options.length - 1));

    return {
      prompt,
      options: options.slice(0, 3),
      answerIndex: boundedAnswer,
      explanation: explanation || null,
    };
  }

  async function fetchQuiz(sentence, highlight) {
    const payload = {
      sentence,
      highlight,
      option_count: 3,
      context: overlayState.contextText || sentence,
    };

    const response = await fetch(QUIZ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Quiz API ${response.status}`);
    }

    const data = await response.json();
    const normalized = normalizeServerQuiz(data);
    if (normalized) {
      return normalized;
    }
    throw new Error('Invalid quiz payload');
  }

  function handleQuizOptionClick(index) {
    const quiz = overlayState.quizData;
    if (!quiz) return;
    overlayState.quizSelection = index;
    const isCorrect = index === quiz.answerIndex;
    overlayState.quizFeedback = isCorrect
      ? '정답이에요! 🎉'
      : '조금 헷갈렸어요. 다시 한번 생각해볼까요?';
    if (isCorrect && quiz.explanation) {
      overlayState.quizFeedback += `\n${quiz.explanation}`;
    }
    renderOverlayContent();
    updateOverlayPosition();
  }

  let overlayPositionRaf = null;

  if (typeof bootstrapAuthState === 'function') {
    bootstrapAuthState();
  }

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
    if (element.closest(AD_LIKE_SELECTOR)) return true;
    if (element.closest('#chatterpals-hint-helper')) return true;
    if (element.closest('.chatterpals-hint-helper')) return true;
    if (element.closest('.chatterpals-hint-cover')) return true;
    if (element.dataset && element.dataset.chatterIgnore === 'true') return true;
    if (element.closest('[contenteditable="true"]')) return true;
    if (element.hasAttribute('contenteditable')) return true;
    return false;
  }

  function isLikelyAd(element) {
    try {
      if (!element || !(element instanceof HTMLElement)) return false;
      if (element.closest(AD_LIKE_SELECTOR)) return true;
      const text = (element.innerText || '').trim();
      if (text && text.length <= 16 && /광고|AD\b/i.test(text)) return true;
      const style = window.getComputedStyle(element);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 360 && rect.height <= 280) return true;
      }
    } catch {}
    return false;
  }

  function pickArticleRoot() {
    const candidates = ARTICLE_ROOT_SELECTORS
      .map((sel) => document.querySelector(sel))
      .filter(Boolean);
    let best = null;
    let bestLen = 0;
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest(AD_LIKE_SELECTOR)) continue;
      const text = (el.innerText || '').trim();
      if (text.length > bestLen) { best = el; bestLen = text.length; }
    }
    return best || document.body;
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
    const normalizedCore = coreText.trim();
    if (!normalizedCore) return null;

    const wordMatches = Array.from(coreText.matchAll(/\S+/g));
    if (!wordMatches.length) return null;

    const targetCenter = coreText.length / 2;
    let chosenMatch = wordMatches[0];
    let bestScore = Number.POSITIVE_INFINITY;

    wordMatches.forEach((match) => {
      const token = match[0];
      const hasLetters = /[A-Za-z가-힣]/.test(token);
      const index = match.index ?? 0;
      const center = index + token.length / 2;
      const distance = Math.abs(center - targetCenter);
      const score = distance - (hasLetters ? 2 : 0);
      if (score < bestScore) {
        bestScore = score;
        chosenMatch = match;
      }
    });

    const word = chosenMatch[0];
    const wordStartInCore = chosenMatch.index ?? 0;
    const wordEndInCore = wordStartInCore + word.length;

    const maskStart = coreStart + wordStartInCore;
    const maskEnd = coreStart + wordEndInCore;

    const maskRect = measureSubstringRect(node, maskStart, maskEnd) || fallbackRect;
    if (!maskRect) return null;

    const maskRawText = rawText.slice(maskStart, maskEnd);
    const maskText = normalizeText(maskRawText);
    if (!maskText) return null;

    const maskedSentence =
      coreText.slice(0, wordStartInCore) + ' _____ ' + coreText.slice(wordEndInCore);
    const fullSentence = normalizeText(rawText) || rawText.trim();

    return {
      maskRect,
      maskText,
      maskRawText,
      maskedSentence: maskedSentence.trim(),
      fullSentence,
      maskStart,
      maskEnd,
    };
  }

  // === 텍스트 범위를 <span class="chatterpals-mask">로 감싼다 ===
function applyMaskSpan(node, startOffset, endOffset) {
  try {
    if (!node || startOffset == null || endOffset == null || endOffset <= startOffset) return null;
    const originalSegment = node.textContent?.slice(startOffset, endOffset) ?? '';
    const range = document.createRange();
    range.setStart(node, startOffset);
    range.setEnd(node, endOffset);

    const frag = range.extractContents();
    const span = document.createElement('span');
    span.className = 'chatterpals-mask';
    span.appendChild(frag);
    if (originalSegment) {
      overlayState.maskRawText = originalSegment;
    }

    range.insertNode(span);
    // 커서가 span 앞뒤로 박히는 부작용 방지
    range.detach?.();
    return span;
  } catch (err) {
    console.warn('applyMaskSpan failed:', err);
    return null;
  }
}

// === 마스크된 모든 <span>을 원문으로 되돌린다 ===
function removeMaskSpan() {
  try {
    const masks = document.querySelectorAll('.chatterpals-mask');
    masks.forEach((span) => {
      const p = span.parentNode;
      if (!p) return;
      while (span.firstChild) p.insertBefore(span.firstChild, span);
      p.removeChild(span);
    });
  } catch (e) {
    console.warn('removeMaskSpan failed:', e);
  }
}

function ensureMaskSpan() {
  if (overlayState.maskSpanEl && document.contains(overlayState.maskSpanEl)) {
    return overlayState.maskSpanEl;
  }

  if (!overlayState.anchorElement || !document.contains(overlayState.anchorElement)) {
    const reAnchored = reAnchorUsingSignature();
    if (!reAnchored) return null;
  }

  const hiddenRaw = overlayState.maskRawText || '';
  const hiddenDisplay = overlayState.maskText || '';
  const textNode = resolveAnchorTextNode();
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

  let start = overlayState.maskStart ?? -1;
  let end = overlayState.maskEnd ?? -1;
  const raw = textNode.textContent || '';

  if (start < 0 || end <= start || end > raw.length) {
    let segment = hiddenRaw || hiddenDisplay;
    if (!segment) return null;
    let idx = raw.indexOf(segment);
    if (idx < 0 && hiddenDisplay && hiddenDisplay !== segment) {
      idx = raw.indexOf(hiddenDisplay);
    }
    if (idx < 0) return null;
    start = idx;
    end = idx + segment.length;
    overlayState.maskStart = start;
    overlayState.maskEnd = end;
    if (!hiddenRaw) {
      overlayState.maskRawText = raw.slice(start, end);
    }
  }

  const span = applyMaskSpan(textNode, start, end);
  if (span) {
    overlayState.maskSpanEl = span;
    overlayState.anchorElement = span.parentElement ? span.parentElement : overlayState.anchorElement;
    overlayState.maskRect = null;
    refreshMaskRect();
  }
  return span;
  return span;
}

function revealMaskSpan(span) {
  if (!span) return;
  span.classList.add('revealed');
}

function concealMaskSpan(span) {
  if (!span) return;
  span.classList.remove('revealed');
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
      // 1) 마스크 span이 있으면 그 위치를 1순위로 사용
      if (overlayState.maskSpanEl && document.contains(overlayState.maskSpanEl)) {
        const rects = overlayState.maskSpanEl.getClientRects?.();
        let union = null;
        if (rects && rects.length) {
          let minL=Infinity,minT=Infinity,maxR=-Infinity,maxB=-Infinity;
          for (const r of rects) {
            if (!r || (r.width===0 && r.height===0)) continue;
            minL = Math.min(minL, r.left);
            minT = Math.min(minT, r.top);
            maxR = Math.max(maxR, r.right);
            maxB = Math.max(maxB, r.bottom);
          }
          if (isFinite(minL) && isFinite(minT)) {
            union = { left: minL, top: minT, width: Math.max(1, maxR-minL), height: Math.max(1, maxB-minT) };
          }
        }
        const base = union || overlayState.maskSpanEl.getBoundingClientRect?.();
        if (base && !(base.width===0 && base.height===0)) {
          overlayState.maskRect = {
            top: base.top + window.scrollY,
            left: base.left + window.scrollX,
            width: base.width,
            height: base.height,
          };
          return;
        }
      }

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

    if (!rect) {
      const rawSegment = overlayState.maskRawText || overlayState.maskText;
      if (rawSegment) {
        const raw = textNode.textContent || '';
        const index = raw.indexOf(rawSegment);
        if (index !== -1) {
          overlayState.maskStart = index;
          overlayState.maskEnd = index + rawSegment.length;
          rect = measureSubstringRect(textNode, overlayState.maskStart, overlayState.maskEnd);
        }
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
  if (isLikelyNoiseText(normalized)) return null;

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
    maskRawText: maskInfo.maskRawText,
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

  const NOISE_KEYWORDS = ['광고', '제휴', '쿠폰', 'sponsored', 'sponsor', 'promotion', 'promo', '후원', '주식회사', '(주)', '㈜'];

  function isLikelyNoiseText(text) {
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (trimmed.length < MIN_SENTENCE_LENGTH) return true;

    if (NOISE_KEYWORDS.some((keyword) => trimmed.includes(keyword))) {
      return true;
    }

    const wordCount = trimmed.split(/\s+/).length;
    const hasSentencePunctuation = /[.!?…]/.test(trimmed);
    if (wordCount < 6 && !hasSentencePunctuation) {
      return true;
    }

    const hangulMatches = trimmed.match(/[ㄱ-힝]/g) || [];
    const letterMatches = trimmed.match(/[A-Za-zㄱ-힝]/g) || [];
    if (hangulMatches.length > 0) {
      const hangulRatio = hangulMatches.length / trimmed.length;
      if (hangulRatio < 0.25 && !hasSentencePunctuation) {
        return true;
      }
    } else if (letterMatches.length > 0) {
      const upperLetters = (trimmed.match(/[A-Z]/g) || []).length;
      if (upperLetters / letterMatches.length > 0.7 && !hasSentencePunctuation) {
        return true;
      }
    }

    return false;
  }

  function getMaskedCharCount() {
    const raw = overlayState.maskRawText || overlayState.maskText || '';
    if (!raw) return 0;
    return raw.replace(/\s/g, '').length;
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
    return /[ㄱ-힝]/.test(text || '');
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
          cleanupAnchorObservers();
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
      cleanupAnchorObservers();
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
      overlayElements.cover = cover;
    }

    if (!overlayElements.helper) {
      const helper = document.createElement('div');
      helper.id = 'chatterpals-inline-toolbar';
      helper.className = 'chatterpals-inline-toolbar';
      helper.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      helper.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      const summary = document.createElement('div');
      summary.className = 'chatterpals-toolbar-summary';
      helper.appendChild(summary);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'chatterpals-toolbar-close';
      closeBtn.setAttribute('aria-label', '창 닫기');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hideHintOverlay();
      });
      helper.appendChild(closeBtn);

      const sentence = document.createElement('div');
      sentence.className = 'chatterpals-toolbar-sentence';
      helper.appendChild(sentence);

      const hintPreview = document.createElement('div');
      hintPreview.className = 'chatterpals-toolbar-hint hidden';
      helper.appendChild(hintPreview);

      const actions = document.createElement('div');
      actions.className = 'chatterpals-toolbar-actions chatterpals-hint-actions';

      const answerToggle = document.createElement('button');
      answerToggle.type = 'button';
      answerToggle.className = 'chatterpals-toolbar-answer-toggle hint-action';
      answerToggle.textContent = '답변창 열기';
      answerToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        overlayState.answerExpanded = !overlayState.answerExpanded;
        renderOverlayContent();
        if (overlayState.answerExpanded) {
          window.setTimeout(() => {
            overlayElements.answerInput?.focus();
          }, 30);
        }
      });
      actions.appendChild(answerToggle);

      // "해당 페이지 더 학습하기" 버튼: 사이드바 열고 현재 페이지 텍스트/URL 전달
      const learnMoreBtn = document.createElement('button');
      learnMoreBtn.type = 'button';
      learnMoreBtn.className = 'chatterpals-toolbar-learnmore hint-action';
      learnMoreBtn.textContent = '해당 페이지 더 학습하기';
      learnMoreBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        try {
          const text = getFullPageText();
          const payload = { contextDataForSidebar: { text, url: location.href } };
          chrome.storage.local.set(payload, () => {
            // 현재 컨텐츠 스크립트 컨텍스트에서 바로 사이드바 열기
            openSidebar();
          });
        } catch {
          openSidebar();
        }
      });
      actions.appendChild(learnMoreBtn);

      helper.appendChild(actions);

      const answerContainer = document.createElement('div');
      answerContainer.className = 'chatterpals-toolbar-answer chatterpals-answer hidden';

      const answerInput = document.createElement('textarea');
      answerInput.className = 'chatterpals-answer-input';
      answerInput.placeholder = 'Type your answer in English';
      answerInput.rows = 3;
      answerInput.addEventListener('input', () => {
        overlayState.answerText = answerInput.value;
        overlayState.answerFeedback = null;
        overlayState.answerIsCorrect = null;
        overlayState.answerScore = null;
        overlayState.answerModelAnswer = null;
        renderOverlayContent();
      });
      answerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void gradeCurrentAnswer();
        }
      });
      answerContainer.appendChild(answerInput);

      const answerControls = document.createElement('div');
      answerControls.className = 'chatterpals-answer-controls';

      const answerHint = document.createElement('span');
      answerHint.className = 'chatterpals-answer-hint';
      answerControls.appendChild(answerHint);

      const answerButton = document.createElement('button');
      answerButton.type = 'button';
      answerButton.className = 'chatterpals-answer-submit';
      answerButton.textContent = '답변 확인';
      answerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void gradeCurrentAnswer();
      });
      answerControls.appendChild(answerButton);

      answerContainer.appendChild(answerControls);

      const answerFeedback = document.createElement('p');
      answerFeedback.className = 'chatterpals-answer-feedback hidden';
      answerContainer.appendChild(answerFeedback);

      const answerScore = document.createElement('p');
      answerScore.className = 'chatterpals-answer-score hidden';
      answerContainer.appendChild(answerScore);

      const answerReference = document.createElement('p');
      answerReference.className = 'chatterpals-answer-reference hidden';
      answerContainer.appendChild(answerReference);

      helper.appendChild(answerContainer);

      overlayElements.helper = helper;
      overlayElements.statementSummary = summary;
      overlayElements.statementSentence = sentence;
      overlayElements.hintPreview = hintPreview;
      overlayElements.actions = actions;
      overlayElements.answerToggle = answerToggle;
      overlayElements.answerContainer = answerContainer;
      overlayElements.answerInput = answerInput;
      overlayElements.answerHint = answerHint;
      overlayElements.answerButton = answerButton;
      overlayElements.answerFeedback = answerFeedback;
      overlayElements.answerScore = answerScore;
      overlayElements.answerReference = answerReference;
      overlayElements.closeBtn = closeBtn;
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

    const hiddenCount = getMaskedCharCount();
    const quiz = overlayState.quizData;
    const baseSummary = quiz?.prompt
      || overlayState.playfulRemark
      || (hiddenCount
        ? `문장 전체를 참고해 하이라이트된 ${hiddenCount}자 표현을 자연스러운 영어로 바꿔보세요.`
        : '문장 전체를 참고해 하이라이트된 표현을 자연스러운 영어로 바꿔보세요.');
    if (overlayElements.statementSummary) {
      overlayElements.statementSummary.textContent = baseSummary;
    }

    const sentenceText = overlayState.maskedSentence || overlayState.contextText || '';
    if (overlayElements.statementSentence) {
      overlayElements.statementSentence.textContent = sentenceText;
      overlayElements.statementSentence.classList.toggle('hidden', !sentenceText);
    }

    if (overlayElements.hintPreview) {
      const feedbackText = overlayState.quizFeedback || overlayState.hintPreview;
      if (feedbackText) {
        overlayElements.hintPreview.textContent = feedbackText;
        overlayElements.hintPreview.classList.remove('hidden');
      } else {
        overlayElements.hintPreview.textContent = '';
        overlayElements.hintPreview.classList.add('hidden');
      }
    }

    if (overlayElements.actions) {
      const container = overlayElements.actions;
      container.textContent = '';

      if (quiz && Array.isArray(quiz.options) && quiz.options.length) {
        quiz.options.forEach((option, idx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = option;
          btn.className = 'chatterpals-quiz-option';
          const isSelected = overlayState.quizSelection === idx;
          const isCorrect = idx === quiz.answerIndex;
          btn.classList.toggle('selected', isSelected);
          btn.classList.toggle('correct', isSelected && isCorrect);
          btn.classList.toggle('incorrect', isSelected && !isCorrect);
          btn.addEventListener('click', (event) => {
            event.stopPropagation();
            handleQuizOptionClick(idx);
          });
          container.appendChild(btn);
        });
      } else {
        const statusLabel = document.createElement('span');
        statusLabel.className = 'chatterpals-quiz-loading';
        statusLabel.textContent = overlayState.loadingLevel === 'translation'
          ? '퀴즈를 준비하고 있어요…\nTip : ESC 또는 X를 눌러 이번 학습을 건너뛸 수 있어요. 학습 내용은 홈페이지에서 확인되고, 학습 환경 조정에 적용됩니다.'
          : '질문을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
        container.appendChild(statusLabel);
      }

      const learnMoreBtn = document.createElement('button');
      learnMoreBtn.type = 'button';
      learnMoreBtn.className = 'chatterpals-toolbar-learnmore hint-action';
      learnMoreBtn.textContent = '더 학습하러 가기';
      learnMoreBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        try {
          const text = getFullPageText();
          const payload = { contextDataForSidebar: { text, url: location.href } };
          chrome.storage.local.set(payload, () => {
            // 현재 컨텐츠 스크립트 컨텍스트에서 바로 사이드바 열기
            openSidebar();
          });
        } catch {
          openSidebar();
        }
      });
      container.appendChild(learnMoreBtn);
    }

    if (overlayElements.answerToggle) {
      overlayElements.answerToggle.classList.add('hidden');
    }

    if (overlayElements.answerContainer) {
      overlayElements.answerContainer.classList.add('hidden');
    }

    if (overlayElements.answerInput) {
      overlayElements.answerInput.value = overlayState.answerText;
      overlayElements.answerInput.disabled = true;
    }

    if (overlayElements.answerHint) {
      overlayElements.answerHint.textContent = '';
      overlayElements.answerHint.classList.add('hidden');
    }

    if (overlayElements.answerButton) {
      overlayElements.answerButton.disabled = true;
      overlayElements.answerButton.classList.add('hidden');
    }

    if (overlayElements.answerFeedback) {
      overlayElements.answerFeedback.textContent = '';
      overlayElements.answerFeedback.classList.add('hidden');
      overlayElements.answerFeedback.classList.remove('is-correct', 'is-incorrect');
    }

    if (overlayElements.answerScore) {
      overlayElements.answerScore.textContent = '';
      overlayElements.answerScore.classList.add('hidden');
    }

    if (overlayElements.answerReference) {
      overlayElements.answerReference.textContent = '';
      overlayElements.answerReference.classList.add('hidden');
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

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const helperWidth = helper.offsetWidth || 0;
    const helperHeight = helper.offsetHeight || 0;
    let toolbarLeft = highlightLeft + scrollX;
    let toolbarTop = highlightTop + scrollY - helperHeight - 12;
    let helperPosition = 'above';

    if (toolbarTop < scrollY + 8) {
      toolbarTop = highlightTop + scrollY + highlightHeight + 12;
      helperPosition = 'below';
    }

    const maxLeft = scrollX + viewportWidth - helperWidth - 8;
    toolbarLeft = Math.max(scrollX + 8, Math.min(toolbarLeft, maxLeft));

    const maxTop = scrollY + viewportHeight - helperHeight - 8;
    toolbarTop = Math.max(scrollY + 8, Math.min(toolbarTop, maxTop));

    helper.style.left = `${toolbarLeft}px`;
    helper.style.top = `${toolbarTop}px`;
    helper.dataset.position = helperPosition;
    overlayState.positionLocked = true;
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
    overlayState.answerExpanded = false;
    overlayState.loadingLevel = null;
    overlayState.hintPreview = '';
    overlayState.answerText = '';
    overlayState.answerFeedback = null;
    overlayState.answerIsCorrect = null;
    overlayState.answerScore = null;
    overlayState.answerModelAnswer = null;
    overlayState.isCheckingAnswer = false;
    overlayState.positionLocked = false;
    resetQuizState();
    if (overlayState.mode === 'question') {
      overlayState.playfulRemark = QUESTION_PROMPT;
    }
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
      cleanupAnchorObservers();
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
      void requestHintForLevel('translation');
    }
    if (overlayState.mode === 'question' && overlayState.answerExpanded) {
      window.setTimeout(() => {
        overlayElements.answerInput?.focus();
      }, 120);
    }
  }

  function hideHintOverlay() {
    // 감싼 마스크 전부 제거하고 상태 초기화
    removeMaskSpan();
    overlayState.maskSpanEl = null;

    overlayState.visible = false;
    overlayState.contextText = '';
    overlayState.fullSentence = '';
    overlayState.maskedSentence = '';
    overlayState.maskText = '';
    overlayState.maskRawText = '';
    overlayState.answerExpanded = false;
    cleanupAnchorObservers();
    cleanupAnchorSignature();
    overlayState.answerText = '';
    overlayState.answerFeedback = null;
    overlayState.answerIsCorrect = null;
    overlayState.answerScore = null;
    overlayState.answerModelAnswer = null;
    overlayState.isCheckingAnswer = false;
    resetQuizState();
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
    if (level !== 'translation') return;

    const sentence = overlayState.fullSentence || overlayState.contextText || '';
    const highlightCandidate = (overlayState.maskRawText || overlayState.maskText || '').trim();

    overlayState.answerModelAnswer = null;

    overlayState.loadingLevel = 'translation';
    renderOverlayContent();
    updateOverlayPosition();

    try {
      const quiz = await fetchQuiz(sentence.trim(), highlightCandidate);
      applyQuizResult(quiz);
      overlayState.playfulRemark = quiz.prompt || QUESTION_PROMPT;
      overlayState.hintPreview = '';
      overlayState.lines = [overlayState.playfulRemark];
    } catch (error) {
      console.warn('Quiz fetch failed:', error);
      resetQuizState();
      const failureMessage = '질문을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
      overlayState.hintPreview = failureMessage;
      overlayState.playfulRemark = QUESTION_PROMPT;
      overlayState.lines = [overlayState.playfulRemark, failureMessage];
    } finally {
      overlayState.loadingLevel = null;
      overlayState.usageCount += 1;
      renderOverlayContent();
      updateOverlayPosition();
    }
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
    const root = pickArticleRoot();
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
          const text = normalizeText(node.textContent || '');
          if (!text || text.length < 8) return NodeFilter.FILTER_SKIP;
          if (node.parentElement && (shouldSkipElement(node.parentElement) || isLikelyAd(node.parentElement))) return NodeFilter.FILTER_SKIP;
          if (text.length >= MIN_SENTENCE_LENGTH && isLikelyNoiseText(text)) return NodeFilter.FILTER_SKIP;
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
    // 스크롤 필요 시 최대 3회까지 재시도
    if (info.needsScroll && attempt < 3) {
      const targetTop = Math.max(0, info.rect.top - 120);
      window.scrollTo({ top: targetTop, behavior: 'smooth' });
      window.setTimeout(() => runAutoHintWithRetry(attempt + 1), 650);
      return;
    }

    // 1) 이전 마스크 모두 제거
    removeMaskSpan?.();
    overlayState.maskSpanEl = null;

    // 2) 텍스트 노드 범위에 실제 마스크 span 적용
    if (
      info.node &&
      typeof info.maskStart === 'number' &&
      typeof info.maskEnd === 'number' &&
      info.maskEnd > info.maskStart
    ) {
      const span = applyMaskSpan?.(info.node, info.maskStart, info.maskEnd);
      if (span) {
        overlayState.maskSpanEl = span;
        // 앵커를 span으로 전환 (관찰자/재앵커링 이점)
        overlayState.anchorElement = span;
        overlayState.anchorSignature = createAnchorSignature?.(span);
        // 위치는 span 기준으로 다시 계산
        overlayState.maskRect = null;
        refreshMaskRect?.();
      }
    }

    // 3) 상태 주입
    overlayState.contextText   = info.fullSentence || info.contextText || '';
    overlayState.fullSentence  = info.fullSentence || overlayState.contextText;
    overlayState.maskedSentence = info.maskedSentence || '';
    overlayState.maskText      = info.maskText || '';
    overlayState.maskRawText   = info.maskRawText || '';
    overlayState.maskStart     = (typeof info.maskStart === 'number') ? info.maskStart : overlayState.maskStart;
    overlayState.maskEnd       = (typeof info.maskEnd   === 'number') ? info.maskEnd   : overlayState.maskEnd;
    overlayState.anchorTextNode = info.node || null;
    overlayState.usageCount = 0;

    // 4) 모드 결정
    const mode = overlayState.maskText
      ? 'question'
      : shouldUseQuestionMode(overlayState.fullSentence) ? 'question' : 'tease';

    // 5) 표시용 rect: span 기준이 있으면 그걸 우선 사용
    const rectForShow = overlayState.maskRect || info.rect;

    // 6) 오버레이 표시 (앵커도 span이 있으면 우선 사용)
    showHintOverlay(
      rectForShow,
      mode,
      'auto',
      overlayState.anchorElement ?? info.element ?? null
    );
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
    if (!overlayState.visible || overlayState.positionLocked) return;
    requestAnimationFrame(() => {
      updateOverlayPosition();
    });
  }, true);

  window.addEventListener('resize', () => {
    if (!overlayState.visible || overlayState.positionLocked) return;
    requestAnimationFrame(() => {
      updateOverlayPosition();
    });
  });


  console.log('readyState:', document.readyState);
  console.log('auto hint scheduled at:', performance.now());
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
})();
