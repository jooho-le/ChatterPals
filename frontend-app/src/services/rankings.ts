const TEXT_API_BASE = import.meta.env.VITE_TEXT_API_BASE ?? 'https://chatterpals-1gbe.onrender.com'

export interface LevelTestRankingEntry {
  rank: number
  nickname: string
  best_score: number
  attempts: number
  last_attempt?: string | null
}

export interface LearningRankingEntry {
  rank: number
  nickname: string
  count: number
  last_activity?: string | null
}

export interface RankingResponse {
  level_test: LevelTestRankingEntry[]
  learning: {
    questions: LearningRankingEntry[]
    discussions: LearningRankingEntry[]
  }
}

export async function fetchRankings(limit = 10): Promise<RankingResponse> {
  const response = await fetch(`${TEXT_API_BASE}/rankings?limit=${limit}`)
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.detail ?? '랭킹 정보를 불러오지 못했습니다.')
  }
  const data = await response.json()
  return {
    level_test: data.level_test ?? [],
    learning: {
      questions: data.learning?.questions ?? [],
      discussions: data.learning?.discussions ?? [],
    },
  }
}
