# Changelog

## [v2.0.0] — 2026-05-27

Major feature release introducing multi-format document support, table extraction, a Markdown reader, OCR capabilities, and a complete UI overhaul.

---

### Backend — `main.py` (v0.1.0 → v0.2.0)

#### New endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/doc/{id}/pdf` | Serve the original PDF source |
| `GET` | `/doc/{id}/markdown` | Export extracted content as Markdown |
| `GET` | `/doc/{id}/searchable-pdf` | Generate a searchable PDF with embedded OCR text layer (requires Tesseract) |
| `POST` | `/doc/{id}/latex-ocr` | Re-run pix2tex LaTeX OCR on all figures of a document |
| `POST` | `/doc/{id}/reprocess` | Re-run the pipeline on a cached document |
| `DELETE` | `/doc/{id}` | Delete a document from the server cache |
| `GET` | `/library` | List all processed documents with status |
| `GET` | `/doc/{id}/status` | Get processing progress (`progress`, `message`, `status`) |
| `GET` | `/tesseract/status` | Report Tesseract availability, path, tessdata directory, and detected languages |

#### Async background processing

Processing now runs in a background thread (`run_pipeline_bg`). The frontend polls `/doc/{id}/status` for real-time progress updates instead of blocking on a long HTTP request.

#### PDF compatibility layer

- `_needs_rasterize()` — detects PDFs containing JPEG2000 images (`JPXDecode`) or broken ICC profiles that PDF.js cannot display.
- `_repair_icc_profiles()` — rasterises each page via `pypdfium2` and repackages as a JPEG-based PDF. The result is served as `cleaned.pdf` transparently to the frontend.

#### Pipeline version tracking

`_CURRENT_PIPELINE_VERSION = "2026-05-25"` is compared against the version stored in `result.json`. A mismatch flags stale cache and enables the frontend to offer a reprocessing prompt.

#### Windows fixes

- Forces UTF-8 on `stdout`/`stderr` at startup to prevent `UnicodeEncodeError` on Windows with `cp1252` encoding.

---

### Backend — `pipeline.py`

#### Fast path mode

A new `fast_mode=True` flag bypasses Docling entirely and uses `pypdfium2` for text extraction only. Processing time drops from ~30–90 s to under 2 s. Recommended for native-text PDFs that don't need figure or table extraction.

#### Table extraction

The pipeline output now includes a `tables` array:

```json
{
  "tables": [
    {
      "id": "t_0",
      "page": 5,
      "bbox": [x0, y0, x1, y1],
      "caption": "Table 1: ...",
      "html": "<table>...</table>",
      "n_rows": 4,
      "n_cols": 3
    }
  ]
}
```

Docling identifies tables and exports their content as HTML for direct rendering in the frontend's new **Tables** panel.

#### OCR support

Three OCR engines are now integrated:

| Engine | Usage |
|--------|-------|
| RapidOCR (via Docling) | Automatic OCR for scanned pages during the main pipeline run |
| OCRmyPDF + Tesseract CLI | Generates a searchable PDF with embedded text layer (`/searchable-pdf` endpoint) |
| pytesseract | Direct OCR on individual images |
| pix2tex | LaTeX OCR — converts math formula images to LaTeX strings stored in `figures[].latex` |

Tesseract is auto-detected at startup: checks `TESSERACT_CMD` env var, then `PATH`, then common Windows/Scoop install paths.

#### Dynamic worker allocation

Worker and thread counts are computed at startup from available CPU cores, RAM (via `psutil`), and GPU presence (CUDA/MPS via PyTorch):

- **GPU available** — few CPU workers, many threads per worker (inference offloaded to GPU).
- **CPU only** — empirical sweet-spot of 4 threads/worker; worker count scales with `(available_RAM - 2 GB) / 1.5 GB`.
- Override with `DOCLING_WORKERS` env var.

#### Other pipeline improvements

- `PIPELINE_VERSION = "2026-05-25"` constant for cache invalidation detection.
- IPv4 force at socket level (fixes IPv6 timeout on some Windows network stacks).
- Batched Docling processing: 10 pages per batch to reduce peak memory usage.
- Combined regex pass (`_apply_combined_passes`) replaces 4 separate passes for HTML post-processing (double-spaces, formula decode, page-number strip, short italic strip).
- Memory monitoring via `psutil` — RSS logged at key stages.

#### Dependencies added (`requirements.txt`)

| Package | Version | Purpose |
|---------|---------|---------|
| `ocrmypdf` | `>=17.0` | Searchable PDF generation |
| `pytesseract` | `>=0.3.10` | Tesseract Python binding |
| `pix2tex` | `==0.1.4` | LaTeX OCR for math figures |

`uvloop` removed — not compatible with Windows.

---

### Frontend — New components

#### `Library` (`src/components/Library/`)

