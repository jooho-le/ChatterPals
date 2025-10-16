import os
import traceback
import json #
import ast
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from dotenv import load_dotenv, find_dotenv
import google.generativeai as genai

# --- 로컬 모듈 임포트 ---
from .analyze import analyze
from .chat import MANAGER as CHAT_MANAGER
from .extract import extract_from_url
from .level_test import (
    create_session as create_level_test_session,
    evaluate_responses as evaluate_level_test_responses,
    generate_dynamic_questions,
    get_daily_words,
    get_session_questions as get_level_test_session,
    questions_to_public_payload,
    select_questions as select_level_test_questions,
)
from .auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_current_user_optional,
    get_password_hash,
    sanitize_user,
)
from .records import (
    create_user,
    delete_record_for_user,
    get_record,
    get_user_by_username,
    list_records,
    list_records_for_user,
    record_to_pdf,
    records_to_pdf,
    save_questions_record,
    get_level_test_rankings,
    get_learning_volume_rankings,
    get_user_level_test_rank,
    get_user_learning_ranks,
    save_level_test_record,
    update_user_nickname,
    get_daily_goal_with_progress,
    upsert_daily_goal,
    list_goal_achievements,
)

# --- 환경 변수 및 API 클라이언트 설정 ---
load_dotenv(find_dotenv())
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise RuntimeError("'.env' 파일에 GOOGLE_API_KEY가 없습니다.")
genai.configure(api_key=GOOGLE_API_KEY)

# --- FastAPI 앱 초기화 ---
app = FastAPI(title="ChatterPals Text API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_goal_date(value: Optional[str]) -> str:
    if value:
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="잘못된 날짜 형식입니다. YYYY-MM-DD 형태로 입력해 주세요.") from exc
        return parsed.isoformat()
    return datetime.now(timezone.utc).date().isoformat()

# --- Pydantic 데이터 모델 정의 ---
class QuestionsRequest(BaseModel):
    text: Optional[str] = None
    max_questions: int = Field(5, ge=0, le=20)

class AnalyzeUrlRequest(BaseModel):
    url: str = Field(..., min_length=6)
    max_questions: int = Field(5, ge=0, le=20)

class QuestionAnswerItem(BaseModel):
    question: str
    answer: str = ""

class SaveQuestionsRequest(BaseModel):
    items: List[QuestionAnswerItem]
    summary: Optional[str] = None
    topics: Optional[List[str]] = None
    selection_text: Optional[str] = Field(None, max_length=4000)

# --- 신규 평가 기능 모델 추가 ---
class EvaluationRequest(BaseModel):
    items: List[QuestionAnswerItem]

class EvaluationScores(BaseModel):
    grammar: int
    vocabulary: int
    clarity: int

class EvaluationResult(BaseModel):
    scores: EvaluationScores
    feedback: str

class EvaluatedItem(BaseModel):
    question: str
    answer: str
    evaluation: Dict[str, Any]

class SaveEvaluationRequest(BaseModel):
    summary: str
    topics: List[str]
    items: List[EvaluatedItem]
    source_text: str

class ChatStartRequest(BaseModel):
    text: str
    max_questions: int = Field(6, ge=1, le=20)

class ChatStartFromUrlRequest(BaseModel):
    url: str = Field(..., min_length=6)
    max_questions: int = Field(6, ge=1, le=20)

class ChatReplyRequest(BaseModel):
    session_id: str
    answer: str


class ChatEndRequest(BaseModel):
    session_id: str


class DiscussionEvaluationRequest(BaseModel):
    record_id: str


class LevelTestOption(BaseModel):
    id: str
    text: str


class LevelTestQuestion(BaseModel):
    id: str
    skill: str
    level: str
    prompt: str
    options: List[LevelTestOption]
    passage: Optional[str] = None


class LevelTestResponseItem(BaseModel):
    question_id: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)


class LevelTestSubmitRequest(BaseModel):
    responses: List[LevelTestResponseItem]
    session_id: Optional[str] = None


class SignupRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    nickname: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class UpdateProfileRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=64)


