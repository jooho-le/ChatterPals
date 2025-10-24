"""Backfill discussion evaluations for records missing Gemini scores.

Run with: `python backend/service-text/backfill_discussion_evaluations.py`
"""

import asyncio
import importlib.util
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from dotenv import load_dotenv, find_dotenv
import google.generativeai as genai


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


records = _load_module("records_module", BASE_DIR / "records.py")


load_dotenv(find_dotenv())

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise SystemExit("GOOGLE_API_KEY가 설정되지 않았습니다. .env를 확인하세요.")

genai.configure(api_key=GOOGLE_API_KEY)

# 동일한 모델/프롬프트 정의를 서버와 맞춰 둡니다.
EVALUATION_MODEL = "gemini-2.0-flash-lite-preview"
JSON_GENERATION_CONFIG = {"response_mime_type": "application/json"}
DISCUSSION_PROMPT = """
당신은 영어 토론 코치입니다. 아래의 토론 기록(역할: AI 또는 User)을 보고, User의 발화 품질을 평가해 주세요.
세 가지 항목(문법, 어휘, 논리)을 1~5점 정수로 채점하고, 개선을 위한 짧은 피드백을 1-2문장으로 작성합니다.

토론 기록:
---
{transcript}
---

JSON 형식으로만 응답하세요. 예시: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
"""


def _extract_json(response_text: str) -> Dict:
    cleaned = (response_text or "").strip()
    cleaned = cleaned.replace("```json", "").replace("```", "").strip()
    if not cleaned:
        raise ValueError("빈 응답")

    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start : end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            try:
                from ast import literal_eval

                return literal_eval(candidate)
            except Exception:
                continue
    raise ValueError(f"JSON 파싱 실패: {candidates[:1]!r}")


def _extract_from_response(response) -> Dict:
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
            return _extract_json(candidate)
        except ValueError:
            continue
    raise ValueError(f"LLM 응답에서 JSON을 찾지 못했습니다: {candidates[:1]!r}")


@dataclass
class DiscussionRecord:
    id: str
    user_id: str
    history: List[Dict]
    initial_questions: List[str]
    meta: Dict
    source_text: str


def _fetch_targets() -> List[DiscussionRecord]:
    results = []
    for record in records.list_records():
        if record["type"] != "discussion":
            continue
        full = records.get_record(record["id"])
        if full.get("evaluation"):
            continue
        payload = full.get("payload") or {}
        results.append(
            DiscussionRecord(
                id=record["id"],
                user_id=full.get("user_id"),
                history=payload.get("history") or [],
                initial_questions=payload.get("initial_questions") or [],
                meta=full.get("meta") or {},
                source_text=payload.get("source_text", ""),
            )
        )
    return results


async def evaluate_discussion(record: DiscussionRecord, model) -> Dict:
    transcript_lines = []
    for entry in record.history:
        role = entry.get("role", "").upper() or "UNKNOWN"
        content = entry.get("content", "")
        transcript_lines.append(f"{role}: {content}")
    prompt = DISCUSSION_PROMPT.format(transcript="\n".join(transcript_lines))
    response = await model.generate_content_async(prompt, generation_config=JSON_GENERATION_CONFIG)
    return _extract_from_response(response)


async def main():
    targets = _fetch_targets()
    if not targets:
        print("평가가 비어 있는 토론 기록이 없습니다.")
        return

    print(f"총 {len(targets)}개의 토론 기록을 재평가합니다.")
    model = genai.GenerativeModel(EVALUATION_MODEL)
    for idx, record in enumerate(targets, start=1):
        print(f"[{idx}/{len(targets)}] {record.id} 평가 중...")
        try:
            evaluation = await evaluate_discussion(record, model)
        except Exception as exc:
            print(f"  ⚠️  실패: {exc}")
            continue

        records.save_discussion_record(
            history=record.history,
            initial_questions=record.initial_questions,
            meta=record.meta,
            source_text=record.source_text,
            user_id=record.user_id,
            record_id=record.id,
            evaluation=evaluation,
        )
        print("  ✅ 저장 완료")


if __name__ == "__main__":
    asyncio.run(main())
