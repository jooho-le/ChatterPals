"""Utilities for generating vocabulary quizzes with Gemini."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, List, Optional

import google.generativeai as genai

QUIZ_MODEL = "gemini-2.0-flash-lite-preview"

QUIZ_PROMPT_TEMPLATE = """You are an English vocabulary tutor.
The learner sees a Korean sentence with one target expression highlighted.
Generate exactly {option_count} multiple-choice options so the learner can pick the best English word or short phrase for the highlight.

Return a strict JSON object with this schema (no commentary, no markdown):
{{
  "prompt": "<Korean instruction explaining which word to pick>",
  "options": ["option1", "option2", ...],
  "answer_index": <zero-based index of the correct option>,
  "explanation": "<Very short Korean note giving the meaning or nuance>"
}}

Requirements:
- The correct option (located at answer_index) must be a natural English translation of the highlighted phrase.
- All options must be unique, ASCII-only English (letters, spaces, apostrophes, hyphen) with 1-3 words.
- Provide plausible distractors that fit the sentence but have different meanings.
- Keep the instruction prompt under 60 Korean characters.

[Sentence]
{sentence}

[Highlighted Phrase]
{highlight}

[Additional Context]
{context}
"""

FALLBACK_OPTIONS = [
    "take action",
    "make progress",
    "stay focused",
    "keep in mind",
    "find a solution",
    "move forward",
    "ask for help",
    "think it through",
    "stay patient",
    "try again",
]


@dataclass
class Quiz:
    prompt: str
    options: List[str]
    answer_index: int
    explanation: Optional[str] = None


class QuizGenerationError(RuntimeError):
    """Raised when the quiz model fails or returns malformed data."""


_OPTION_SANITIZE_RE = re.compile(r"[^A-Za-z'\-\s]")


def _sanitize_option(text: str) -> str:
    if not isinstance(text, str):
        return ""
    normalized = unicodedata.normalize("NFKC", text)
    cleaned = _OPTION_SANITIZE_RE.sub("", normalized)
    collapsed = re.sub(r"\s+", " ", cleaned).strip()
    return collapsed[:48]


def _is_valid_option(text: str) -> bool:
    if not text:
        return False
    return bool(re.search(r"[A-Za-z]", text))


def _parse_json_payload(raw_text: str) -> dict:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            snippet = raw_text[start : end + 1]
            return json.loads(snippet)
        raise


def _deduplicate_options(options: Iterable[str], answer_index: int) -> (List[str], int):
    seen: dict[str, int] = {}
    result: List[str] = []
    updated_answer = -1

    for idx, option in enumerate(options):
        sanitized = _sanitize_option(option)
        if not _is_valid_option(sanitized):
            continue
        lower = sanitized.lower()
        if lower in seen:
            if idx == answer_index and updated_answer == -1:
                updated_answer = seen[lower]
            continue
        seen[lower] = len(result)
        if idx == answer_index and updated_answer == -1:
            updated_answer = len(result)
        result.append(sanitized)

    return result, updated_answer


def _fill_with_fallback(options: List[str], answer_index: int, limit: int) -> (List[str], int):
    seen_lower = {opt.lower() for opt in options}
    for candidate in FALLBACK_OPTIONS:
        if len(options) >= limit:
            break
        sanitized = _sanitize_option(candidate)
        if not sanitized or sanitized.lower() in seen_lower:
            continue
        options.append(sanitized)
        seen_lower.add(sanitized.lower())

    answer_index = max(0, min(answer_index, len(options) - 1))
    return options, answer_index


def generate_translation_quiz(
    sentence: str,
    highlight: str,
    *,
    option_count: int = 3,
    context: str | None = None,
) -> Quiz:
    if option_count < 3:
        option_count = 3

    model = genai.GenerativeModel(QUIZ_MODEL)
    prompt = QUIZ_PROMPT_TEMPLATE.format(
        sentence=sentence.strip(),
        highlight=highlight.strip(),
        context=(context or "").strip() or "없음",
        option_count=option_count,
    )
    response = model.generate_content(prompt)
    raw_text = "".join(part.text for part in response.candidates[0].content.parts).strip()
    try:
        payload = _parse_json_payload(raw_text)
    except Exception as error:
        raise QuizGenerationError(f"Failed to parse quiz JSON: {error}") from error

    options_raw = payload.get("options") or []
    if not isinstance(options_raw, list):
        options_raw = []

    answer_index_raw = payload.get("answer_index")
    answer_index = int(answer_index_raw) if isinstance(answer_index_raw, (int, float)) else 0

    options_clean, updated_answer = _deduplicate_options(options_raw, answer_index)
    if updated_answer == -1:
        updated_answer = 0
    options_clean, updated_answer = _fill_with_fallback(options_clean, updated_answer, option_count)

    if len(options_clean) < option_count:
        raise QuizGenerationError("Quiz generation returned insufficient unique options.")

    prompt_text = str(payload.get("prompt") or "").strip() or "하이라이트된 표현에 들어갈 영어 단어를 골라보세요."
    explanation = str(payload.get("explanation") or "").strip() or None

    return Quiz(
        prompt=prompt_text,
        options=options_clean[:option_count],
        answer_index=updated_answer,
        explanation=explanation,
    )