class DailyGoalRequest(BaseModel):
    goal_date: Optional[str] = Field(
        None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="목표가 적용될 날짜 (YYYY-MM-DD). 비우면 오늘 날짜로 설정",
    )
    questions_target: int = Field(0, ge=0, le=999, description="하루 질문·답변 목표 수")
    discussions_target: int = Field(0, ge=0, le=999, description="하루 토론 목표 수")


class DailyGoalHistoryItem(BaseModel):
    goal_date: str
    questions_target: int
    discussions_target: int
    achieved_at: str

# --- API 엔드포인트 ---
@app.get("/")
def get_status():
    return {"status": "Text server is running"}


@app.post("/auth/signup")
def post_auth_signup(req: SignupRequest):
    username = req.username.strip().lower()
    nickname = req.nickname.strip()
    if not username or not nickname:
        raise HTTPException(status_code=400, detail="Username and nickname are required")
    existing = get_user_by_username(username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    password_hash = get_password_hash(req.password)
    user = create_user(username=username, nickname=nickname, password_hash=password_hash)
    sanitized = sanitize_user(user)
    token = create_access_token({"sub": sanitized["id"]})
    return {"access_token": token, "token_type": "bearer", "user": sanitized}


@app.post("/auth/login")
def post_auth_login(form_data: OAuth2PasswordRequestForm = Depends()):
    username = form_data.username.strip().lower()
    user = authenticate_user(username, form_data.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    token = create_access_token({"sub": user["id"]})
    return {"access_token": token, "token_type": "bearer", "user": user}


@app.get("/auth/me")
async def get_auth_me(current_user: dict = Depends(get_current_user)):
    return current_user


@app.patch("/auth/me")
async def patch_auth_me(req: UpdateProfileRequest, current_user: dict = Depends(get_current_user)):
    nickname = req.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="Nickname cannot be empty")
    updated = update_user_nickname(current_user["id"], nickname)
    return sanitize_user(updated)


@app.get("/me/records")
async def get_my_records(
    date: Optional[str] = Query(None, description="YYYY-MM-DD filter"),
    current_user: dict = Depends(get_current_user),
):
    records = list_records_for_user(current_user["id"], date=date)
    return {"records": records}


@app.get("/me/records/{record_id}.pdf")
async def get_my_record_pdf(record_id: str, current_user: dict = Depends(get_current_user)):
    record = get_record(record_id)
    if not record or record.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=404, detail="Record not found")
    pdf_bytes = record_to_pdf(record)
    filename = (record.get("title") or "record").replace(" ", "_")
    disposition = f"attachment; filename=\"{filename}-{record_id[:8]}.pdf\""
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": disposition})


@app.get("/me/records/{record_id}")
async def get_my_record(record_id: str, current_user: dict = Depends(get_current_user)):
    record = get_record(record_id)
    if not record or record.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@app.delete("/me/records/{record_id}", status_code=204)
