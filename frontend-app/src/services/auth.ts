const TEXT_API_BASE = import.meta.env.VITE_TEXT_API_BASE ?? 'https://chatterpals.onrender.com'

export interface SignupPayload {
  username: string
  nickname: string
  password: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: {
    id: string
    username: string
    nickname: string
    created_at: string
  }
}

export async function signup(payload: SignupPayload): Promise<AuthResponse> {
  const response = await fetch(`${TEXT_API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '회원가입에 실패했습니다.')
  }
  return response.json()
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const formData = new URLSearchParams()
  formData.set('username', username)
  formData.set('password', password)

  const response = await fetch(`${TEXT_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '로그인에 실패했습니다.')
  }
  return response.json()
}

export async function fetchMe(token: string): Promise<AuthResponse['user']> {
  const response = await fetch(`${TEXT_API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error('사용자 정보를 불러오지 못했습니다.')
  }
  return response.json()
}

export interface MyRecord {
  id: string
  type: string
  created_at: string
  updated_at: string
  date: string
  meta: Record<string, unknown> | null
  title?: string
  payload?: Record<string, unknown>
  evaluation?: Record<string, unknown>
}

export async function fetchMyRecords(token: string): Promise<MyRecord[]> {
  const response = await fetch(`${TEXT_API_BASE}/me/records`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '학습 기록을 불러오지 못했습니다.')
  }
  const data = await response.json()
  return data.records ?? []
}

export async function fetchMyRecord(token: string, id: string): Promise<MyRecord> {
  const response = await fetch(`${TEXT_API_BASE}/me/records/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '기록을 불러오지 못했습니다.')
  }
  return response.json()
}

export async function deleteMyRecord(token: string, id: string): Promise<void> {
  const response = await fetch(`${TEXT_API_BASE}/me/records/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '기록 삭제에 실패했습니다.')
  }
}

export async function evaluateDiscussionRecord(token: string, id: string) {
  const response = await fetch(`${TEXT_API_BASE}/chat/evaluate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record_id: id }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '토론 평가에 실패했습니다.')
  }
  return response.json()
}

export interface MyRankingsResponse {
  level_test: {
    rank: number
    best_score: number
    attempts: number
    last_attempt?: string | null
  } | null
  learning: {
    questions: { rank: number; count: number; last_activity?: string | null } | null
    discussions: { rank: number; count: number; last_activity?: string | null } | null
  }
}

export async function fetchMyRankings(token: string): Promise<MyRankingsResponse> {
  const response = await fetch(`${TEXT_API_BASE}/me/rankings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '내 랭킹 정보를 불러오지 못했습니다.')
  }
  const data = await response.json()
  return {
    level_test: data.level_test ?? null,
    learning: {
      questions: data.learning?.questions ?? null,
      discussions: data.learning?.discussions ?? null,
    },
  }
}
