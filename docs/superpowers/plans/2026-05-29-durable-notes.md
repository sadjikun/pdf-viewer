# Durable Notes (R11/R12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate highlights & notes from browser `localStorage` to durable server-side JSON storage, with auto-migration on first open, section-scoped multi-node highlight restore, an in-Reader notes panel, and a backend revision-sheet ("fiche") export.

**Architecture:** Backend gains 3 endpoints (GET/PUT `/doc/{id}/annotations`, GET `/doc/{id}/fiche`) writing to `cache/{doc_id}/annotations.json` via atomic temp+`os.replace`. A pure `backend/fiche.py` generates HTML/Markdown for unit-testing. Frontend keeps `localStorage` as the primary store but adds a debounced (1000ms) background sync to the server (Option B). Highlight restore moves from fragile `indexOf` single-node matching to a section-scoped, multi-node, offset-map model with deterministic `{section}::{shortHash(text)}` keys.

**Tech Stack:** Python 3.13 / FastAPI / uvicorn (backend, cache-based, no DB); React 19 + TypeScript + Vite (frontend); pytest (new, backend TDD only — frontend verified manually).

---

## Data-Safety Invariants (from spec §6 — never violate)

- **I-A** Atomic write: server writes to `annotations.json.tmp` then `os.replace`.
- **I-B** A failed background sync must NEVER clear `localStorage` — the local copy is the fallback.
- **I-C** Orphan notes (a note key with no matching highlight key) are dropped on save.
- **I-D** The server stamps `saved_at` (ms epoch) on every successful PUT.

---

## File Structure

**Backend**
- `backend/requirements.txt` — *modify*: add `pytest>=8.0`.
- `backend/conftest.py` — *create*: pytest fixtures (`client`, `doc_id`).
- `backend/tests/test_annotations.py` — *create*: GET/PUT endpoint tests.
- `backend/tests/test_fiche.py` — *create*: fiche generator + endpoint tests.
- `backend/fiche.py` — *create*: pure HTML/Markdown generators (no FastAPI).
- `backend/main.py` — *modify*: add `import time`; add `Response` to `fastapi.responses` import; add `_EMPTY_ANNOTATIONS`; add `get_annotations`, `put_annotations`, `get_fiche` endpoints.

**Frontend**
- `frontend/src/types.ts` — *modify*: add `StoredHighlight`, `AnnotationStore`.
- `frontend/src/api.ts` — *modify*: add `getAnnotations`, `saveAnnotations`, `ficheUrl`.
- `frontend/src/components/Reader/MarkdownReader.tsx` — *modify*: rewrite restore (Task 6), capture+persist (Task 7), load sequence (Task 8), notes panel (Task 9), export button (Task 10).
- `frontend/src/components/Reader/MarkdownReader.css` — *modify*: minimal styles for notes-list panel.

**Memory (project wiki — PROTOCOLE ÉCRITURE)**
- `memory/fixes-registry.md`, `memory/LOG.md`, `memory/phases.md`, `memory/INDEX.md`, `CLAUDE.md`, `GEMINI.md`, `memory/PRD.md` — *modify* (Task 11).

---

## Task 1: Backend test harness

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/conftest.py`
- Create: `backend/tests/test_annotations.py`

- [ ] **Step 1: Add pytest to requirements**

Add this line to `backend/requirements.txt`:

```
pytest>=8.0
```

- [ ] **Step 2: Install it**

Run: `cd backend && pip install pytest>=8.0`
Expected: `Successfully installed pytest-...`

- [ ] **Step 3: Create the fixtures**

Create `backend/conftest.py`:

```python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make `import main` work no matter where pytest is invoked from.
sys.path.insert(0, os.path.dirname(__file__))

import main  # noqa: E402