async def delete_my_record(record_id: str, current_user: dict = Depends(get_current_user)):
    deleted = delete_record_for_user(record_id, current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")
    return Response(status_code=204)


@app.get("/me/daily-goal", tags=["Daily Goal"])
async def get_my_daily_goal(
    date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    goal_date = _resolve_goal_date(date)
    return get_daily_goal_with_progress(current_user["id"], goal_date)


@app.put("/me/daily-goal", tags=["Daily Goal"])
async def put_my_daily_goal(req: DailyGoalRequest, current_user: dict = Depends(get_current_user)):
    goal_date = _resolve_goal_date(req.goal_date)
    upsert_daily_goal(
        current_user["id"],
        goal_date,
        req.questions_target,
        req.discussions_target,
    )
    return get_daily_goal_with_progress(current_user["id"], goal_date)


@app.get("/me/daily-goal/history", tags=["Daily Goal"])
async def get_my_daily_goal_history(
    limit: int = Query(7, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
):
    history = list_goal_achievements(current_user["id"], limit=limit)
    return {"history": history}

@app.post("/questions")
def post_questions(req: QuestionsRequest):
    try:
        return analyze((req.text or "").strip(), max_questions=req.max_questions)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_url")
def post_analyze_url(req: AnalyzeUrlRequest):
    """Analyze content extracted from a URL and optionally generate questions.

    Returns the same shape as /questions with additional meta about the source.
    """
    try:
        text, meta = extract_from_url(req.url)
        result = analyze(text.strip(), max_questions=req.max_questions)
        result["meta"] = {**meta}
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"URL 분석 중 오류가 발생했습니다: {e}")


@app.get("/level-test/start", tags=["Level Test"])
async def get_level_test_start(
    count: int = Query(25, ge=6, le=50, description="Number of questions to deliver"),
    mode: str = Query(
        "dynamic",
        pattern="^(dynamic|static)$",
        description="dynamic: generate via LLM, static: use preset bank",
    ),
):
    questions_raw = None
    used_mode = mode
    if mode == "dynamic":
        try:
            questions_raw = await generate_dynamic_questions(count=count)
        except Exception as exc:
            print(f"[level-test] dynamic generation failed: {exc}")
            used_mode = "static"
    if questions_raw is None:
        questions_raw = select_level_test_questions(count)
    session_id = create_level_test_session(questions_raw)
    questions = questions_to_public_payload(questions_raw)
    skills = sorted({q["skill"] for q in questions})
    levels = sorted({q["level"] for q in questions})
    return {
        "questions": questions,
        "skills": skills,
        "levels": levels,
        "session_id": session_id,
        "mode": used_mode,
    }


@app.post("/level-test/submit", tags=["Level Test"])
def post_level_test_submit(
    req: LevelTestSubmitRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    if not req.responses:
        raise HTTPException(status_code=400, detail="응답이 전달되지 않았습니다.")

    response_pairs = [(item.question_id, item.answer) for item in req.responses]
    question_lookup = get_level_test_session(req.session_id)
    evaluation = evaluate_level_test_responses(response_pairs, question_lookup=question_lookup)
    if not evaluation.get("total_questions"):
        raise HTTPException(status_code=400, detail="채점할 유효한 문항이 없습니다.")

    details = evaluation.pop("details")
    record = None
    if current_user:
        try:
            record = save_level_test_record(
                responses=details,
                evaluation=evaluation,
                user_id=current_user["id"],
                meta={
                    "title": f"Level Test 결과 ({evaluation.get('level', 'N/A')})",
                    "summary": evaluation.get("feedback", {}).get("summary"),
                    "level": evaluation.get("level"),
                    "score": evaluation.get("percentage"),
                },
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"레벨 테스트 결과 저장에 실패했습니다: {exc}")

    return {
        "evaluation": evaluation,
        "details": details,
        "record_id": record.get("id") if record else None,
    }


@app.get("/level-test/words", tags=["Level Test"])
def get_level_test_words(count: int = Query(3, ge=1, le=10)):
    return {"words": get_daily_words(count=count)}

# ✅ [신규] 답변 평가 API
EVALUATION_MODEL = "gemini-2.0-flash-lite-preview"
JSON_GENERATION_CONFIG = {"response_mime_type": "application/json"}
EVALUATION_PROMPT_TEMPLATE = """
    당신은 외국어 학습자의 답변을 평가하는 AI 선생님입니다. 다음은 학생이 질문에 대해 작성한 답변입니다.
    - 질문: "{question}"
    - 학생 답변: "{answer}"
    아래의 세 가지 기준에 따라 답변을 평가하고, 각 항목별 점수(1~5점)와 구체적인 서술형 피드백을 JSON 형식으로 반환해 주세요.
    1.  **문법 및 정확성 (Grammar & Accuracy):** 문법 오류, 단어 선택의 정확성 평가
    2.  **어휘 사용 (Vocabulary Usage):** 사용된 어휘의 수준과 다양성 평가
    3.  **논리 및 명확성 (Clarity & Coherence):** 답변의 구조적 논리성과 명확성 평가
    피드백은 칭찬과 개선점을 모두 포함하고, 해당 사항을 반영한 예시 답변도 반환하여 주세요. 분량은 공백 포함 400자 이내로 제한하여 대답합니다.
    JSON 출력 예시: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "문법적으로는 훌륭하지만..."}}
    """

DISCUSSION_EVALUATION_PROMPT_TEMPLATE = """
    당신은 영어 토론 코치입니다. 아래의 토론 기록(역할: AI 또는 User)을 보고, User의 발화 품질을 평가해 주세요.
    세 가지 항목(문법, 어휘, 논리)을 1~5점 정수로 채점하고, 개선을 위한 짧은 피드백을 1-2문장으로 작성합니다.

    토론 기록:
    ---
    {transcript}
    ---

    JSON 형식으로만 응답하세요. 예시: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
"""

# --- 공통 유틸 ---
def _extract_json_dict(raw_text: str) -> Dict:
    """LLM 응답에서 JSON 객체를 파싱한다."""
    cleaned = (raw_text or "").strip()
    cleaned = cleaned.replace('```json', '').replace('```', '').strip()
    if not cleaned:
        raise ValueError("빈 응답")

    candidates = [cleaned]
    start = cleaned.find('{')
    end = cleaned.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start:end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            try:
                return ast.literal_eval(candidate)
            except Exception:
                continue
    raise ValueError("JSON 파싱 실패")


def _extract_json_from_response(response) -> Dict:
    """google-generativeai Response 객체에서 JSON 딕셔너리를 추출."""
    candidates: List[str] = []
    text = getattr(response, "text", None)
    if text:
        candidates.append(text)

    for cand in getattr(response, "candidates", []) or []:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", []) if content else []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "mime_type", "").startswith("application/json"):
                try:
                    import base64

                    decoded = base64.b64decode(inline.data).decode("utf-8")
                    candidates.append(decoded)
                except Exception:
                    continue
            text_part = getattr(part, "text", None)
            if text_part:
                candidates.append(text_part)
            func_call = getattr(part, "function_call", None)
            if func_call:
                arguments = getattr(func_call, "arguments", None)
                if isinstance(arguments, str):
                    candidates.append(arguments)
                else:
                    candidates.append(json.dumps(func_call, ensure_ascii=False))

    for candidate in candidates:
        try:
            return _extract_json_dict(candidate)
        except ValueError:
            continue
    raise ValueError("LLM 응답에서 JSON을 찾지 못했습니다.")


@app.post("/evaluate/answers", tags=["Answer Evaluation"])
async def evaluate_answers(req: EvaluationRequest):
    try:
        model = genai.GenerativeModel(EVALUATION_MODEL)
        evaluations = []
        for item in req.items:
            if not item.answer or not item.answer.strip():
                evaluations.append({
                    "question": item.question, "answer": item.answer,
                    "evaluation": {"scores": {"grammar": 0, "vocabulary": 0, "clarity": 0}, "feedback": "답변이 입력되지 않았습니다."}
                })
                continue

            prompt = EVALUATION_PROMPT_TEMPLATE.format(question=item.question, answer=item.answer)
            response = await model.generate_content_async(prompt, generation_config=JSON_GENERATION_CONFIG)
            evaluation_data = _extract_json_from_response(response)
            evaluations.append({"question": item.question, "answer": item.answer, "evaluation": evaluation_data})
        return {"evaluations": evaluations}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"답변 평가 중 오류가 발생했습니다: {e}")

# ✅ 토론 평가 API
@app.post("/chat/evaluate", tags=["Answer Evaluation"])
async def evaluate_discussion(req: DiscussionEvaluationRequest, current_user: dict = Depends(get_current_user)):
    record = get_record(req.record_id)
    if not record or record.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=404, detail="Record not found")
    history = (record.get("payload") or {}).get("history") or []
    if not history:
        raise HTTPException(status_code=400, detail="평가할 토론 기록이 없습니다.")

    transcript_lines = []
    for entry in history:
        role = entry.get("role", "unknown").upper()
        content = entry.get("content", "")
        transcript_lines.append(f"{role}: {content}")

    prompt = DISCUSSION_EVALUATION_PROMPT_TEMPLATE.format(transcript="\n".join(transcript_lines))
    try:
        model = genai.GenerativeModel(EVALUATION_MODEL)
        response = await model.generate_content_async(prompt, generation_config=JSON_GENERATION_CONFIG)
        evaluation_data = _extract_json_from_response(response)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"토론 평가에 실패했습니다: {exc}")

    payload = record.get("payload") or {}
    save_discussion_record(
        history=history,
        initial_questions=payload.get("initial_questions") or [],
        meta=record.get("meta"),
        source_text=payload.get("source_text", ""),
        user_id=current_user["id"],
        record_id=req.record_id,
        evaluation=evaluation_data,
    )
    return {"evaluation": evaluation_data}

