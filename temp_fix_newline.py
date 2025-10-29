from pathlib import Path
path = Path(r"backend/service_text/server.py")
text = path.read_text(encoding='utf-8')
text = text.replace('prompt = build_discussion_evaluation_prompt(language_code, "\n".join(transcript_lines))', 'prompt = build_discussion_evaluation_prompt(language_code, "\\n".join(transcript_lines))')
path.write_text(text, encoding='utf-8')
