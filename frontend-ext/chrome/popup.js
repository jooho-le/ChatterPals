// ChatterPals Extension Frontend Script
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const urlParams = new URLSearchParams(window.location.search);
    const context = urlParams.get('context');
    if (context === 'sidebar') {
        document.getElementById('sidebar-view').style.display = 'block';
        initializeSidebar();
    } else {
        document.getElementById('popup-view').style.display = 'block';
        initializePopup();
    }
});

function initializePopup() {
    // (이 함수는 변경 없음)
    const toggleButton = document.getElementById('toggleButton');
    const statusText = document.getElementById('statusText');
    chrome.storage.local.get(['floatingButtonVisible'], (result) => {
        const isVisible = result.floatingButtonVisible !== false;
        toggleButton.checked = isVisible;
        updateStatusText(isVisible);
    });
    toggleButton.addEventListener('change', () => {
        const isVisible = toggleButton.checked;
        chrome.storage.local.set({ floatingButtonVisible: isVisible }, () => {
            updateStatusText(isVisible);
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id && !tab.url.startsWith('chrome://')) {
                         chrome.tabs.sendMessage(tab.id, {
                            action: 'toggleFloatingButton',
                            visible: isVisible
                        }).catch(error => console.log(`Tab ${tab.id} 메시지 전송 실패: ${error.message}`));
                    }
                });
            });
        });
    });
    function updateStatusText(isVisible) {
        statusText.textContent = isVisible ? '플로팅 버튼 활성화' : '플로팅 버튼 비활성화';
    }
}