TEST_DOC_ID = "aaaaaaaaaaaaaaaa"  # 16 hex chars — passes _DOC_ID_RE


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def doc_id():
    """Create a minimal cached doc, yield its id, clean up afterwards."""
    ddir = main.CACHE_DIR / TEST_DOC_ID
    ddir.mkdir(parents=True, exist_ok=True)
    result = {
        "doc_id": TEST_DOC_ID,
        "title": "Eurocode Test",
        "filename": "eurocode-test.pdf",
        "num_pages": 3,
    }
    (ddir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    try:
        yield TEST_DOC_ID
    finally:
        import shutil
        shutil.rmtree(ddir, ignore_errors=True)
```

- [ ] **Step 4: Write the first failing test**

Create `backend/tests/test_annotations.py`:

```python
def test_get_annotations_empty(client, doc_id):
    res = client.get(f"/doc/{doc_id}/annotations")
    assert res.status_code == 200
    assert res.json() == {
        "version": 1,
        "highlights": [],
        "notes": {},
        "saved_at": 0,
    }
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_annotations.py -v`
Expected: FAIL with 404 (route not defined yet).

---

## Task 2: GET + PUT annotations endpoints

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_annotations.py`

- [ ] **Step 1: Add the `time` import**

In `backend/main.py`, the stdlib import block currently has (no `time`):

```python
import hashlib
import io
import json
import os
import re
import shutil
import sys
```

Add `import time` in alphabetical position:

```python
import hashlib
import io
import json
import os
import re
import shutil
import sys
import time
```

- [ ] **Step 2: Add the empty-store constant**

Near the other module constants (after `_DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")`), add:

```python
_EMPTY_ANNOTATIONS = {"version": 1, "highlights": [], "notes": {}, "saved_at": 0}
```

- [ ] **Step 3: Write failing tests for roundtrip + orphan-drop + bad shape**

Append to `backend/tests/test_annotations.py`:

```python
def test_put_then_get_roundtrip(client, doc_id):
    payload = {
        "version": 1,
        "highlights": [
            {"key": "rs_1_3::a1b2c3d4", "color": "yellow",
             "text": "coefficient partiel", "section": "rs_1_3",
             "sectionTitle": "1.3 Bases", "page": 12}
        ],
        "notes": {"rs_1_3::a1b2c3d4": "Revoir le coefficient partiel."},
    }
    put = client.put(f"/doc/{doc_id}/annotations", json=payload)
    assert put.status_code == 200
    got = client.get(f"/doc/{doc_id}/annotations").json()
    assert got["highlights"] == payload["highlights"]
    assert got["notes"] == payload["notes"]
    assert got["saved_at"] > 0  # I-D: server stamps it


def test_put_drops_orphan_notes(client, doc_id):
    payload = {
        "highlights": [{"key": "k1", "color": "yellow", "text": "x"}],
        "notes": {"k1": "kept", "ghost": "dropped"},
    }
    client.put(f"/doc/{doc_id}/annotations", json=payload)
    got = client.get(f"/doc/{doc_id}/annotations").json()
    assert got["notes"] == {"k1": "kept"}  # I-C


def test_put_bad_shape_422(client, doc_id):
    res = client.put(f"/doc/{doc_id}/annotations", json={"highlights": "nope"})
    assert res.status_code == 422


def test_get_unknown_doc_404(client):
    res = client.get("/doc/ffffffffffffffff/annotations")
    assert res.status_code == 404
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_annotations.py -v`
Expected: FAIL (routes still missing).

- [ ] **Step 5: Implement both endpoints**

In `backend/main.py`, add after the existing `_load_result` helper region (anywhere among the route handlers is fine; place near other `/doc/{doc_id}` routes):

```python
@app.get("/doc/{doc_id}/annotations")
def get_annotations(doc_id: str):
    ddir = _doc_dir(doc_id)  # raises 400 on bad id
    if not ddir.exists():
        raise HTTPException(status_code=404, detail="document not found")
    path = ddir / "annotations.json"
    if not path.exists():
        return JSONResponse(dict(_EMPTY_ANNOTATIONS))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return JSONResponse(dict(_EMPTY_ANNOTATIONS))  # corrupt → empty
    return JSONResponse(data)


@app.put("/doc/{doc_id}/annotations")
def put_annotations(doc_id: str, body: dict):
    ddir = _doc_dir(doc_id)
    if not ddir.exists():
        raise HTTPException(status_code=404, detail="document not found")

    highlights = body.get("highlights", [])
    notes = body.get("notes", {})
    if not isinstance(highlights, list) or not isinstance(notes, dict):
        raise HTTPException(status_code=422, detail="invalid annotations shape")

    # I-C: drop orphan notes (no matching highlight key)
    valid_keys = {h.get("key") for h in highlights if isinstance(h, dict)}
    notes = {k: v for k, v in notes.items() if k in valid_keys}

    store = {
        "version": 1,
        "highlights": highlights,
        "notes": notes,
        "saved_at": int(time.time() * 1000),  # I-D
    }

    # I-A: atomic write
    path = ddir / "annotations.json"
    tmp = ddir / "annotations.json.tmp"
    tmp.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return {"ok": True, "saved_at": store["saved_at"]}
```

- [ ] **Step 6: Run all annotation tests**

Run: `cd backend && python -m pytest tests/test_annotations.py -v`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/conftest.py backend/tests/test_annotations.py backend/main.py
git commit -m "feat(annotations): durable server-side annotation store (GET/PUT)"
```

---

## Task 3: Fiche export (pure generator + endpoint)

**Files:**
- Create: `backend/fiche.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_fiche.py`

- [ ] **Step 1: Write failing generator tests**

Create `backend/tests/test_fiche.py`:

```python
from fiche import render_markdown, render_html

STORE = {
    "highlights": [
        {"key": "b::2", "color": "yellow", "text": "second point",
         "section": "rs_1", "sectionTitle": "1 Intro", "page": 8},
        {"key": "a::1", "color": "green", "text": "first point",
         "section": "rs_1", "sectionTitle": "1 Intro", "page": 5},
    ],
    "notes": {"a::1": "ma note"},
}


def test_markdown_contains_text_page_and_note():
    md = render_markdown("Mon Doc", STORE)
    assert "first point" in md
    assert "[p. 5]" in md
    assert "ma note" in md


def test_markdown_orders_highlights_by_page():
    md = render_markdown("Mon Doc", STORE)
    assert md.index("first point") < md.index("second point")  # p.5 before p.8


def test_html_has_blockquote_color_and_page():
    html = render_html("Mon Doc", STORE)
    assert "<blockquote" in html
    assert "yellow" in html or "green" in html
    assert "p. 5" in html
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_fiche.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fiche'`.

- [ ] **Step 3: Implement the pure generator**

Create `backend/fiche.py`:

```python
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
            parts.append(
                f'<blockquote style="border-left-color:{color}">{text} '
                f'<span class="page">p. {page}</span></blockquote>'
            )
            note = notes.get(h.get("key", ""))
            if note:
                parts.append(f'<div class="note">📝 {esc(note.strip())}</div>')
    parts.append("</body></html>")
    return "".join(parts)
```

- [ ] **Step 4: Run generator tests**

Run: `cd backend && python -m pytest tests/test_fiche.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `Response` to the imports**

In `backend/main.py`, the responses import is currently:

```python
from fastapi.responses import FileResponse, JSONResponse
```

Change to:

```python
from fastapi.responses import FileResponse, JSONResponse, Response
```

- [ ] **Step 6: Write a failing endpoint integration test**

Append to `backend/tests/test_fiche.py`:

```python
def test_fiche_md_endpoint_contains_highlight(client, doc_id):
    payload = {
        "highlights": [{"key": "rs_1::1", "color": "yellow",
                        "text": "phrase clef", "section": "rs_1",
                        "sectionTitle": "1 Intro", "page": 4}],
        "notes": {"rs_1::1": "important"},
    }
    client.put(f"/doc/{doc_id}/annotations", json=payload)
    res = client.get(f"/doc/{doc_id}/fiche?format=md")
    assert res.status_code == 200
    assert "phrase clef" in res.text
    assert "[p. 4]" in res.text
    assert "attachment" in res.headers.get("content-disposition", "")


def test_fiche_html_endpoint_ok(client, doc_id):
    client.put(f"/doc/{doc_id}/annotations", json={
        "highlights": [{"key": "k::1", "color": "green", "text": "abc",
                        "section": "rs_1", "sectionTitle": "1", "page": 2}],
        "notes": {},
    })
    res = client.get(f"/doc/{doc_id}/fiche?format=html")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "<blockquote" in res.text
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_fiche.py -v`
Expected: FAIL (endpoint missing).

- [ ] **Step 8: Implement the fiche endpoint**

In `backend/main.py`, add near the annotation routes:

```python
@app.get("/doc/{doc_id}/fiche")
def get_fiche(doc_id: str, format: str = "html"):
    ddir = _doc_dir(doc_id)
    if not ddir.exists():
        raise HTTPException(status_code=404, detail="document not found")
    if format not in ("html", "md"):
        raise HTTPException(status_code=400, detail="format must be html or md")

    # Title: prefer cleaned result title, fall back to doc id.
    try:
        result = _load_result(doc_id)
        title = _clean_title(result.get("title") or result.get("filename") or doc_id)
    except HTTPException:
        title = doc_id

    path = ddir / "annotations.json"
    if path.exists():
        try:
            store = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            store = dict(_EMPTY_ANNOTATIONS)
    else:
        store = dict(_EMPTY_ANNOTATIONS)

    from fiche import render_html, render_markdown

    safe = re.sub(r"[^\w\-]+", "_", title).strip("_") or "fiche"
    if format == "md":
        content = render_markdown(title, store)
        media = "text/markdown; charset=utf-8"
        fname = f"{safe}.md"
    else:
        content = render_html(title, store)
        media = "text/html; charset=utf-8"
        fname = f"{safe}.html"

    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
```

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && python -m pytest -v`
Expected: PASS (all annotation + fiche tests).

- [ ] **Step 10: Commit**

```bash
git add backend/fiche.py backend/tests/test_fiche.py backend/main.py
git commit -m "feat(fiche): backend revision-sheet export (HTML/Markdown)"
```

---

## Task 4: Frontend annotation types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add the types**

Append to `frontend/src/types.ts`:

```typescript
export interface StoredHighlight {
  key: string;
  color: string;
  text: string;
  section: string;        // section[data-sid], "" if unknown (legacy)
  sectionTitle: string;   // derived heading text, "" if unknown
  page: number;           // nearest preceding .pdf-page-marker, 0 if unknown
  prefix?: string;        // up to 30 chars before text (disambiguation)
  suffix?: string;        // up to 30 chars after text
}

export interface AnnotationStore {
  version: number;
  highlights: StoredHighlight[];
  notes: Record<string, string>;  // key → note text (DD-5)
  saved_at: number;               // ms epoch, server-stamped
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(types): add StoredHighlight and AnnotationStore"
```

---

## Task 5: Frontend annotation API

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Import the store type**

`frontend/src/api.ts` line 1 currently:

```typescript
import type { DocResult, LibraryResponse } from "./types";
```

Change to:

```typescript
import type { DocResult, LibraryResponse, AnnotationStore } from "./types";
```

- [ ] **Step 2: Add the three functions**

Append to `frontend/src/api.ts`:

```typescript
export async function getAnnotations(docId: string): Promise<AnnotationStore> {
  const res = await fetch(`${API_BASE}/doc/${docId}/annotations`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function saveAnnotations(
  docId: string,
  store: { highlights: unknown[]; notes: Record<string, string> },
): Promise<{ ok: boolean; saved_at: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/annotations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export function ficheUrl(docId: string, format: "html" | "md"): string {
  return `${API_BASE}/doc/${docId}/fiche?format=${format}`;
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(api): getAnnotations, saveAnnotations, ficheUrl"
```

---

## Task 6: Restore rewrite — section-scoped multi-node

**Files:**
- Modify: `frontend/src/components/Reader/MarkdownReader.tsx` (lines 957-1003, call site ~1224)

> **Read first:** `memory/fixes-registry.md` highlight section — the TreeWalker MUST skip `.reader-hl, script, style, .formula, .equation` (preserved below). This replaces the fragile single-node `indexOf` matcher with a multi-node offset-map matcher scoped to the highlight's section.

- [ ] **Step 1: Replace `highlightTextInElement` (and keep `removeAllHighlights`)**

Find the current block (lines 957-1003) defining `highlightTextInElement`. Replace **only** that function with the three functions below. Leave `removeAllHighlights` (1005-1017) untouched.

```typescript
// Collect text nodes under `scope`, skipping already-highlighted spans,
// scripts, styles, and math (same exclusions as the original FIX).
function collectTextNodes(scope: Element): Text[] {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest(".reader-hl, script, style, .formula, .equation")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Text);
    n = walker.nextNode();
  }
  return nodes;
}

// Wrap a [start,end) char range inside a single text node with a hl span.
function wrapRange(
  node: Text, start: number, end: number,
  color: string, key: string, hasNote: boolean,
): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const span = document.createElement("span");
  span.className = `reader-hl${hasNote ? " reader-hl--has-note" : ""}`;
  span.setAttribute("data-key", key);
  span.setAttribute("data-color", color);
  range.surroundContents(span);
}

// Restore one highlight: find its text within its section (or whole doc as
// fallback) using a concatenated-string offset map, then wrap every text-node
// segment the match spans.
function restoreHighlight(
  docEl: Element,
  hl: { text: string; color: string; key: string; section?: string;
        prefix?: string; suffix?: string },
  hasNote: boolean,
): boolean {
  if (!hl.text) return false;

  let scope: Element = docEl;
  if (hl.section) {
    const found = docEl.querySelector(`section[data-sid="${CSS.escape(hl.section)}"]`);
    if (found) scope = found;
  }

  const nodes = collectTextNodes(scope);
  if (nodes.length === 0) return false;

  // Build concatenated string + a map of which node each char came from.
  let full = "";
  const map: { node: Text; start: number }[] = [];
  for (const node of nodes) {
    map.push({ node, start: full.length });
    full += node.data;
  }

  // Prefer prefix+text+suffix (disambiguates repeated phrases), then text.
  let matchStart = -1;
  let matchLen = hl.text.length;
  if (hl.prefix || hl.suffix) {
    const probe = (hl.prefix ?? "") + hl.text + (hl.suffix ?? "");
    const at = full.indexOf(probe);
    if (at >= 0) {
      matchStart = at + (hl.prefix ?? "").length;
    }
  }
  if (matchStart < 0) matchStart = full.indexOf(hl.text);
  if (matchStart < 0) return false;
  const matchEnd = matchStart + matchLen;

  // Find node index for a given absolute offset.
  const nodeIndexAt = (offset: number): number => {
    let lo = 0, hi = map.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (map[mid].start <= offset) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  };

  // Wrap each segment, back-to-front so earlier offsets stay valid.
  const segments: { node: Text; start: number; end: number }[] = [];
  const firstIdx = nodeIndexAt(matchStart);
  const lastIdx = nodeIndexAt(matchEnd - 1);
  for (let i = firstIdx; i <= lastIdx; i++) {
    const nodeStartAbs = map[i].start;
    const nodeLen = map[i].node.data.length;
    const segStart = Math.max(0, matchStart - nodeStartAbs);
    const segEnd = Math.min(nodeLen, matchEnd - nodeStartAbs);
    if (segEnd > segStart) {
      segments.push({ node: map[i].node, start: segStart, end: segEnd });
    }
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    try {
      wrapRange(s.node, s.start, s.end, hl.color, hl.key, hasNote);
    } catch {
      // surroundContents throws if the range partially selects a non-text
      // node; skip that segment rather than abort the whole restore.
    }
  }
  return true;
}
```

- [ ] **Step 2: Update the reapply-effect call site (~line 1224)**

The reapply effect currently calls `highlightTextInElement(docEl, hl.text, hl.color, hl.key, hasNote)`. Change that line to:

```typescript
        highlights.forEach((hl) => {
          const hasNote = !!notes[hl.key];
          restoreHighlight(docEl, hl, hasNote);
        });
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (`Highlight` interface gains optional fields in Task 7; until then `hl.section`/`prefix`/`suffix` are read via the looser param type on `restoreHighlight`, which is fine.)

- [ ] **Step 4: Manual smoke (deferred to Task 8 verification)**

No commit yet — restore depends on capture (Task 7) to populate the new fields. Proceed to Task 7.

---

## Task 7: Capture + persistence (Option B sync)

**Files:**
- Modify: `frontend/src/components/Reader/MarkdownReader.tsx` (imports line 1, 8, 9; `Highlight` interface 951; handlers; "Effacer tout" 2635-2636)

- [ ] **Step 1: Add `useCallback` to the React import**

Line 1 currently:

```typescript
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
```

Change to:

```typescript
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
```

- [ ] **Step 2: Extend the api + type imports**

Line 8 currently:

```typescript
import { htmlUrl, htmlManifestUrl, htmlPartUrl, markdownUrl, API_BASE } from "../../api";
```

Change to:

```typescript
import { htmlUrl, htmlManifestUrl, htmlPartUrl, markdownUrl, API_BASE, getAnnotations, saveAnnotations, ficheUrl } from "../../api";
```

Line 9 currently:

```typescript
import type { HtmlManifestEntry, OutlineNode, Figure } from "../../types";
```

Change to:

```typescript
import type { HtmlManifestEntry, OutlineNode, Figure, AnnotationStore, StoredHighlight } from "../../types";
```

- [ ] **Step 3: Extend the `Highlight` interface (line 951)**

Currently:

```typescript
export interface Highlight { text: string; color: string; key: string; }
```

Change to:

```typescript
export interface Highlight {
  text: string;
  color: string;
  key: string;
  section?: string;
  sectionTitle?: string;
  page?: number;
  prefix?: string;
  suffix?: string;
}
```

- [ ] **Step 4: Add module-level helpers**

Place these near the top-level helpers (just below the `Highlight` interface, before the component):

```typescript
// djb2 → base36, deterministic short hash for stable keys.
function shortHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Normalize selected text for hashing (collapse whitespace, lowercase).
function normForKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Nearest enclosing section[data-sid] + its heading text.
function findSectionInfo(node: Node | null): { section: string; sectionTitle: string } {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  const sec = el?.closest("section[data-sid]") as HTMLElement | null;
  if (!sec) return { section: "", sectionTitle: "" };
  const heading = sec.querySelector("h1,h2,h3,h4");
  return {
    section: sec.getAttribute("data-sid") ?? "",
    sectionTitle: heading?.textContent?.trim() ?? "",
  };
}

// Page number from the nearest preceding .pdf-page-marker[data-page].
function findPageNo(docEl: Element, node: Node | null): number {
  if (!node) return 0;
  const markers = Array.from(docEl.querySelectorAll(".pdf-page-marker[data-page]"));
  let page = 0;
  for (const m of markers) {
    const pos = m.compareDocumentPosition(node);
    // marker is BEFORE node → node comes after this marker
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      page = parseInt(m.getAttribute("data-page") || "0", 10) || page;
    } else {
      break;
    }
  }
  return page;
}
```

- [ ] **Step 5: Add the sync ref + `persistAll` (inside the component, near other refs/state)**

```typescript
  const syncTimerRef = useRef<number | null>(null);

  const persistAll = useCallback(
    (hls: Highlight[], nts: Record<string, string>) => {
      // localStorage is the primary store — write immediately.
      try {
        localStorage.setItem(`reader-hl-${docId}`, JSON.stringify(hls));
        localStorage.setItem(`reader-notes-${docId}`, JSON.stringify(nts));
      } catch {
        /* quota — ignore, server sync is the durable copy */
      }
      // Debounced background server sync (Option B). I-B: a failed sync
      // never touches localStorage, so the local copy survives.
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
      syncTimerRef.current = window.setTimeout(() => {
        saveAnnotations(docId, { highlights: hls, notes: nts }).catch(() => {
          /* offline / server down — keep local copy, retry on next change */
        });
      }, 1000);
    },
    [docId],
  );
