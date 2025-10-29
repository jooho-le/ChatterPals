from pathlib import Path
lines = Path(r"frontend-ext/chrome/overlay.js").read_text(encoding='utf-8').splitlines()
start = next(i for i,l in enumerate(lines) if "learningLanguage'" in l)
for i in range(start, start+8):
    print(f"{i}: {lines[i]}")
