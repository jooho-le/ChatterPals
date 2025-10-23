<template>
  <main class="record-detail" aria-live="polite">
    <section v-if="loading" class="loading">기록을 불러오는 중...</section>
    <section v-else-if="error" class="error">{{ error }}</section>

    <section v-else class="content" v-if="record">
      <RouterLink to="/mypage" class="back">← 마이페이지로 돌아가기</RouterLink>
      <header class="header">
        <p class="type">{{ translateType(record.type) }}</p>
        <h1 class="title">{{ record.title || '제목 없음' }}</h1>
        <p class="date">{{ formatDate(record.created_at) }}</p>
      </header>

      <section v-if="record.type === 'questions'" class="section">
        <h2>질문 &amp; 답변</h2>
        <ol class="question-list">
          <li v-for="(item, index) in qaItems" :key="index">
            <p class="question">Q{{ index + 1 }}. {{ item.question }}</p>
            <p class="answer" v-if="item.answer">A. {{ item.answer }}</p>
            <p v-else class="answer empty">답변이 비어 있습니다.</p>
            <div v-if="item.evaluation" class="evaluation">
              <p class="evaluation-header">AI 평가</p>
              <ul>
                <li>문법: {{ item.evaluation.scores?.grammar ?? '-' }}/5</li>
                <li>어휘: {{ item.evaluation.scores?.vocabulary ?? '-' }}/5</li>
                <li>논리: {{ item.evaluation.scores?.clarity ?? '-' }}/5</li>
              </ul>
              <p class="feedback">{{ item.evaluation.feedback }}</p>
            </div>
          </li>
        </ol>
      </section>

      <section v-else-if="record.type === 'discussion'" class="section">
        <h2>토론 기록</h2>
        <article class="discussion" v-for="(entry, index) in discussionHistory" :key="index">
          <span class="role" :class="entry.role">{{ translateRole(entry.role) }}</span>
          <p class="content">{{ entry.content }}</p>
        </article>
        <div v-if="discussionEvaluation" class="discussion-eval">
          <h3>AI 평가</h3>
          <ul>
            <li>문법: {{ displayScore(discussionEvaluation.scores?.grammar) }}</li>
            <li>어휘: {{ displayScore(discussionEvaluation.scores?.vocabulary) }}</li>
            <li>논리: {{ displayScore(discussionEvaluation.scores?.clarity) }}</li>
          </ul>
          <p class="feedback">{{ discussionEvaluation.feedback }}</p>
        </div>
      </section>

      <section v-else-if="record.type === 'level_test'" class="section">
        <h2>레벨 테스트 결과</h2>
        <div v-if="levelTestEvaluation" class="level-summary">
          <p class="level-tag">{{ levelTestEvaluation.level }}</p>
          <p class="score">총점 {{ levelTestEvaluation.percentage }}% ({{ levelTestEvaluation.total_correct }} / {{ levelTestEvaluation.total_questions }})</p>
          <p class="summary">{{ levelTestEvaluation.feedback?.summary }}</p>
          <p v-if="levelTestEvaluation.feedback?.recommendation" class="summary">{{ levelTestEvaluation.feedback?.recommendation }}</p>
          <ul class="skill-breakdown">
            <li v-for="entry in levelTestSkillEntries" :key="entry.skill">
              <span class="skill-name">{{ translateSkill(entry.skill) }}</span>
              <span class="skill-score">{{ entry.correct }} / {{ entry.total }} ({{ entry.percentage }}%)</span>
              <div class="bar"><div class="fill" :style="{ width: entry.percentage + '%' }"></div></div>
            </li>
          </ul>
        </div>

        <div class="level-responses" v-if="levelTestResponses.length">
          <h3>문항별 해설</h3>
          <ol>
            <li v-for="item in levelTestResponses" :key="item.id" :class="{ correct: item.is_correct, wrong: !item.is_correct }">
              <header class="response-head">
                <span class="skill">{{ translateSkill(item.skill) }}</span>
                <span class="result-tag">{{ item.is_correct ? '정답' : '오답' }}</span>
              </header>
              <p v-if="item.passage" class="passage">{{ item.passage }}</p>
              <p class="prompt">{{ item.prompt }}</p>
              <ul class="option-list" v-if="item.options?.length">
                <li
                  v-for="option in item.options"
                  :key="option.id"
                  :class="{
                    answer: option.id === item.correct,
                    chosen: option.id === item.selected && option.id !== item.correct,
                  }"
                >
                  <strong>{{ option.id }}.</strong> {{ option.text }}
                </li>
              </ul>
              <p class="explain">정답: {{ item.correct }} · 나의 선택: {{ item.selected || '-' }}</p>
              <p class="explain" v-if="item.explanation">{{ item.explanation }}</p>
            </li>
          </ol>
        </div>
      </section>

      <section v-if="sourceText" class="section">
        <h2>분석한 원문</h2>
        <p class="source">{{ sourceText }}</p>
      </section>

      <div class="export-actions" v-if="record">
        <button class="export-btn" type="button" @click="exportPdf" :disabled="exporting">
          {{ exporting ? 'PDF 내보내는 중...' : '📄 PDF로 내보내기' }}
        </button>
        <p v-if="exportStatus" class="export-status">{{ exportStatus }}</p>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { fetchMyRecord, type MyRecord } from '@/services/auth'

