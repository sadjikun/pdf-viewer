from __future__ import annotations

import html
from typing import Any


def _group_by_section(store: dict) -> list[dict]:
    """Group highlights by section, ordered by each section's min page.
    Within a section, highlights are ordered by page then text."""
    highlights = store.get("highlights", []) or []
    notes = store.get("notes", {}) or {}

    by_section: dict[str, dict[str, Any]] = {}
    for h in highlights:
        sec = h.get("section") or ""
        title = h.get("sectionTitle") or "Sans section"
        bucket = by_section.setdefault(sec, {"title": title, "items": []})
        bucket["items"].append(h)

    groups = []
    for sec, bucket in by_section.items():
        items = sorted(bucket["items"], key=lambda x: (x.get("page", 0), x.get("text", "")))
        min_page = min((x.get("page", 0) for x in items), default=0)
        groups.append({"section": sec, "title": bucket["title"],
                       "min_page": min_page, "items": items, "notes": notes})
    groups.sort(key=lambda g: g["min_page"])
    return groups


def render_markdown(title: str, store: dict) -> str:
    notes = store.get("notes", {}) or {}
    lines = [f"# {title}", "", "_Fiche de révision générée depuis vos annotations._", ""]
    for g in _group_by_section(store):
        lines.append(f"## {g['title']}")
        lines.append("")
        for h in g["items"]:
            page = h.get("page", 0)
            text = h.get("text", "").strip()
            lines.append(f"- {text} [p. {page}]")
            note = notes.get(h.get("key", ""))
            if note:
                lines.append(f"  - 📝 {note.strip()}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


_COLOR_HEX = {
    "yellow": "#fff3a3", "green": "#b8f0c0",
    "blue": "#b3d9ff", "pink": "#ffc0e0", "orange": "#ffd9a0",
}


def render_html(title: str, store: dict) -> str:
    notes = store.get("notes", {}) or {}
    esc = html.escape
    parts = [
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">",
        f"<title>{esc(title)}</title>",
        "<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;"
        "padding:0 1rem;line-height:1.5}blockquote{border-left:4px solid #ccc;margin:.5rem 0;"
        "padding:.25rem .75rem}.note{color:#555;font-style:italic;margin:.25rem 0 1rem .5rem}"
        ".page{color:#888;font-size:.85em}</style></head><body>",
        f"<h1>{esc(title)}</h1>",
        "<p><em>Fiche de révision générée depuis vos annotations.</em></p>",
    ]
    for g in _group_by_section(store):
        parts.append(f"<h2>{esc(g['title'])}</h2>")
        for h in g["items"]:
            color = _COLOR_HEX.get(h.get("color", ""), "#fff3a3")
            page = h.get("page", 0)
            text = esc(h.get("text", "").strip())
            color_name = h.get("color", "yellow")
            parts.append(
                f'<blockquote class="hl-{color_name}" style="border-left-color:{color}">{text} '
                f'<span class="page">p. {page}</span></blockquote>'
            )
            note = notes.get(h.get("key", ""))
            if note:
                parts.append(f'<div class="note">📝 {esc(note.strip())}</div>')
    parts.append("</body></html>")
    return "".join(parts)
