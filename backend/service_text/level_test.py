"""Utilities for generating and scoring the English level test."""

from __future__ import annotations

import base64
import json
import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import google.generativeai as genai

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR.parent / "data" / "level_test_questions.json"

SESSION_TTL = timedelta(hours=2)
GENERATION_MODEL = "gemini-2.0-flash-lite-preview"
GENERATION_PROMPT = """
You are a CELTA-qualified English teacher and assessment designer.
Create {count} multiple-choice questions that evaluate learners according to the CEFR framework.

Constraints:
- Skills to cover: {skills_clause} (use each skill at least once if possible)
- Use only CEFR levels A2, B1 or B2. Mix them naturally unless a level is specified explicitly.
- Provide a concise prompt and exactly four options labelled A, B, C, D.
- Include the correct answer id and a short explanation (<=120 characters).
- If the skill is "reading" provide a short passage (<=70 words) before the question.
- Grammar / vocabulary prompts should be single sentences or brief contexts.
- Avoid culturally sensitive or region-specific references.

Return ONLY valid JSON matching this schema:
{{
  "questions": [
    {{
      "skill": "grammar" | "vocabulary" | "reading",
      "level": "A2" | "B1" | "B2",
      "prompt": "...",
      "passage": "..." | null,
      "options": [{{"id": "A", "text": "..."}}, ...],
      "answer": "A",
      "explanation": "..."
    }}
  ]
}}
"""

WORDS_OF_DAY = [
    {"word": "assemble", "meaning": "모으다, 조립하다"},
    {"word": "meticulous", "meaning": "세심한, 꼼꼼한"},
    {"word": "tentative", "meaning": "임시적인, 잠정적인"},
    {"word": "discern", "meaning": "분별하다, 알아차리다"},
    {"word": "endeavor", "meaning": "노력, 시도"},
    {"word": "alleviate", "meaning": "완화하다, 경감하다"},
    {"word": "pragmatic", "meaning": "실용적인, 현실적인"},
    {"word": "inevitable", "meaning": "불가피한"},
    {"word": "diligent", "meaning": "성실한, 부지런한"},
    {"word": "substantiate", "meaning": "입증하다, 구체화하다"},
]


@dataclass
class LevelQuestion:
    id: str
    skill: str
    level: str
    prompt: str
    options: List[Dict[str, str]]
    answer: str
    explanation: str
    passage: Optional[str] = None
    source: Optional[str] = None

    def ensure_consistent(self) -> "LevelQuestion":
        normalized: List[Dict[str, str]] = []
        used_ids = set()
        for idx, option in enumerate(self.options):
            opt_id = str(option.get("id") or "").strip().upper() or chr(ord("A") + idx)
            if opt_id in used_ids:
                opt_id = f"{opt_id}{idx}"
            used_ids.add(opt_id)
            normalized.append({
                "id": opt_id,
                "text": str(option.get("text") or "").strip(),
            })
        self.options = normalized
        valid_ids = {opt["id"] for opt in self.options}
        answer_id = str(self.answer or "").strip().upper() or (next(iter(valid_ids), "A"))
        if answer_id not in valid_ids and valid_ids:
            answer_id = next(iter(valid_ids))
        self.answer = answer_id
        if self.level:
            self.level = self.level.strip().upper()
        if self.skill:
            self.skill = self.skill.strip().lower()
        if self.passage:
            self.passage = self.passage.strip()
        self.explanation = (self.explanation or "").strip()
        self.prompt = self.prompt.strip()
        return self

    def as_public(self) -> Dict[str, object]:
        data: Dict[str, object] = {
            "id": self.id,
            "skill": self.skill,
            "level": self.level,
            "prompt": self.prompt,
            "options": self.options,
        }
        if self.passage:
            data["passage"] = self.passage
        return data


# --- 문제 은행 -------------------------------------------------------