type QAItem = {
  question: string
  answer?: string
  evaluation?: {
    scores?: {
      grammar?: number
      vocabulary?: number
      clarity?: number
    }
    feedback?: string
  }
}

type EvaluationRecordItem = {
  question?: string
  answer?: string
  evaluation?: QAItem['evaluation']
}

type DiscussionEntry = {
  role: string
  content: string
}

const route = useRoute()
const { token, ensureLoaded, isAuthenticated } = useAuth()
const record = ref<MyRecord | null>(null)
const loading = ref(false)
const error = ref('')
const exportStatus = ref('')
const exporting = ref(false)

const TEXT_API_BASE = import.meta.env.VITE_TEXT_API_BASE ?? 'https://chatterpals.onrender.com'

const qaItems = computed<QAItem[]>(() => {
  if (!record.value || record.value.type !== 'questions') return []
  const payload = (record.value.payload as { items?: QAItem[] }) || {}
  const evaluations = (record.value.evaluation as { evaluations?: EvaluationRecordItem[] })?.evaluations || []
  return (payload.items || []).map((item, index) => ({
    ...item,
    evaluation: evaluations[index]?.evaluation ?? item.evaluation,
  }))
})

const discussionHistory = computed<DiscussionEntry[]>(() => {
  if (!record.value || record.value.type !== 'discussion') return []
  const payload = record.value.payload as { history?: DiscussionEntry[] } | undefined
  return payload?.history ?? []
})

const discussionEvaluation = computed(() => {
  if (!record.value || record.value.type !== 'discussion') return null
  return record.value.evaluation as { scores?: { grammar?: number; vocabulary?: number; clarity?: number }; feedback?: string } | null
})

type LevelTestEvaluation = {
  total_correct: number
  total_questions: number
  percentage: number
  level: string
  feedback?: { summary?: string; recommendation?: string | null }
  skill_breakdown?: Record<string, { correct: number; total: number; percentage: number }>
}

type LevelTestResponse = {
  id: string
  skill: string
  prompt: string
  passage?: string
  options?: Array<{ id: string; text: string }>
  selected?: string
  correct?: string
  is_correct?: boolean
  explanation?: string
}

const levelTestEvaluation = computed<LevelTestEvaluation | null>(() => {
  if (!record.value || record.value.type !== 'level_test') return null
  return record.value.evaluation as LevelTestEvaluation | null
})

const levelTestSkillEntries = computed(() => {
  if (!levelTestEvaluation.value?.skill_breakdown) return []
  return Object.entries(levelTestEvaluation.value.skill_breakdown).map(([skill, stat]) => ({
    skill,
    correct: stat.correct,
    total: stat.total,
    percentage: stat.percentage,
  }))
})

const levelTestResponses = computed<LevelTestResponse[]>(() => {
  if (!record.value || record.value.type !== 'level_test') return []
  const payload = record.value.payload as { responses?: LevelTestResponse[] } | undefined
  return payload?.responses ?? []
})

const sourceText = computed(() => {
  const payload = record.value?.payload as { source_text?: string } | undefined
  return payload?.source_text || ''
})

async function loadRecord(id: string) {
  if (!token.value) return
  loading.value = true
  error.value = ''
  try {
    record.value = await fetchMyRecord(token.value, id)
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : '기록을 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('ko', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch (error) {
    return iso
  }
}

function translateType(type: string) {
  if (type === 'questions') return '질문·답변'
  if (type === 'discussion') return '토론'
  if (type === 'level_test') return '레벨 테스트'
  return type
}

function translateRole(role: string) {
  if (role === 'ai') return 'AI'
  if (role === 'user') return '나'
  return role
}

function translateSkill(skill: string) {
  if (skill === 'grammar') return '문법'
  if (skill === 'vocabulary') return '어휘'
  if (skill === 'reading') return '읽기'
  return skill
}

function displayScore(value?: number) {
  if (value == null || Number.isNaN(value)) return '-'
  return `${value}/5`
}