A sidebar panel listing all documents previously processed by the server. Each entry shows the document title, page count, processing date, and extraction mode. Supports:

- Opening a document from history.
- Deleting a document from cache.
- Displaying documents currently processing with a live progress indicator.

#### `MarkdownReader` (`src/components/Reader/`)

A full-featured Markdown document reader powered by `react-markdown`. Features:

- **Math rendering** — inline (`$...$`) and display (`$$...$$`) LaTeX rendered via KaTeX (`rehype-katex`).
- **Code highlighting** — syntax-highlighted code blocks via `rehype-highlight`.
- **GFM support** — tables, task lists, and strikethrough via `remark-gfm`.
- **10 themes** — matches the app-level theme (glassmorphism, minimalist, technical, vintage, OLED, forest, CSTB, Swiss, e-ink, HUD).
- **Smooth section sync** — scrolling the Reader updates the outline sidebar; clicking an outline entry scrolls the Reader.
- Persistent theme selection via `localStorage`.

#### `TablesPanel` (`src/components/Tables/`)

A sidebar tab that renders all tables extracted from the PDF as formatted HTML. Each table shows its caption and page number. Empty states are handled gracefully.

---

### Frontend — Updated components

#### `App.tsx`

- **3 view modes**: `pdf` (PDF.js viewer), `reader` (Markdown reader), `compare` (side-by-side PDF + Reader with draggable divider).
- **10 app themes**: glassmorphism, minimalist, technical, vintage, OLED, forest, CSTB, Swiss, e-ink, HUD. Theme and dark/light state persisted in `localStorage`.
- **Resizable sidebar**: drag handle between sidebar and content. Width clamped to 180–560 px, persisted in `localStorage`.
- **Real-time progress**: polls `/doc/{id}/status` while processing and passes `progress` + `message` to `LoadingDocling`.
- **Library panel**: toggle button to open/close the document library.
- **Synchronized scroll** between PDF Viewer and Markdown Reader in compare mode (FIX-037: debounced to prevent feedback loops).
- **Tables tab**: third sidebar tab alongside Outline and Gallery.

#### `Viewer.tsx`

- **Virtualized rendering**: only renders pages within `RENDER_BUFFER = 5` pages of the current scroll position. Slot heights are computed from page metadata (width/height aspect ratio) without mounting all pages.
- **Scroll-based page detection**: replaced `IntersectionObserver` with a throttled scroll listener + binary search on cumulative heights. More reliable and avoids ghost intersections during fast scrolling.
- **Smooth scroll threshold**: uses `scrollTop` directly instead of `scrollIntoView` for large jumps (> 5 000 px).
- **Debounced resize**: `ResizeObserver` callback debounced at 150 ms to avoid layout thrashing.
- **PDF.js worker**: switched from Vite `?url` import to unpkg CDN (`https://unpkg.com/pdfjs-dist@{version}/...`) to fix worker loading in some environments.

#### `UploadZone.tsx`

- Accepts all formats supported by MarkItDown: PDF, DOCX, PPTX, XLSX, HTML, Markdown, CSV, images (PNG/JPEG/GIF/WebP), Jupyter notebooks.
- **Fast mode toggle**: checkbox defaults to `true`. When enabled, the `?fast_mode=true` query parameter is sent to the backend; Docling and figure/table extraction are skipped.
- Updated hint text to reflect multi-format support.

#### `LoadingDocling.tsx`

- Accepts optional `progress: number | null` and `message: string` props.
- Renders an animated progress bar with percentage text when `progress` is provided.
- Falls back to the existing elapsed-time stage labels when no server progress is available.

#### `Outline.tsx`

- Toggle arrows replaced with SVG chevrons (animated rotate on expand/collapse).
- Level-based CSS classes (`outline-item-l1`, `outline-item-l2`, …) enable per-level indentation.
- Clicking the title button also toggles expand/collapse when the node has children.

---

### Frontend — New dependencies (`package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| `katex` | `^0.16.47` | Math rendering engine |
| `react-markdown` | `^10.1.0` | Markdown to JSX renderer |
| `rehype-highlight` | `^7.0.2` | Syntax highlighting in code blocks |
| `rehype-katex` | `^7.0.1` | KaTeX integration for rehype |
| `remark-gfm` | `^4.0.1` | GitHub Flavored Markdown |
| `remark-math` | `^6.0.0` | Math block parsing |

---

### New project files

| File | Description |
|------|-------------|
| `install.bat` | One-click Windows setup: creates venv, installs backend and frontend deps |
| `start.bat` | Starts backend (uvicorn) and frontend (vite) in separate windows |
| `AGENTS.md` | AI agent usage guide for this project |
| `FIXES.md` | Running log of bugs fixed during development |
| `IMPLEMENTATION.md` | Architecture and implementation notes |
| `docs/` | Generated documentation artifacts |
