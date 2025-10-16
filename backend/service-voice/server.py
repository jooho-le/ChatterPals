import json
import os
import io
import asyncio
import subprocess
import shutil
from pathlib import Path
import traceback
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv, find_dotenv
import google.generativeai as genai
import requests

# --- 환경 변수 및 API 클라이언트 설정 ---
load_dotenv(find_dotenv())
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise RuntimeError("'.env' 파일에 GOOGLE_API_KEY가 없습니다.")
genai.configure(api_key=GOOGLE_API_KEY)

ELEVEN_API_KEY = os.getenv("ELEVEN_API_KEY")
if not ELEVEN_API_KEY:
    raise RuntimeError("'.env' 파일에 ELEVEN_API_KEY가 없습니다.")

# --- FastAPI 앱 초기화 ---
app = FastAPI(title="ChatterPals Voice API", version="1.2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 모델 및 프롬프트 설정 ---
MODEL_STT = "gemini-2.0-flash-lite-preview"
MODEL_CHAT = "gemini-2.0-flash-lite-preview"
SYSTEM_PROMPT = "너는 친절하고 상냥한 AI 외국어 교육 어시스턴트야. 발음,회화, 문법등을 대화하면서 도와주는 선생님이지."

# --- 헬퍼 함수 ---
SUPPORTED_DIRECT_MIME = {
    "audio/wav",
    "audio/x-wav",
    "audio/vnd.wave",
    "audio/wave",
}


class TextRequest(BaseModel):
    text: str


class HintRequest(BaseModel):
    context: str
    level: Literal["starter", "keywords", "translation"]
    usage_count: int = 0


class HintResponse(BaseModel):
    level: Literal["starter", "keywords", "translation"]
    hint_text: str
    keywords: list[str] | None = None
    playful_remark: str | None = None


class AnswerCheckRequest(BaseModel):
    question: str
    user_answer: str
    context: str | None = None


class AnswerCheckResponse(BaseModel):
    is_correct: bool
    feedback: str
    score: float | None = None
    model_answer: str | None = None

def transcode_to_wav_pcm16k(audio_bytes: bytes, mime_type: str | None = None) -> bytes:
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        if mime_type and mime_type in SUPPORTED_DIRECT_MIME:
            return audio_bytes
        raise FileNotFoundError("FFmpeg가 설치되어 있지 않습니다. 시스템에 FFmpeg를 설치해주세요.")

    base_command = [
        ffmpeg_path, '-i', 'pipe:0', '-acodec', 'pcm_s16le',
        '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
    ]

    command = base_command.copy()
    if mime_type and mime_type in {"audio/pcm", "application/octet-stream"}:
        command = [
            ffmpeg_path, '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', 'pipe:0',
            '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
        ]

    try:
        process = subprocess.run(command, input=audio_bytes, capture_output=True, check=True)
    except subprocess.CalledProcessError as error:
        if mime_type and mime_type in SUPPORTED_DIRECT_MIME:
            return audio_bytes
        raise error

    return process.stdout

async def stream_text_to_speech_bytes(text: str):
    voice_id = "EXAVITQu4vr4xnSDxMaL"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    headers = {"xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json"}
    payload = {
        "text": text, "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
    }
    try:
        response = requests.post(url, headers=headers, json=payload, stream=True)
        response.raise_for_status()
        for chunk in response.iter_content(chunk_size=1024):
            if chunk: yield chunk
    except Exception as e:
        print(f"TTS 오류: {e}")
        yield b''

# --- API 엔드포인트 ---
@app.get("/")
def get_status():
    return {"status": "Voice server is running"}

@app.post("/api/get-ai-response")
async def get_ai_response(audio: UploadFile = File(...)):
    try:
        print("[1/3] 오디오 파일 수신 및 변환 중...")
        input_audio_bytes = await audio.read()
        wav_audio_bytes = transcode_to_wav_pcm16k(input_audio_bytes, audio.content_type)

        print("[2/3] Gemini File API에 오디오 업로드 및 STT 실행 중...")
        uploaded_file = genai.upload_file(
            path=io.BytesIO(wav_audio_bytes),
            display_name="user_audio.wav",
            mime_type="audio/wav"
        )
        stt_model = genai.GenerativeModel(MODEL_STT)

        # AI가 더 잘 인식하도록 프롬프트를 직접적으로 수정
        stt_prompt = "이 오디오 파일의 내용을 텍스트로 받아적어 주세요."
        stt_response = await stt_model.generate_content_async([stt_prompt, uploaded_file])
        
        # 더 안정적인 파싱 방법 사용
        transcript = "".join(part.text for part in stt_response.candidates[0].content.parts).strip()
        print(f"[2/3] STT 결과: '{transcript}'")

        # '인식 실패' 문자열 대신, 결과가 비어 있는지 여부로 판단
        if not transcript:
            print("[오류] STT 결과가 비어 있습니다. 음성 인식이 실패한 것으로 간주합니다.")
            raise ValueError("STT recognized empty text.")

        print("[3/3] Gemini 채팅 응답 생성 중...")
        chat_model = genai.GenerativeModel(MODEL_CHAT, system_instruction=SYSTEM_PROMPT)
        llm_response = await chat_model.generate_content_async(transcript)
        response_text = "".join(part.text for part in llm_response.candidates[0].content.parts).strip()
        print(f"[3/3] Gemini 응답: {response_text}")

        return JSONResponse(content={"transcript": transcript, "response_text": response_text})

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"음성 처리 중 서버 오류 발생: {str(e)}")


