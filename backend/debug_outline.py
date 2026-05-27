import re
from pathlib import Path

_SECTION_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?(?=\s|$)")
_TOP_CHAPTER_PREFIX = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ö])")
_ALPHA_WORD = re.compile(r"[a-zA-ZÀ-ÿ]{3,}")
_MATH_HEAVY = re.compile(r"[=±-∞%σ%•%●^√^'¹^²^s³±<.×§]|[<>]=?")
_FALSE_POSITIVE_PATTERNS = re.compile(
    r"^("
    r"In these expressions|T-stub response|Definition of effective|"
    r"Definition of the rigid|"
    r"where\s|Note\s*:|see\s|with\s|for\s|and\s|the\s|this\s|it\s|from\s|"
    r"Part\s+[IVX]+\s*:|"
    r"\([a-z]\)\s|"
    r"•\s|"
    r"Data\s*:|Calculation\s*:|PRELIMINARY\s|CALCULATION\s+PROCEDURE|"
    r"Assembly procedure\s|Presentation for\s|"
    r"^Strength$|^Stiffness$|^Modelling$|^Data$|^Calculation$"
    r")",
    re.IGNORECASE,
)

def _est_titre_section(line: str) -> tuple[bool, int | None]:
    if ".." in line:
        return False, None
    m_top = _TOP_CHAPTER_PREFIX.match(line)
    if m_top:
        rest = line[m_top.end() - 1:].strip()
        if (len(rest) >= 5
                and _ALPHA_WORD.search(rest)
                and not _MATH_HEAVY.search(rest)
                and not _FALSE_POSITIVE_PATTERNS.match(line)):
            alpha_ratio = sum(c.isalpha() for c in rest) / max(len(rest), 1)
            if alpha_ratio >= 0.50:
                return True, 1
    m = _SECTION_PREFIX.match(line)
    if not m:
        return False, None
    rest = line[m.end():].strip()
    if len(rest) < 10:
        return False, None
    if not _ALPHA_WORD.search(rest):
        return False, None
    if _MATH_HEAVY.search(rest):
        return False, None
    alpha_ratio = sum(c.isalpha() for c in rest) / max(len(rest), 1)
    if alpha_ratio < 0.50:
        return False, None
    level = m.group(1).count(".") + 1
    return True, level

pages_text_path = Path(r"C:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend\cache\99cb355a11d94406\result.md")
if not pages_text_path.exists():
    pages_text_path = Path(r"C:\Users\MHDINGBI\.gemini\antigravity\brain\aac4369e-9ab5-4e58-9ae8-308748e54a4b\scratch\pages_text.txt")

print(f"Reading from: {pages_text_path}")
content = pages_text_path.read_text(encoding="utf-8")

print("First 500 chars of file:")
print(repr(content[:500]))

# Let's check a few specific lines
test_lines = [
    "1. Welcome to Advance Design 2026",
    "2. Quick list",
    "2.1 Composite beams",
    "2.2 Modeling of pile foundations",
    "3. Composite beams",
    "3.1 Modeling of composite beams",
    "3.1.1 Composite beam",
]

print("\nTesting specific lines:")
for l in test_lines:
    ok, lvl = _est_titre_section(l)
    print(f"{repr(l)} -> ok: {ok}, level: {lvl}")

print("\nScanning first few lines of content:")
for i, line in enumerate(content.splitlines()[:150]):
    line = line.strip()
    if not line:
        continue
    ok, lvl = _est_titre_section(line)
    if ok:
        print(f"Line {i}: {repr(line)} -> level {lvl}")
