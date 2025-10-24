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
        # AI가 직접 첫 질문을 생성하도록 프롬프트를 구성합니다.
        prompt = f"""
        다음 텍스트에 대해 깊이 있는 토론을 시작하려고 합니다.
        이 텍스트의 핵심 내용을 파악하고, 사용자의 비판적 사고를 자극할 수 있는 첫 번째 토론 질문을 하나만 만들어 주세요.

        텍스트:
        ---
        {self.text[:4000]}
        ---
        """
        response = self.model.generate_content(prompt)
        first_q = response.text.strip()
        self.questions.append(first_q)
        self.q_index = 1
        return first_q

    def next_question(self) -> str:
        if len(self.questions) >= self.max_questions:
            return self._closing_message()
        self.q_index += 1
        # 대화 기록을 바탕으로 AI가 후속 질문을 생성합니다.
        prompt = f"""
        다음은 AI와 사용자 간의 토론 내용입니다. 이 대화의 흐름을 이어받아,
        사용자의 마지막 답변에 대한 통찰력 있는 후속 질문을 하나만 만들어 주세요.

        전체 토론 텍스트:
        ---
        {self.text[:2000]}
        ---
        
        대화 기록:
        ---
        {json.dumps(self.history, ensure_ascii=False)}
        ---
        """
        response = self.model.generate_content(prompt)
        next_q = response.text.strip()
        self.questions.append(next_q)
        return next_q

    def _closing_message(self) -> str:
        return "훌륭한 토론이었습니다. 다른 주제로 다시 이야기 나눠요!"


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
