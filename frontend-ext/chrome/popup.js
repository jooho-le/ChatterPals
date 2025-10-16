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
// ⛔ 플로팅 토글 UI 제거: const floatingToggle = $('#floatingToggle');
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
    // ⛔ 플로팅 토글 관련 스토리지 키 사용 제거: 'floatingButtonVisible',
    'catVisible'
  ]);
  auth.token = stored.authToken || null;
  auth.user = stored.authUser || null;
  auth.exp = stored.authExp || null;

  // ⛔ 플로팅 토글 체크박스 제거로 인한 코드 삭제:
  // floatingToggle.checked = stored.floatingButtonVisible !== false;
  catToggle.checked = stored.catVisible !== false;

  // (안전) 과거에 저장된 false 값으로 버튼이 숨는 문제 방지: 키 제거
  chrome.storage.local.remove('floatingButtonVisible').catch(() => {});

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
  // ⛔ 플로팅 토글 리스너 제거: floatingToggle?.addEventListener('change', onFloatingToggle);
  catToggle?.addEventListener('change', onCatToggle);
  pingSummaryBtn?.addEventListener('click', onPingSummary);
  openSideBtn?.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'openSidebarOnPage' }));
}

function initializeSidebar() {
  // --- UI 요소 참조 ---
  const summaryView = document.getElementById('summary-view');
  const summaryDiv = document.getElementById('summary');
  const topicsDiv = document.getElementById('topics');
  // 수동 시작 요소 제거됨
  const resultDiv = document.getElementById('result');
  const questionsDiv = document.getElementById('questions');
  const actionButtons = document.getElementById('action-buttons');
  const evaluateBtn = document.getElementById('evaluateBtn');
  const saveBtn = document.getElementById('saveBtn');
  const chatDiv = document.getElementById('chat');
  const sidSpan = document.getElementById('sid');
  const qSpan = document.getElementById('q');
  const answerInput = document.getElementById('answer');
  const sendBtn = document.getElementById('send');
  const chatEndBtn = document.getElementById('chatEnd');
  const chatEvaluationBox = document.getElementById('chat-evaluation');
  const chatGrammarScore = document.getElementById('chat-grammar-score');
  const chatVocabScore = document.getElementById('chat-vocab-score');
  const chatClarityScore = document.getElementById('chat-clarity-score');
  const chatFeedback = document.getElementById('chat-feedback');
  const chatLimitDisplay = document.getElementById('chat-limit-display');
  const recordBtn = document.getElementById('recordBtn');
  const voiceStatus = document.getElementById('voiceStatus');
  const userTranscript = document.getElementById('userTranscript');
  const aiResponse = document.getElementById('aiResponse');
  const aiAudioPlayer = document.getElementById('ai-audio-player');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn'); // 닫기 버튼 참조 추가
  const loginForm = document.getElementById('login-form');
  const loginStatus = document.getElementById('login-status');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  const accountSignedIn = document.getElementById('account-signed-in');
  const accountNickname = document.getElementById('account-nickname');
  const logoutBtn = document.getElementById('logoutBtn');
  const toastEl = document.getElementById('toast');

  // --- 자동 시작 설정 UI ---
  const autoStartSection = document.getElementById('auto-start-section');
  const autoStartEnabledEl = document.getElementById('auto-start-enabled');
  const autoStartModeEl = document.getElementById('auto-start-mode');
  const autoStartQcountWrap = document.getElementById('auto-start-qcount-wrap');
  const autoStartChatLimitWrap = document.getElementById('auto-start-chatlimit-wrap');
  const autoStartQcountEl = document.getElementById('auto-start-qcount');
  const autoStartChatLimitEl = document.getElementById('auto-start-chatlimit');

  // --- 서버 주소 설정 ---
  const TEXT_API_SERVER = 'http://127.0.0.1:8008';
  const VOICE_API_SERVER = 'http://127.0.0.1:8000';

  // --- 상태 변수 ---
  let lastAnalyzedText = '';
  let lastAnalyzedUrl = '';
  let lastAnalysisResult = null;
  let lastEvaluationResult = null;
  let currentSessionId = '';
  let currentRecordId = '';
  let isRecording = false;
  let isProcessing = false;
  let currentAudioUrl = null;
  let authToken = null;
  let authUser = null;
  let chatActive = false;
  let toastTimeoutId = null;
  let startedAutomatically = false;

  // 페이지에서 전달된 URL 쿼리(page_url)가 있으면 우선 사용
  try {
    const params = new URLSearchParams(window.location.search);
    const qsUrl = params.get('page_url');
    if (qsUrl && /^https?:/i.test(qsUrl)) {
      lastAnalyzedUrl = qsUrl;
    }
  } catch {}

  // 자동 시작 설정 로드 및 적용 (URL 기반)
  chrome.storage.local.get(
    ['autoStartEnabled', 'autoStartMode', 'autoStartQcount', 'autoStartChatLimit'],
    (cfg) => {
      const enabled = cfg.autoStartEnabled === true;
      const mode = cfg.autoStartMode === 'discussion' ? 'discussion' : 'questions';
      const qcount = Number.isFinite(cfg.autoStartQcount) ? String(cfg.autoStartQcount) : '3';
      const chatLimit = Number.isFinite(cfg.autoStartChatLimit) ? String(cfg.autoStartChatLimit) : '5';

      if (autoStartEnabledEl) autoStartEnabledEl.checked = enabled;
      if (autoStartModeEl) autoStartModeEl.value = mode;
      if (autoStartQcountEl) autoStartQcountEl.value = qcount;
      if (autoStartChatLimitEl) autoStartChatLimitEl.value = chatLimit;
      updateAutoStartModeVisibility();

      if (enabled && !startedAutomatically) {
        startedAutomatically = true;
        (async () => {
          const url = lastAnalyzedUrl || (await resolvePageUrlWithFallbacks());
          if (!url) {
            resultDiv.textContent = '자동 시작: 페이지 URL을 가져오지 못했습니다.';
            return;
          }
          lastAnalyzedUrl = url;
          try {
            if (mode === 'discussion') {
              await startChatSessionFromUrl(url);
            } else {
              await generateQuestionsFromUrl(url);
            }
          } catch (e) {
            console.error('자동 시작 실패:', e);
          }
        })();
      }
    }
  );

  // --- 이벤트 리스너 ---
  evaluateBtn.addEventListener('click', handleEvaluation);
  saveBtn.addEventListener('click', handleSaveEvaluation);
  sendBtn.addEventListener('click', sendReply);
  chatEndBtn.addEventListener('click', handleChatEnd);
  recordBtn.addEventListener('click', handleRecordClick);
  closeSidebarBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'closeSidebar' });
  });
  loginForm.addEventListener('submit', onLoginSubmit);
  logoutBtn.addEventListener('click', handleLogout);

  function updateAutoStartModeVisibility() {
    if (!autoStartModeEl) return;
    const mode = autoStartModeEl.value;
    if (autoStartQcountWrap) autoStartQcountWrap.style.display = mode === 'discussion' ? 'none' : '';
    if (autoStartChatLimitWrap) autoStartChatLimitWrap.style.display = mode === 'discussion' ? '' : 'none';
  }

  if (autoStartEnabledEl) {
    autoStartEnabledEl.addEventListener('change', () => {
      chrome.storage.local.set({ autoStartEnabled: autoStartEnabledEl.checked });
    });
  }
  if (autoStartModeEl) {
    autoStartModeEl.addEventListener('change', () => {
      updateAutoStartModeVisibility();
      chrome.storage.local.set({ autoStartMode: autoStartModeEl.value });
    });
  }
  if (autoStartQcountEl) {
    autoStartQcountEl.addEventListener('change', () => {
      chrome.storage.local.set({ autoStartQcount: parseInt(autoStartQcountEl.value, 10) });
    });
  }
  if (autoStartChatLimitEl) {
    autoStartChatLimitEl.addEventListener('change', () => {
      chrome.storage.local.set({ autoStartChatLimit: parseInt(autoStartChatLimitEl.value, 10) });
    });
  }

  async function resolvePageUrlWithFallbacks() {
    // 1) background를 통해 탭 URL 시도
    try {
      const r1 = await new Promise((res) => chrome.runtime.sendMessage({ action: 'getPageUrl' }, res));
      const u1 = (r1 && r1.url) || '';
      if (u1 && /^https?:/i.test(u1)) return u1;
    } catch {}
    // 2) referrer 사용 시도
    try {
      if (document.referrer && /^https?:/i.test(document.referrer)) return document.referrer;
    } catch {}
    // 3) parent window에 postMessage로 직접 요청
    try {
      const u3 = await new Promise((resolve) => {
        let settled = false;
        const handler = (ev) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.source === 'chatter-page' && msg.type === 'RESPONSE_PAGE_URL') {
            window.removeEventListener('message', handler);
            settled = true;
            resolve(msg.url || '');
          }
        };
        window.addEventListener('message', handler);
        try {
          window.parent.postMessage({ source: 'chatter-ext', type: 'REQUEST_PAGE_URL' }, '*');
        } catch {}
        setTimeout(() => {
          if (!settled) {
            window.removeEventListener('message', handler);
            resolve('');
          }
        }, 800);
      });
      if (u3 && /^https?:/i.test(u3)) return u3;
    } catch {}
    return '';
  }

  chrome.storage.local.get(['authToken', 'authUser'], async (stored) => {
    if (stored.authToken) {
      authToken = stored.authToken;
      authUser = stored.authUser || null;
      try {
        const me = await fetchMe();
        authUser = me;
        chrome.storage.local.set({ authUser });
        updateAccountUI();
      } catch (error) {
        console.warn('Stored token invalid', error);
        clearAuth();
        updateAccountUI();
      }
    } else {
      updateAccountUI();
    }
  });
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

    // 이전 수동 분석 함수 제거

    async function analyzeTextForSummary(text) {
      lastAnalysisResult = null;
      lastEvaluationResult = null;
      questionsDiv.innerHTML = '';
      actionButtons.style.display = 'none';
      chatDiv.style.display = 'none';
      chatEvaluationBox.style.display = 'none';
      chatActive = false;
      sidSpan.textContent = '-';
      qSpan.textContent = '(없음)';
      summaryView.style.display = 'none';
      resultDiv.textContent = 'AI가 텍스트를 분석 중입니다...';

      try {
        const response = await fetch(`${TEXT_API_SERVER}/questions`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text, max_questions: 0 })
        });
        if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
        const data = await response.json();
        lastAnalysisResult = data;
        summaryDiv.textContent = data.summary;
        topicsDiv.innerHTML = (data.topics || []).map((topic) => `<span class="topic-tag">${topic}</span>`).join('');
        summaryView.style.display = 'block';
        resultDiv.textContent = '요약이 준비되었습니다.';
      } catch (error) {
        resultDiv.textContent = '텍스트 분석 서버에 연결할 수 없습니다.';
        console.error('요약 분석 실패:', error);
      }
    }

    async function generateQuestionsFromUrl(url) {
      resultDiv.textContent = 'AI가 질문을 만들고 있습니다...';
      questionsDiv.innerHTML = '';
      actionButtons.style.display = 'none';
      evaluateBtn.disabled = true;
      saveBtn.disabled = true;
      lastEvaluationResult = null;

      const questionCount = (() => {
        const el = document.getElementById('auto-start-qcount');
        const v = el ? parseInt(el.value, 10) : 3;
        return Number.isFinite(v) ? v : 3;
      })();

      try {
        const response = await fetch(`${TEXT_API_SERVER}/analyze_url`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ url, max_questions: questionCount })
        });
        if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
        const data = await response.json();

        lastAnalysisResult = data;
        summaryDiv.textContent = data.summary;
        topicsDiv.innerHTML = (data.topics || []).map((topic) => `<span class="topic-tag">${topic}</span>`).join('');
        summaryView.style.display = 'block';

        resultDiv.textContent = `질문 ${data.questions.length}개를 생성했습니다. 답변을 입력하고 평가받으세요.`;
        questionsDiv.innerHTML = (data.questions || [])
          .map((q, index) => {
            const questionText = typeof q === 'object' ? q.question : q;
            return `
              <div class="question-item" data-index="${index}">
                <div class="question-text">${index + 1}. ${questionText}</div>
                <textarea class="question-answer" placeholder="답변을 입력하세요..."></textarea>
                <div class="evaluation-result">
                  <div class="evaluation-scores">
                    <span class="score-item">총점: <span class="total-score value"></span></span>
                    <span class="score-item">문법: <span class="grammar-score value"></span></span>
                    <span class="score-item">어휘: <span class="vocab-score value"></span></span>
                    <span class="score-item">논리: <span class="clarity-score value"></span></span>
                  </div>
                  <p class="feedback-text"></p>
                </div>
              </div>`;
          })
          .join('');

        actionButtons.style.display = 'flex';
        evaluateBtn.disabled = false;
      } catch (error) {
        resultDiv.textContent = '질문 생성에 실패했습니다. 다시 시도해 주세요.';
        console.error('질문 생성 API 호출 실패:', error);
      }
    }

    async function handleEvaluation() {
      resultDiv.textContent = 'AI가 답변을 평가 중입니다...';
      evaluateBtn.disabled = true;
      saveBtn.disabled = true;

      const answers = Array.from(document.querySelectorAll('.question-answer'));
      const itemsToEvaluate = (lastAnalysisResult.questions || []).map((q, i) => ({
        question: typeof q === 'object' ? q.question : q,
        answer: answers[i].value || ''
      }));

      try {
        const response = await fetch(`${TEXT_API_SERVER}/evaluate/answers`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ items: itemsToEvaluate })
        });
        if (!response.ok) throw new Error('평가 서버에서 오류가 발생했습니다.');

        const data = await response.json();
        lastEvaluationResult = data.evaluations;
        displayEvaluationResults(data.evaluations);

        resultDiv.textContent = '평가가 완료되었습니다. 결과를 저장할 수 있습니다.';
        saveBtn.disabled = false;
      } catch (error) {
        resultDiv.textContent = `평가 실패: ${error.message}`;
      } finally {
        evaluateBtn.disabled = false;
      }
    }

    function displayEvaluationResults(evaluations) {
      evaluations.forEach((result, index) => {
        const itemEl = document.querySelector(`.question-item[data-index="${index}"]`);
        if (!itemEl) return;
        const resultEl = itemEl.querySelector('.evaluation-result');
        const scores = result.evaluation.scores;
        const totalScore = scores.grammar + scores.vocabulary + scores.clarity;

        itemEl.querySelector('.total-score').textContent = `${totalScore}/15`;
        itemEl.querySelector('.grammar-score').textContent = `${scores.grammar}/5`;
        itemEl.querySelector('.vocab-score').textContent = `${scores.vocabulary}/5`;
        itemEl.querySelector('.clarity-score').textContent = `${scores.clarity}/5`;
        itemEl.querySelector('.feedback-text').textContent = result.evaluation.feedback;
        resultEl.style.display = 'block';
      });
    }

    async function handleSaveEvaluation() {
      if (!lastEvaluationResult) {
        resultDiv.textContent = '저장할 평가 결과가 없습니다. 먼저 평가를 진행해주세요.';
        return;
      }
      if (!authToken) {
        resultDiv.textContent = '평가 결과를 저장하려면 먼저 로그인하세요.';
        loginStatus.textContent = '로그인이 필요합니다.';
        return;
      }
      resultDiv.textContent = '평가 결과를 저장하는 중...';
      saveBtn.disabled = true;

      const payload = {
        summary: lastAnalysisResult.summary,
        topics: lastAnalysisResult.topics,
        items: lastEvaluationResult,
        source_text: (lastAnalyzedText && lastAnalyzedText.substring(0, 4000)) || lastAnalyzedUrl || ''
      };

      try {
        const response = await fetch(`${TEXT_API_SERVER}/records/save_evaluation`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail || `서버 오류: ${response.status}`);
        }
        const savedRecord = await response.json();
        resultDiv.textContent = `성공적으로 저장되었습니다! (ID: ${savedRecord.id.substring(0, 8)})`;
      } catch (error) {
        resultDiv.textContent = `저장 실패: ${error.message}`;
        saveBtn.disabled = false;
      }
    }

    async function startChatSessionFromUrl(url) {
      resultDiv.textContent = '채팅 세션을 시작합니다...';
      try {
        const response = await fetch(`${TEXT_API_SERVER}/chat/start_url`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            url,
            max_questions: (() => {
              const el = document.getElementById('auto-start-chatlimit');
              const v = el ? parseInt(el.value, 10) : 5;
              return Number.isFinite(v) ? v : 5;
            })()
          })
        });
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || '채팅 서버 연결 실패');
        }
        const data = await response.json();
        currentSessionId = data.session_id;
        currentRecordId = data.record_id;
        sidSpan.textContent = currentSessionId.substring(0, 8);
        qSpan.textContent = data.question;
        chatDiv.style.display = 'block';
        chatLimitDisplay.textContent = document.getElementById('auto-start-chatlimit')?.value || '5';
        resultDiv.textContent = '채팅이 시작되었습니다.';
        chatActive = true;
        chatEndBtn.style.display = 'inline-flex';
        chatEndBtn.disabled = false;
        sendBtn.disabled = false;
        answerInput.disabled = false;
        resetDiscussionEvaluation();
      } catch (error) {
        resultDiv.textContent = `오류: ${error.message}`;
        console.error('채팅 시작 API 호출 실패:', error);
      }
    }

    async function sendReply() {
      const answer = answerInput.value.trim();
      if (!answer || !currentSessionId || !chatActive) return;
      qSpan.textContent = 'AI가 생각 중...';
      try {
        const response = await fetch(`${TEXT_API_SERVER}/chat/reply`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ session_id: currentSessionId, answer })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        qSpan.textContent = data.question;
        answerInput.value = '';
        if (data.done) {
          finalizeChat(data.record_id);
        }
      } catch (error) {
        qSpan.textContent = '오류가 발생했습니다.';
        console.error('채팅 응답 API 호출 실패:', error);
      }
    }

    async function handleChatEnd() {
      if (!currentSessionId) return;
      chatEndBtn.disabled = true;
      try {
        const response = await fetch(`${TEXT_API_SERVER}/chat/end`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ session_id: currentSessionId })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || '세션을 종료하지 못했습니다.');
        }
        const data = await response.json();
        qSpan.textContent = data.message || '토론이 종료되었습니다.';
        finalizeChat(data.record_id);
      } catch (error) {
        resultDiv.textContent = `종료 실패: ${error.message}`;
        chatEndBtn.disabled = false;
      }
    }

    function finalizeChat(recordId) {
      chatActive = false;
      chatEndBtn.style.display = 'none';
      sendBtn.disabled = true;
      answerInput.disabled = true;
      currentSessionId = '';
      if (recordId) {
        currentRecordId = recordId;
        evaluateDiscussion(recordId);
      }
    }

    async function evaluateDiscussion(recordId) {
      if (!recordId) return;
      if (!authToken) {
        chatEvaluationBox.style.display = 'block';
        chatGrammarScore.textContent = '-';
        chatVocabScore.textContent = '-';
        chatClarityScore.textContent = '-';
        chatFeedback.textContent = '로그인하면 토론 평가 결과를 확인할 수 있습니다.';
        return;
      }
      try {
        const response = await fetch(`${TEXT_API_SERVER}/chat/evaluate`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ record_id: recordId })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || '토론 평가에 실패했습니다.');
        }
        const data = await response.json();
        displayDiscussionEvaluation(data.evaluation);
      } catch (error) {
        chatEvaluationBox.style.display = 'block';
        chatGrammarScore.textContent = '-';
        chatVocabScore.textContent = '-';
        chatClarityScore.textContent = '-';
        chatFeedback.textContent = error instanceof Error ? error.message : '평가를 불러오지 못했습니다.';
      }
    }

    function displayDiscussionEvaluation(evaluation) {
      if (!evaluation) return;
      chatEvaluationBox.style.display = 'block';
      const scores = evaluation.scores || {};
      chatGrammarScore.textContent = scores.grammar != null ? `${scores.grammar}/5` : '-';
      chatVocabScore.textContent = scores.vocabulary != null ? `${scores.vocabulary}/5` : '-';
      chatClarityScore.textContent = scores.clarity != null ? `${scores.clarity}/5` : '-';
      chatFeedback.textContent = evaluation.feedback || '';
    }

    function resetDiscussionEvaluation() {
      chatEvaluationBox.style.display = 'none';
      chatGrammarScore.textContent = '-';
      chatVocabScore.textContent = '-';
      chatClarityScore.textContent = '-';
      chatFeedback.textContent = '';
    }

    // -- 녹음세션 --
    function handleRecordClick() {
      if (!isRecording) {
        chrome.runtime.sendMessage({ action: 'requestMicrophonePermission' });
      } else {
        chrome.runtime.sendMessage({ action: 'stopRecording' });
      }
    }

    chrome.runtime.onMessage.addEventListener?.call
    ? null
    : null; // (무시 가능한 보호 코드; 일부 번들러 경고 회피용)

    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'permissionResult') {
        if (request.success) {
          voiceStatus.textContent = '듣고 있어요...';
          recordBtn.textContent = '🔴 녹음 중지';
          isRecording = true;
          chrome.runtime.sendMessage({ action: 'startRecording' });
        } else {
          voiceStatus.textContent =
            request.error === 'denied'
              ? '마이크가 차단되었습니다. 브라우저 설정에서 권한을 허용해주세요.'
              : '마이크 권한이 거부되었습니다.';
          isRecording = false;
        }
      } else if (request.action === 'recordingStopped') {
        recordBtn.textContent = '🎤 말하기 시작';
        voiceStatus.textContent = '처리 중...';
        isRecording = false;
        handleRecordingData(request.audioDataUrl);
      } else if (request.action === 'recordingError') {
        voiceStatus.textContent = `마이크 오류: ${request.error}`;
        isRecording = false;
        recordBtn.textContent = '🎤 말하기 시작';
      }
    });

    async function handleRecordingData(audioDataUrl) {
      if (isProcessing) {
        console.log('이미 음성 처리 요청이 진행 중입니다. 중복 요청을 무시합니다.');
        return;
      }
      isProcessing = true;

      voiceStatus.textContent = '음성을 인식하는 중...';
      userTranscript.textContent = '';
      aiResponse.textContent = '';
      aiAudioPlayer.style.display = 'none';
      aiAudioPlayer.src = '';

      try {
        const audioBlob = await (await fetch(audioDataUrl)).blob();
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const response = await fetch(`${VOICE_API_SERVER}/api/get-ai-response`, {
          method: 'POST',
          body: formData
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail || `서버 오류: ${response.status}`);
        }
        const result = await response.json();
        userTranscript.textContent = result.transcript;
        aiResponse.textContent = result.response_text;

        voiceStatus.textContent = 'AI 답변을 재생합니다.';
        const ttsBlob = await getTtsAudio(result.response_text);
        playAudio(ttsBlob);
        voiceStatus.textContent = '완료. 다시 질문하려면 버튼을 누르세요.';
      } catch (error) {
        console.error('음성 처리 파이프라인 오류:', error);
        voiceStatus.textContent = `오류 발생: ${error.message}`;
      } finally {
        isProcessing = false;
      }
    }

    function playAudio(blob) {
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      const newAudioUrl = URL.createObjectURL(blob);
      currentAudioUrl = newAudioUrl;

      aiAudioPlayer.src = newAudioUrl;
      aiAudioPlayer.style.display = 'block';
      aiAudioPlayer.play().catch((e) => console.error('오디오 자동 재생 실패:', e));
    }

    async function getTtsAudio(text) {
      const response = await fetch(`${VOICE_API_SERVER}/api/tts?text=${encodeURIComponent(text)}`);
      if (!response.ok) throw new Error('TTS 오디오를 가져오지 못했습니다.');
      return response.blob();
    }

    function buildHeaders(base = {}) {
      const headers = { ...base };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      return headers;
    }

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

// ⛔ 플로팅 토글 핸들러 완전 삭제
// async function onFloatingToggle() { ... }

async function onCatToggle() {
  const visible = catToggle.checked;
  await chrome.storage.local.set({ catVisible: visible });
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
      chrome.tabs
        .sendMessage(tab.id, { action: 'toggleCat', visible })
        .catch(() => {});
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
