import requests
from bs4 import BeautifulSoup
from readability import Document

def extract_from_url(url: str) -> tuple[str, dict]:
    """
    주어진 URL에서 웹페이지의 본문 텍스트와 메타데이터를 추출합니다.
    추출된 텍스트가 너무 짧으면 오류를 발생시켜 수동 선택을 유도합니다.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        # Readability를 사용하여 본문 추출
        doc = Document(response.text)
        title = doc.title()
        content_html = doc.summary()
        
        # HTML 태그를 제거하여 순수 텍스트만 추출
        soup = BeautifulSoup(content_html, 'lxml')
        text = soup.get_text(separator='\n', strip=True)

        # 개선된 부분: 추출된 텍스트가 유의미한지 길이를 확인
        # "로그인하세요" 같은 짧은 문구로 토론이 시작되는 것을 방지합니다.
        if not text or len(text) < 100: # 100자 미만은 유의미한 콘텐츠가 아니라고 판단
            raise ValueError(
                f"자동으로 본문을 추출할 수 없거나 내용이 너무 짧습니다. "
                f"사이트가 동적으로 로딩되거나 분석이 어려운 구조일 수 있습니다. "
                f"분석하고 싶은 부분을 마우스로 직접 선택한 후 다시 시도해 주세요."
            )

        meta = {
            "title": title,
            "url": url,
        }
        return text, meta

    except requests.RequestException as e:
        print(f"URL로부터 콘텐츠를 가져오는 데 실패했습니다: {e}")
        # 클라이언트에게 전달될 오류 메시지를 표준화합니다.
        raise ValueError(f"URL에 접근하는 중 오류가 발생했습니다: {url}")

