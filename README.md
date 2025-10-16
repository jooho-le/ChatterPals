ChatterPals-jh — 화면 텍스트 맥락 Q&A (MVP)

개요
- 목표: 화면에 보이는 텍스트(예: 웹 기사)를 입력으로 받아 맥락을 파악하고 핵심 토픽을 식별하여 사용자가 생각을 확장할 수 있도록 “영어 질문”을 생성합니다.
- 범위(MVP): 외부 의존성 없이 로컬에서 동작하는 HTTP 서비스. 텍스트를 받아 요약, 토픽, 질문을 반환하고, 생성된 Q&A/토론 내역을 날짜별 기록으로 저장·PDF로 내보낼 수 있습니다.

빠른 시작
- 요구 사항: Python 3.9+, FastAPI 0.110+, Uvicorn 0.23+
- 의존성 설치: `pip install fastapi uvicorn`
- 개발용 서버 실행: `uvicorn app.server:app --reload --port 8008`
- 배포용(간단) 실행: `python3 -m app.server`
- 텍스트 분석 예시(curl):
  - `curl -s -X POST http://localhost:8008/analyze -H 'Content-Type: application/json' -d '{"text":"Jeonju city hit by heavy rain with widespread damage reported..."}' | jq`
- 자동 문서: `http://127.0.0.1:8008/docs`

API
- POST `/analyze`
  - 요청 JSON:
    - `text`: string (필수) – 화면에서 추출한 원문 텍스트(기사 전체 또는 선택 영역)
    - `source_url`: string (선택) – 페이지 URL(참고용)
    - `max_questions`: int (선택, 기본 5)
  - 응답 JSON:
    - `summary`: 짧은 요약 문자열
    - `topics`: 핵심 키워드/토픽 문자열 배열
    - `questions`: 텍스트에 맞춘 영어 질문 배열
    - `meta`: 부가 정보(언어 추정, 엔티티 유사 정보, 길이 등)

설계 노트
- FastAPI 기반 REST 서버이므로 Uvicorn 또는 Gunicorn으로 확장이 쉽고, `/docs`에서 API 스키마를 확인할 수 있습니다.
- 질문/요약 로직은 휴리스틱으로 구성되어 외부 LLM 의존성이 없습니다.
- 기록 데이터는 `data/records.db` SQLite 데이터베이스에 저장되며, `/records` API나 직접 sqlite3를 통해 조회할 수 있습니다. PDF 응답은 요청 시점에 생성됩니다.
- 확장 로드맵:
  - 입력: OCR(Tesseract 등) 또는 브라우저 확장으로 가시 텍스트 자동 수집
  - NLP: 휴리스틱 요약 → LLM(`SummaryProvider`), 질문 생성 → LLM(`QuestionProvider`)
  - 다국어: 현재는 질문을 영어로만 생성. 이후 출력 언어 옵션 추가 예정

개발 팁
- 빠른 반복을 위해 `/analyze` 엔드포인트에 원문 텍스트를 바로 POST 하세요.
- 휴리스틱 요약 특성상 1–8K자 정도 분량에서 품질이 더 안정적입니다.

추가 예시
- URL 분석(curl):
  - `curl -s -X POST http://localhost:8008/analyze_url -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com/article\"}' | jq`
- 영어 토론 시작(curl):
  - `curl -s -X POST http://localhost:8008/chat/start -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com/article\"}' | jq`
  - 답변 전송: `curl -s -X POST http://localhost:8008/chat/reply -H 'Content-Type: application/json' -d '{\"session_id\":\"<위 session_id>\", \"answer\":\"I think ...\"}' | jq`

추가 엔드포인트
- POST `/analyze_url`
  - 요청: `{ url: string, max_questions?: number }`
  - 설명: URL에서 텍스트를 추출해 분석 결과 반환

- POST `/questions`
  - 요청: `{ text?: string, url?: string, title?: string, max_questions?: number }`
  - 설명: 요약/토픽과 함께 최대 N개의 영어 질문만 반환(확장 프로그램에서 사용)

- POST `/chat/start`
  - 요청: `{ text?: string, url?: string, title?: string, max_questions?: number }`
  - 설명: 영어 토론 세션 시작, 첫 질문과 `session_id` 반환

- POST `/chat/reply`
  - 요청: `{ session_id: string, answer: string }`
  - 설명: 사용자 답변을 받고 다음 영어 질문 반환

