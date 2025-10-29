"""Shared language configuration for ChatterPals multi-language support."""
from __future__ import annotations

from typing import Dict, Optional

DEFAULT_LANGUAGE = "en"

_LANGUAGE_OPTIONS: Dict[str, Dict[str, str]] = {
    "en": {
        "code": "en",
        "name": "English",
        "display_label": "영어",
        "teacher_title": "English language tutor",
        "learner_label": "English learner",
        "llm_language": "English",
    },
    "ja": {
        "code": "ja",
        "name": "Japanese",
        "display_label": "일본어",
        "teacher_title": "Japanese language tutor",
        "learner_label": "Japanese learner",
        "llm_language": "Japanese",
    },
    "zh": {
        "code": "zh",
        "name": "Chinese",
        "display_label": "중국어",
        "teacher_title": "Chinese language tutor",
        "learner_label": "Chinese learner",
        "llm_language": "Chinese",
    },
}

_LANGUAGE_ALIASES = {
    "en-us": "en",
    "en-gb": "en",
    "english": "en",
    "jp": "ja",
    "ja-jp": "ja",
    "japanese": "ja",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "zh-hans": "zh",
    "zh-hant": "zh",
    "chinese": "zh",
    "cn": "zh",
}

_QUIZ_SETTINGS = {
    "en": {
        "tutor_title": "an English vocabulary tutor",
        "target_language_name": "English",
        "option_requirements": "natural English words or short phrases (ASCII letters, 1-3 words).",
        "explanation_language": "Korean",
        "prompt_text": "하이라이트된 표현에 어울리는 영어 표현을 골라보세요.",
        "fallback_options": [
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
        ],
        "sanitize_mode": "latin",
    },
    "ja": {
        "tutor_title": "a Japanese vocabulary tutor",
        "target_language_name": "Japanese",
        "option_requirements": "natural Japanese expressions written in kanji, hiragana, or katakana (2-6 characters).",
        "explanation_language": "Korean",
        "prompt_text": "하이라이트된 표현에 어울리는 일본어 표현을 골라보세요.",
        "fallback_options": [
            "行動する",
            "集中する",
            "覚えておく",
            "解決する",
            "助けを求める",
            "挑戦してみる",
            "見直してみる",
            "考え直す",
            "試してみる",
        ],
        "sanitize_mode": "unicode",
    },
    "zh": {
        "tutor_title": "a Chinese vocabulary tutor",
        "target_language_name": "Chinese",
        "option_requirements": "natural Simplified Chinese expressions (2-6 characters).",
        "explanation_language": "Korean",
        "prompt_text": "하이라이트된 표현에 어울리는 중국어 표현을 골라보세요.",
        "fallback_options": [
            "采取行动",
            "保持专注",
            "牢记这一点",
            "找到答案",
            "继续前进",
            "再试一次",
            "寻求帮助",
            "想一想",
            "保持耐心",
        ],
        "sanitize_mode": "unicode",
    },
}

_WRITING_EVALUATION_PROMPTS = {
    "en": """
You are an English writing tutor. Review the learner's answer and grade it.
- Question: "{question}"
- Learner answer: "{answer}"
Score each category from 1 to 5 and return JSON only:
1. Grammar & Accuracy
2. Vocabulary Usage
3. Clarity & Coherence
Keep the feedback concise and write it in English.
JSON format: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
    "ja": """
あなたは日本語のライティング講師です。次の回答を評価してください。
- 質問: "{question}"
- 学習者の回答: "{answer}"
以下の観点でそれぞれ1〜5点で採点し、すべて日本語で短いフィードバックを書いてください。
1. Grammar & Accuracy（文法と正確さ）
2. Vocabulary Usage（語彙の使い方）
3. Clarity & Coherence（明瞭さ・論理性）
JSON形式のみで返してください: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
    "zh": """
你是一位中文寫作老師。請評估學習者的回答。
- 題目: "{question}"
- 學習者的回答: "{answer}"
請從下列三個面向各給 1~5 分，並以中文寫出精簡的回饋。
1. Grammar & Accuracy（文法與正確度）
2. Vocabulary Usage（詞彙運用）
3. Clarity & Coherence（清楚與連貫）
只需回傳 JSON: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
}

_DISCUSSION_EVALUATION_PROMPTS = {
    "en": """
You are an English conversation coach. Evaluate the learner's discussion transcript.
Transcript:
{transcript}
Score grammar, vocabulary, and clarity from 1 to 5 (JSON only) and keep feedback in English.
JSON format: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
    "ja": """
あなたは日本語の会話コーチです。次の討論記録を評価してください。
討論記録:
{transcript}
文法・語彙・明瞭さをそれぞれ1〜5点で採点し、フィードバックは日本語で書いてください。JSONのみを返してください: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
    "zh": """
你是一位中文會話教練。請評估以下討論內容。
討論紀錄:
{transcript}
請從文法、詞彙、表達清晰度三項各給 1~5 分，並以中文寫出簡短回饋。僅需回傳 JSON: {{"scores": {{"grammar": 4, "vocabulary": 3, "clarity": 5}}, "feedback": "..."}}
""",
}

_NO_ANSWER_MESSAGES = {
    "en": "No answer was provided.",
    "ja": "回答が入力されていません。",
    "zh": "尚未填写回答。",
}


def normalize_language(code: Optional[str]) -> str:
    """Return a supported language code, falling back to English."""
    if not code:
        return DEFAULT_LANGUAGE
    lowered = code.strip().lower()
    if lowered in _LANGUAGE_OPTIONS:
        return lowered
    if lowered in _LANGUAGE_ALIASES:
        return _LANGUAGE_ALIASES[lowered]
    if lowered.startswith("ja"):
        return "ja"
    if lowered.startswith("zh"):
        return "zh"
    if lowered.startswith("en"):
        return "en"
    return DEFAULT_LANGUAGE


def get_language_config(code: Optional[str] = None) -> Dict[str, str]:
    """Return configuration for the requested language."""
    normalized = normalize_language(code)
    return _LANGUAGE_OPTIONS[normalized]


def get_quiz_settings(code: Optional[str] = None) -> Dict[str, str]:
    """Return quiz-generation settings for the requested language."""
    normalized = normalize_language(code)
    return _QUIZ_SETTINGS[normalized]


def build_writing_evaluation_prompt(language: Optional[str], question: str, answer: str) -> str:
    normalized = normalize_language(language)
    template = _WRITING_EVALUATION_PROMPTS[normalized]
    return template.format(question=question, answer=answer)


def build_discussion_evaluation_prompt(language: Optional[str], transcript: str) -> str:
    normalized = normalize_language(language)
    template = _DISCUSSION_EVALUATION_PROMPTS[normalized]
    return template.format(transcript=transcript)


def get_no_answer_message(language: Optional[str]) -> str:
    normalized = normalize_language(language)
    return _NO_ANSWER_MESSAGES[normalized]