function initializeSidebar() {
    // --- UI 요소 참조 ---
    const summaryView = document.getElementById('summary-view');
    const summaryDiv = document.getElementById('summary');
    const topicsDiv = document.getElementById('topics');
    const questionBtn = document.getElementById('question');
    const analyzeAllBtn = document.getElementById('analyzeAll');
    const questionCountSelect = document.getElementById('question-count-select');
    const chatQuestionLimitSelect = document.getElementById('chat-question-limit');
    const analysisChoice = document.getElementById('analysis-choice');
    const questionFlowBtn = document.getElementById('start-question-flow');
    const chatStartBtn = document.getElementById('chatStart');
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

    // --- 서버 주소 설정 ---
    const TEXT_API_SERVER = 'http://127.0.0.1:8008';
    const VOICE_API_SERVER = 'http://127.0.0.1:8000';

    // --- 상태 변수 ---
    let lastAnalyzedText = '';
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

    chrome.storage.local.get('contextDataForSidebar', (result) => {
        const payload = result.contextDataForSidebar || null;
        if (!payload) return;
        const incomingUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
        const incomingText = typeof payload.text === 'string' ? payload.text.trim() : '';

        if (incomingUrl) {
            resultDiv.textContent = '페이지에서 본문을 추출하고 요약 중입니다...';
            analyzeUrlForSummary(incomingUrl);
        } else if (incomingText) {
            lastAnalyzedText = incomingText;
            analyzeTextForSummary(lastAnalyzedText);
        }
        chrome.storage.local.remove('contextDataForSidebar');
    });

    // --- 이벤트 리스너 ---
    questionBtn.addEventListener('click', () => handlePageTextRequest('selection'));
    analyzeAllBtn.addEventListener('click', () => handlePageTextRequest('fullPage'));
    if (questionFlowBtn) {
        questionFlowBtn.addEventListener('click', () => generateQuestions(lastAnalyzedText));
    }
    evaluateBtn.addEventListener('click', handleEvaluation);
    saveBtn.addEventListener('click', handleSaveEvaluation);
    chatStartBtn.addEventListener('click', startChatSession);
    sendBtn.addEventListener('click', sendReply);
    chatEndBtn.addEventListener('click', handleChatEnd);
    recordBtn.addEventListener('click', handleRecordClick);
    closeSidebarBtn.addEventListener('click', () => { // 닫기 버튼 이벤트 리스너 추가
    // content.js에 사이드바를 닫으라는 메시지를 보냅니다.
    chrome.runtime.sendMessage({ action: 'closeSidebar' });
    });
    loginForm.addEventListener('submit', onLoginSubmit);
    logoutBtn.addEventListener('click', handleLogout);

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

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        let shouldFetchUser = false;
        console.log('[popup] storage changed', changes);

        if (Object.prototype.hasOwnProperty.call(changes, 'authToken')) {
            authToken = changes.authToken.newValue || null;
            if (!authToken) {
                authUser = null;
                updateAccountUI();
            } else if (!Object.prototype.hasOwnProperty.call(changes, 'authUser')) {
                shouldFetchUser = true;
            }
        }

        if (Object.prototype.hasOwnProperty.call(changes, 'authUser')) {
            authUser = changes.authUser.newValue || null;
            updateAccountUI();
        } else if (shouldFetchUser && authToken) {
            fetchMe()
                .then((me) => {
                    authUser = me;
                    chrome.storage.local.set({ authUser: me });
                    updateAccountUI();
                })
                .catch((error) => {
                    console.warn('Failed to refresh auth user', error);
                    clearAuth(false);
                    updateAccountUI();
                });
        }
    });

    function handlePageTextRequest(type) {
        const message = type === 'selection' ? '선택된 텍스트를 분석 중...' : '페이지 전체 텍스트를 분석 중...';
        resultDiv.textContent = message;
        chrome.runtime.sendMessage({ action: 'getTextFromPage', type }, (response) => {
            if (response && response.text && response.text.trim()) {
                lastAnalyzedText = response.text.trim();
                analyzeTextForSummary(lastAnalyzedText);
            } else {
                resultDiv.textContent = '분석할 텍스트가 없습니다.';
            }
        });
    }

    async function analyzeTextForSummary(text) {
        lastAnalysisResult = null;
        lastEvaluationResult = null;
        questionsDiv.innerHTML = '';
        actionButtons.style.display = 'none';
        analysisChoice.style.display = 'none';
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
                body: JSON.stringify({ text, max_questions: 0 }),
            });
            if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
            const data = await response.json();
            lastAnalysisResult = data;
            summaryDiv.textContent = data.summary;
            topicsDiv.innerHTML = (data.topics || []).map(topic => `<span class="topic-tag">${topic}</span>`).join('');
            summaryView.style.display = 'block';
            resultDiv.textContent = '요약이 준비되었습니다. 질문 생성 또는 토론 시작을 선택하세요.';
            analysisChoice.style.display = 'flex';
        } catch (error) {
            resultDiv.textContent = '텍스트 분석 서버에 연결할 수 없습니다.';
            console.error('요약 분석 실패:', error);
        }
    }

    async function analyzeUrlForSummary(url) {
        lastAnalysisResult = null;
        lastEvaluationResult = null;
        questionsDiv.innerHTML = '';
        actionButtons.style.display = 'none';
        analysisChoice.style.display = 'none';
        chatDiv.style.display = 'none';
        chatEvaluationBox.style.display = 'none';
        chatActive = false;
        sidSpan.textContent = '-';
        qSpan.textContent = '(없음)';
        summaryView.style.display = 'none';

        try {
            const response = await fetch(`${TEXT_API_SERVER}/analyze_url`, {
                method: 'POST',
                headers: buildHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ url, max_questions: 0 }),
            });
            if (!response.ok) {
                let detail = '';
                try { const j = await response.json(); detail = j?.detail || ''; } catch {}
                console.warn('URL 분석 응답 에러', response.status, detail);
                await fallbackAnalyzeFromPageText();
                return;
            }
            const data = await response.json();
            lastAnalysisResult = data;
            lastAnalyzedText = data.meta?.url ? `URL: ${data.meta.url}` : '';
            summaryDiv.textContent = data.summary;
            topicsDiv.innerHTML = (data.topics || []).map(topic => `<span class="topic-tag">${topic}</span>`).join('');
            summaryView.style.display = 'block';
            resultDiv.textContent = '요약이 준비되었습니다. 질문 생성 또는 토론 시작을 선택하세요.';
            analysisChoice.style.display = 'flex';
        } catch (error) {
            console.error('URL 요약 분석 실패:', error);
            await fallbackAnalyzeFromPageText();
        }
    }

    async function fallbackAnalyzeFromPageText() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTextFromPage', type: 'fullPage' }, async (response) => {
                const text = (response && typeof response.text === 'string') ? response.text.trim() : '';
                if (text) {
                    await analyzeTextForSummary(text);
                    resolve();
                } else {
                    resultDiv.textContent = '자동 추출에 실패했습니다. 기사 본문을 드래그해서 선택한 뒤 다시 시도해 주세요.';
                    resolve();
                }
            });
        });
    }

    async function generateQuestions(text) {
        if (!text || !text.trim()) {
            resultDiv.textContent = '먼저 텍스트를 분석해주세요.';
            return;
        }
        resultDiv.textContent = 'AI가 질문을 만들고 있습니다...';
        questionsDiv.innerHTML = '';
        actionButtons.style.display = 'none';
        evaluateBtn.disabled = true;
        saveBtn.disabled = true;
        lastEvaluationResult = null;
        analysisChoice.style.display = 'none';

        const questionCount = parseInt(questionCountSelect.value, 10);

        try {
            const response = await fetch(`${TEXT_API_SERVER}/questions`, {
                method: 'POST',
                headers: buildHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ text, max_questions: questionCount }),
            });
            if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
            const data = await response.json();

            lastAnalysisResult = data;
            summaryDiv.textContent = data.summary;
            topicsDiv.innerHTML = (data.topics || []).map(topic => `<span class="topic-tag">${topic}</span>`).join('');
            summaryView.style.display = 'block';

            resultDiv.textContent = `질문 ${data.questions.length}개를 생성했습니다. 답변을 입력하고 평가받으세요.`;
            questionsDiv.innerHTML = (data.questions || []).map((q, index) => {
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
            }).join('');

            actionButtons.style.display = 'flex';
            evaluateBtn.disabled = false;
        } catch (error) {
            resultDiv.textContent = '질문 생성에 실패했습니다. 다시 시도해 주세요.';
            console.error('질문 생성 API 호출 실패:', error);
            analysisChoice.style.display = 'flex';
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
//--평가함수--//
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
            source_text: lastAnalyzedText.substring(0, 4000)
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
//--토론세션--//
    async function startChatSession() {
        let textForChat = lastAnalyzedText;
        if (!textForChat) {
            textForChat = window.getSelection().toString().trim();
        }
        if (!textForChat) {
            resultDiv.textContent = '토론을 시작할 텍스트를 먼저 분석하거나, 페이지에서 텍스트를 선택해주세요.';
            return;
        }

        resultDiv.textContent = '채팅 세션을 시작합니다...';
        try {
            const response = await fetch(`${TEXT_API_SERVER}/chat/start`, {
                method: 'POST',
                headers: buildHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    text: textForChat,
                    max_questions: parseInt(chatQuestionLimitSelect.value, 10),
                }),
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
            chatLimitDisplay.textContent = chatQuestionLimitSelect.value;
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
            analysisChoice.style.display = 'flex';
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
                body: JSON.stringify({ session_id: currentSessionId, answer: answer }),
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
                body: JSON.stringify({ session_id: currentSessionId }),
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
                body: JSON.stringify({ record_id: recordId }),
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

//--녹음세션--//
    function handleRecordClick() {
        if (!isRecording) {
            chrome.runtime.sendMessage({ action: 'requestMicrophonePermission' });
        } else {
            chrome.runtime.sendMessage({ action: 'stopRecording' });
        }
    }

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'permissionResult') {
            if (request.success) {
                voiceStatus.textContent = '듣고 있어요...';
                recordBtn.textContent = '🔴 녹음 중지';
                isRecording = true;
                chrome.runtime.sendMessage({ action: 'startRecording' });
            } else {
                voiceStatus.textContent = request.error === 'denied'
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
            console.log("이미 음성 처리 요청이 진행 중입니다. 중복 요청을 무시합니다.");
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
                body: formData,
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
        aiAudioPlayer.play().catch(e => console.error("오디오 자동 재생 실패:", e));
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

    function showToast(message) {
        if (!toastEl) return;
        toastEl.textContent = message;
        toastEl.classList.add('show');
        if (toastTimeoutId) {
            clearTimeout(toastTimeoutId);
        }
        toastTimeoutId = setTimeout(() => {
            toastEl.classList.remove('show');
        }, 2500);
    }

    async function fetchMe() {
        const response = await fetch(`${TEXT_API_SERVER}/auth/me`, {
            headers: buildHeaders(),
        });
        if (!response.ok) throw new Error('인증 정보가 만료되었습니다.');
        return response.json();
    }

    async function onLoginSubmit(event) {
        event.preventDefault();
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        if (!username || !password) {
            loginStatus.textContent = '아이디와 비밀번호를 입력해주세요.';
            return;
        }
        loginStatus.textContent = '로그인 중...';
        try {
            const payload = new URLSearchParams();
            payload.set('username', username);
            payload.set('password', password);
            const response = await fetch(`${TEXT_API_SERVER}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: payload.toString(),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || '로그인에 실패했습니다.');
            }
            const data = await response.json();
            authToken = data.access_token;
            authUser = data.user;
            chrome.storage.local.set({ authToken, authUser }, () => {
                chrome.runtime.sendMessage({
                    action: 'broadcastAuthUpdate',
                    token: authToken,
                    user: authUser,
                });
            });
            loginStatus.textContent = '로그인 성공!';
            loginForm.reset();
            updateAccountUI();
        } catch (error) {
            loginStatus.textContent = error.message;
            clearAuth();
            updateAccountUI();
        }
    }

    function handleLogout() {
        clearAuth();
        loginStatus.textContent = '로그아웃되었습니다.';
        updateAccountUI();
    }

    function clearAuth(shouldBroadcast = true) {
        authToken = null;
        authUser = null;
        chrome.storage.local.remove(['authToken', 'authUser'], () => {
            if (shouldBroadcast) {
                chrome.runtime.sendMessage({
                    action: 'broadcastAuthUpdate',
                    token: null,
                    user: null,
                });
            }
        });
    }

    function updateAccountUI() {
        if (authToken && authUser) {
            accountSignedIn.style.display = 'block';
            loginForm.style.display = 'none';
            accountNickname.textContent = authUser.nickname || authUser.username;
        } else {
            accountSignedIn.style.display = 'none';
            loginForm.style.display = 'flex';
        }
    }
}
