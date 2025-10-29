from pathlib import Path
path = Path(r"frontend-ext/chrome/overlay.js")
text = path.read_text(encoding='utf-8')
old = "const baseSummary = quiz?.prompt\n      || overlayState.playfulRemark\n      || (hiddenCount\n        ? `���� ��ü�� ������ ���̶���Ʈ�� ${hiddenCount}�� ǥ���� �ڿ������� ����� �ٲ㺸����.`\n        : '���� ��ü�� ������ ���̶���Ʈ�� ǥ���� �ڿ������� ����� �ٲ㺸����.');"
new = "const label = getLanguageLabel();\n    const baseSummary = quiz?.prompt\n      || overlayState.playfulRemark\n      || (hiddenCount\n        ? `${label} 표현이 가려진 부분이 ${hiddenCount}자 남아 있어요.`\n        : `${label} 표현을 함께 살펴볼까요?`);"
if old not in text:
    raise SystemExit('baseSummary block not found')
path.write_text(text.replace(old, new), encoding='utf-8')