# ✅ [신규] 평가 결과 저장 API
@app.post("/records/save_evaluation", tags=["Records"])
def save_evaluated_record(
    req: SaveEvaluationRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        # Pydantic 모델을 Python 딕셔너리로 변환
        items_to_save = [item.dict() for item in req.items]
        meta = {"summary": req.summary, "topics": req.topics}
        
        # records.py의 save_questions_record 함수를 evaluation_results와 함께 호출
        saved_record = save_questions_record(
            items=items_to_save,
            meta=meta,
            source_text=req.source_text,
            evaluation_results={"evaluations": items_to_save}, # 평가 결과를 함께 저장
            user_id=current_user["id"],
        )
        return saved_record
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"평가 기록 저장 실패: {e}")


@app.post("/records/questions")
def post_save_questions(
    req: SaveQuestionsRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    try:
        items_serialized = [item.model_dump() for item in req.items]
        meta = {"summary": req.summary, "topics": req.topics}
        user_id = current_user["id"] if current_user else None
        record = save_questions_record(
            items_serialized,
            meta,
            source_text=(req.selection_text or "").strip(),
            user_id=user_id,
        )
        return {"record_id": record.get("id"), "created_at": record.get("created_at")}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to save record.")

@app.post("/chat/start")
def post_chat_start(
    req: ChatStartRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    try:
        user_id = current_user["id"] if current_user else None
        return CHAT_MANAGER.start(req.text, max_q=req.max_questions, user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/start_url")
def post_chat_start_from_url(
    req: ChatStartFromUrlRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    try:
        text, meta = extract_from_url(req.url)
        user_id = current_user["id"] if current_user else None
        return CHAT_MANAGER.start(text, max_q=req.max_questions, user_id=user_id)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/reply")
def post_chat_reply(req: ChatReplyRequest):
    try:
        result = CHAT_MANAGER.reply(req.session_id.strip(), req.answer.strip())
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/end")
def post_chat_end(req: ChatEndRequest):
    try:
        result = CHAT_MANAGER.end(req.session_id.strip())
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/records")
def get_records_list(date: Optional[str] = Query(None, description="YYYY-MM-DD filter")):
    try:
        return {"records": list_records(date=date)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/records/{record_id}")
def get_record_details(record_id: str):
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@app.get("/rankings", tags=["Rankings"])
def get_rankings(
    limit: int = Query(10, ge=1, le=100, description="Number of entries to return"),
):
    return {
        "level_test": get_level_test_rankings(limit=limit),
        "learning": get_learning_volume_rankings(limit=limit),
    }


@app.get("/me/rankings", tags=["Rankings"])
async def get_my_rankings(current_user: dict = Depends(get_current_user)):
    return {
        "level_test": get_user_level_test_rank(current_user["id"]),
        "learning": get_user_learning_ranks(current_user["id"]),
    }

@app.get("/records/{record_id}.pdf")
def get_record_as_pdf(record_id: str):
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    pdf_bytes = record_to_pdf(record)
    return Response(content=pdf_bytes, media_type="application/pdf")


# --- 서버 실행 ---
def run(host: str = "0.0.0.0", port: int = 8008):
    import uvicorn
    print(f"Starting Text Server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=True)

if __name__ == "__main__":
    run()
