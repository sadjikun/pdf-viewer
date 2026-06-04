# ARCHITECTURE — Vue système

Dernière mise à jour : 2026-06-04 (aligné sur la branche `develop`)

> ⚠️ État de **`develop`**. Le fast path pypdfium2 (`_extraire_natif`,
> `has_native_text`, `extraction_mode "fast"/"native"`), le de-embedding d'images,
> la rastérisation `cleaned.pdf` et l'endpoint benchmark de la v2 d'origine ne sont
> **pas** sur develop.

---

## Vue d'ensemble (traitement asynchrone)

```
┌──────────────┐  POST /process (upload)   ┌─────────────────────────────────┐
│   Browser    │ ─────────────────────────► │  FastAPI  main.py               │
│  React 19    │  POST /register (chemin)   │  - doc_id = sha256(contenu       │
│  Vite + TS   │ ─────────────────────────► │            OU chemin)[:16]       │
│              │ ◄── {status:"processing"} ─ │  - BackgroundTasks → pipeline   │
│  Library     │                            └──────────┬──────────────────────┘
│  3 panneaux  │  GET /doc/{id}/status (poll)          │
│  - PDF.js    │ ◄── progress 0→100 ─────────────────  │
│  - Reader    │  GET /doc/{id}/outline|pdf|html|…     ▼
│  - Compare   │ ◄── JSON / FileResponse ── ┌─────────────────────────────────┐
└──────────────┘                            │  pipeline.py                    │
                                            │  convertir_pdf()  → Docling     │
                                            │    _needs_ocr() par page        │
                                            │    > 50 pages → batch (tranches)│
                                            │  convertir_generic() → MarkItDown│
                                            └──────────┬──────────────────────┘
                                                       │
                                            ┌──────────▼──────────────────────┐
                                            │  cache/{doc_id}/                │
                                            │  ├── source.pdf  (sauf registered)│
                                            │  ├── result.json                │
                                            │  ├── result.html + html_part_*  │
                                            │  ├── result.md                  │
                                            │  ├── thumbnail.png              │
                                            │  └── figures/f_0.png …          │
                                            └─────────────────────────────────┘
```

Trois façons d'entrer un document :
- **`POST /process`** : upload (PDF → Docling, autres → MarkItDown), async.
- **`POST /register`** : référence un PDF/dossier par chemin, **sans copie** (scan léger
  pypdfium2 → `extraction_mode:"registered"`). Analyse Docling à la demande via
  **`POST /doc/{id}/process`**.
- **`POST /doc/{id}/reprocess`** : ré-extrait depuis la source (`force_ocr` pour hybrides).

---

## Constantes clés

| Constante | Valeur | Fichier | Rôle |
|-----------|--------|---------|------|
| `BATCH_SIZE` | 30 (env `PDF_BATCH_SIZE`) | `pipeline.py` | Pages par tranche Docling |
| `BATCH_THRESHOLD` | 50 (env `PDF_BATCH_THRESHOLD`) | `pipeline.py` | Seuil de bascule en mode batch |
| `_TEXT_NATIVE_THRESHOLD` | 50 | `pipeline.py` | Chars/page mini pour « natif » (skip OCR) |
| `images_scale` | 2.0 (1.0 en batch) | `pipeline.py` | Résolution extraction figures |
| `MAX_UPLOAD_BYTES` | 100 Mo | `main.py` | Limite upload |
| `DOC_ID_RE` | `^[a-f0-9]{16}$` | `main.py` | Validation doc_id (anti path-traversal) |
| `FORMULA_ENGINE` | `auto` (env) | `ocr.py` | `texify` \| `pix2tex` \| `auto` pour `/latex-ocr` |
| `_PDFIUM_LOCK` / `_converter_lock` | — | `pipeline.py` | Sérialisent pypdfium2 / l'init Docling (thread-safety) |

---

## Flux de données

### Upload (`POST /process`)
1. Validation extension (`{.pdf} ∪ MARKITDOWN_EXTENSIONS`), taille, magic `%PDF`.
2. `doc_id = sha256(contenu)[:16]`. Cache hit → retour immédiat de `result.json`.
3. Sinon : écrit `source.<ext>`, enregistre `active_tasks[doc_id]`, lance `run_pipeline_bg`,
   retourne `{status:"processing"}`.
