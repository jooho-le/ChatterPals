"""Utilities for generating vocabulary quizzes with Gemini."""

from __future__ import annotations

import json
import random
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

import google.generativeai as genai

from .language import DEFAULT_LANGUAGE, get_quiz_settings, normalize_language  # type: ignore

QUIZ_MODEL = "gemini-2.0-flash-lite-preview"

QUIZ_PROMPT_TEMPLATE = """
You are {tutor_title}.
The learner sees a passage with one expression highlighted.
Generate exactly {option_count} multiple-choice options so the learner can pick the best {target_language_name} expression for the highlight.

Return a strict JSON object with this schema (no commentary, no markdown):
{{
  "prompt": "<instruction shown to the learner in Korean>",
  "options": ["option1", "option2", ...],
  "answer_index": <zero-based index of the correct option>,
  "explanation": "<Very short Korean note giving the meaning or nuance>"
}}

Requirements:
- The correct option (located at answer_index) must be a natural {target_language_name} expression.
- All options must be {option_requirements}
- Provide the explanation in {explanation_language}.
- Do not include romanization unless it is part of a natural expression.

[Sentence]
{sentence}

[Highlighted Phrase]
{highlight}

[Additional Context]
{context}
"""

LATIN_OPTION_SANITIZE_RE = re.compile(r"[^A-Za-z'\-\s]")


@dataclass
class Quiz:
    prompt: str
    options: List[str]
    answer_index: int
    explanation: Optional[str] = None


class QuizGenerationError(RuntimeError):
    """Raised when the quiz model fails or returns malformed data."""


def _sanitize_option(text: str, *, mode: str) -> str:
    if not isinstance(text, str):
        return ""
    normalized = unicodedata.normalize("NFKC", text).strip()
    if mode == "latin":
        cleaned = LATIN_OPTION_SANITIZE_RE.sub("", normalized)
        collapsed = re.sub(r"\s+", " ", cleaned).strip()
        return collapsed[:48]
    # unicode mode: allow native scripts, just collapse whitespace
    return re.sub(r"\s+", " ", normalized).strip()[:32]


def _is_valid_option(text: str) -> bool:
    return bool(text and text.strip())


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


def _deduplicate_options(
    options: Iterable[str],
    answer_index: int,
    *,
    sanitize_mode: str,
) -> Tuple[List[str], int]:
    seen: dict[str, int] = {}
    result: List[str] = []
    updated_answer = -1

    for idx, option in enumerate(options):
        sanitized = _sanitize_option(option, mode=sanitize_mode)
        if not _is_valid_option(sanitized):
            continue
        lowered = sanitized.lower()
        if lowered in seen:
            if idx == answer_index and updated_answer == -1:
                updated_answer = seen[lowered]
            continue
        seen[lowered] = len(result)
        if idx == answer_index and updated_answer == -1:
            updated_answer = len(result)
        result.append(sanitized)

    if updated_answer == -1 and 0 <= answer_index < len(result):
        updated_answer = answer_index
    return result, max(0, updated_answer)


def _fill_with_fallback(
    options: List[str],
    answer_index: int,
    *,
    option_count: int,
    fallback_options: List[str],
    sanitize_mode: str,
) -> Tuple[List[str], int]:
    seen_lower = {opt.lower() for opt in options}
    for candidate in fallback_options:
        if len(options) >= option_count:
            break
        sanitized = _sanitize_option(candidate, mode=sanitize_mode)
        if not sanitized or sanitized.lower() in seen_lower:
            continue
        options.append(sanitized)
        seen_lower.add(sanitized.lower())

    while len(options) < option_count:
        filler = f"option {len(options) + 1}"
        sanitized = _sanitize_option(filler, mode=sanitize_mode)
        if sanitized.lower() in seen_lower:
            continue
        options.append(sanitized)
        seen_lower.add(sanitized.lower())

    answer_index = max(0, min(answer_index, len(options) - 1))
    return options, answer_index


def _build_fallback_quiz(
    sentence: str,
    highlight: str,
    *,
    option_count: int,
    settings: Dict[str, str],
) -> Quiz:
    options: List[str] = []
    seen: set[str] = set()
    sanitize_mode = settings["sanitize_mode"]
    fallback = settings["fallback_options"]

    highlight_candidate = _sanitize_option(highlight, mode=sanitize_mode)
    if highlight_candidate:
        options.append(highlight_candidate)
        seen.add(highlight_candidate.lower())

    for candidate in random.sample(fallback, k=len(fallback)):
        sanitized = _sanitize_option(candidate, mode=sanitize_mode)
        if not sanitized or sanitized.lower() in seen:
            continue
        options.append(sanitized)
        seen.add(sanitized.lower())
        if len(options) >= option_count:
            break

    options, answer_index = _fill_with_fallback(
        options,
        0,
        option_count=option_count,
        fallback_options=fallback,
        sanitize_mode=sanitize_mode,
    )

    explanation = None
    if sentence.strip():
        explanation = f"문장 참고: {sentence.strip()}"

    return Quiz(
        prompt=settings["prompt_text"],
        options=options[:option_count],
        answer_index=answer_index,
        explanation=explanation,
    )


def generate_translation_quiz(
    sentence: str,
    highlight: str,
    *,
    option_count: int = 3,
    context: Optional[str] = None,
    language: str = DEFAULT_LANGUAGE,
) -> Quiz:
    if option_count < 3:
        option_count = 3

    language_code = normalize_language(language)
    settings = get_quiz_settings(language_code)
    context_text = (context or "").strip()

    try:
        model = genai.GenerativeModel(QUIZ_MODEL)
        prompt = QUIZ_PROMPT_TEMPLATE.format(
            tutor_title=settings["tutor_title"],
            option_count=option_count,
            target_language_name=settings["target_language_name"],
            option_requirements=settings["option_requirements"],
            explanation_language=settings["explanation_language"],
            sentence=sentence.strip(),
            highlight=highlight.strip(),
            context=context_text,
        )
        response = model.generate_content(prompt)
        raw_text = response.text.strip().replace("```json", "").replace("```", "").strip()
        payload = _parse_json_payload(raw_text)

        options = payload.get("options") or []
        answer_index = int(payload.get("answer_index", 0))
        options, answer_index = _deduplicate_options(
            options,
            answer_index,
            sanitize_mode=settings["sanitize_mode"],
        )

        if not options:
            raise QuizGenerationError("Quiz model returned no valid options.")

        options, answer_index = _fill_with_fallback(
            options,
            answer_index,
            option_count=option_count,
            fallback_options=settings["fallback_options"],
            sanitize_mode=settings["sanitize_mode"],
        )

        prompt_text = payload.get("prompt") or settings["prompt_text"]
        explanation = payload.get("explanation")

        return Quiz(
            prompt=prompt_text,
            options=options[:option_count],
            answer_index=max(0, min(answer_index, len(options) - 1)),
            explanation=explanation.strip() if isinstance(explanation, str) else None,
        )
    except Exception as exc:
        print(f"[quiz] generation failed: {exc}")
        return _build_fallback_quiz(
            sentence,
            highlight,
            option_count=option_count,
            settings=settings,
        )