@app.post("/api/get-ai-response-from-text")
async def get_ai_response_from_text(payload: TextRequest):
    transcript = payload.text.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="질문 텍스트가 비어 있습니다.")

    try:
        chat_model = genai.GenerativeModel(MODEL_CHAT, system_instruction=SYSTEM_PROMPT)
        llm_response = await chat_model.generate_content_async(transcript)
        response_text = "".join(
            part.text for part in llm_response.candidates[0].content.parts
        ).strip()
        if not response_text:
            raise ValueError("생성된 응답이 비어 있습니다.")
        return {"transcript": transcript, "response_text": response_text}
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"텍스트 응답 생성 실패: {error}")


@app.get("/api/tts")
async def tts_streaming_endpoint(text: str = Query(..., min_length=1)):
    return StreamingResponse(stream_text_to_speech_bytes(text), media_type="audio/mpeg")


HINT_SYSTEM_PROMPT = """당신은 영어 회화와 독해 학습을 돕는 장난꾸러기 튜터입니다.
정답을 직접 말하지 않고, 학습자가 스스로 추론할 수 있는 부드러운 단서를 제공합니다.
모든 응답은 한국어로 작성하되, 필요한 영어 단어는 괄호 안에 병기하세요."""

EVAL_SYSTEM_PROMPT = """You are an English language tutor grading short answers.
Always respond with JSON only and be fair and concise in your evaluation."""

HINT_LEVEL_TEMPLATES = {
    "starter": """[Role] Provide one or two short hints in ENGLISH that help the learner guess the missing expression without giving the exact answer.
- Speak only in English.
- Encourage the learner to think about the meaning or nuance.

[Context]
{context}

[Output]
1-2 friendly English hint sentences.""",
    "keywords": """[역할] 정답을 떠올리는 데 도움이 되는 한국어 핵심 단어 3개를 골라.
- 키워드는 한국어 1~3어절로 제시해.
- 영어 번역은 적지 않아.

[문맥]
{context}

[출력]
- 단어1
- 단어2
- 단어3""",
    "translation": """[역할] 학습자가 방향을 잡을 수 있도록 문맥의 일부만 한국어로 살짝 번역해.
- 40자 이내의 짧은 한국어 문장 1개만 제공.
- 전체 정답을 알 수는 없지만 감을 잡을 수 있게 해.

[문맥]
{context}

[출력]
짧은 한국어 문장 1개.""",
}


def _extract_keywords(raw_text: str) -> list[str]:
    normalized = raw_text.replace("•", "\n").replace(",", "\n")
    results: list[str] = []
    for line in normalized.splitlines():
        token = line.strip(" -•\t\r\n0123456789.")
        if not token:
            continue
        results.append(token.strip())
        if len(results) >= 3:
            break
    return results


