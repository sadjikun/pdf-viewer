# Design — Durable Notes, Notes Panel & Export (R11/R12)

> **Status:** Approved (design) — awaiting spec review before implementation planning.
> **Date:** 2026-05-29
> **Phase:** 1 (Confiance) — Roadmap `memory/ROADMAP.md`
> **Covers:** PRD features R11 (durable notes), R12 (export annotations). Adds a Notes Panel (UX refinement).
> **Boussole:** `memory/VISION.md` · **Détail features:** `memory/PRD.md`

---

## 1. Context & goal

Highlights and sticky notes today live only in browser `localStorage`
(`reader-hl-{docId}`, `reader-notes-{docId}` — see `MarkdownReader.tsx`). Clearing the
browser cache destroys them. For a study platform meant to accumulate years of
annotations, this is the single biggest trust gap.

**Goal:** make annotations durable (survive a browser cache clear), reviewable (a panel
listing all notes), and exportable (a revision sheet). Without losing the existing fast,
local-first feel.

**Key insight from design review:** the current anchor model is *text-quote* based —
a highlight stores only `{ text, color, key }` and is re-found on load via
`indexOf` over text nodes (`highlightTextInElement`, MarkdownReader.tsx:957). This
survives re-rendering, but has correctness bugs that moving storage server-side does
**not** fix:
- `indexOf` matches the **first** occurrence in the whole document — a repeated phrase
  ("selon l'Eurocode") always highlights occurrence #1, not where the user selected.
- The `key` is the first 50 chars of text → two similar highlights collide → the second
  is silently rejected and notes overwrite each other.
- `indexOf` matches within a **single** text node → highlights crossing bold/links/
  formulas silently vanish on reload.

This spec fixes the first and third (scoped, multi-node restore) and sidesteps the
second (section-qualified deterministic keys).

---

## 2. Non-goals (this round)

- **Standalone margin notes** (notes not tied to a highlight) — deferred, documented limitation.
- **Cross-device sync** — explicitly excluded by VISION.md (offline-first, mono-machine).
- **A database** — ROADMAP Phase 1 says "pas encore de base de données." Per-doc JSON only.
- **Library organization (L1/L2)** and **AI summaries (AI3)** — separate specs/phases.

---

## 3. Storage format

One file per document: `backend/cache/{doc_id}/annotations.json`

```json
{
  "version": 1,
  "highlights": [
    {
      "key": "rs_1_3::a1b2c3d4",
      "color": "#ffe066",
      "text": "la contrainte admissible vaut 0,6 fck",
      "section": "rs_1_3",
      "sectionTitle": "1.3 Calcul des charges",
      "page": 14,
      "prefix": "On en déduit que ",
      "suffix": " pour cette classe."
    }
  ],
  "notes": {
    "rs_1_3::a1b2c3d4": "Revoir le coefficient partiel."
  },
  "saved_at": 1748505600000
}
```

Field notes:
- `version` — schema version, for future-proof migration. Starts at `1`.
- `key` — **section-qualified deterministic** id: `{section}::{shortHash(text)}`. Stable
  across reloads (deterministic), collision-safe across sections. Replaces the current
  first-50-chars key. **Design decision — see §9.**
- `section` — the `data-sid` of the nearest ancestor `section[data-sid]` at creation time.
- `sectionTitle` — that section's heading text (for the export and notes panel).
- `page` — nearest ancestor `[data-page]` (page markers injected by
  `_annotate_split_page_divs`, MarkdownReader.tsx:149).
- `prefix` / `suffix` — up to ~30 chars of text immediately before/after the selection
  (optional; used only to disambiguate identical text within the *same* section). May be
  empty.
- `notes` — keyed by highlight `key`. A note with no matching highlight key is an orphan
  and is dropped on next save (cleanup).

---

## 4. Backend changes (`backend/main.py`)

Three new endpoints. No new Python dependency (uses `json` + `pathlib` already imported).

| Method | Route | Behaviour |
|--------|-------|-----------|
| `GET`  | `/doc/{doc_id}/annotations` | Read `cache/{doc_id}/annotations.json`. If absent, return `200` with empty structure `{ "version": 1, "highlights": [], "notes": {}, "saved_at": 0 }`. `404` only if the doc itself doesn't exist. |
| `PUT`  | `/doc/{doc_id}/annotations` | Validate body shape, write atomically (temp file + rename) to `cache/{doc_id}/annotations.json`. Return the saved object. |
| `GET`  | `/doc/{doc_id}/fiche?format=html\|md` | Generate revision sheet server-side from `annotations.json`. Returns the file as a download (`Content-Disposition: attachment`). |