4. Frontend poll `GET /doc/{id}/status` (`processing` → `ready` | `failed`).

### Référencement (`POST /register`)
1. Chemin (fichier ou dossier) → pour chaque PDF : `doc_id = sha256(chemin_résolu)[:16]`.
2. `_register_pdf` : scan pypdfium2 (n_pages, dimensions, titre) + miniature →
   `result.json` `extraction_mode:"registered"` + `source_path`. **Pas de copie.**
3. Apparaît dans la Library (PDF visible). « Analyser » → `POST /doc/{id}/process`
   copie le fichier en cache puis lance Docling complet.

### Pipeline (`convertir_pdf`)
1. `_count_pages` ; si > `BATCH_THRESHOLD` → `_convertir_batch` (tranches).
2. `do_ocr = force_ocr or _needs_ocr(pdf)` (longueurs de texte par page).
3. Docling (`DocumentConverter` mis en cache par `(batch, ocr)`) → pages, figures,
   tables, sections → outline.
4. Export `result.md` + HTML (`_docling_html_body` EMBEDDED → `_write_html_artifacts`).
5. ML optionnels à la demande : `/latex-ocr` (pix2tex/Texify), `/caption-figures` (Florence-2),
   `/searchable-pdf` (OCRmyPDF) — async via `asyncio.to_thread`.

### Rendu frontend
- **PDF viewer** : react-pdf + PDF.js (virtualisation, IntersectionObserver, markers figures).
- **Reader** : `/html-manifest` → `/html-part/{start}` (HTML Docling) ; fallback `/markdown`.
  `sectionizeHtml` (helpers dans `readerHtml.ts`), KaTeX auto-render.
- **Compare** : Viewer + Reader côte à côte, diviseur draggable, sync Reader→PDF.
- **Launcher desktop** (Windows) : `launcher.py` (pywebview) spawn `uvicorn main:app` + Vite/dist.

---

## Contrats inter-couches

### `result.json` → frontend
```typescript
{
  doc_id: string                                  // 16 hex
  filename: string
  extraction_mode: "docling" | "markitdown" | "registered"
  source_path?: string                            // registered uniquement
  needs_reprocess?: boolean
  n_pages: number; n_figures: number; n_tables: number
  pages: Array<{number: number, width: number, height: number}>
  outline: OutlineNode[]
  figures: Figure[]
  tables: Table[]
}
```

### `OutlineNode`
```typescript
{ id: string, level: 1|2|3|4, title: string, page: number|null, bbox: number[]|null, children: OutlineNode[] }
```

### `Figure`
```typescript
{ id: string, page: number|null, bbox: number[]|null, caption: string, latex?: string, caption_ai?: string }
```

### `Table`
```typescript
{ id: string, page: number|null, bbox: number[]|null, caption: string, html: string }
// dimensions n×n calculées côté frontend (composant Tables), pas dans result.json
```

---

## Stack technique

| Couche | Technologie | Notes |
|--------|-------------|-------|
| Backend runtime | Python 3.13 | |
| API | FastAPI + uvicorn | 24+ endpoints, async ML via to_thread |
| ML extraction | Docling 2.92 | DocumentConverter caché, batch > 50p |
| Multi-format | MarkItDown[all] | DOCX/PPTX/XLSX/HTML/images/notebooks |
| PDF natif/miniatures | pypdfium2 | `_count_pages`, `_page_text_lengths`, register, thumbnail (sous `_PDFIUM_LOCK`) |
| OCR couche texte | OCRmyPDF + Tesseract | optionnel (`/searchable-pdf`, `/ocr-image`) |
| Formules ML | pix2tex / Texify | optionnel (`FORMULA_ENGINE`, `/latex-ocr`) |
| Captioning figures | Florence-2 | optionnel (`/caption-figures`) |
| Frontend | React 19 + Vite + TS | Library, Reader, Compare, 10 thèmes |
| PDF viewer | react-pdf (PDF.js) | |
| Formules rendu | KaTeX | |
| Launcher desktop | pywebview (Windows) | `launcher.py` / `launcher_core.py`, opt. |
