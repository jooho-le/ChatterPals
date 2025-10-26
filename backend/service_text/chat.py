import uuid
import json
from typing import Dict, List, Optional
import google.generativeai as genai

# records 임포트: 패키지/스크립트 실행 모두 지원
try:
    from .records import save_discussion_record  # type: ignore
except Exception:
    from records import save_discussion_record

class ChatSession:
    def __init__(self, text: str, **kwargs):
        self.text = text
        # Gemini 모델을 직접 초기화합니다.
        self.model = genai.GenerativeModel('gemini-2.0-flash-lite-preview')
        self.questions: List[str] = []
        self.q_index = 0
        self.history: List[Dict] = []
        self.source_url = kwargs.get('source_url', '')
        self.title = kwargs.get('title', '')
        self.selection_text = kwargs.get('selection_text', '')
        self.record_id: Optional[str] = None
        self.user_id: Optional[str] = kwargs.get('user_id')
        self.max_questions: int = int(kwargs.get('max_q') or kwargs.get('max_questions') or 6)

    def first_question(self) -> str:
        # 첫 질문은 1:1 영어 대화 느낌으로, 불필요한 서론/마크다운 없이 간결하게 생성
        prompt = f"""
        You are a friendly discussion partner.
        Read the article text and ask ONE short, conversational question in natural English to kick off a 1:1 chat.
        Constraints:
        - Only output the question sentence.
        - No headings, lists, explanations, or markdown.
        - Keep it under 120 characters.

        Article text:
        ---
        {self.text[:4000]}
        ---
        """
        response = self.model.generate_content(prompt)
        first_q = (response.text or "").strip()
        self.questions.append(first_q)
        self.q_index = 1
        return first_q

    def next_question(self) -> str:
        if len(self.questions) >= self.max_questions:
            return self._closing_message()
        self.q_index += 1
        # 후속 질문도 동일하게 간결한 1문장 영어 질문으로 제한
        prompt = f"""
        You are continuing a 1:1 discussion in English.
        Based on the article and the conversation so far, ask ONE short follow-up question.
        Constraints:
        - Only output the question sentence.
        - No headings, lists, explanations, or markdown.
        - Keep it under 120 characters.

        Article (context):
        ---
        {self.text[:2000]}
        ---

        Conversation history (JSON):
        ---
        {json.dumps(self.history, ensure_ascii=False)}
        ---
        """
        response = self.model.generate_content(prompt)
        next_q = (response.text or "").strip()
        self.questions.append(next_q)
        return next_q

    def _closing_message(self) -> str:
        return "Great discussion. Let's switch topics for next time."


class ChatManager:
    def __init__(self):
        self.sessions: Dict[str, ChatSession] = {}

    def start(self, text: str, **kwargs) -> Dict:
        sid = str(uuid.uuid4())
        # analyze를 호출하지 않는 새로운 ChatSession을 생성합니다.
        sess = ChatSession(text=text, **kwargs)
        self.sessions[sid] = sess
        
        first = sess.first_question()
        sess.history.append({"role": "ai", "content": first})
        
        # 간단한 메타데이터만으로 기록을 저장합니다.
        record_meta = {'title': sess.title or f"Chat about: {text[:30]}..."}
        record = save_discussion_record(
            history=sess.history,
            initial_questions=sess.questions,
            meta=record_meta,
            source_text=text[:4000],
            user_id=sess.user_id,
        )
        sess.record_id = record.get('id')

        return {
            "session_id": sid,
            "question": first,
            "record_id": sess.record_id,
        }

    def reply(self, session_id: str, user_text: str) -> Dict:
        sess = self.sessions.get(session_id)
        if not sess:
            return {"error": "invalid_session"}
        
        sess.history.append({"role": "user", "content": user_text})
        q = sess.next_question()
        sess.history.append({"role": "ai", "content": q})
        done = q.startswith("훌륭한 토론이었습니다")

        # 기록을 업데이트합니다.
        save_discussion_record(
            history=sess.history,
            record_id=sess.record_id,
            initial_questions=sess.questions,
            user_id=sess.user_id,
        )
        
        if done:
            self.sessions.pop(session_id, None)
        return {"question": q, "done": done, "record_id": sess.record_id}

    def end(self, session_id: str) -> Dict:
        sess = self.sessions.pop(session_id, None)
        if not sess:
            return {"error": "invalid_session"}
        closing = sess._closing_message()
        sess.history.append({"role": "ai", "content": closing})
        save_discussion_record(
            history=sess.history,
            record_id=sess.record_id,
            initial_questions=sess.questions,
            user_id=sess.user_id,
        )
        return {"message": closing, "done": True, "record_id": sess.record_id}


MANAGER = ChatManager()