```

- [ ] **Step 6: Rewrite `handleMouseUp` capture (lines ~1311-1356)**

Replace the body that computes the key and persists. The new key uses section + hash; capture section/page/prefix/suffix; then `persistAll`:

```typescript
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    const docEl = contentRef.current?.querySelector(".reader-doc");
    if (!docEl) return;

    const range = selection.getRangeAt(0);
    const { section, sectionTitle } = findSectionInfo(range.startContainer);
    const page = findPageNo(docEl, range.startContainer);

    // prefix/suffix for disambiguation (best-effort within start node).
    const startText = (range.startContainer.textContent ?? "");
    const prefix = startText.slice(Math.max(0, range.startOffset - 30), range.startOffset);
    const endText = (range.endContainer.textContent ?? "");
    const suffix = endText.slice(range.endOffset, range.endOffset + 30);

    const key = `${section}::${shortHash(normForKey(selectedText))}`;

    // Dedup by key.
    if (highlights.some((h) => h.key === key)) {
      selection.removeAllRanges();
      return;
    }

    const newHl: Highlight = {
      text: selectedText, color: hlColor, key,
      section, sectionTitle, page, prefix, suffix,
    };
    const nextHls = [...highlights, newHl];
    setHighlights(nextHls);
    persistAll(nextHls, notes);

    setActiveNoteKey(key);
    setShowNotePanel(true);
    setNoteText(notes[key] ?? "");
    selection.removeAllRanges();