@lru_cache(maxsize=1)
def _load_bank() -> Dict[str, LevelQuestion]:
    if not DATA_PATH.exists():  # pragma: no cover - 방어용 가드
        raise FileNotFoundError(f"Level test dataset not found: {DATA_PATH}")
    with DATA_PATH.open("r", encoding="utf-8") as fh:
        raw_items = json.load(fh)
    bank: Dict[str, LevelQuestion] = {}
    for item in raw_items:
        question = LevelQuestion(
            id=item["id"],
            skill=item["skill"],
            level=item.get("level", ""),
            prompt=item["prompt"],
            options=item["options"],
            answer=item["answer"],
            explanation=item.get("explanation", ""),
            passage=item.get("passage"),
            source=item.get("source", "static"),
        ).ensure_consistent()
        bank[question.id] = question
    return bank


def list_questions() -> List[LevelQuestion]:
    return list(_load_bank().values())


def select_questions(count: int = 12) -> List[LevelQuestion]:
    bank = list_questions()
    if count >= len(bank):
        random.shuffle(bank)
        return bank
    grouped: Dict[str, List[LevelQuestion]] = {}
    for q in bank:
        grouped.setdefault(q.skill, []).append(q)
    for questions in grouped.values():
        random.shuffle(questions)
    selection: List[LevelQuestion] = []
    while len(selection) < count:
        for questions in grouped.values():
            if questions and len(selection) < count:
                selection.append(questions.pop())
        if all(not questions for questions in grouped.values()):
            break
    random.shuffle(selection)
    return selection[:count]


# --- 세션 관리 ---------------------------------------------------

_SESSIONS: Dict[str, Dict[str, object]] = {}


def _now() -> datetime:
    return datetime.utcnow()


def _cleanup_sessions() -> None:
    now = _now()
    expired = [sid for sid, data in _SESSIONS.items() if data["expires"] < now]
    for sid in expired:
        _SESSIONS.pop(sid, None)


def create_session(questions: Iterable[LevelQuestion]) -> str:
    _cleanup_sessions()
    q_map = {q.id: q for q in questions}
    session_id = uuid.uuid4().hex
    _SESSIONS[session_id] = {
        "questions": q_map,
        "created": _now(),
        "expires": _now() + SESSION_TTL,
    }
    return session_id


def get_session_questions(session_id: Optional[str]) -> Optional[Dict[str, LevelQuestion]]:
    if not session_id:
        return None
    data = _SESSIONS.get(session_id)
    if not data:
        return None
    if data["expires"] < _now():
        _SESSIONS.pop(session_id, None)
        return None
    return data["questions"]


# --- 동적 문제 생성 ---------------------------------------------------


def _extract_text_from_response(response) -> str:
    text = getattr(response, "text", None)
    if text:
        return text
    for cand in getattr(response, "candidates", []) or []:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", []) if content else []
        for part in parts:
            if hasattr(part, "text") and part.text:
                return part.text
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                try:
                    decoded = base64.b64decode(inline.data).decode("utf-8")
                    return decoded
                except Exception:  # pragma: no cover - 방어용 가드
                    continue
    return ""


def _parse_generated_questions(raw: str) -> List[LevelQuestion]:
    cleaned = (raw or "").strip()
    cleaned = cleaned.replace("```json", "").replace("```", "").strip()
    if not cleaned:
        raise ValueError("빈 응답")
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        raise ValueError("JSON 파싱 실패")
    questions_data = payload.get("questions")
    if not isinstance(questions_data, list):
        raise ValueError("'questions' 배열이 필요합니다.")
    results: List[LevelQuestion] = []
    for item in questions_data:
        if not isinstance(item, dict):
            continue
        q = LevelQuestion(
            id=f"dyn_{uuid.uuid4().hex[:10]}",
            skill=str(item.get("skill", "grammar")),
            level=str(item.get("level", "B1")),
            prompt=item.get("prompt", ""),
            options=item.get("options") or [],
            answer=item.get("answer", "A"),
            explanation=item.get("explanation", ""),
            passage=item.get("passage") or None,
            source="dynamic",
        ).ensure_consistent()
        results.append(q)
    if not results:
        raise ValueError("생성된 문항이 없습니다.")
    return results


