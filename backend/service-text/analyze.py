import os
import json
import google.generativeai as genai
from typing import Dict, Any

# Gemini 모델 설정
# 참고: API 키는 server.py에서 이미 설정했으므로 여기서 다시 설정할 필요는 없습니다.
# genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

def analyze(text: str, max_questions: int = 5) -> Dict[str, Any]:
    """
    2단계 처리 방식을 사용하여 텍스트를 분석하고 고품질 질문을 생성합니다.
    1단계: 텍스트를 요약하고 핵심 키워드를 추출합니다.
    2단계: 요약본과 키워드를 바탕으로 다양한 유형의 질문을 생성합니다.
    """
    if not text:
        return {"summary": "", "topics": [], "questions": []}

    try:
        # --- 1단계: "요약 전문가" AI ---
        summarizer_model = genai.GenerativeModel('gemini-2.0-flash-lite-preview')
        
        summarizer_prompt = f"""
        You are a senior news editor. Read the text and return a strict JSON object.

        1. `summary`: Provide a concise summary in natural English (3-4 sentences).
        2. `keywords`: Extract 5 key topics in English, ordered by importance.

        Text:
        ---
        {text[:10000]}
        ---

        JSON output only:
        """

        summary_response = summarizer_model.generate_content(summarizer_prompt)
        
        # AI가 생성한 JSON 문자열을 파싱
        # 때때로 AI가 코드 블록 마크다운을 포함하므로 제거
        cleaned_json_str = summary_response.text.strip().replace('```json', '').replace('```', '').strip()
        summary_data = json.loads(cleaned_json_str)
        
        summary = summary_data.get("summary", "")
        keywords = summary_data.get("keywords", [])

        if not summary:
             raise ValueError("1단계 요약 생성에 실패했습니다.")

        if max_questions <= 0:
            return {
                "summary": summary,
                "topics": keywords,
                "questions": [],
            }

        # --- 2단계: "질문 생성가" AI ---
        question_generator_model = genai.GenerativeModel('gemini-2.0-flash-lite-preview')

        question_generator_prompt = f"""
        당신은 학생들의 비판적 사고력을 키우는 최고의 영어 교사입니다. 학생들을 위해서 질문은 영어로 만들어주세요
        아래에 제공된 "핵심 요약"과 "주요 키워드"를 바탕으로, 다음 세 가지 유형의 질문을 합해서 총 {max_questions}개 생성해 주세요.

        1. **사실 확인 질문 (Factual Questions):** 요약된 내용에서 답을 직접 찾을 수 있는 질문.
        2. **추론 질문 (Inferential Questions):** 내용에 암시된 의미나 저자의 의도를 파악해야 하는 질문.
        3. **평가 질문 (Evaluative Questions):** 독자의 개인적인 의견이나 가치 판단을 묻는 질문.

        질문은 반드시 "주요 키워드"와 관련된 내용이어야 합니다. 결과는 JSON 형식의 질문 목록으로만 반환해 주세요.

        핵심 요약:
        ---
        {summary}
        ---

        주요 키워드: {", ".join(keywords)}

        JSON 출력 (질문 목록):
        """
        
        questions_response = question_generator_model.generate_content(question_generator_prompt)
        cleaned_json_str = questions_response.text.strip().replace('```json', '').replace('```', '').strip()
        raw_questions = json.loads(cleaned_json_str)

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
            "topics": keywords, # 기존 'topics' 키에 키워드를 할당
            "questions": questions_list,
        }

    except Exception as e:
        print(f"AI 분석 중 오류 발생: {e}")
        # 오류 발생 시, 간단한 분석으로 대체 (Fallback)
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-lite-preview')
            prompt = f"다음 텍스트에서 토론 질문 {max_questions}개를 만들어줘: {text[:2000]}"
            response = model.generate_content(prompt)
            # 간단한 텍스트 분리
            questions = [q.strip() for q in response.text.split('\n') if q.strip()]
            trimmed = questions[:max(0, max_questions)] if max_questions else []
            return {
                "summary": text[:200] + "...",
                "topics": [],
                "questions": trimmed,
            }
        except Exception as fallback_e:
            print(f"Fallback 분석 중 오류 발생: {fallback_e}")
            return {"summary": "분석 중 오류가 발생했습니다.", "topics": [], "questions": []}
