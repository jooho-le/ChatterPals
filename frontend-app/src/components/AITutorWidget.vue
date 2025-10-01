<template>
  <div class="ai-tutor-widget">
    <div class="chat-history" ref="chatHistoryEl">
      <div v-for="(msg, index) in messages" :key="index" :class="['chat-message', msg.role]">
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
import { nextTick, onBeforeUnmount, ref, watch, defineEmits, defineExpose } from 'vue';
import * as api from '@/services/api';
import * as audioRecorder from '@/services/audioRecorder';

interface Message {
  role: 'user' | 'ai';
  text: string;
  audioUrl?: string;
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

async function handleSendMessage() {
  const text = inputText.value.trim();
  if (!text || isProcessingAudio.value || isProcessingText.value) return;

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
  messages.value.push({ role: 'ai', text, audioUrl });
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