```

> Keep the existing `hlMode` guard at the top of the handler if present (only capture when highlight mode is active). Preserve any early-returns that already exist for non-highlight clicks.

- [ ] **Step 7: Route note save / delete / clear-all through `persistAll`**

In `handleSaveNote` (~1396-1409), after building `nextNotes`, replace the two `localStorage.setItem` calls with:

```typescript
    persistAll(highlights, nextNotes);
```

In `handleDeleteHighlight` (~1412-1427), after computing `nextHls`/`nextNotes`, replace the localStorage writes with:

```typescript
    persistAll(nextHls, nextNotes);
```

In the "Effacer tout" button (lines 2625-2642), after `setHighlights([]); setNotes({});`, replace the two `localStorage.removeItem` lines (2635-2636) with:

```typescript
                  persistAll([], {});
```

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/Reader/MarkdownReader.tsx
git commit -m "feat(reader): capture section/page/prefix + Option B server sync"
```

---

## Task 8: Load sequence + auto-migration

**Files:**
- Modify: `frontend/src/components/Reader/MarkdownReader.tsx` (load effect ~1196-1212)

- [ ] **Step 1: Rewrite the load effect**

Replace the localStorage-read load effect with a server-first load that migrates legacy localStorage on first open. Keep `setBreadcrumb` and any TTS cleanup that already lives in this effect.

