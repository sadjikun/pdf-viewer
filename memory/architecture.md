# ARCHITECTURE — Vue système

Dernière mise à jour : 2026-05-21

---

## Vue d'ensemble

```
┌──────────────┐  POST /process (PDF)   ┌─────────────────────────────────┐
│   Browser    │ ──────────────────────► │  FastAPI  main.py               │
│  React 19    │                         │  - hash SHA256[:16] → doc_id    │
│  Vite        │ ◄── JSONResponse ──── │  - background task → pipeline   │
│  TypeScript  │                         └──────────┬──────────────────────┘
│              │  GET /doc/{id}/outline              │
│  3 panneaux  │ ◄── outline JSON ──────────────── │ cache/{id}/result.json
│  - PDF.js    │                                     │
│  - Reader    │  GET /doc/{id}/pdf                  ▼
│  - Compare   │ ◄── FileResponse ───── ┌─────────────────────────────────┐
└──────────────┘                         │  pipeline.py                    │
                                         │  convertir_pdf()                │
                                         │    → has_native_text() ?        │
                                         │      oui → _extraire_natif()    │
                                         │      non → Docling (OCR)        │
                                         └──────────┬──────────────────────┘
                                                    │
                                         ┌──────────▼──────────────────────┐
                                         │  cache/{doc_id}/                │
                                         │  ├── source.pdf                 │
                                         │  ├── result.json                │
                                         │  ├── result.html                │
                                         │  ├── result.md                  │
                                         │  ├── cleaned.pdf (si JPEG2000)  │
                                         │  ├── figures/f_0.png …         │
                                         │  └── tables/ (futur)           │
                                         └─────────────────────────────────┘
```

---

## Constantes clés

| Constante | Valeur | Fichier | Rôle |
|-----------|--------|---------|------|
| `BATCH_SIZE` | 10 | `pipeline.py` | Pages par tranche Docling (réduit OOM) |
| `_NATIVE_CHAR_MIN` | 100 | `pipeline.py` | Chars sur 3 pages pour déclarer PDF natif |
| `images_scale` | 2.0 | `pipeline.py` | Résolution extraction figures (144 DPI) |
| `MIN_DIM` | 50 px | `pipeline.py` | Filtre figures trop petites |
| `MIN_AREA` | 2500 px² | `pipeline.py` | Filtre figures trop petites (50×50) |
| `MAX_UPLOAD_BYTES` | 100 MB | `main.py` | Limite upload |
| `CACHE_DIR` | `backend/cache/` | `main.py` | Répertoire cache |
| `FORMULA_ENRICHMENT` | `0` (env var) | `pipeline.py` | Active CodeFormulaV2 Docling |
| `PIX2TEX_FALLBACK` | `1` (env var) | `pipeline.py` | Active pix2tex après CodeFormulaV2 |

---

## Flux de données détaillé

### Upload d'un nouveau PDF
1. Frontend : `POST /process` avec `multipart/form-data`
2. `main.py` : hash SHA256 → `doc_id` (16 chars hex)
3. Si `result.json` existe → retourne cache immédiatement (idempotent)
4. Sinon : écrit `source.pdf`, ajoute tâche background, retourne `{status: "processing"}`
5. Frontend poll `GET /doc/{id}/status` (progress 0→100)
6. Pipeline écrit `result.json` → status passe à `"ready"`

### Pipeline extraction (Docling path)
1. `has_native_text()` via pypdfium2 (3 premières pages, > 100 chars)
2. Si natif → `_extraire_natif()` : TOC + texte + figures pypdfium2
3. Si scanné → Docling par tranches de `BATCH_SIZE=10` pages
   - `PdfPipelineOptions` : `generate_picture_images=True`, `images_scale=2.0`
   - `do_formula_enrichment=True` si `FORMULA_ENRICHMENT=1`
   - Batch OK → extraction sections, figures, tables, HTML, Markdown
   - Batch FAIL → retry page-par-page
4. pix2tex fallback si `PIX2TEX_FALLBACK=1` et pix2tex installé
5. `_fix_formula_html()` : classe `formula-not-decoded` → `formula` si LaTeX détecté
6. `_strip_page_headers_footers()` sur le HTML final

### Rendu frontend
- **PDF viewer** : react-pdf + PDF.js. Si JPEG2000/ICC → `cleaned.pdf` (rastérisé pypdfium2)
- **Reader** : `GET /doc/{id}/html` → `MarkdownReader.tsx` → `sectionizeHtml()` → sections
  - KaTeX auto-render sur `$...$` et `$$...$$` (pas d'`ignoredClasses`)
- **Compare** : PDF viewer gauche + Reader droite, synchronisés via `forwardRef` handles

---

## Contrats inter-couches

### `result.json` → frontend
```typescript
{
  doc_id: string           // 16 chars hex
  filename: string         // nom original
  extraction_mode: "fast" | "native" | "docling"
  pages: Array<{number: number, width: number, height: number}>
  outline: OutlineNode[]   // arbre récursif (children)
  figures: Figure[]
  tables: Table[]
  tesseract_available: boolean
}
```

### `OutlineNode`
```typescript
{ id: string, level: 1|2|3|4, title: string, page: number|null, bbox: number[]|null, children: OutlineNode[] }
```

### `Figure`
```typescript
{ id: string, page: number, bbox: number[]|null, caption: string, latex?: string }
```

### `Table`
```typescript
{ id: string, page: number, bbox: number[]|null, caption: string, html: string, n_rows: number, n_cols: number }
```

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Backend runtime | Python | 3.13 |
| API | FastAPI + uvicorn | 0.2.0 |
| ML extraction | Docling | 2.92+ |
| PDF natif | pypdfium2 | latest |
| PDF fix ICC | PyMuPDF (fitz) | latest |
| OCR inline | RapidOCR (via Docling) | — |
| OCR couche | OCRmyPDF + Tesseract | optionnel |
| Formules ML | pix2tex (LaTeX-OCR) | optionnel |
| Frontend | React 19 + Vite + TypeScript | — |
| PDF viewer | react-pdf (PDF.js) | — |
| Formules rendu | KaTeX auto-render | — |