**Validation (PUT):** reject if body is not an object with `highlights` (array) and
`notes` (object). Drop orphan notes (keys absent from highlights). Stamp `saved_at`
server-side with current epoch ms (ignore client value to keep it authoritative for
last-write-wins).

**Atomic write:** write to `annotations.json.tmp` then `os.replace()` — never leave a
half-written file if the process dies mid-write (data-safety invariant).

**Fiche generation:** load `annotations.json`, group highlights by `section`
(sections ordered by their lowest `page`; highlights within a section ordered by `page`
ascending), and render:
- **HTML:** self-contained doc; section as `<h2 class="fiche-section">`; each highlight
  as a `<blockquote>` with `background-color` = its color and a `<cite>[p. N]</cite>`;
  attached note rendered below as `<p class="fiche-note">`. Title + export date header.
- **Markdown:** `## {sectionTitle}` then per highlight `> {text} — [p. N]` and, if a note,
  a following `> *Note: {note}*`.
- Sections with zero highlights are skipped. Math/KaTeX excluded (text only).

Filename: `{sanitized_doc_title}_fiche.{html|md}`.

---

## 5. Frontend changes

### 5.1 API client (`frontend/src/api.ts`)
```ts
getAnnotations(docId: string): Promise<AnnotationStore>
saveAnnotations(docId: string, data: AnnotationStore): Promise<AnnotationStore>
ficheUrl(docId: string, format: "html" | "md"): string   // for download link
```

### 5.2 Types (`frontend/src/types.ts` — or local to Reader)
```ts
interface StoredHighlight {
  key: string; color: string; text: string;
  section: string; sectionTitle: string; page: number;
  prefix?: string; suffix?: string;
}
interface AnnotationStore {
  version: number;
  highlights: StoredHighlight[];
  notes: Record<string, string>;   // key → note text (see DD-5)
  saved_at: number;
}
```

