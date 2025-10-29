"""Multilingual chat session manager for sidebar discussions."""
from __future__ import annotations

import json
import uuid
from typing import Dict, List, Optional

import google.generativeai as genai

try:  # pragma: no cover
    from .language import DEFAULT_LANGUAGE, get_language_config, normalize_language
    from .records import save_discussion_record  # type: ignore
except Exception:  # pragma: no cover
    from language import DEFAULT_LANGUAGE, get_language_config, normalize_language  # type: ignore
    from records import save_discussion_record  # type: ignore

FIRST_QUESTION_PROMPT = """
You are a {teacher_title} facilitating a thoughtful discussion in {output_language}.
Read the passage below and craft the first open-ended question in {output_language} that sparks critical thinking.
Return only the question text without additional commentary.

Passage:
---
{passage}
---
"""

FOLLOW_UP_PROMPT = """
You are a {teacher_title} continuing a discussion in {output_language}.
Review the conversation history and provide the next open-ended question in {output_language}.
Make it encouraging, reflective, and tied to the previous answer.

Original passage (for context):
---
{passage_excerpt}
---

Conversation so far (JSON format):
{conversation_json}
"""

CLOSING_PROMPT = """
You are a {teacher_title} speaking in {output_language}.
Provide a single warm sentence in {output_language} thanking the learner and inviting them to practice again soon.
Return only the sentence.
"""


class ChatSession:
    """In-memory representation of a learner's discussion with the AI coach."""

    def __init__(self, text: str, **kwargs):
        self.text = text
        self.language = normalize_language(kwargs.get("language"))
        self.language_config = get_language_config(self.language)
        self.output_language = self.language_config["llm_language"]
        self.model = genai.GenerativeModel("gemini-2.0-flash-lite-preview")
        self.questions: List[str] = []
        self.history: List[Dict[str, str]] = []
        self.source_url = kwargs.get("source_url", "")
        self.title = kwargs.get("title", "")
        self.selection_text = kwargs.get("selection_text", "")
        self.record_id: Optional[str] = None
        self.user_id: Optional[str] = kwargs.get("user_id")
        self.max_questions: int = int(kwargs.get("max_q") or kwargs.get("max_questions") or 6)

    def first_question(self) -> str:
        prompt = FIRST_QUESTION_PROMPT.format(
            teacher_title=self.language_config["teacher_title"],
            output_language=self.output_language,
            passage=self.text[:4000],
        )
        response = self.model.generate_content(prompt)
        first_question = response.text.strip()
        self.questions.append(first_question)
        return first_question

    def next_question(self) -> str:
        if len(self.questions) >= self.max_questions:
            return self._closing_message()

        prompt = FOLLOW_UP_PROMPT.format(
            teacher_title=self.language_config["teacher_title"],
            output_language=self.output_language,
            passage_excerpt=self.text[:2000],
            conversation_json=json.dumps(self.history, ensure_ascii=False),
        )
        response = self.model.generate_content(prompt)
        next_q = response.text.strip()
        self.questions.append(next_q)
        return next_q

    def _closing_message(self) -> str:
        prompt = CLOSING_PROMPT.format(
            teacher_title=self.language_config["teacher_title"],
            output_language=self.output_language,
        )
        response = self.model.generate_content(prompt)
        return response.text.strip()


class ChatManager:
    def __init__(self):
        self.sessions: Dict[str, ChatSession] = {}

    def start(self, text: str, **kwargs) -> Dict[str, str]:
        session_id = str(uuid.uuid4())
        session = ChatSession(text=text, **kwargs)
        self.sessions[session_id] = session

        first_question = session.first_question()
        session.history.append({"role": "ai", "content": first_question})

        record_meta = {
            "title": session.title or f"Chat about: {text[:30]}...",
            "language": session.language,
        }
        record = save_discussion_record(
            history=session.history,
            initial_questions=session.questions,
            meta=record_meta,
            source_text=text[:4000],
            user_id=session.user_id,
        )
        session.record_id = record.get("id")

        return {
            "session_id": session_id,
            "question": first_question,
            "record_id": session.record_id,
        }

    def reply(self, session_id: str, user_text: str) -> Dict[str, str]:
        session = self.sessions.get(session_id)
        if not session:
            return {"error": "invalid_session"}

        session.history.append({"role": "user", "content": user_text})
        answer = session.next_question()
        session.history.append({"role": "ai", "content": answer})
        is_done = len(session.questions) >= session.max_questions

        save_discussion_record(
            history=session.history,
            record_id=session.record_id,
            initial_questions=session.questions,
            user_id=session.user_id,
        )

        if is_done:
            self.sessions.pop(session_id, None)

        return {"question": answer, "done": is_done, "record_id": session.record_id}

    def end(self, session_id: str) -> Dict[str, str]:
        session = self.sessions.pop(session_id, None)
        if not session:
            return {"error": "invalid_session"}

        closing_message = session._closing_message()
        session.history.append({"role": "ai", "content": closing_message})

        save_discussion_record(
            history=session.history,
            record_id=session.record_id,
            initial_questions=session.questions,
            user_id=session.user_id,
        )

        return {"message": closing_message, "done": True, "record_id": session.record_id}


MANAGER = ChatManager()
