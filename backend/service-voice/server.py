import os
import io
import asyncio
import subprocess
import shutil
from pathlib import Path
import traceback

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


@app.get("/api/tts")
async def tts_streaming_endpoint(text: str = Query(..., min_length=1)):
    return StreamingResponse(stream_text_to_speech_bytes(text), media_type="audio/mpeg")

# --- 서버 실행 ---
def run(host: str = "0.0.0.0", port: int = 8000):
    import uvicorn
    print(f"Starting Voice Server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=True)

if __name__ == "__main__":
    run()