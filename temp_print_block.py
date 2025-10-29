from pathlib import Path
lines = Path(r"frontend-ext/chrome/overlay.js").read_text(encoding='utf-8').splitlines()
for i in range(243, 254):
    print(f"{i}: {lines[i]!r}")
