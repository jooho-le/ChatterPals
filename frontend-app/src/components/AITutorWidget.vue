<template>
  <div class="ai-tutor-widget">
    <div class="chat-history" ref="chatHistoryEl">
      <div
        v-for="(msg, index) in messages"
        :key="index"
        :class="['chat-message', msg.role, { 'is-hint': msg.kind === 'hint' }]"
        :ref="(el) => captureMessageRef(el, msg, index)"
      >
        <div class="message-content">
          <p>{{ msg.text }}</p>
          <div v-if="msg.role === 'ai' && msg.audioUrl" class="audio-player">
            <button @click="playAudio(msg.audioUrl, index)" class="play-pause-btn" :aria-label="currentlyPlayingIndex === index ? '오디오 일시중지' : '오디오 재생'">
              <svg
                v-if="currentlyPlayingIndex !== index"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div v-if="isProcessingAudio || isProcessingText" class="chat-message ai thinking">
        <div class="message-content thinking">...</div>
      </div>
      <transition name="floating-cover">
        <div
          v-if="overlayState.visible && overlayAnchor && overlayState.mode === 'tease'"
          class="floating-cover"
          :style="{
            top: `${overlayAnchor.top}px`,
            left: `${overlayAnchor.left}px`,
            width: `${overlayAnchor.width}px`,
            height: `${overlayAnchor.height}px`,
          }"
        ></div>
      </transition>
      <transition name="floating-helper">
        <div
          v-if="overlayState.visible && overlayAnchor"
          class="floating-helper"
          :class="['mode-' + overlayState.mode]"
          :style="{
            top: `${overlayAnchor.top}px`,
            left: `${overlayAnchor.left + overlayAnchor.width / 2}px`,
          }"
        >
          <div class="floating-character" aria-hidden="true">😜</div>
          <div class="floating-bubble" role="dialog" aria-live="polite">
            <button type="button" class="close-btn" @click="hideOverlay" aria-label="힌트 닫기">×</button>
            <p v-for="line in overlayState.lines" :key="line">{{ line }}</p>
            <p
              v-if="overlayState.playfulRemark && overlayState.lines[0] !== overlayState.playfulRemark"
              class="playful-remark"
            >
              {{ overlayState.playfulRemark }}
            </p>
            <div v-if="overlayState.hintPreview" class="hint-preview">
              <pre>{{ overlayState.hintPreview }}</pre>
            </div>
            <p v-if="hintUsageCount" class="hint-usage">
              힌트 사용 {{ hintUsageCount }}회
            </p>
            <div class="floating-actions">
              <button
                v-for="action in helperActions"
                :key="action.level"
                type="button"
                @click="handleHintRequest(action.level)"
                :disabled="overlayState.loadingLevel === action.level"
              >
                <span v-if="overlayState.loadingLevel === action.level">…</span>
                <span v-else>{{ action.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="inputText"
        @keydown.enter.prevent="handleSendMessage"
        @focus="handleInputFocus"
        @blur="handleInputBlur"
        placeholder="메시지를 입력하거나 마이크를 누르세요..."
        rows="1"
        ref="textareaEl"
      ></textarea>
      <button @click="handleSendMessage" :disabled="!inputText.trim() || isProcessingAudio || isProcessingText" aria-label="메시지 전송">
        전송
      </button>
      <button
        @click="toggleRecording"
        :disabled="isProcessingText"
        class="mic-btn"
        :aria-pressed="isRecording"
        aria-label="음성 녹음 토글"
      >
        {{ isRecording ? '🔴' : '🎤' }}
      </button>
    </div>

    <audio ref="audioPlayer" style="display: none;"></audio>

    <transition name="toast-fade">
      <div v-if="toastMessage" class="toast" role="status" aria-live="polite">
        {{ toastMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineEmits,
  defineExpose,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import type { ComponentPublicInstance } from 'vue';
import * as api from '@/services/api';
import type { HintLevel, HintResponse } from '@/services/api';
import * as audioRecorder from '@/services/audioRecorder';

interface Message {
  role: 'user' | 'ai';
  text: string;
  audioUrl?: string;
  kind?: 'chat' | 'hint';
}

const emit = defineEmits<{
  (event: 'voice-start'): void;
  (event: 'voice-stop'): void;
  (event: 'input-focus'): void;
  (event: 'input-blur'): void;
  (event: 'error', message: string): void;
}>();

const messages = ref<Message[]>([]);
const inputText = ref('');
const isRecording = ref(false);
const isProcessingAudio = ref(false);
const isProcessingText = ref(false);

const audioPlayer = ref<HTMLAudioElement | null>(null);
const currentlyPlayingIndex = ref<number | null>(null);

const chatHistoryEl = ref<HTMLElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const toastMessage = ref<string | null>(null);
let toastTimer: number | undefined;

type NudgeReason = 'timeout' | 'wrong';
type OverlayMode = 'tease' | 'question';

interface AnchorPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TEASE_LINES_BASE: string[] = ['힌트 볼래?', '키워드 3개 줄까?', '번역 조금만?'];
const WRONG_LINES: string[] = ['조금 헷갈리나봐!', '힌트 볼래?', '키워드 3개 줄까?'];
const QUESTION_LINES: string[] = ['이게 뭐야?', '핵심 키워드를 찾아봐!'];
const HINT_LABELS: Record<HintLevel, string> = {
  starter: '힌트',
  keywords: '키워드 힌트',
  translation: '부분 번역',
};

const hintUsageCount = ref(0);
const consecutiveWrongCount = ref(0);
const lastAiMessageText = ref('');
const latestAiMessageElement = ref<HTMLElement | null>(null);
const scrollSnapshot = ref(0);
const viewportTick = ref(0);

const overlayState = reactive({
  visible: false,
  mode: 'tease' as OverlayMode,
  lines: [...TEASE_LINES_BASE],
  hintPreview: null as string | null,
  playfulRemark: null as string | null,
  loadingLevel: null as HintLevel | null,
  reason: null as NudgeReason | 'question' | null,
});

const overlayAnchor = computed<AnchorPosition | null>(() => {
  // depend on scroll / resize updates
  void scrollSnapshot.value;
  void viewportTick.value;

  const messageEl = latestAiMessageElement.value;
  const containerEl = chatHistoryEl.value;
  if (!messageEl || !containerEl) return null;

  const messageRect = messageEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const top = messageRect.top - containerRect.top + containerEl.scrollTop;
  const left = messageRect.left - containerRect.left;

  return {
    top,
    left,
    width: messageRect.width,
    height: messageRect.height,
  };
});

let inactivityTimerId: number | null = null;
let overlayAutoHideTimer: number | null = null;

const helperActions = computed(() => {
  if (overlayState.mode === 'question') {
    return [
      { label: '키워드 3개', level: 'keywords' as HintLevel },
      { label: '힌트 보기', level: 'starter' as HintLevel },
    ];
  }
  return [
    { label: '힌트 보기', level: 'starter' as HintLevel },
    { label: '키워드 3개', level: 'keywords' as HintLevel },
    { label: '번역 조금만', level: 'translation' as HintLevel },
  ];
});

function showToast(message: string) {
  toastMessage.value = message;
  emit('error', message);
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = null;
  }, 4000);
}

function handleScroll() {
  if (chatHistoryEl.value) {
    scrollSnapshot.value = chatHistoryEl.value.scrollTop;
  }
}

function handleResize() {
  viewportTick.value += 1;
}

onMounted(() => {
  if (chatHistoryEl.value) {
    chatHistoryEl.value.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }
  window.addEventListener('resize', handleResize);
});

function getLastAiChatIndex(): number {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const message = messages.value[i];
    if (message.role === 'ai' && message.kind !== 'hint') {
      return i;
    }
  }
  return -1;
}

function captureMessageRef(
  el: Element | ComponentPublicInstance | null,
  msg: Message,
  index: number,
) {
  if (msg.role !== 'ai' || msg.kind === 'hint') {
    if (!el && index === getLastAiChatIndex()) {
      latestAiMessageElement.value = null;
    }
    return;
  }

  const lastIndex = getLastAiChatIndex();
  if (el instanceof HTMLElement && index === lastIndex) {
    latestAiMessageElement.value = el;
  } else if (!el && index === lastIndex) {
    latestAiMessageElement.value = null;
  }
}

function clearOverlayAutoHide() {
  if (overlayAutoHideTimer) {
    window.clearTimeout(overlayAutoHideTimer);
    overlayAutoHideTimer = null;
  }
}

function hideOverlay() {
  overlayState.visible = false;
  overlayState.hintPreview = null;
  overlayState.loadingLevel = null;
  overlayState.reason = null;
  clearOverlayAutoHide();
}

function configureTease(reason: NudgeReason) {
  overlayState.mode = 'tease';
  overlayState.reason = reason;
  overlayState.lines = reason === 'wrong' ? [...WRONG_LINES] : [...TEASE_LINES_BASE];
  overlayState.playfulRemark = null;
  overlayState.hintPreview = null;
}

async function triggerTeaseNudge(reason: NudgeReason) {
  configureTease(reason);
  await nextTick();
  if (overlayAnchor.value) {
    clearOverlayAutoHide();
    overlayState.visible = true;
  } else {
    overlayState.reason = null;
  }
}

function configureQuestionOverlay() {
  overlayState.mode = 'question';
  overlayState.reason = 'question';
  overlayState.lines = [...QUESTION_LINES];
  overlayState.playfulRemark = null;
  overlayState.hintPreview = null;
}

async function showQuestionOverlay() {
  configureQuestionOverlay();
  await nextTick();
  if (overlayAnchor.value) {
    overlayState.visible = true;
    clearOverlayAutoHide();
    overlayAutoHideTimer = window.setTimeout(() => {
      overlayState.visible = false;
      overlayState.reason = null;
      overlayState.hintPreview = null;
    }, 8000);
  } else {
    overlayState.reason = null;
  }
}

function clearInactivityNudge() {
  if (inactivityTimerId) {
    window.clearTimeout(inactivityTimerId);
    inactivityTimerId = null;
  }
}

function scheduleInactivityNudge() {
  clearInactivityNudge();
  inactivityTimerId = window.setTimeout(() => {
    void triggerTeaseNudge('timeout');
  }, 45000);
}

function buildHintContext(): string {
  const start = Math.max(messages.value.length - 6, 0);
  const recent = messages.value.slice(start);
  const context = recent
    .filter((msg) => msg.kind !== 'hint')
    .map((msg) => `${msg.role === 'ai' ? 'AI' : 'USER'}: ${msg.text}`)
    .join('\n');
  if (context.trim()) {
    return context;
  }
  return lastAiMessageText.value ? `AI: ${lastAiMessageText.value}` : '';
}

function appendHintMessage(level: HintLevel, hint: HintResponse): string {
  const label = HINT_LABELS[level] ?? '힌트';
  let body = hint.hint_text.trim();
  if (hint.keywords?.length) {
    body = hint.keywords.map((keyword) => `• ${keyword}`).join('\n');
  }
  const formatted = `[${label}]\n${body}`;
  messages.value.push({ role: 'ai', text: formatted, kind: 'hint' });
  return formatted;
}

function formatHintPreview(level: HintLevel, hint: HintResponse): string {
  if (hint.keywords?.length) {
    return hint.keywords.join(' · ');
  }
  return hint.hint_text;
}

async function handleHintRequest(level: HintLevel) {
  if (overlayState.loadingLevel) return;

  const context = buildHintContext();
  if (!context.trim()) {
    showToast('힌트를 제공할 질문이 없어요.');
    return;
  }

  overlayState.loadingLevel = level;
  try {
    const result = await api.requestHint(context, level, hintUsageCount.value);
    hintUsageCount.value += 1;
    const appended = appendHintMessage(level, result);
    overlayState.hintPreview = formatHintPreview(level, result);
    if (result.playful_remark) {
      overlayState.playfulRemark = result.playful_remark;
      overlayState.lines = [result.playful_remark];
    } else if (hintUsageCount.value >= 3) {
      overlayState.playfulRemark = '다음엔 스스로! 이번엔 꼭 성공하자! 😜';
      overlayState.lines = [overlayState.playfulRemark];
    }
    return appended;
  } catch (error) {
    console.error('힌트 요청 중 오류:', error);
    showToast('힌트를 가져오지 못했어요. 잠시 후 다시 시도해주세요.');
  } finally {
    overlayState.loadingLevel = null;
    scheduleInactivityNudge();
  }
}

function updateAccuracySignals(aiText: string) {
  const hasWrongSignal =
    aiText.includes('틀렸') ||
    aiText.includes('오답') ||
    aiText.toLowerCase().includes('incorrect') ||
    aiText.toLowerCase().includes('try again');
  const hasSuccessSignal =
    aiText.includes('정답') ||
    aiText.includes('잘했') ||
    aiText.toLowerCase().includes('correct');

  if (hasWrongSignal) {
    consecutiveWrongCount.value += 1;
    if (consecutiveWrongCount.value >= 2) {
      void triggerTeaseNudge('wrong');
    }
  } else if (hasSuccessSignal) {
    consecutiveWrongCount.value = 0;
    hideOverlay();
  } else {
    consecutiveWrongCount.value = Math.max(consecutiveWrongCount.value - 1, 0);
  }
}

function shouldShowQuestionOverlay(text: string): boolean {
  if (!text) return false;
  const lengthScore = text.length >= 80;
  const questionMarks = (text.match(/\?/g) ?? []).length;
  const hasList = text.includes('\n') || text.includes('1.') || text.includes('•');
  return lengthScore || questionMarks >= 1 || hasList;
}

async function handleSendMessage() {
  const text = inputText.value.trim();
  if (!text || isProcessingAudio.value || isProcessingText.value) return;

  clearInactivityNudge();
  hideOverlay();
  messages.value.push({ role: 'user', text });
  inputText.value = '';
  isProcessingText.value = true;

  try {
    const result = await api.getResponseFromText(text);
    await processAiResponse(result.response_text);
  } catch (error) {
    console.error('텍스트 응답 처리 중 오류:', error);
    showToast('응답 생성 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
    messages.value.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  } finally {
    isProcessingText.value = false;
  }
}

async function toggleRecording() {
  clearInactivityNudge();
  hideOverlay();

  if (isRecording.value) {
    try {
      await audioRecorder.stop();
      const blob = await audioRecorder.getBlob();
      isRecording.value = false;
      emit('voice-stop');
      if (!blob) {
        showToast('녹음된 오디오를 가져오지 못했습니다.');
        return;
      }
      await handleAudioProcessing(blob);
    } catch (error) {
      console.error('녹음 종료 중 오류:', error);
      isRecording.value = false;
      emit('voice-stop');
      showToast('녹음 종료 중 문제가 발생했습니다.');
    }
    return;
  }

  try {
    await audioRecorder.start();
    isRecording.value = true;
    emit('voice-start');
  } catch (error) {
    console.error('마이크 접근 오류:', error);
    showToast('마이크를 사용할 수 없습니다. 권한을 확인해주세요.');
  }
}

function focusInputField() {
  nextTick(() => {
    textareaEl.value?.focus();
  });
}

async function startVoiceChat() {
  if (isRecording.value) return;
  if (!audioRecorder.isNative()) {
    await toggleRecording();
    return;
  }
  try {
    await audioRecorder.start();
    isRecording.value = true;
    emit('voice-start');
  } catch (error) {
    console.error('네이티브 음성 녹음 시작 실패:', error);
    showToast('음성 녹음을 시작할 수 없습니다.');
  }
}

defineExpose({
  startVoiceChat,
  focusInput: focusInputField,
});

async function handleAudioProcessing(audioBlob: Blob) {
  isProcessingAudio.value = true;
  try {
    clearInactivityNudge();
    hideOverlay();
    const result = await api.getResponseFromAudio(audioBlob);
    messages.value.push({ role: 'user', text: `"${result.transcript}"` });
    await processAiResponse(result.response_text);
  } catch (error) {
    console.error('음성 응답 처리 중 오류:', error);
    showToast('음성 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    messages.value.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  } finally {
    isProcessingAudio.value = false;
  }
}

async function processAiResponse(text: string) {
  const ttsAudioBlob = await api.getTtsAudio(text);
  const audioUrl = URL.createObjectURL(ttsAudioBlob);
  messages.value.push({ role: 'ai', text, audioUrl, kind: 'chat' });
  lastAiMessageText.value = text;
  hintUsageCount.value = 0;
  overlayState.playfulRemark = null;
  overlayState.lines = [...TEASE_LINES_BASE];

  await nextTick();
  handleScroll();
  updateAccuracySignals(text);

  if (shouldShowQuestionOverlay(text) && overlayState.reason !== 'wrong') {
    void showQuestionOverlay();
  } else if (overlayState.reason === 'question') {
    clearOverlayAutoHide();
    overlayState.visible = false;
    overlayState.reason = null;
  }

  clearInactivityNudge();
  scheduleInactivityNudge();
}

function playAudio(url: string, index: number) {
  if (!audioPlayer.value) return;

  if (currentlyPlayingIndex.value === index) {
    audioPlayer.value.pause();
    currentlyPlayingIndex.value = null;
  } else {
    audioPlayer.value.src = url;
    void audioPlayer.value.play();
    currentlyPlayingIndex.value = index;
  }

  audioPlayer.value.onended = () => {
    currentlyPlayingIndex.value = null;
  };
}

watch(
  messages,
  () => {
    nextTick(() => {
      if (chatHistoryEl.value) {
        chatHistoryEl.value.scrollTop = chatHistoryEl.value.scrollHeight;
        handleScroll();
      }
    });
  },
  { deep: true }
);

watch(inputText, () => {
  if (!textareaEl.value) return;
  textareaEl.value.style.height = 'auto';
  textareaEl.value.style.height = `${textareaEl.value.scrollHeight}px`;
});

function handleInputFocus() {
  emit('input-focus');
}

function handleInputBlur() {
  emit('input-blur');
}

onBeforeUnmount(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  if (isRecording.value) {
    void audioRecorder.stop();
  }
  clearInactivityNudge();
  clearOverlayAutoHide();
  if (chatHistoryEl.value) {
    chatHistoryEl.value.removeEventListener('scroll', handleScroll);
  }
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.ai-tutor-widget {
  background-color: #ffffff;
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-history {
  flex-grow: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

.chat-message {
  display: flex;
  max-width: 82%;
}

.chat-message.user {
  align-self: flex-end;
}

.chat-message.ai {
  align-self: flex-start;
}

.chat-message.thinking {
  opacity: 0.6;
}

.chat-message.is-hint .message-content {
  background-color: #fef3c7;
  color: #92400e;
  border: 1px dashed rgba(245, 158, 11, 0.6);
}

.message-content {
  padding: 10px 15px;
  border-radius: 18px;
  position: relative;
  background-color: #f8fafc;
  color: #0f172a;
}

.chat-message.user .message-content {
  background-color: #6366f1;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.chat-message.ai .message-content {
  background-color: #e2e8f0;
  color: #0f172a;
  border-bottom-left-radius: 4px;
}

.message-content p {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.5;
}

.message-content.thinking {
  background-color: #e2e8f0;
  color: #64748b;
}

.audio-player {
  margin-top: 8px;
}

.play-pause-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background-color: rgba(15, 23, 42, 0.08);
  border-radius: 50%;
  cursor: pointer;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.play-pause-btn:hover {
  background-color: rgba(15, 23, 42, 0.16);
}

.chat-input-area {
  display: flex;
  padding: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.3);
  gap: 8px;
  align-items: flex-end;
  background-color: #f8fafc;
}

textarea {
  flex-grow: 1;
  border: 1px solid rgba(148, 163, 184, 0.6);
  border-radius: 20px;
  padding: 10px 15px;
  font-size: 15px;
  line-height: 1.4;
  resize: none;
  max-height: 120px;
  overflow-y: auto;
  font-family: inherit;
  background-color: #ffffff;
}

.chat-input-area button {
  border-radius: 9999px;
  min-width: 44px;
  height: 44px;
  padding: 0 14px;
  border: none;
  background-color: #6366f1;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.chat-input-area button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-input-area button:not(:disabled):hover {
  background-color: #4f46e5;
}

.mic-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.floating-cover {
  position: absolute;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.15);
  pointer-events: none;
  z-index: 4;
}

.floating-helper {
  position: absolute;
  z-index: 5;
  transform: translate(-50%, calc(-100% - 16px));
  display: flex;
  align-items: flex-end;
  gap: 12px;
  max-width: min(320px, 70vw);
}

.floating-helper.mode-question {
  transform: translate(-50%, -40%);
}

.floating-character {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 26px;
  box-shadow: 0 12px 24px rgba(79, 70, 229, 0.22);
  animation: helper-bounce 3s ease-in-out infinite;
}

.floating-helper.mode-question .floating-character {
  background: linear-gradient(135deg, #f97316, #fb7185);
}

.floating-bubble {
  position: relative;
  background: #0f172a;
  color: #f8fafc;
  padding: 16px 18px 18px;
  border-radius: 18px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.3);
  width: 100%;
}

.floating-helper.mode-question .floating-bubble {
  background: #ffffff;
  color: #111827;
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.18);
}

.floating-bubble::after {
  content: '';
  position: absolute;
  bottom: -14px;
  left: 24px;
  border-width: 14px 12px 0 12px;
  border-style: solid;
  border-color: #0f172a transparent transparent transparent;
}

.floating-helper.mode-question .floating-bubble::after {
  border-color: #ffffff transparent transparent transparent;
}

.floating-bubble p {
  margin: 0;
  font-weight: 600;
}

.floating-bubble .playful-remark {
  margin-top: 6px;
  font-weight: 500;
  font-size: 0.95rem;
}

.floating-bubble .hint-preview {
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(148, 163, 184, 0.15);
  color: inherit;
}

.floating-bubble .hint-preview pre {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  line-height: 1.45;
}

.floating-bubble .hint-usage {
  margin-top: 8px;
  font-size: 0.85rem;
  opacity: 0.8;
}

.floating-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.floating-actions button {
  border: none;
  border-radius: 9999px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
  background: #fbbf24;
  color: #1f2937;
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.floating-helper.mode-question .floating-actions button {
  background: #38bdf8;
  color: #0f172a;
}

.floating-actions button:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px rgba(251, 191, 36, 0.25);
}

.floating-actions button:disabled {
  opacity: 0.6;
  cursor: wait;
  transform: none;
  box-shadow: none;
}

.floating-helper.mode-question .floating-actions button:hover {
  box-shadow: 0 10px 18px rgba(56, 189, 248, 0.3);
}

.floating-bubble .close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}

.floating-helper-enter-active,
.floating-helper-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.floating-helper-enter-from,
.floating-helper-leave-to {
  opacity: 0;
  transform: translate(-50%, -120%);
}

.floating-cover-enter-active,
.floating-cover-leave-active {
  transition: opacity 0.2s ease;
}

.floating-cover-enter-from,
.floating-cover-leave-to {
  opacity: 0;
}

@keyframes helper-bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  background-color: rgba(30, 41, 59, 0.92);
  color: #f8fafc;
  padding: 10px 16px;
  border-radius: 9999px;
  font-size: 14px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.3s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .ai-tutor-widget {
    border-radius: 20px 20px 0 0;
  }
  .chat-history {
    padding: 16px;
  }
}
</style>
