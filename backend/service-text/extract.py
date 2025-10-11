import requests
from bs4 import BeautifulSoup
from readability import Document

def extract_from_url(url: str) -> tuple[str, dict]:
    """
    주어진 URL에서 웹페이지의 본문 텍스트와 메타데이터를 추출합니다.
    - 우선 Readability 적용
    - 부족하면 CSS 셀렉터 기반으로 본문 후보를 추출
    - AMP 링크(rel=amphtml)로 재시도
    - 최종적으로도 짧으면 그대로 반환(최소 길이만 확인)
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Connection": "keep-alive",
    }

    def _clean_text(html: str) -> str:
        soup = BeautifulSoup(html or "", "lxml")
        # 제거 대상 태그
        for tag in soup(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "header", "aside"]):
            tag.decompose()
        # 광고/잡동사니로 흔한 클래스 제거
        for noisy in soup.select('[class*="ad"], [id*="ad"], .banner, .social, .share, .related, .recommend'):
            noisy.decompose()
        text = soup.get_text("\n", strip=True)
        # 줄바꿈 정리
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return "\n".join(lines)

    def _extract_with_selectors(html: str) -> str:
        soup = BeautifulSoup(html or "", "lxml")
        for tag in soup(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "header", "aside"]):
            tag.decompose()
        candidates = soup.select(
            "article, main, #article, .article, .art_body, .art_text, .article-body, "
            ".post-content, #news_body, .news_body, #content, .content, .entry-content"
        )
        if not candidates:
            candidates = soup.find_all("p")
        parts = []
        for node in candidates:
            parts.append(node.get_text("\n", strip=True))
        text = "\n".join(p for p in parts if p)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return "\n".join(lines)

    try:
        resp = requests.get(url, headers=headers, timeout=12)
        resp.raise_for_status()

        # 1) Readability 우선
        doc = Document(resp.text)
        title = doc.title() or ""
        content_html = doc.summary() or ""
        text = _clean_text(content_html)

        # 2) 부족하면 CSS 셀렉터 기반 추출
        if len(text) < 200:
            text = _extract_with_selectors(resp.text)

        # 3) 여전히 부족하면 AMP로 재시도
        if len(text) < 200:
            try:
                soup0 = BeautifulSoup(resp.text, "lxml")
                amp_link = soup0.find("link", rel=lambda v: v and "amphtml" in v.lower())
                amp_href = amp_link.get("href") if amp_link else None
                if amp_href:
                    if amp_href.startswith("//"):
                        amp_href = "https:" + amp_href
                    amp_resp = requests.get(amp_href, headers=headers, timeout=12)
                    amp_resp.raise_for_status()
                    doc2 = Document(amp_resp.text)
                    title = doc2.title() or title
                    content_html2 = doc2.summary() or ""
                    text2 = _clean_text(content_html2)
                    if len(text2) > len(text):
                        text = text2
                        url = amp_href
            except Exception:
                pass

        # 4) 최종 정리 및 길이 검사(완화)
        text = (text or "").strip()
        if len(text) < 40:
            # 너무 짧으면 전체 HTML에서라도 최대한 수집
            text = _extract_with_selectors(resp.text)

        meta = {"title": title, "url": url}
        return text, meta

    except requests.RequestException as e:
        print(f"URL로부터 콘텐츠를 가져오는 데 실패했습니다: {e}")
        raise ValueError(f"URL에 접근하는 중 오류가 발생했습니다: {url}")
