<template>
  <Teleport to="body">
    <div class="floating-pet-wrapper" aria-live="polite">
      <transition name="restore-fade">
        <button
          v-if="isPetHidden"
          class="pet-restore"
          type="button"
          @click="handleRestore"
        >
          친구 다시 불러오기
        </button>
      </transition>

      <div v-if="!isPetHidden" class="pet-layer">
        <div
          class="pet-bubble"
          :class="{ dragging: isDragging, 'is-easter-egg': easterEgg }"
          :style="bubbleStyle"
          role="dialog"
          aria-label="친구 열기"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @pointerleave="onPointerLeave"
          @focusin="showQuickActions"
          @mouseenter="showQuickActions"
          @mouseleave="hideQuickActions"
          tabindex="0"
          @keydown.enter.prevent="openPanel()"
          @keydown.space.prevent="openPanel()"
        >
          <div class="pet-avatar">🐾</div>
          <transition name="quick-actions">
            <div v-if="quickActionsVisible" class="quick-actions" role="group" aria-label="빠른 실행">
              <button type="button" @click.stop="startVoice" aria-label="음성 대화 시작">🎙️</button>
              <button type="button" @click.stop="focusChat" aria-label="채팅창 열기">💬</button>
              <button type="button" @click.stop="goToHome" aria-label="앱 홈으로 이동">🏠</button>
              <button type="button" @click.stop="dismissPet" aria-label="펫 숨기기">🙈</button>
            </div>
          </transition>
        </div>
      </div>

      <transition name="panel-fade">
        <aside
          v-if="isOpen"
          class="floating-panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
        >
          <header class="panel-header">
            <div class="panel-title">
              <span>Chatter Friend</span>
              <span v-if="sharedPayload" class="shared-text">{{ sharedPayload }}</span>
            </div>
            <div class="panel-actions">
              <button type="button" @click="togglePanelMode" aria-label="패널 크기 전환">⤢</button>
              <button type="button" @click="closePanel" aria-label="패널 닫기">✕</button>
            </div>
          </header>
          <section class="panel-body">
            <AITutorWidget
              ref="widgetRef"
              @voice-start="handleVoiceStart"
              @voice-stop="handleVoiceStop"
              @input-focus="handleInputFocus"
              @input-blur="handleInputBlur"
              @error="handleWidgetError"
            />
          </section>
        </aside>
      </transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AITutorWidget from '@/components/AITutorWidget.vue';
import { useFloatingPanel } from '@/composables/useFloatingPanel';
import { onSharedData, syncOverlayPosition, toggleOverlay } from '@/services/nativeBridge';

const router = useRouter();
const panelStore = useFloatingPanel();

const widgetRef = ref<InstanceType<typeof AITutorWidget> | null>(null);
const isDragging = ref(false);
const dragOffset = reactive({ x: 0, y: 0 });
let activePointerId: number | null = null;

const quickActionsVisible = ref(false);
let quickActionsTimer: number | undefined;

const easterEgg = ref(false);
let easterEggTimer: number | undefined;
let longPressTimer: number | undefined;

const sharedPayload = ref<string | null>(null);

const panelModeOrder: Array<'half' | 'drawer' | 'full'> = ['half', 'drawer', 'full'];

const isOpen = panelStore.isOpen;
const panelMode = panelStore.panelMode;
const petPosition = panelStore.petPosition;
const isPetHidden = panelStore.isPetHidden;

const bubbleStyle = computed(() => ({
  transform: `translate3d(${petPosition.value.x}px, ${petPosition.value.y}px, 0)`,
}));

const panelClass = computed(() => {
  switch (panelMode.value) {
    case 'full':
      return 'mode-full';
    case 'drawer':
      return 'mode-drawer';
    default:
      return 'mode-half';
  }
});

