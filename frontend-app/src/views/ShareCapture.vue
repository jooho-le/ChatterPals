<template>
  <main class="share-capture">
    <h1>공유한 콘텐츠</h1>
    <p v-if="!decodedText" class="empty">공유된 텍스트가 없습니다.</p>
    <p v-else class="payload">{{ decodedText }}</p>
    <button type="button" @click="openAssistant">AI 친구와 분석하기</button>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useFloatingPanel } from '@/composables/useFloatingPanel';

const route = useRoute();
const panelStore = useFloatingPanel();

const decodedText = computed(() => {
  const text = route.query.text;
  if (!text || typeof text !== 'string') return '';
  try {
    return decodeURIComponent(text);
  } catch (error) {
    console.warn('Failed to decode share target text', error);
    return text;
  }
});

function openAssistant() {
  const text = decodedText.value;
  if (text) {
    panelStore.setSharedText(text);
  }
  panelStore.open('drawer');
}

onMounted(() => {
  openAssistant();
});
</script>

<style scoped>
.share-capture {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px;
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  font-size: 1.8rem;
  color: #1e293b;
}

.payload {
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  white-space: pre-wrap;
}

.empty {
  color: #94a3b8;
}

button {
  align-self: flex-start;
  border: none;
  background: #6366f1;
  color: white;
  padding: 12px 24px;
  border-radius: 9999px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.2s ease;
}

button:hover {
  background: #4f46e5;
}
</style>