async def generate_dynamic_questions(
    *, count: int = 26, skills: Optional[List[str]] = None
) -> List[LevelQuestion]:
    skills = skills or ["grammar", "vocabulary", "reading"]
    skills_clause = ", ".join(skills)
    prompt = GENERATION_PROMPT.format(count=count, skills_clause=skills_clause)
    model = genai.GenerativeModel(GENERATION_MODEL)
    response = await model.generate_content_async(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    raw_text = _extract_text_from_response(response)
    questions = _parse_generated_questions(raw_text)
    random.shuffle(questions)
    return questions[:count]


# --- 채점 로직 -----------------------------------------------------------


def evaluate_responses(
    responses: List[Tuple[str, str]],
    question_lookup: Optional[Dict[str, LevelQuestion]] = None,
) -> Dict[str, object]:
    lookup = question_lookup or _load_bank()
    totals_by_skill: Dict[str, Dict[str, float]] = {}
    detailed: List[Dict[str, object]] = []
    total_correct = 0

    for qid, answer in responses:
        question = lookup.get(qid)
        if not question:
            continue
        is_correct = answer == question.answer
        if is_correct:
            total_correct += 1
        stats = totals_by_skill.setdefault(question.skill, {"correct": 0, "total": 0})
        stats["total"] += 1
        if is_correct:
            stats["correct"] += 1
        detailed.append(
            {
                "id": question.id,
                "skill": question.skill,
                "prompt": question.prompt,
                "passage": question.passage,
                "options": question.options,
                "selected": answer,
                "correct": question.answer,
                "is_correct": is_correct,
                "explanation": question.explanation,
            }
        )

    total_questions = len(detailed)
    percentage = (total_correct / total_questions * 100) if total_questions else 0.0

    def pct(value: float, total: float) -> float:
        return round((value / total * 100), 1) if total else 0.0

    skill_breakdown = {
        skill: {
            "correct": stats["correct"],
            "total": stats["total"],
            "percentage": pct(stats["correct"], stats["total"]),
        }
        for skill, stats in totals_by_skill.items()
    }

    level = assess_level(percentage)
    focus_skill = min(
        skill_breakdown.items(),
        key=lambda item: (item[1]["percentage"], item[0]),
        default=(None, {"percentage": 0.0}),
    )[0]
    feedback = build_feedback(level, percentage, focus_skill)

    return {
        "total_correct": total_correct,
        "total_questions": total_questions,
        "percentage": round(percentage, 1),
        "level": level,
        "skill_breakdown": skill_breakdown,
        "focus_skill": focus_skill,
        "feedback": feedback,
        "details": detailed,
    }


def assess_level(percentage: float) -> str:
    if percentage >= 90:
        return "C1"
    if percentage >= 75:
        return "B2"
    if percentage >= 55:
        return "B1"
    if percentage >= 35:
        return "A2"
    return "A1"


def build_feedback(level: str, percentage: float, focus_skill: Optional[str]) -> Dict[str, object]:
    messages = {
        "C1": "Excellent performance! You handle complex structures with confidence.",
        "B2": "Great job! You show solid upper-intermediate control.",
        "B1": "Good effort. Strengthen accuracy to reach the next band.",
        "A2": "Keep practicing core patterns to build stability.",
        "A1": "Start with foundational grammar and vocabulary practice.",
    }
    summary = messages.get(level, "Keep learning and practising.")
    recommendation = None
    if focus_skill:
        focus_messages = {
            "grammar": "문법 패턴을 복습하고 예문을 만들어 보세요.",
            "vocabulary": "새 어휘를 문맥 속에서 암기하고 반복해 보세요.",
            "reading": "짧은 기사나 이메일을 읽고 핵심 아이디어를 요약해 보세요.",
        }
        recommendation = focus_messages.get(focus_skill, "약한 영역을 반복 학습해 보세요.")
    return {
        "summary": summary,
        "recommendation": recommendation,
        "score_text": f"총점 {percentage:.1f}% ({level})",
    }


def questions_to_public_payload(questions: Iterable[LevelQuestion]) -> List[Dict[str, object]]:
    return [q.as_public() for q in questions]


def get_daily_words(count: int = 3) -> List[Dict[str, str]]:
    pool = WORDS_OF_DAY[:]
    random.shuffle(pool)
    return pool[: min(count, len(pool))]