function clampPosition(position: { x: number; y: number }) {
  const bubbleSize = 76;
  const padding = 16;
  const maxX = window.innerWidth - bubbleSize - padding;
  const maxY = window.innerHeight - bubbleSize - padding;
  const x = Math.min(Math.max(padding, position.x), Math.max(padding, maxX));
  const y = Math.min(Math.max(padding, position.y), Math.max(padding, maxY));
  panelStore.setPetPosition({ x, y });
  void syncOverlayPosition({ x, y }).catch((error) => console.warn('overlay sync failed', error));
}

function onPointerDown(event: PointerEvent) {
  activePointerId = event.pointerId;
  isDragging.value = false;
  dragOffset.x = event.clientX - petPosition.value.x;
  dragOffset.y = event.clientY - petPosition.value.y;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  startLongPress();
}

function onPointerMove(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  const deltaX = event.clientX - dragOffset.x;
  const deltaY = event.clientY - dragOffset.y;
  if (!isDragging.value) {
    const distance = Math.hypot(deltaX - petPosition.value.x, deltaY - petPosition.value.y);
    if (distance > 6) {
      isDragging.value = true;
      cancelLongPress();
    }
  }
  if (isDragging.value) {
    clampPosition({ x: deltaX, y: deltaY });
  }
}

function onPointerUp(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  if (!isDragging.value) {
    openPanel();
  }
  isDragging.value = false;
  activePointerId = null;
  cancelLongPress();
}

function onPointerCancel() {
  isDragging.value = false;
  activePointerId = null;
  cancelLongPress();
}

function onPointerLeave() {
  cancelLongPress();
}

function startLongPress() {
  cancelLongPress();
  longPressTimer = window.setTimeout(() => {
    easterEgg.value = true;
    easterEggTimer = window.setTimeout(() => {
      easterEgg.value = false;
    }, 1200);
  }, 1100);
}

function cancelLongPress() {
  if (longPressTimer) {
    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
}

function showQuickActions() {
  quickActionsVisible.value = true;
  if (quickActionsTimer) {
    window.clearTimeout(quickActionsTimer);
  }
  quickActionsTimer = window.setTimeout(() => {
    quickActionsVisible.value = false;
  }, 4000);
}

function hideQuickActions() {
  if (quickActionsTimer) {
    window.clearTimeout(quickActionsTimer);
    quickActionsTimer = undefined;
  }
  quickActionsVisible.value = false;
}

function openPanel(mode?: 'half' | 'drawer' | 'full') {
  panelStore.open(mode);
  void toggleOverlay('hide').catch((error) => console.warn('overlay hide failed', error));
  nextTick(() => {
    widgetRef.value?.focusInput();
  });
}

function closePanel() {
  panelStore.close();
  sharedPayload.value = null;
  void toggleOverlay('show').catch((error) => console.warn('overlay show failed', error));
}

function togglePanelMode() {
  const currentIndex = panelModeOrder.indexOf(panelMode.value);
  const nextIndex = (currentIndex + 1) % panelModeOrder.length;
  panelStore.setMode(panelModeOrder[nextIndex]);
}

function startVoice() {
  openPanel('full');
  nextTick(() => {
    widgetRef.value?.startVoiceChat();
  });
}

function focusChat() {
  openPanel('drawer');
  nextTick(() => {
    widgetRef.value?.focusInput();
  });
}

function goToHome() {
  void router.push('/');
  openPanel(panelMode.value);
}

function dismissPet() {
  panelStore.hidePet();
  closePanel();
}

function handleRestore() {
  panelStore.restorePet();
  void toggleOverlay('show').catch((error) => console.warn('overlay show failed', error));
}

function handleVoiceStart() {
  panelStore.setMode('full');
}

function handleVoiceStop() {
  if (panelMode.value === 'full') {
    panelStore.setMode('half');
  }
}

function handleInputFocus() {
  if (window.innerWidth < 768) {
    panelStore.setMode('full');
  }
}

function handleInputBlur() {
  if (window.innerWidth < 768) {
    panelStore.setMode('half');
  }
}

function handleWidgetError(message: string) {
  console.warn('Widget error:', message);
}

watch(
  () => panelStore.sharedText.value,
  (value) => {
    if (value) {
      sharedPayload.value = value;
      panelStore.open('drawer');
      nextTick(() => {
        widgetRef.value?.focusInput();
      });
      panelStore.setSharedText(null);
    }
  }
);

onMounted(() => {
  clampPosition({ x: petPosition.value.x, y: petPosition.value.y });
  window.addEventListener('resize', handleResize);
  onSharedData((text) => {
    if (text) {
      panelStore.setSharedText(text);
    }
  });
  void toggleOverlay('show').catch((error) => console.warn('overlay show failed', error));
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (quickActionsTimer) {
    window.clearTimeout(quickActionsTimer);
  }
  if (easterEggTimer) {
    window.clearTimeout(easterEggTimer);
  }
  cancelLongPress();
});

function handleResize() {
  clampPosition({ x: petPosition.value.x, y: petPosition.value.y });
}
</script>

<style scoped>
.floating-pet-wrapper {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 3000;
}

.pet-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pet-bubble {
  position: absolute;
  width: 72px;
  height: 72px;
  border-radius: 36px;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  box-shadow: 0 20px 40px rgba(79, 70, 229, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  outline: none;
}

.pet-bubble:focus-visible {
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.4);
}

.pet-bubble.dragging {
  cursor: grabbing;
  box-shadow: 0 24px 48px rgba(79, 70, 229, 0.45);
}

.pet-avatar {
  font-size: 2rem;
  animation: idle-bounce 3s ease-in-out infinite;
}

.pet-bubble.is-easter-egg .pet-avatar {
  animation: celebrate 1s ease forwards;
}

.quick-actions {
  position: absolute;
  bottom: 82px;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(15, 23, 42, 0.85);
  padding: 10px;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
}

.quick-actions button {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #f8fafc;
  font-size: 1.1rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.quick-actions button:hover,
.quick-actions button:focus-visible {
  background: rgba(255, 255, 255, 0.4);
}

.floating-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(420px, calc(100vw - 32px));
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(12px);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.45);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 120px);
}

