const TEXT_API_BASE = import.meta.env.VITE_TEXT_API_BASE
  ?? ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:8008/text'
      : 'https://chatterpals.onrender.com/text')

export interface DailyGoal {
  id?: string | null
  goal_date: string
  questions_target: number
  discussions_target: number
  questions_completed: number
  discussions_completed: number
  achieved: boolean
  achieved_at: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface SaveDailyGoalPayload {
  goal_date?: string
  questions_target: number
  discussions_target: number
}

export interface DailyGoalHistoryItem {
  goal_date: string
  questions_target: number
  discussions_target: number
  achieved_at: string
}

function authHeaders(token: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

export async function fetchDailyGoal(token: string, goalDate?: string): Promise<DailyGoal> {
  const params = goalDate ? `?date=${encodeURIComponent(goalDate)}` : ''
  const response = await fetch(`${TEXT_API_BASE}/me/daily-goal${params}`, {
    headers: authHeaders(token),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '일일 목표를 불러오지 못했습니다.')
  }
  return response.json()
}

export async function saveDailyGoal(token: string, payload: SaveDailyGoalPayload): Promise<DailyGoal> {
  const response = await fetch(`${TEXT_API_BASE}/me/daily-goal`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '일일 목표를 저장하지 못했습니다.')
  }
  return response.json()
}

export async function fetchDailyGoalHistory(token: string, limit = 7): Promise<DailyGoalHistoryItem[]> {
  const response = await fetch(`${TEXT_API_BASE}/me/daily-goal/history?limit=${limit}`, {
    headers: authHeaders(token),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '목표 달성 이력을 불러오지 못했습니다.')
  }
  const data = await response.json()
  return data?.history ?? []
}
