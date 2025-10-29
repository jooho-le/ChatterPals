# -*- coding: utf-8 -*-
import pathlib
path = pathlib.Path(r"frontend-ext/chrome/overlay.js")
text = path.read_text(encoding='utf-8')
text = text.replace('https://chatterpals-1gbe.onrender.com/api', 'https://chatterpals-1.onrender.com/api')
text = text.replace('https://chatterpals-1gbe.onrender.com', 'https://chatterpals.onrender.com')
start = text.find('const QUESTION_PROMPT = ')
if start != -1:
    end = text.find('\n', start)
    text = text[:start] + "const QUESTION_PROMPT = '빈칸에 어울리는 표현을 골라보세요.'\n" + text[end+1:]
if 'const LANGUAGE_LABELS' not in text:
    anchor = 'const QUIZ_ENDPOINT = `${TEXT_API_BASE}/text/quiz/cloze`;'
    text = text.replace(anchor, anchor + "\n  const LANGUAGE_LABELS = { en: '영어', ja: '일본어', zh: '중국어' };")
if 'let learningLanguage' not in text:
    text = text.replace('let fabEl = null;', "let fabEl = null;\n  let learningLanguage = 'en';")
path.write_text(text, encoding='utf-8')
