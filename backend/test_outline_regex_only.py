import re
from pathlib import Path

_SECTION_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?(?=\s|$)")
_TOP_CHAPTER_PREFIX = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ü])")
_CHAPTER_PREFIX = re.compile(r"^\s*Chapter\s+(\d+)\s*:", re.IGNORECASE)
_ANNEX_PREFIX = re.compile(r"^\s*(Attachment|Appendix|Annex|Exhibit)\s+([A-Z0-9]+)\b", re.IGNORECASE)
_FALSE_POSITIVE_PATTERNS = re.compile(
    r"^("
    r"In these expressions|T-stub response|Definition of effective|"
    r"Definition of the rigid|"
    r"where\s|Note\s*:|see\s|with\s|for\s|and\s|the\s|this\s|it\s|from\s|"
    r"Part\s+[IVX]+\s*:|"
    r"\([a-z]\)\s|"
    r"·\s|"
    r"Data\s*:|Calculation\s*:|PRELIMINARY\s|CALCULATION\s+PROCEDURE|"
    r"Assembly procedure\s|Presentation for\s|"
    r"^Strength$|^Stiffness$|^Modelling$|^Data$|^Calculation$"
    r")",
    re.IGNORECASE,
)
_ALPHA_WORD = re.compile(r"[a-zA-ZÀ-ÿ]{3,}")
_MATH_HEAVY = re.compile(r"[=×÷±≤≥≠∆∑∫√½π⋅·σδε]|[<>]=?")

def _est_titre_section(line: str) -> tuple[bool, int | None]:
    if ".." in line:
        return False, None

    if _CHAPTER_PREFIX.match(line):
        return True, 1

    if _ANNEX_PREFIX.match(line):
        return True, 1

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

pages_text_path = Path(r"C:\Users\MHDINGBI\.gemini\antigravity\brain\aac4369e-9ab5-4e58-9ae8-308748e54a4b\scratch\pages_text.txt")
content = pages_text_path.read_text(encoding="utf-8")

pages = content.split("================ PAGE ")
flat = []
seen = set()

for page_part in pages:
    if not page_part.strip():
        continue
    lines = page_part.splitlines()
    header_line = lines[0].split(" =")[0]
    try:
        pno = int(header_line)
    except ValueError:
        continue
    
    for line in lines[1:]:
        line = line.strip()
        if not line or len(line) > 120:
            continue
        if _FALSE_POSITIVE_PATTERNS.match(line):
            continue

        ok, level = _est_titre_section(line)
        if not ok:
            continue

        key = line.lower()
        if key in seen:
            continue
        seen.add(key)

        flat.append({
            "page": pno,
            "level": level,
            "title": line
        })

print(f"Total matched items: {len(flat)}")
print("\nFirst 30 matched outline items:")
for item in flat[:30]:
    print(f"Page {item['page']} (Level {item['level']}): {repr(item['title'])}")