```typescript
  useEffect(() => {
    let cancelled = false;

    // Migrate legacy localStorage highlights: recompute deterministic keys
    // with empty section (whole-doc restore fallback), remap note keys.
    const migrateLegacy = (): { hls: Highlight[]; nts: Record<string, string> } => {
      let legacyHls: Highlight[] = [];
      let legacyNts: Record<string, string> = {};
      try {
        legacyHls = JSON.parse(localStorage.getItem(`reader-hl-${docId}`) || "[]");
        legacyNts = JSON.parse(localStorage.getItem(`reader-notes-${docId}`) || "{}");
      } catch {
        return { hls: [], nts: {} };
      }
      const remap: Record<string, string> = {};
      const hls = legacyHls.map((h) => {
        const newKey = h.section ? h.key : `::${shortHash(normForKey(h.text))}`;
        if (newKey !== h.key) remap[h.key] = newKey;
        return { ...h, key: newKey, section: h.section ?? "", page: h.page ?? 0 };
      });
      const nts: Record<string, string> = {};
      for (const [k, v] of Object.entries(legacyNts)) {
        nts[remap[k] ?? k] = v;
      }
      return { hls, nts };
    };

    (async () => {
      let store: AnnotationStore | null = null;
      try {
        store = await getAnnotations(docId);
      } catch {
        store = null; // offline — fall back to localStorage below
      }
      if (cancelled) return;

      if (store && store.highlights.length > 0) {
        setHighlights(store.highlights as Highlight[]);
        setNotes(store.notes ?? {});
      } else {
        const { hls, nts } = migrateLegacy();
        setHighlights(hls);
        setNotes(nts);
        if (hls.length > 0) persistAll(hls, nts); // push migrated data to server
      }
    })();

    // ... preserve existing setBreadcrumb(...) / pdfTitle logic here ...

    return () => {
      cancelled = true;
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      // ... preserve existing TTS / cleanup here ...
    };
  }, [docId, filename, pdfTitle, persistAll]);
```