- POST `/chat/end`
  - 요청: `{ session_id: string }`
  - 설명: 진행 중인 토론을 조기 종료하고 마무리 멘트를 반환

- POST `/chat/evaluate`
  - 요청: `{ record_id: string }`
  - 설명: 토론 기록을 토대로 문법/어휘/논리 점수와 피드백을 생성해 기록에 저장

- POST `/records/questions`
  - 요청: `{ items: [{ question, answer }...], meta?: object, title?: string, url?: string, selection_text?: string, summary?: string, topics?: string[] }`
  - 설명: 확장 프로그램에서 작성한 질문·답변을 저장. 응답으로 `record_id`, `created_at` 반환

- GET `/records`
  - 쿼리: `?date=YYYY-MM-DD` 선택
  - 설명: 저장된 기록 목록을 최신순으로 반환

- GET `/records/{record_id}`
  - 설명: 특정 기록의 전체 JSON 반환

- GET `/records/{record_id}.pdf`
  - 설명: 기록을 간단한 PDF 문서로 다운로드(기본 CJK 폰트 사용)
- GET `/records/export.pdf?ids=<id1,id2,...>`
  - 설명: 여러 기록을 한 PDF로 합쳐 내려받기 (질문/답변 + 토론 기록을 함께 묶을 때 활용)

사용자 계정 및 마이페이지
- POST `/auth/signup`
  - 요청: `{ username, nickname, password }`
  - 설명: 새 계정을 만들고 즉시 액세스 토큰을 반환합니다.
- POST `/auth/login`
  - 요청: `application/x-www-form-urlencoded` 바디 (`username`, `password`)
  - 설명: 로그인 후 `access_token`을 받습니다. 이후 `Authorization: Bearer <token>` 헤더를 사용합니다.
- GET `/auth/me`
  - 설명: 현재 로그인한 사용자 정보를 반환합니다. `PATCH /auth/me`로 닉네임을 수정할 수 있습니다.
- GET `/me/records`
  - 설명: 나의 학습 기록 목록(질문/토론)을 반환합니다. `GET /me/records/{record_id}`로 상세 조회가 가능합니다.
- 질문/토론 저장 API (`/records/questions`, `/records/save_evaluation`, `/chat/start`) 호출 시 토큰을 포함하면 기록이 계정에 연결됩니다.
- 웹 마이페이지에서는 최근 기록을 빠르게 살펴보고, `/records/{id}` 화면에서 질문·답변/토론 내역과 평가 결과를 자세히 확인할 수 있습니다.

브라우저 확장(Chrome, MV3)
- 위치: `ext/chrome`
- 기능: 현재 탭의 선택 텍스트가 있으면 그것을, 없으면 현재 탭 URL을 로컬 서버로 전송
- 제공 버튼:
  - Question: `/questions`를 호출해 기사/페이지에 대한 질문 5개 생성
  - Save Answers: 질문별로 입력한 답변을 `/records/questions`에 저장(기록 ID 반환)
  - Discuss (EN): `/chat/start`로 토론 세션 시작 → 답변을 주고받으며 마지막에 자동으로 기록 저장
- 서버 주소 입력란: 기본 `http://127.0.0.1:8008` (변경 가능, 동기 저장)
- 확장에서 평가 결과나 토론 기록을 저장하려면 사이드바 상단의 로그인 섹션에서 계정 정보를 입력해 JWT 토큰을 발급받아야 합니다.

설치 방법
1) 크롬에서 개발자 모드 ON → 확장 프로그램 → 압축해제된 확장 프로그램을 로드
2) 폴더 선택: 이 리포지토리의 `ext/chrome`
3) 로컬 서버 실행: `python3 -m app.server`
4) 아무 페이지나 열고 확장 아이콘 클릭 → Analyze 또는 Discuss (EN)

주의
- 사내 프록시/보안 정책에 따라 `http://127.0.0.1:8008` 접근이 제한될 수 있습니다. 필요 시 `http://localhost:8008`로 바꾸세요(서버는 CORS 허용).


<aside>

**백앤드 서버 설정**

텍스트 분석/채팅 서버 : uvicorn backend.service-text.server:app --reload --port 8008
음성 서버 : uvicorn backend.service-voice.server:app --reload --port 8000
프론트엔드 실행 : cd frontend-app, npm run dev

</aside>

<aside>

**1. 파이썬 가상환경 생성 및 활성화**

python -m venv venv
source venv/bin/activate  # macOS/Linux
.\venv\Scripts\activate    # Window

</aside>