async function exportPdf() {
  exportStatus.value = ''
  if (!record.value) {
    exportStatus.value = '내보낼 기록이 없습니다.'
    return
  }
  if (!token.value) {
    exportStatus.value = '로그인 후 이용해주세요.'
    return
  }
  exporting.value = true
  try {
    const response = await fetch(`${TEXT_API_BASE}/me/records/${record.value.id}.pdf`, {
      headers: {
        Authorization: `Bearer ${token.value}`,
      },
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      throw new Error(detail?.detail ?? 'PDF를 생성하지 못했습니다.')
    }
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const safeTitle = (record.value.title || 'record').replace(/[^a-zA-Z0-9-_\.]/g, '_')
    link.href = blobUrl
    link.download = `${safeTitle}-${record.value.id.slice(0, 8)}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
    exportStatus.value = 'PDF로 내보냈습니다.'
  } catch (err) {
    exportStatus.value = err instanceof Error ? err.message : 'PDF 내보내기에 실패했습니다.'
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  if (!isAuthenticated.value) {
    error.value = '로그인 후 다시 확인해주세요.'
    return
  }
  const id = route.params.id as string
  loadRecord(id)
})

watch(() => route.params.id, (id) => {
  if (typeof id === 'string') {
    loadRecord(id)
  }
})

watch(record, () => {
  exportStatus.value = ''
})
</script>

<style scoped>
.record-detail {
  padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 48px);
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7ff 0%, #ffffff 60%);
}

.back {
  display: inline-block;
  margin-bottom: 1.5rem;
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}

.header {
  margin-bottom: 2rem;
}

.type {
  color: #4f46e5;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.title {
  margin: 0;
  font-size: clamp(1.8rem, 1.4rem + 1.2vw, 2.6rem);
}

.date {
  color: #6b7280;
  margin-top: 0.5rem;
}

.section {
  margin-bottom: 2rem;
  background: #111827;
  color: #f9fafb;
  padding: clamp(18px, 3vw, 26px);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.15);
}

.section h2 {
  margin-top: 0;
  margin-bottom: 1rem;
}

.question-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}

.question {
  font-weight: 600;
  margin: 0 0 0.35rem;
}

.answer {
  margin: 0;
}

.answer.empty {
  opacity: 0.6;
}

.evaluation {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: 12px;
  background: rgba(37, 99, 235, 0.12);
}

.evaluation-header {
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.evaluation ul {
  margin: 0 0 0.5rem;
  padding-left: 1.25rem;
}

.feedback {
  margin: 0;
}

.discussion {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 0.5rem 1rem;
  padding: 0.85rem;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.6);
}

.role {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #facc15;
}

.role.user {
  color: #34d399;
}

.content {
  margin: 0;
}

.discussion-eval {
  margin-top: 1rem;
  background: rgba(59, 130, 246, 0.15);
  border-radius: 14px;
  padding: 1rem;
}

.discussion-eval h3 {
  margin-top: 0;
}

.discussion-eval ul {
  margin: 0 0 0.5rem;
  padding-left: 1.2rem;
}

.level-summary {
  background: rgba(79, 70, 229, 0.18);
  padding: 1.25rem;
  border-radius: 16px;
  margin-bottom: 1.5rem;
}

.level-summary .level-tag {
  font-size: 1.4rem;
  font-weight: 700;
}

.level-summary .score {
  margin: 0.4rem 0;
  font-weight: 600;
}

.skill-breakdown {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
  display: grid;
  gap: 0.85rem;
}

.skill-breakdown li {
  display: grid;
  gap: 0.4rem;
}

.skill-breakdown .skill-name {
  font-weight: 600;
}

.skill-breakdown .skill-score {
  color: rgba(249, 250, 251, 0.85);
}

.skill-breakdown .bar {
  height: 8px;
  border-radius: 6px;
  background: rgba(249, 250, 251, 0.25);
  overflow: hidden;
}

.skill-breakdown .fill {
  height: 100%;
  background: #38bdf8;
  border-radius: inherit;
}

.level-responses {
  background: rgba(15, 23, 42, 0.7);
  border-radius: 16px;
  padding: 1.5rem;
}

.level-responses ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}

.level-responses li {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 1rem;
  border: 1px solid transparent;
}

.level-responses li.correct {
  border-color: rgba(16, 185, 129, 0.6);
}

.level-responses li.wrong {
  border-color: rgba(239, 68, 68, 0.6);
}

.response-head {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.level-responses .skill {
  font-weight: 600;
}

.result-tag {
  margin-left: auto;
  font-weight: 700;
}

.level-responses .passage {
  background: rgba(255, 255, 255, 0.08);
  padding: 0.6rem;
  border-radius: 10px;
  margin-bottom: 0.5rem;
}

.level-responses .prompt {
  font-weight: 600;
  margin: 0.4rem 0;
}

.level-responses .option-list {
  list-style: none;
  padding: 0;
  margin: 0.6rem 0;
  display: grid;
  gap: 0.4rem;
}

.level-responses .option-list li {
  display: flex;
  gap: 0.4rem;
}

.level-responses .option-list li.answer {
  font-weight: 700;
}

.level-responses .option-list li.chosen {
  color: #fca5a5;
}

.level-responses .explain {
  margin: 0.3rem 0;
  color: #d1d5db;
}

.export-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.6rem;
  margin-top: 1.5rem;
}

.export-btn {
  border: none;
  background: linear-gradient(135deg, #4f46e5, #0ea5e9);
  color: #fff;
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
}

.export-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.export-status {
  margin: 0;
  font-size: 0.95rem;
  color: #cbd5f5;
}

.source {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
}

.loading,
.error {
  font-size: 1.1rem;
  color: #4b5563;
}

.error {
  color: #dc2626;
}

@media (prefers-color-scheme: dark) {
  .record-detail {
    background: #030712;
    color: #e5e7eb;
  }
  .section {
    background: #0f172a;
  }
  .discussion-eval {
    background: rgba(59, 130, 246, 0.25);
  }
}
</style>