> **Preserve** whatever `setBreadcrumb`/breadcrumb logic and TTS cleanup the original effect contained — only the highlight/notes loading changes. Add `persistAll` to the dependency array (it is stable via `useCallback([docId])`).

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification — durability**

Run backend (`cd backend && uvicorn main:app --reload`) and frontend (`cd frontend && npm run dev`). Then:
1. Open a document in Reader mode, enable Surlignage, highlight a phrase, add a note.
2. Confirm `backend/cache/{doc}/annotations.json` exists and contains the highlight + note.
3. Hard-clear browser localStorage (DevTools → Application → Clear site data).
4. Reload the page → the highlight and note **reappear** (loaded from server).
Expected: highlight restored in the correct section, note badge present.

- [ ] **Step 4: Manual verification — migration**

1. In DevTools console, seed legacy data:
   `localStorage.setItem('reader-hl-<docId>', JSON.stringify([{text:"...",color:"yellow",key:"old key"}]))`
2. Delete `backend/cache/<docId>/annotations.json`.
3. Reload → highlight restores (whole-doc fallback) AND `annotations.json` is recreated.
Expected: migrated highlight visible; server file present with recomputed key.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Reader/MarkdownReader.tsx
git commit -m "feat(reader): server-first load with localStorage auto-migration"
```

---

## Task 9: Notes Panel (in-Reader list)

**Files:**
- Modify: `frontend/src/components/Reader/MarkdownReader.tsx`
- Modify: `frontend/src/components/Reader/MarkdownReader.css`

- [ ] **Step 1: Add the panel state**

Near the other UI state (`showNotePanel`, etc.):

```typescript
  const [showNotesList, setShowNotesList] = useState(false);
```

- [ ] **Step 2: Build grouped data with `useMemo`**

```typescript
  const notesListGroups = useMemo(() => {
    const bySection = new Map<string, { title: string; items: Highlight[]; minPage: number }>();
    for (const h of highlights) {
      const sec = h.section ?? "";
      const title = h.sectionTitle || "Sans section";
      const g = bySection.get(sec) ?? { title, items: [], minPage: Number.MAX_SAFE_INTEGER };
      g.items.push(h);
      g.minPage = Math.min(g.minPage, h.page ?? 0);
      bySection.set(sec, g);
    }
    const groups = Array.from(bySection.values());
    groups.forEach((g) => g.items.sort((a, b) => (a.page ?? 0) - (b.page ?? 0)));
    groups.sort((a, b) => a.minPage - b.minPage);
    return groups;
  }, [highlights]);