.floating-panel.mode-half {
  height: min(60vh, 520px);
}

.floating-panel.mode-drawer {
  height: min(75vh, 640px);
}

.floating-panel.mode-full {
  inset: 0;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  max-height: none;
}

@media (max-width: 768px) {
  .floating-panel {
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0 auto;
    width: 100vw;
    border-radius: 28px 28px 0 0;
    max-height: 80vh;
  }
  .floating-panel.mode-half {
    height: 50vh;
  }
  .floating-panel.mode-drawer {
    height: 65vh;
  }
  .floating-panel.mode-full {
    inset: 0;
    max-height: 100vh;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.75);
  color: #f8fafc;
}

.panel-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-weight: 600;
}

.panel-title .shared-text {
  font-size: 12px;
  background: rgba(255, 255, 255, 0.16);
  padding: 4px 8px;
  border-radius: 9999px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-actions button {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  border: none;
  background: rgba(248, 250, 252, 0.2);
  color: #f8fafc;
  cursor: pointer;
}

.panel-body {
  flex: 1;
  background: rgba(255, 255, 255, 0.92);
}

.pet-restore {
  position: fixed;
  left: 16px;
  bottom: 24px;
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.8);
  color: #f8fafc;
  border: none;
  border-radius: 9999px;
  padding: 12px 20px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
}

.panel-fade-enter-active,
.panel-fade-leave-active,
.restore-fade-enter-active,
.restore-fade-leave-active {
  transition: opacity 0.25s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to,
.restore-fade-enter-from,
.restore-fade-leave-to {
  opacity: 0;
}

.quick-actions-enter-active,
.quick-actions-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.quick-actions-enter-from,
.quick-actions-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

@keyframes idle-bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

@keyframes celebrate {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.2) rotate(-10deg);
  }
  80% {
    transform: scale(1.1) rotate(10deg);
  }
  100% {
    transform: scale(1);
  }
}
</style>
