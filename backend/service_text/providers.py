from typing import Protocol, List, Dict


class SummaryProvider(Protocol):
    def summarize(self, text: str, max_sentences: int = 2) -> str: ...


class QuestionProvider(Protocol):
    def questions(self, text: str, topics: List[str], meta: Dict, max_q: int = 5) -> List[str]: ...


class HeuristicSummaryProvider:
    def __init__(self, summarize_fn):
        self._summarize = summarize_fn

    def summarize(self, text: str, max_sentences: int = 2) -> str:
        return self._summarize(text, max_sentences=max_sentences)


class HeuristicQuestionProvider:
    def __init__(self, question_fn):
        self._question = question_fn

    def questions(self, text: str, topics: List[str], meta: Dict, max_q: int = 5) -> List[str]:
        return self._question(topics, meta.get('summary', ''), meta.get('entities', {}), max_q=max_q)