ANSWER_EVAL_TEMPLATE = """You are grading a learner's answer with help from Gemini. Analyse carefully and respond with strict JSON (no code fences, no commentary).
Expected JSON schema:
{{
  "is_correct": true | false,
  "feedback": "<짧은 코멘트 한국어>",
  "score": <0.0-1.0 숫자>,
  "model_answer": "<정답 또는 모범 답안 (한국어 또는 필요한 경우 영어)>"
}}

- "feedback": 간단하고 응원하는 한국어 문장 1~2개.
- "model_answer": 학습자가 참고할 정답 요약. 정답이 명확하지 않다면 질문을 더 분석해 제공 가능한 최선의 답을 작성.
- "score": 0과 1 사이 (예: 0.0, 0.25, 0.5, 0.75, 1.0).
- "is_correct": 학습자의 답이 충분히 맞다면 true, 아니면 false.

질문: {question}
학습자 답변: {user_answer}
참고 문맥: {context}
"""


def _parse_json_response(raw_text: str) -> dict[str, object]:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            snippet = raw_text[start : end + 1]
            return json.loads(snippet)
        raise


@app.post("/api/hints", response_model=HintResponse)
async def generate_hint(payload: HintRequest):
    template = HINT_LEVEL_TEMPLATES.get(payload.level)
    if not template:
        raise HTTPException(status_code=400, detail="지원하지 않는 힌트 레벨입니다.")

    context = payload.context.strip()
    if not context:
        raise HTTPException(status_code=400, detail="문맥(context)이 비어 있습니다.")

    prompt = template.format(context=context)

    try:
        model = genai.GenerativeModel(MODEL_CHAT, system_instruction=HINT_SYSTEM_PROMPT)
        ai_response = await model.generate_content_async(prompt)
        raw_text = "".join(
            part.text for part in ai_response.candidates[0].content.parts
        ).strip()

        hint_text = raw_text
        keywords: list[str] | None = None

        if payload.level == "keywords":
            keywords = _extract_keywords(raw_text)
            if keywords:
                hint_text = "\n".join(keywords)

        playful_remark = None
        if payload.usage_count >= 3:
            playful_remark = "다음엔 스스로! 이번 힌트로 꼭 풀어봐. 😜"

        return HintResponse(
            level=payload.level,
            hint_text=hint_text,
            keywords=keywords,
            playful_remark=playful_remark,
        )
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"힌트 생성 실패: {error}")


@app.post("/api/check-answer", response_model=AnswerCheckResponse)
async def check_answer(payload: AnswerCheckRequest):
    question = payload.question.strip()
    user_answer = payload.user_answer.strip()
    if not question:
        raise HTTPException(status_code=400, detail="채점할 질문이 없습니다.")
    if not user_answer:
        raise HTTPException(status_code=400, detail="학습자 답변이 비어 있습니다.")

    context = payload.context.strip() if payload.context else ""
    prompt = ANSWER_EVAL_TEMPLATE.format(
        question=question,
        user_answer=user_answer,
        context=context or "없음",
    )

    try:
        model = genai.GenerativeModel(MODEL_CHAT, system_instruction=EVAL_SYSTEM_PROMPT)
        ai_response = await model.generate_content_async(prompt)
        raw_text = "".join(
            part.text for part in ai_response.candidates[0].content.parts
        ).strip()
        try:
            result = _parse_json_response(raw_text)
        except Exception as parse_error:
            raise HTTPException(
                status_code=502,
                detail=f"채점 결과를 파싱하지 못했습니다: {parse_error}",
            )

        is_correct = bool(result.get("is_correct"))
        feedback = str(result.get("feedback") or "").strip()
        score_value = result.get("score")
        model_answer = result.get("model_answer")

        score_float: float | None = None
        if isinstance(score_value, (int, float)):
            score_float = max(0.0, min(1.0, float(score_value)))
        elif isinstance(score_value, str):
            try:
                parsed_score = float(score_value)
                score_float = max(0.0, min(1.0, parsed_score))
            except ValueError:
                score_float = None

        if not feedback:
            feedback = "채점 결과를 가져왔습니다."

        return AnswerCheckResponse(
            is_correct=is_correct,
            feedback=feedback,
            score=score_float,
            model_answer=str(model_answer).strip() if model_answer else None,
        )
    except HTTPException:
        raise
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"채점 요청 중 오류 발생: {error}")


# --- 서버 실행 ---
def run(host: str = "0.0.0.0", port: int = 8000):
    import uvicorn
    print(f"Starting Voice Server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=True)

if __name__ == "__main__":
    run()
