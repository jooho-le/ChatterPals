const TEXT_API_BASE = import.meta.env.VITE_TEXT_API_BASE
  ?? ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:8008/text'
      : 'https://chatterpals.onrender.com/text')

export interface LevelTestOption {
  id: string
  text: string
}

export interface LevelTestQuestion {
  id: string
  skill: string
  level: string
  prompt: string
  passage?: string
  options: LevelTestOption[]
}

export interface LevelTestStartResponse {
  questions: LevelTestQuestion[]
  skills: string[]
  levels: string[]
  session_id: string
  mode: 'dynamic' | 'static'
}

export interface LevelTestResponseItem {
  question_id: string
  answer: string
}

export interface LevelTestEvaluation {
  total_correct: number
  total_questions: number
  percentage: number
  level: string
  skill_breakdown: Record<string, { correct: number; total: number; percentage: number }>
  focus_skill?: string | null
  feedback: {
    summary?: string
    recommendation?: string | null
    score_text?: string
  }
}

export interface LevelTestSubmitResponse {
  evaluation: LevelTestEvaluation
  details: Array<{
    id: string
    skill: string
    prompt: string
    passage?: string | null
    options?: LevelTestOption[]
    selected?: string
    correct?: string
    is_correct?: boolean
    explanation?: string
  }>
  record_id?: string | null
}

export async function startLevelTest(count = 12, mode: 'dynamic' | 'static' = 'dynamic'): Promise<LevelTestStartResponse> {
  const response = await fetch(`${TEXT_API_BASE}/level-test/start?count=${count}&mode=${mode}`)
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '레벨 테스트 문항을 불러오지 못했습니다.')
  }
  return response.json()
}

export async function submitLevelTest(
  responses: LevelTestResponseItem[],
  token?: string,
  sessionId?: string,
): Promise<LevelTestSubmitResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${TEXT_API_BASE}/level-test/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ responses, session_id: sessionId }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '레벨 테스트 채점에 실패했습니다.')
  }
  return response.json()
}

export interface WordTip {
  word: string
  meaning: string
}

export async function fetchWordTips(count = 3): Promise<WordTip[]> {
  const response = await fetch(`${TEXT_API_BASE}/level-test/words?count=${count}`)
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '단어 정보를 불러오지 못했습니다.')
  }
  const data = await response.json()
  return data.words ?? []
}
