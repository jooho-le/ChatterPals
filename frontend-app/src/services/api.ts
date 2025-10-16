// frontend-app/src/services/api.ts

const VOICE_API_BASE = 'http://127.0.0.1:8000/api';

/**
 * 음성 파일을 서버로 보내 텍스트로 변환(STT)하고 AI 응답까지 받습니다.
 * (service-voice/server.py의 /api/get-ai-response 엔드포인트 호출)
 */
export async function getResponseFromAudio(audioBlob: Blob) {
  const formData = new FormData();
  // 백엔드에서 'audio'라는 이름으로 파일을 기대하므로 수정합니다.
  formData.append('audio', audioBlob, 'recording.webm');

  const response = await fetch(`${VOICE_API_BASE}/get-ai-response`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('음성 인식에 실패했습니다.');
  return response.json();
}

/**
 * 텍스트를 서버로 보내 AI 응답을 받습니다.
 * (service-voice/server.py의 /api/get-ai-response-from-text 엔드포인트 호출)
 */
export async function getResponseFromText(text: string) {
    const response = await fetch(`${VOICE_API_BASE}/get-ai-response-from-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error('텍스트 응답 생성에 실패했습니다.');
    return response.json();
}


/**
 * 텍스트를 AI 음성(TTS)으로 변환하는 오디오 데이터를 Blob 형태로 가져옵니다.
 * (service-voice/server.py의 /api/tts 엔드포인트 호출)
 */
export async function getTtsAudio(text: string): Promise<Blob> {
  const response = await fetch(`${VOICE_API_BASE}/tts?text=${encodeURIComponent(text)}`);
  if (!response.ok) {
    throw new Error('TTS 오디오를 가져오는 데 실패했습니다.');
  }
  return response.blob();
}

export type HintLevel = 'starter' | 'keywords' | 'translation';

export interface HintResponse {
  level: HintLevel;
  hint_text: string;
  keywords?: string[];
  playful_remark?: string | null;
}

export async function requestHint(context: string, level: HintLevel, usageCount = 0): Promise<HintResponse> {
  const response = await fetch(`${VOICE_API_BASE}/hints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, level, usage_count: usageCount }),
  });

  if (!response.ok) {
    throw new Error('힌트 생성에 실패했습니다.');
  }

  return response.json() as Promise<HintResponse>;
}
