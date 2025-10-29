"""Generate summaries and questions in the learner's target language."""
from __future__ import annotations

import json
from typing import Any, Dict

import google.generativeai as genai

try:  # pragma: no cover
    from .language import DEFAULT_LANGUAGE, get_language_config, normalize_language
except Exception:  # pragma: no cover
    from language import DEFAULT_LANGUAGE, get_language_config, normalize_language  # type: ignore

SUMMARY_PROMPT_TEMPLATE = """
You are a senior news editor who always writes in {output_language}.
Read the article below and return strict JSON with:
  - "summary": a concise {output_language} summary in 3-4 sentences.
  - "keywords": an array with the five most important topics in {output_language}.
Return JSON only without markdown fences or commentary.

Article:
---
{truncated_text}
---

JSON:
"""

QUESTION_PROMPT_TEMPLATE = """
You are a {teacher_title} supporting a {learner_label}.
Use the summary and key topics to craft {question_count} discussion questions in {output_language}.
Include a mix of factual, inferential, and evaluative prompts.
Return only JSON with a "questions" array of {output_language} strings.

Summary:
---
{summary}
---

Key topics: {topics}

JSON:
"""

FALLBACK_QUESTION_PROMPT = """
Create {count} short discussion questions in {output_language} based on the passage below.
Return each question on its own line using {output_language}.

Passage:
{passage}
"""


def analyze(text: str, max_questions: int = 5, language: str = DEFAULT_LANGUAGE) -> Dict[str, Any]:
    """Produce a summary, topics, and optional discussion questions."""
    normalized_language = normalize_language(language)
    language_config = get_language_config(normalized_language)
    output_language = language_config["llm_language"]

    if not text:
        return {"summary": "", "topics": [], "questions": [], "language": normalized_language}

    try:
        summarizer_model = genai.GenerativeModel("gemini-2.0-flash-lite-preview")
        summarizer_prompt = SUMMARY_PROMPT_TEMPLATE.format(
            output_language=output_language,
            truncated_text=text[:10000],
        )
        summary_response = summarizer_model.generate_content(summarizer_prompt)
        cleaned_summary = summary_response.text.strip().replace("```json", "").replace("```", "").strip()
        summary_data = json.loads(cleaned_summary)

        summary = str(summary_data.get("summary", "")).strip()
        keywords = summary_data.get("keywords", [])

        if not summary:
            raise ValueError("Empty summary returned from language model.")

        if max_questions <= 0:
            return {
                "summary": summary,
                "topics": keywords,
                "questions": [],
                "language": normalized_language,
            }

        generator_model = genai.GenerativeModel("gemini-2.0-flash-lite-preview")
        question_prompt = QUESTION_PROMPT_TEMPLATE.format(
            teacher_title=language_config["teacher_title"],
            learner_label=language_config["learner_label"],
            question_count=max_questions,
            output_language=output_language,
            summary=summary,
            topics=", ".join(keywords) if isinstance(keywords, list) else str(keywords),
        )
        questions_response = generator_model.generate_content(question_prompt)
        cleaned_questions = questions_response.text.strip().replace("```json", "").replace("```", "").strip()
        raw_questions = json.loads(cleaned_questions)

        if isinstance(raw_questions, dict):
            questions_list = raw_questions.get("questions") or raw_questions.get("items") or []
        elif isinstance(raw_questions, list):
            questions_list = raw_questions
        else:
            questions_list = []

        if max_questions > 0:
            questions_list = questions_list[:max_questions]
        else:
            questions_list = []

        return {
            "summary": summary,
            "topics": keywords,
            "questions": questions_list,
            "language": normalized_language,
        }

    except Exception as primary_error:
        print(f"[analyze] primary analysis failed: {primary_error}")
        try:
            fallback_model = genai.GenerativeModel("gemini-2.0-flash-lite-preview")
            prompt = FALLBACK_QUESTION_PROMPT.format(
                count=max(0, max_questions),
                output_language=output_language,
                passage=text[:2000],
            )
            response = fallback_model.generate_content(prompt)
            questions = [line.strip() for line in response.text.splitlines() if line.strip()]
            trimmed = questions[:max(0, max_questions)] if max_questions else []
            summary_seed = text[:200] + "..." if len(text) > 200 else text
            return {
                "summary": summary_seed,
                "topics": [],
                "questions": trimmed,
                "language": normalized_language,
            }
        except Exception as fallback_error:
            print(f"[analyze] fallback analysis failed: {fallback_error}")
            return {
                "summary": "Failed to generate a summary.",
                "topics": [],
                "questions": [],
                "language": normalized_language,
            }