### 5.3 Load sequence (`MarkdownReader.tsx`)
On doc open:
1. `getAnnotations(docId)`.
2. If server `highlights.length > 0` → use server data.
3. Else read `localStorage['reader-hl-{docId}']` + `['reader-notes-{docId}']`.
   - If present (legacy shape `{text,color,key}`) → **migrate**: upgrade each to the new
     shape by re-finding the text in the DOM to derive `section`/`page` (best-effort;
     if a highlight can't be located, keep it with `section:""`, `page:0`), then
     `saveAnnotations` immediately. Keep using the migrated data.
4. Apply highlights to the DOM via the new restore algorithm (§5.4).

### 5.4 Restore algorithm — section-scoped + multi-node (folds #1 and #3)
Replaces `highlightTextInElement`'s single-node `indexOf`. For each highlight:
1. Resolve the section element: `contentRef.current.querySelector('section[data-sid="{section}"]')`.
   Fall back to the whole `.reader-doc` if the section is missing.
2. Gather all accepted text nodes within that scope (same `TreeWalker` filter as today:
   skip `.reader-hl, script, style, .formula, .equation`).
3. Build one concatenated string with an **offset map** (array of `{node, start, end}`).
4. Find the target: search the concatenated string for `prefix + text + suffix` first
   (most specific); if not found, fall back to `text` alone. Pick the first match
   **within this section** — which is the correct occurrence because the search is scoped.
5. Translate the matched `[startChar, endChar)` back to one-or-more `(node, offset)`
   segments via the offset map.
6. For each segment, create a `Range` over that text-node slice and `surroundContents`
   a `.reader-hl` span (same class/attrs as today: `data-key`, `data-color`,
   `reader-hl--has-note` when a note exists). Multiple spans share the same `data-key`.

This makes repeated phrases land in the right section, and lets a highlight cross inline
markup (each text node gets its own span).

### 5.5 Save sequence (Option B — localStorage-primary + background sync)
On any add/edit/delete of a highlight or note:
1. Update React state + write to `localStorage` immediately (unchanged latency).
2. Schedule a **debounced (1000 ms)** background `saveAnnotations(docId, store)`.
   - On failure: keep the localStorage copy, log a console warning, retry on next change.
     No blocking UI, no data loss.
3. "Effacer tout" also fires `saveAnnotations` with empty arrays so the server stays in sync.

**Divergence rule (single source-of-truth tiebreak):** server is authoritative on load
when it has data; `saved_at` (server-stamped) is the tiebreak. Since this is single-user/
single-machine, the only realistic divergence is two browser tabs — last write wins,
which is acceptable.

### 5.6 Notes Panel (new UX)
A **toggleable panel inside the Reader** (a drawer/overlay opened from a new Reader
toolbar button — *not* the App.tsx sidebar, which would require lifting highlight state
out of `MarkdownReader`). Lists all annotations for the current doc:
- One row per highlight: color swatch · text snippet (~80 chars) · `sectionTitle` · `p. N` ·
  a note indicator if a note exists.
- Grouped by `sectionTitle`, ordered by `page` ascending.
- Click a row → scroll the highlight into view (reuse existing scroll-to logic via
  `data-key` lookup) and open its note popup.
- Empty state: "Aucune annotation pour ce document."
- Reads directly from `MarkdownReader`'s in-memory `highlights`/`notes` state — no new
  fetch, no state lifting.

### 5.7 Export button
A Reader toolbar control "Fiche de révision" opening a tiny inline menu with two actions:
- **HTML** → trigger download of `ficheUrl(docId, "html")`.
- **Markdown** → trigger download of `ficheUrl(docId, "md")`.
Implemented as plain anchor downloads hitting the backend endpoint (§4).

---

## 6. Data-safety invariants (new — candidates for fixes-registry)
- **I-A:** `PUT /annotations` writes atomically (temp + `os.replace`). Never a half file.
- **I-B:** A failed background sync never clears localStorage; the local copy is the fallback.
- **I-C:** Orphan notes (no matching highlight key) are dropped on save, never resurrected.
- **I-D:** Server stamps `saved_at`; client value is ignored.

---

## 7. Testing (ties into Q1 smoke net)
- Backend: `GET /annotations` on a fresh doc returns the empty structure; `PUT` then
  `GET` round-trips; `PUT` with orphan note drops it; `fiche?format=md` contains a known
  highlight's text and `[p. N]`.
- Frontend (manual, documented in spec): create a highlight on a repeated phrase, reload,
  confirm it restores on the correct occurrence; create a highlight spanning a bold word,
  reload, confirm it restores; clear localStorage, reload, confirm annotations come back
  from the server.

---

## 8. Known limitations (documented, accepted)
- Standalone (highlight-less) notes are not supported this round.
- Within a single section, two highlights of *identical* text + identical prefix/suffix
  still collide on key. Considered negligible for real study use.
- Migration of a legacy highlight that can no longer be located in the DOM keeps it with
  `section:""`/`page:0` (still listed in the panel, may not visually restore).

---

## 9. Design decisions
- **DD-1 — Keys are section-qualified deterministic, not random UUIDs.** The user
  preferred deterministic keys (stable across reloads). `{section}::{shortHash(text)}`
  keeps determinism while eliminating cross-section collisions — fixes the practical
  data-loss case without changing the key philosophy. (Supersedes the original "#2 unique
  keys" proposal.)
- **DD-2 — Option B (localStorage-primary).** Chosen over server-first so annotations
  keep working instantly and even if the backend is momentarily down.
- **DD-3 — Backend export.** Chosen over frontend generation so Phase 2 can reuse the
  fiche generator (auto revision sheets) and the user can export without opening the Reader.
- **DD-4 — `prefix`/`suffix` are optional.** Stored when cheaply available; restoration
  degrades gracefully to section-scoped `text`-only search when absent.
- **DD-5 — Notes are `Record<key, string>`, not `{text, createdAt}`.** The live
  `MarkdownReader` state is already `Record<string, string>` (a note value is the plain
  string). Keeping that shape end-to-end (state, localStorage, server JSON) avoids a
  risky refactor of the heavily-FIXed component and a localStorage migration of the note
  map. `createdAt` is unused (nothing displays it), so it is dropped. The notes panel
  orders by the highlight's `page`, not by note creation time.

---

## 10. Impacted files
- `backend/main.py` — 3 endpoints + fiche generator (consider a small `fiche.py` helper if main.py grows).
- `frontend/src/api.ts` — 3 client functions.
- `frontend/src/types.ts` — annotation types.
- `frontend/src/components/Reader/MarkdownReader.tsx` — load/save/restore rewrite, notes
  panel, export button. (Touches highlight logic — re-read `memory/fixes-registry.md` for
  FIX-008, FIX-067 before editing.)
- `memory/` — LOG entry, fixes-registry (I-A..I-D), phases.md, PRD status flip for R11/R12.

---

## 11. Out-of-scope follow-ups (next specs)
- L1/L2 — library organization & study metadata.
- AI3 — auto-generate fiches/flashcards from highlights (reuses the §4 fiche generator).