```

- [ ] **Step 3: Add the scroll-to-highlight helper**

```typescript
  const scrollToHighlight = useCallback((key: string) => {
    const docEl = contentRef.current?.querySelector(".reader-doc");
    const el = docEl?.querySelector(`.reader-hl[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveNoteKey(key);
      setShowNotePanel(true);
      setNoteText(notes[key] ?? "");
    }
  }, [notes]);
```

- [ ] **Step 4: Add the toolbar toggle button (with count badge)**

In the toolbar right group (near the Surlignage button ~2584), add:

```tsx
            <button
              type="button"
              className="reader-tool-btn"
              title="Liste des annotations"
              onClick={() => setShowNotesList((v) => !v)}
            >
              📋 Notes
              {highlights.length > 0 && (
                <span className="reader-notes-count">{highlights.length}</span>
              )}
            </button>
```

- [ ] **Step 5: Add the panel JSX**

Near the existing note-panel JSX (~3120-3151), add a sibling:

```tsx
        {showNotesList && (
          <div className="reader-notes-list">
            <div className="reader-notes-list__head">
              <strong>Annotations</strong>
              <button type="button" onClick={() => setShowNotesList(false)}>✕</button>
            </div>
            {highlights.length === 0 ? (
              <p className="reader-notes-list__empty">Aucune annotation pour ce document.</p>
            ) : (
              notesListGroups.map((g) => (
                <div key={g.title} className="reader-notes-list__section">
                  <h4>{g.title}</h4>
                  {g.items.map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      className="reader-notes-list__item"
                      onClick={() => scrollToHighlight(h.key)}
                    >
                      <span
                        className="reader-notes-list__swatch"
                        data-color={h.color}
                      />
                      <span className="reader-notes-list__text">
                        {h.text.length > 80 ? h.text.slice(0, 80) + "…" : h.text}
                        {notes[h.key] && <em className="reader-notes-list__note"> — {notes[h.key]}</em>}
                      </span>
                      {h.page ? <span className="reader-notes-list__page">p.{h.page}</span> : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
```

- [ ] **Step 6: Add minimal CSS**

Append to `frontend/src/components/Reader/MarkdownReader.css`:

```css
.reader-notes-count {
  margin-left: .35rem; background: #555; color: #fff; border-radius: 999px;
  padding: 0 .4rem; font-size: .75em;
}
.reader-notes-list {
  position: absolute; right: 1rem; top: 4rem; width: 320px; max-height: 70vh;
  overflow-y: auto; background: var(--reader-bg, #fff); border: 1px solid #ddd;
  border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: .75rem;
  z-index: 40;
}
.reader-notes-list__head {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: .5rem;
}
.reader-notes-list__empty { color: #888; font-style: italic; }
.reader-notes-list__section h4 { margin: .5rem 0 .25rem; font-size: .9em; color: #666; }
.reader-notes-list__item {
  display: flex; gap: .5rem; align-items: flex-start; width: 100%; text-align: left;
  background: none; border: none; padding: .4rem; border-radius: 6px; cursor: pointer;
}
.reader-notes-list__item:hover { background: rgba(0,0,0,.05); }
.reader-notes-list__swatch {
  width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; margin-top: .2rem;
  background: #fff3a3;
}
.reader-notes-list__swatch[data-color="green"] { background: #b8f0c0; }
.reader-notes-list__swatch[data-color="blue"] { background: #b3d9ff; }
.reader-notes-list__swatch[data-color="pink"] { background: #ffc0e0; }
.reader-notes-list__swatch[data-color="orange"] { background: #ffd9a0; }
.reader-notes-list__text { flex: 1; font-size: .85em; line-height: 1.35; }
.reader-notes-list__note { color: #777; }
.reader-notes-list__page { color: #999; font-size: .8em; flex: 0 0 auto; }
```

- [ ] **Step 7: Type-check + manual smoke**

Run: `cd frontend && npx tsc --noEmit`
Then in the browser: open the panel, confirm grouped list shows, click an item → scrolls to highlight and opens its note.
Expected: no errors; navigation works.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Reader/MarkdownReader.tsx frontend/src/components/Reader/MarkdownReader.css
git commit -m "feat(reader): in-Reader notes/annotations list panel"
```

---

## Task 10: Export (fiche) button

**Files:**
- Modify: `frontend/src/components/Reader/MarkdownReader.tsx`

- [ ] **Step 1: Add the menu state**

```typescript
  const [showFicheMenu, setShowFicheMenu] = useState(false);
```

- [ ] **Step 2: Add the toolbar button + popover**

In the toolbar right group, add:

```tsx
            <div className="reader-fiche-wrap">
              <button
                type="button"
                className="reader-tool-btn"
                title="Exporter une fiche de révision"
                onClick={() => setShowFicheMenu((v) => !v)}
              >
                ⬇ Fiche
              </button>
              {showFicheMenu && (
                <div className="reader-fiche-menu">
                  <a href={ficheUrl(docId, "html")} download onClick={() => setShowFicheMenu(false)}>
                    HTML
                  </a>
                  <a href={ficheUrl(docId, "md")} download onClick={() => setShowFicheMenu(false)}>
                    Markdown
                  </a>
                </div>
              )}
            </div>
```

> The server sets `Content-Disposition: attachment; filename="..."`, so the browser uses the server's filename even though `download` (with no value) can't set a cross-origin name itself.

- [ ] **Step 3: Add minimal CSS**

Append to `frontend/src/components/Reader/MarkdownReader.css`:

```css
.reader-fiche-wrap { position: relative; display: inline-block; }
.reader-fiche-menu {
  position: absolute; right: 0; top: 100%; margin-top: .25rem; background: #fff;
  border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.15);
  display: flex; flex-direction: column; z-index: 45; min-width: 120px;
}
.reader-fiche-menu a {
  padding: .5rem .75rem; text-decoration: none; color: #222;
}
.reader-fiche-menu a:hover { background: rgba(0,0,0,.06); }
```

- [ ] **Step 4: Type-check + manual smoke**

Run: `cd frontend && npx tsc --noEmit`
Then: highlight a few phrases with notes, click Fiche → HTML and Fiche → Markdown; confirm both files download and contain the highlights, page numbers, and notes grouped by section.
Expected: two valid downloads.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Reader/MarkdownReader.tsx frontend/src/components/Reader/MarkdownReader.css
git commit -m "feat(reader): fiche export button (HTML/Markdown)"
```

---

## Task 11: Memory wiki updates (PROTOCOLE ÉCRITURE)

**Files:**
- Modify: `memory/fixes-registry.md`, `memory/LOG.md`, `memory/phases.md`, `memory/INDEX.md`, `CLAUDE.md`, `GEMINI.md`, `memory/PRD.md`

> **Read first:** the top of `memory/fixes-registry.md` for the exact FIX entry format, and `CLAUDE.md` PROTOCOLE ÉCRITURE for the full update checklist. The last existing FIX is FIX-071 → next is FIX-072.

- [ ] **Step 1: Add three FIX entries to `memory/fixes-registry.md`**

Follow the file's existing entry format. Content:

- **FIX-072 — Annotations durables côté serveur.** `localStorage` → `cache/{doc}/annotations.json`. Endpoints GET/PUT `/doc/{id}/annotations`. Écriture atomique (tmp + `os.replace`, I-A). Notes orphelines supprimées au save (I-C). `saved_at` estampillé serveur (I-D). Fichiers : `backend/main.py`, `backend/fiche.py`, `backend/tests/`.
- **FIX-073 — Restauration surlignage section-scopée multi-nœuds.** Remplace `indexOf` mono-nœud par carte d'offsets concaténés dans `section[data-sid]` (fallback doc entier). Clés déterministes `{section}::{shortHash(text)}` (djb2→base36). TreeWalker exclut toujours `.reader-hl, script, style, .formula, .equation`. Fichier : `MarkdownReader.tsx` (`restoreHighlight`, `collectTextNodes`, `wrapRange`).
- **FIX-074 — Sync Option B + auto-migration.** `localStorage` primaire + sync serveur débouncé 1000ms ; un sync échoué ne vide jamais `localStorage` (I-B). Au premier open : charge serveur d'abord, sinon migre `localStorage` (recalcul clés, remap notes) puis pousse au serveur. Fichier : `MarkdownReader.tsx` (`persistAll`, effet de chargement).

- [ ] **Step 2: Mirror the FIX table rows into `CLAUDE.md` and `GEMINI.md`**

Add FIX-072/073/074 rows to the FIX table in both `CLAUDE.md` and `GEMINI.md` (keep them identical — multi-agent sync).

- [ ] **Step 3: Add a `memory/LOG.md` entry**

Dated entry (2026-05-29) summarizing: durable annotations shipped (R11), backend fiche export shipped (R12), new restore model, Option B sync, pytest harness added.

- [ ] **Step 4: Update `memory/phases.md`**

Mark R11 and R12 as done under Phase 1.

- [ ] **Step 5: Update `memory/INDEX.md`**

Add references to the new files (`backend/fiche.py`, `backend/tests/`, the spec, this plan) if INDEX lists source files.

- [ ] **Step 6: Update `memory/PRD.md` + `memory/ROADMAP.md` status**

Flip R11 "Notes & surlignages durables" and R12 "Export des annotations" to done/✅ in the PRD feature list and the ROADMAP suivi/phase tables.

- [ ] **Step 7: Run the full backend suite one last time**

Run: `cd backend && python -m pytest -v`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add memory/fixes-registry.md memory/LOG.md memory/phases.md memory/INDEX.md CLAUDE.md GEMINI.md memory/PRD.md memory/ROADMAP.md
git commit -m "docs(memory): record R11/R12 (durable annotations + fiche export)"
```

---

## Self-Review (run before execution)

- **Spec coverage:** GET/PUT annotations (Task 2) ✓ §5.1; fiche HTML/MD (Task 3) ✓ §5.1/R12; section-scoped multi-node restore (Task 6) ✓ §5.3; deterministic keys (Task 7) ✓; Option B sync (Task 7) ✓ §5; auto-migration (Task 8) ✓; notes panel (Task 9) ✓; export button (Task 10) ✓; invariants I-A/B/C/D ✓ Tasks 2 & 7.
- **Invariants mapping:** I-A → Task 2 Step 5 (`os.replace`); I-B → Task 7 Step 5 (catch keeps local); I-C → Task 2 Step 5 (`valid_keys`); I-D → Task 2 Step 5 (`saved_at`).
- **Type consistency:** `persistAll(hls, nts)`, `restoreHighlight(docEl, hl, hasNote)`, `shortHash`, `normForKey`, `findSectionInfo`, `findPageNo` — names identical across Tasks 6/7/8/9. `Highlight` gains optional `section/sectionTitle/page/prefix/suffix` (Task 7) consumed by Task 6 restore and Task 9 grouping. `AnnotationStore`/`StoredHighlight` (Task 4) used by `getAnnotations`/`saveAnnotations` (Task 5) and the load effect (Task 8).
- **No placeholders:** every code step shows complete code; every test step shows the assertion and the run command.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batched with checkpoints.
