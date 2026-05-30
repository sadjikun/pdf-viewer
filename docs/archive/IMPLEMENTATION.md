# IMPLEMENTATION — Journal des améliorations

> **ARCHIVE — Journal d'implémentation historique.**  
> Nouvelles notes dans [`memory/LOG.md`](memory/LOG.md). Ne pas modifier ce fichier.

Ce fichier documente toutes les fonctionnalités ajoutées lors de la session d'amélioration du projet, avec le détail technique de chaque implémentation.

---

## P0.1 — Fast Path natif (pypdfium2)

### Problème
Docling prend 25–80s par document même pour des PDFs natifs (avec texte embarqué). Inutile de passer par le pipeline ML complet pour ces cas.

### Solution
Auto-détection du type de PDF au boot du pipeline :

**`backend/pipeline.py`**
```python
def has_native_text(pdf_path: Path) -> bool:
    """Compte les caractères sur les 3 premières pages via pypdfium2."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(pdf_path))
    total = 0
    for i in range(min(3, len(pdf))):
        page = pdf[i]
        textpage = page.get_textpage()
        total += len(textpage.get_text_range())
    return total > 100
```

Si `has_native_text()` retourne `True`, on appelle `_extraire_natif()` au lieu de Docling.

### `_extraire_natif()` — extraction fast path
- Extrait tout le texte via `pypdfium2`
- Construit le sommaire depuis le TOC natif du PDF (`pdf.get_toc()`)
- Si le TOC natif est vide ou trop court → fallback regex sur le texte

### Détection de sections par regex
```python
_SECTION_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?(?=\s|$)")  # X.Y minimum
_CHAPTER_PREFIX = re.compile(r"^\s*Chapter\s+(\d+)\s*:", re.IGNORECASE)  # colon requis
_ALPHA_WORD     = re.compile(r"[a-zA-ZÀ-ÿ]{3,}")
_MATH_HEAVY     = re.compile(r"[=×÷±≤≥≠∆∑∫√½π⋅·σδε]|[<>]=?")
```

Règles appliquées sur chaque ligne candidate :
1. Matcher `_SECTION_PREFIX` (format X.Y obligatoire) ou `_CHAPTER_PREFIX`
2. Partie texte ≥ 10 caractères
3. Contient au moins un mot de 3+ lettres (`_ALPHA_WORD`)
4. Pas de symboles mathématiques (`_MATH_HEAVY`)
5. Ratio alpha ≥ 50%

### Résultat
| Mode | Temps (12 pages) |
|---|---|
| Docling | ~25s |
| Fast path | ~0.16s (cache) / ~1.4s (première fois) |

**Champ `extraction_mode`** dans `result.json` : `"fast"` ou `"docling"`.

---

## P0.2 — Tables UI (onglet Tables)

### Problème
Docling extrait les tableaux (`doc.tables`) mais ils n'étaient pas exposés côté frontend.

### Backend — `backend/pipeline.py`
```python
def _extraire_tables_doc(doc, page_offset, tbl_offset) -> list:
    tables = []
    for i, table in enumerate(doc.tables):
        prov = table.prov[0] if table.prov else None
        page = (prov.page_no + page_offset - 1) if prov else None
        bbox = _prov_to_bbox(prov) if prov else None
        html = table.export_to_html(doc)  # doc requis depuis Docling 2.x
        caption = " ".join(
            item.text for item in getattr(table, "captions", [])
            if hasattr(item, "text")
        ).strip()
        tables.append({
            "id": f"tbl-{tbl_offset + i}",
            "page": page,
            "bbox": bbox,
            "caption": caption,
            "html": html,
            "n_rows": len(table.data.grid) if table.data else 0,
            "n_cols": len(table.data.grid[0]) if (table.data and table.data.grid) else 0,
        })
    return tables
```

> **Attention** : `table.export_to_html(doc)` — le document Docling doit être passé en argument depuis Docling 2.x, sinon retourne une chaîne vide.

### Frontend — `frontend/src/types.ts`
```typescript
export interface Table {
  id: string;
  page: number | null;
  bbox: Bbox | null;
  caption: string;
  html: string;
  n_rows: number;
  n_cols: number;
}
```

### Frontend — `frontend/src/components/Tables/TablesPanel.tsx`
- Liste les tableaux avec caption, page, dimensions (N×M)
- Aperçu HTML rendu via `dangerouslySetInnerHTML` (sécurisé : Docling ne génère pas de scripts)
- Bouton "Page N" → callback `onGotoPage(page)` qui switch vers le viewer PDF

### Frontend — `frontend/src/App.tsx`
- 3ème onglet `Tables` avec badge de comptage (`{tables.length}`)
- Badge `⚡ fast` dans la meta sidebar quand `extraction_mode === "fast"` (figures et tables non disponibles en mode rapide)

---

## P1.1 — OCRmyPDF (PDF cherchable)

### But
Générer un PDF avec couche de texte OCR embarquée, téléchargeable directement.

### Backend — `backend/main.py`
```python
@app.get("/doc/{doc_id}/searchable-pdf")
def get_searchable_pdf(doc_id: str) -> FileResponse:
    # Vérifie Tesseract disponible, sinon 503
    # Vérifie ocrmypdf installé, sinon 503
    # Si searchable.pdf déjà en cache → retourne directement
    # Sinon :
    ocrmypdf.ocr(
        source, searchable,
        language=["fra", "eng"],
        skip_text=skip_text,  # True pour PDFs natifs (fast mode)
        progress_bar=False,
        jobs=2,
    )
```

- `skip_text=True` pour les PDFs natifs (texte déjà présent, OCR uniquement sur les zones image)
- `skip_text=False` pour les PDFs scannés (OCR complet)
- Résultat mis en cache dans `cache/<doc_id>/searchable.pdf`

### Frontend — `frontend/src/api.ts`
```typescript
export function searchablePdfUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/searchable-pdf`;
}
```

### Frontend — `frontend/src/App.tsx`
Bouton OCR conditionnel dans la sidebar :
```tsx
{tesseract?.available ? (
  <a
    className="app-action"
    href={searchablePdfUrl(doc.doc_id)}
    target="_blank"
    rel="noreferrer"
    title={`PDF cherchable via Tesseract ${tesseract.version} (${tesseract.langs.join(", ")})`}
  >
    OCR
  </a>
) : (
  <span
    className="app-action app-action--disabled"
    title="Tesseract non disponible — installez-le avec : scoop install tesseract"
  >
    OCR
  </span>
)}
```

---

## P1.2 — LaTeX-OCR (pix2tex, optionnel)

### But
Extraire les formules mathématiques des figures et les stocker en LaTeX.

### Backend — `backend/main.py`
```python
@app.post("/doc/{doc_id}/latex-ocr")
def run_latex_ocr(doc_id: str) -> JSONResponse:
    from pix2tex.cli import LatexOCR
    model = LatexOCR()
    for fig in figures:
        img = Image.open(img_path)
        w, h = img.size
        # Filtre : ignore images trop grandes ou portrait (texte, photos)
        if h > w * 0.6 or w * h > 1_000_000:
            continue
        latex = model(img)
        if latex and 3 <= len(latex) <= 600:
            fig["latex"] = latex.strip()
    # Met à jour result.json
```

### Frontend — `frontend/src/api.ts`
```typescript
export async function runLatexOcr(docId: string): Promise<{ figures_updated: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/latex-ocr`, { method: "POST" });
  ...
}
```

> **Note** : pix2tex est optionnel (`pip install pix2tex`). Si absent, l'endpoint retourne 503.

---

## Tesseract — Installation et intégration

### Installation (Windows via Scoop)
```bash
scoop install tesseract
# Données de langue (téléchargement manuel depuis tessdata_fast) :
# eng.traineddata, fra.traineddata, osd.traineddata
# → C:\Users\<user>\scoop\persist\tesseract\tessdata\
```

### Auto-détection au boot du pipeline
**`backend/pipeline.py`** — exécuté à l'import du module :
```python
def _find_tesseract() -> tuple[str | None, str | None]:
    # 1. Variable d'environnement TESSERACT_CMD
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd and Path(env_cmd).exists():
        cmd = env_cmd
    else:
        # 2. PATH système (shutil.which)
        cmd = shutil.which("tesseract")
    if not cmd:
        # 3. Chemins candidats connus (Scoop, Program Files)
        candidates = [
            Path(os.environ.get("USERPROFILE","")) / "scoop" / "shims" / "tesseract.exe",
            Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
            Path("C:/Program Files (x86)/Tesseract-OCR/tesseract.exe"),
        ]
        for c in candidates:
            if c.exists():
                cmd = str(c)
                break
    # Tessdata
    tessdata = os.environ.get("TESSDATA_PREFIX")
    if not tessdata:
        scoop_data = Path(os.environ.get("USERPROFILE","")) / "scoop" / "apps" / "tesseract" / "current" / "tessdata"
        if scoop_data.exists():
            tessdata = str(scoop_data)
    return cmd, tessdata

TESSERACT_CMD, TESSDATA_DIR = _find_tesseract()
if TESSERACT_CMD:
    if TESSDATA_DIR:
        os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR
    try:
        import pytesseract as _pyt
        _pyt.pytesseract.tesseract_cmd = TESSERACT_CMD
    except ImportError:
        pass
```

### Endpoint status — `GET /tesseract/status`
```json
{
  "available": true,
  "cmd": "C:\\Users\\MHDINGBI\\scoop\\shims\\tesseract.EXE",
  "tessdata": "C:\\Users\\MHDINGBI\\scoop\\apps\\tesseract\\current\\tessdata",
  "langs": ["eng", "fra", "osd"],
  "version": "5.5.0.20241111"
}
```

### Endpoint OCR image — `POST /doc/{id}/ocr-image/{fig_id}`
OCR direct via pytesseract sur une figure PNG. Retourne le texte brut extrait.

---

## Reader Markdown (2 thèmes)

### But
Alternative au viewer PDF : rendu Markdown enrichi avec KaTeX pour les équations.

### Dépendances frontend ajoutées
```bash
npm install react-markdown remark-gfm remark-math rehype-katex rehype-highlight
```

### `frontend/src/components/Reader/MarkdownReader.tsx`
- Récupère `/doc/{id}/markdown` (généré à la demande par le backend via Docling)
- Rendu avec `ReactMarkdown` :
  - `remarkPlugins: [remarkGfm, remarkMath]`
  - `rehypePlugins: [rehypeKatex, rehypeHighlight]`
- Toggle thème `reading` / `interactive`
- Persistance dans `localStorage`

### `frontend/src/components/Reader/MarkdownReader.css`
Deux thèmes via CSS custom properties :

| Propriété | `reading` | `interactive` |
|---|---|---|
| Police | Charter, serif | Inter, sans-serif |
| Fond | `#fbfaf7` (papier) | `#fbfaf6` |
| Accent | `#c75a30` (terracotta) | `#2c5e3f` (vert) |
| Taille | 19px | 16px |
| Largeur max | 680px | 780px |

KaTeX display blocks stylés avec fond accent + bordure gauche.

---

## Nouveaux endpoints API (récapitulatif)

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/doc/{id}/searchable-pdf` | PDF avec couche texte OCR (OCRmyPDF + Tesseract) |
| `POST` | `/doc/{id}/ocr-image/{fig_id}` | OCR direct pytesseract sur une figure PNG |
| `GET` | `/tesseract/status` | Disponibilité, version, langues Tesseract |
| `POST` | `/doc/{id}/latex-ocr` | Lance pix2tex sur toutes les figures (optionnel) |

---

## Nouveaux champs dans `result.json`

```json
{
  "doc_id": "...",
  "extraction_mode": "fast | docling",
  "n_pages": 12,
  "n_figures": 4,
  "n_tables": 3,
  "tables": [
    {
      "id": "tbl-0",
      "page": 3,
      "bbox": { "x1": 0.1, "y1": 0.2, "x2": 0.9, "y2": 0.5 },
      "caption": "Table 1. Résultats…",
      "html": "<table>…</table>",
      "n_rows": 5,
      "n_cols": 4
    }
  ],
  "figures": [
    {
      "id": "fig-0",
      "page": 2,
      "bbox": { … },
      "caption": "Figure 1. …",
      "latex": "E = mc^2"  // présent si latex-ocr lancé
    }
  ]
}
```

---

## Fichiers modifiés

| Fichier | Changements |
|---|---|
| `backend/pipeline.py` | Fast path, auto-détection Tesseract, extraction tables, regex sections améliorée |
| `backend/main.py` | 4 nouveaux endpoints, CORS ports 5173+5174 |
| `frontend/src/types.ts` | Types `Table`, `ExtractionMode`, mise à jour `DocResult` |
| `frontend/src/api.ts` | `searchablePdfUrl`, `runLatexOcr`, `getTesseractStatus`, `TesseractStatus` |
| `frontend/src/App.tsx` | Onglet Tables, toggle PDF/Reader, badge fast mode, bouton OCR conditionnel |
| `frontend/src/App.css` | `.app-view-toggle`, `.app-mode-badge`, `.app-tab-count`, `.app-action--disabled` |
| `frontend/src/components/Reader/MarkdownReader.tsx` | Nouveau composant (thèmes reading/interactive + KaTeX) |
| `frontend/src/components/Reader/MarkdownReader.css` | Styles des deux thèmes |
| `frontend/src/components/Tables/TablesPanel.tsx` | Nouveau composant (liste + aperçu HTML tables) |
| `frontend/src/components/Tables/TablesPanel.css` | Styles dark theme pour les tables |

---

## Dépendances ajoutées

### Backend (`requirements.txt` / pip)
```
ocrmypdf>=17.4.2
pytesseract>=0.3.13
# optionnel : pix2tex (LaTeX-OCR, lourd ~2Go)
```

### Frontend (`package.json`)
```
react-markdown
remark-gfm
remark-math
rehype-katex
rehype-highlight
katex (peer dep)
```

---

## P2 — Benchmark d'extraction PDF

### But
Comparer objectivement les outils d'extraction de texte PDF disponibles sur le document traité.

### Outils benchmarkés
| Outil | Rôle | Spécialité |
|---|---|---|
| pypdfium2 | Notre fast path | Ultra-rapide, texte natif |
| pymupdf (fitz) | Référence industrielle | Vitesse + TOC natif |
| pdfplumber | Extraction structurée | Détection tables layout |
| pdfminer | Extraction exhaustive | Plus de caractères (espacements) |
| pypdf | Léger | Outline natif |
| Docling | Notre pipeline ML | Figures + tables structurées |

### Résultats sur document test (82 pages, 4.7 MB)

| Outil | Vitesse | Caractères | Sections | Tables | Figures |
|---|---|---|---|---|---|
| **pypdfium2** | **0.045s** ⚡ | 61 398 | 53 | 0 | 0 |
| **pymupdf** | 0.057s | 61 310 | 0 (via TOC) | 0 | 0 |
| pdfplumber | 1.257s | 59 632 | 0 | **3** | 0 |
| pdfminer | 1.147s | **64 853** | 0 | 0 | 0 |
| pypdf | 0.152s | 61 113 | 0 | 0 | 0 |
| **Docling (cache)** | (déjà traité) | 61 353 | 31 | 2 | **112** |

### Conclusions
- **Vitesse** : pypdfium2 ≈ pymupdf (~0.05s) sont 25× plus rapides que pdfplumber/pdfminer (~1.2s)
- **Texte brut** : pdfminer extrait +5% de caractères (spaces/retours inclus) mais sans structure
- **Structure** : seuls Docling (ML) et pypdfium2 (regex) détectent les sections
- **Tables** : pdfplumber détecte 3 tables via analyse layout ; Docling 2 via ML (TableFormer)
- **Figures** : uniquement Docling (112 via vision ML)
- **Notre choix** (fast path pypdfium2 + Docling pour figures/tables) est optimal :
  - Texte en 0.05s via pypdfium2
  - Structure via regex ou TOC natif
  - Figures + tables via Docling en arrière-plan

### Fichiers créés
- `backend/benchmark.py` — script standalone + fonctions d'extraction
- `GET /doc/{id}/benchmark` — endpoint JSON (mis en cache dans `benchmark.json`)
- `GET /doc/{id}/benchmark.html` — rapport HTML dark-mode avec highlight
- Bouton **Bench** dans la sidebar → ouvre le rapport dans un nouvel onglet

### Dépendances ajoutées (benchmark uniquement)
```
pymupdf>=1.27
pdfplumber>=0.11
pypdf>=6
```

---

## P3 — Multi-format (markitdown)

### But
Accepter d'autres formats que le PDF : Word, PowerPoint, Excel, HTML, images, Jupyter…

### Formats supportés
| Format | Extension(s) | Outil |
|---|---|---|
| PDF | `.pdf` | Docling + pypdfium2 (pipeline existant) |
| Word | `.docx` | markitdown → mammoth |
| PowerPoint | `.pptx` | markitdown → python-pptx |
| Excel | `.xlsx`, `.xls` | markitdown → openpyxl/xlrd |
| HTML | `.html`, `.htm` | markitdown → beautifulsoup4 |
| Markdown | `.md` | markitdown (passthrough) |
| Texte | `.txt`, `.csv` | markitdown |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | markitdown |
| Jupyter | `.ipynb` | markitdown |

### Architecture

**`backend/pipeline.py`** — nouvelle fonction `convertir_generic()` :
```python
def convertir_generic(file_path: Path, out_dir: Path) -> dict:
    from markitdown import MarkItDown
    converter = MarkItDown()
    result = converter.convert(str(file_path))
    markdown_text = result.text_content or ""
    # Sauvegarde result.md → servi par GET /doc/{id}/markdown
    (out_dir / "result.md").write_text(markdown_text, encoding="utf-8")
    # Outline extrait des titres Markdown (# H1, ## H2…)
    outline = _outline_from_markdown(markdown_text)
    return {
        "extraction_mode": "markitdown",
        "file_type": ext.lstrip("."),
        ...
    }
```

**`backend/main.py`** — `/process` générique :
```python
SUPPORTED_EXTENSIONS = {".pdf"} | MARKITDOWN_EXTENSIONS
# Routing automatique selon l'extension
if is_pdf:
    result = convertir_pdf(source_path, ddir)
else:
    result = convertir_generic(source_path, ddir)
result["filename"] = file.filename  # nom original conservé
```

### Frontend

| Composant | Changement |
|---|---|
| `UploadZone.tsx` | `accept` élargi à 15 extensions, sous-titre "PDF · Word · PowerPoint…" |
| `types.ts` | `ExtractionMode` += `"markitdown"` ; `DocResult` += `filename?`, `file_type?` |
| `App.tsx` | `isMarkitdown` flag : masque toggle PDF/Reader, boutons OCR/Bench/Retraiter, onglets Galerie/Tables |
| `App.tsx` | `effectiveViewMode` : force Reader pour fichiers non-PDF |
| `App.tsx` | Titre = nom du fichier (sans extension) au lieu de l'ID |
| `App.css` | `.app-mode-badge--format` (bleu) pour badge type (DOCX, PPTX…) |

### Résultat visuel
- **PDF** : expérience identique — viewer PDF + galerie + tables
- **Word/PPTX/etc.** : mode Reader activé automatiquement, badge bleu indiquant le format, outline depuis les titres du document

### Dépendances ajoutées
```
markitdown[all]>=0.0.2   # inclut mammoth, python-pptx, openpyxl, beautifulsoup4
```

---

## P4 — Reader "Interactive Book" (refonte complète)

### But
Transformer le Reader Markdown en une expérience de lecture scientifique de qualité ArXiv Vanity / Interactive Book, avec navigation par section, focus mode, typographie premium et affichage fidèle des figures.

### Design language
Inspiré du fichier `PDF_To_InteractiveBook.html` :
- **Polices** : Open Sans (UI) · Source Serif 4 (corps) · JetBrains Mono (code) — Google Fonts
- **Accent** : orange `#e07800` (titres, bordures, CTAs)
- **Bleu formule** : `#0055a4` (équations, blocs code math)
- **Dark mode** : fond `#111110`, texte `#e8e4d8`

---

### P4.1 — Endpoint HTML Docling (`GET /doc/{id}/html`)

**`backend/pipeline.py`**

Ajout de l'export HTML Docling avec images embarquées en base64 :
```python
try:
    from docling_core.types.doc import ImageRefMode
    all_html_parts.append(doc.export_to_html(image_mode=ImageRefMode.EMBEDDED))
except Exception:
    try: all_html_parts.append(doc.export_to_html())
    except Exception: pass
```

> `ImageRefMode.EMBEDDED` embeds toutes les images (figures, formules, graphiques) en base64 directement dans le HTML — élimine les références externes et les figures vides.

Fonctions d'assemblage HTML :
```python
def _extract_body(html: str) -> str:
    """Extrait le contenu du <body> d'un HTML Docling complet."""
    m = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL | re.IGNORECASE)
    return m.group(1) if m else html

def _clean_html_spaces(html: str) -> str:
    """Supprime les doubles espaces dans le texte (artefact pypdfium2/Docling)."""
    return re.sub(r'  +', ' ', html)
```

**`backend/main.py`** — nouvel endpoint :
```python
@app.get("/doc/{doc_id}/html")
def get_html(doc_id: str):
    ddir = _doc_dir(doc_id)
    html_path = ddir / "result.html"
    if not html_path.exists():
        raise HTTPException(404, "HTML non disponible")
    return HTMLResponse(html_path.read_text(encoding="utf-8"))
```

---

### P4.2 — `_merge_pdf_lines()` — fusion des paragraphes pypdfium2

**Problème** : pypdfium2 retourne chaque ligne visuelle du PDF comme une ligne séparée. Résultat : chaque phrase s'affiche comme un paragraphe indépendant.

**`backend/pipeline.py`** :
```python
def _merge_pdf_lines(raw: str) -> str:
    """Fusionne les lignes coupées par pypdfium2 en paragraphes cohérents."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw_blocks = re.split(r"\n{2,}", text)
    paragraphs: list[str] = []
    for block in raw_blocks:
        lines = [l.rstrip() for l in block.split("\n") if l.strip()]
        if not lines: continue
        merged: list[str] = []
        buf = ""
        for line in lines:
            if not buf: buf = line; continue
            prev = buf
            if prev.endswith("-"):           # coupure de mot (tiret de fin)
                buf = prev[:-1] + line
            elif prev[-1] in ".!?:" and (len(prev) < 72 or line[0].isupper()):
                merged.append(buf); buf = line   # nouvelle phrase
            elif len(prev) < 60 and prev[-1] not in ",;(":
                merged.append(buf); buf = line   # ligne courte = titre/légende
            else:
                buf = prev + " " + line          # continuation de paragraphe
        if buf: merged.append(buf)
        paragraphs.append("\n".join(merged))
    return "\n\n".join(p for p in paragraphs if p.strip())
```

Utilisé dans `native_fallback_md` pour les PDFs natifs extraits par pypdfium2.

---

### P4.3 — `sectionizeHtml()` — parser récursif du HTML Docling

**Problème** : Le HTML Docling enveloppe tout le contenu dans `<div class='page'>`. Un parcours `body.childNodes` ne trouve qu'un seul enfant (le DIV racine) → zéro sections détectées, navigation impossible.

**`frontend/src/components/Reader/MarkdownReader.tsx`** :
```tsx
function sectionizeHtml(raw: string): { html: string; sections: Section[]; words: number } {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  parsed.querySelectorAll("script,style").forEach((el) => el.remove());
  const body = parsed.body;
  const sections: Section[] = [];
  const root = parsed.createElement("div");
  let cur: Element | null = null;
  let idx = 0;

  // Classes qui marquent un <div> comme feuille — NE PAS récursiver
  const LEAF_DIV_CLASSES = [
    "formula-not-decoded", "formula", "equation",
    "table-wrap", "tw", "fig-wrap", "caption",
  ];

  function processNode(child: ChildNode) {
    const el = child as HTMLElement;
    const tag = el.tagName ?? "";
    const isH = /^H[1-4]$/.test(tag);
    const isLeafDiv = tag === "DIV" &&
      LEAF_DIV_CLASSES.some((cls) => el.classList?.contains(cls));

    if (isH) {
      // Nouveau section
      const sid = `rs_${idx++}`;
      cur = parsed.createElement("section");
      cur.setAttribute("data-sid", sid);
      root.appendChild(cur);
      sections.push({ id: sid, title: el.textContent?.trim() ?? `Section ${idx}`, level: parseInt(tag[1]) });
      cur.appendChild(child.cloneNode(true));
    } else if (!isLeafDiv && (tag === "DIV" || tag === "ARTICLE" || tag === "MAIN")) {
      // Conteneur transparent → récursion (unwrap <div class='page'>)
      for (const sub of Array.from(child.childNodes)) processNode(sub);
    } else {
      if (!cur) { cur = parsed.createElement("section"); cur.setAttribute("data-sid", "rs_pre"); root.appendChild(cur); }
      cur.appendChild(child.cloneNode(true));
    }
  }

  for (const child of Array.from(body.childNodes)) processNode(child);

  // Supprimer les attributs width/height inline de Docling sur les images
  root.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("width"); img.removeAttribute("height");
    img.style.removeProperty("width"); img.style.removeProperty("height");
    img.style.removeProperty("max-width");
  });

  const words = body.textContent?.split(/\s+/).filter(Boolean).length ?? 0;
  return { html: root.innerHTML, sections, words };
}
```

**Point critique — `LEAF_DIV_CLASSES`** : Sans cette liste, `<div class="formula-not-decoded">` serait récursé et son contenu texte intégré sans classe → les formules perdaient leur style. La liste protège aussi les wrappers de tables et figures.

---

### P4.4 — Navigation focus mode

**`frontend/src/components/Reader/MarkdownReader.tsx`** — `useEffect` de navigation :
```tsx
useEffect(() => {
  if (!focusSectionTitle) return;
  const t = setTimeout(() => {
    if (renderMode === "html" && sections.length) {
      const match = matchSection(sections, focusSectionTitle);
      if (match) {
        setFocusSid(match.id);   // active le focus mode (masque les autres sections)
        setFocusIdx(sections.indexOf(match));
        setBreadcrumb(match.title);
        contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    // Fallback : scroll vers le titre par correspondance textuelle
    const normalize = (s: string) => s.toLowerCase().replace(/\W+/g, "");
    const target = normalize(focusSectionTitle);
    const headings = contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4");
    for (const h of headings ?? []) {
      const ht = normalize(h.textContent ?? "");
      if (ht === target || ht.includes(target) || target.includes(ht)) {
        h.scrollIntoView({ behavior: "smooth", block: "start" }); break;
      }
    }
    onFocusClear?.();
  }, 80);
  return () => clearTimeout(t);
}, [focusSectionTitle]);
```

**CSS focus mode** — injection dynamique dans le HTML rendu :
```tsx
const visibleHtml = useMemo(() => {
  if (!htmlContent) return null;
  const styles: string[] = [];
  if (paperMeta?.title) styles.push(`section[data-sid="rs_pre"]{display:none!important}`);
  if (focusSid) styles.push(`section[data-sid]:not([data-sid="${focusSid}"]){display:none!important}`);
  return styles.length ? htmlContent + `<style>${styles.join("")}</style>` : htmlContent;
}, [htmlContent, focusSid, paperMeta]);
```

---

### P4.5 — Figures à résolution naturelle

**Problème** : Docling ajoute des attributs `width`/`height` inline sur les `<img>`, et le CSS `max-width: 100%` contraignait les figures à la largeur de la colonne de texte.

**Solution CSS** (`MarkdownReader.css`) :
```css
.reader-doc figure,
.reader-doc .fig-wrap {
  margin: 24px -44px;   /* sort de la colonne pour occuper toute la largeur */
  overflow-x: auto;     /* scroll horizontal si le diagramme est très large */
}

.reader-doc figure img {
  max-width: none;      /* lève la contrainte */
  width: auto;
  height: auto;
  display: block;
  margin: 0 auto;
  padding: 16px;
}
```

**Solution JS** (`sectionizeHtml`) :
```tsx
root.querySelectorAll("img").forEach((img) => {
  img.removeAttribute("width");
  img.removeAttribute("height");
  img.style.removeProperty("width");
  img.style.removeProperty("height");
  img.style.removeProperty("max-width");
});
```

---

### P4.6 — Formules `formula-not-decoded`

Docling génère deux variantes quand il ne peut pas décoder une formule (PDFs natifs avec formules image) :
- `<div class="formula-not-decoded">Formula not decoded</div>` — formule display (bloc)
- `<span class="formula-not-decoded">Formula not decoded</span>` — formule inline

**CSS** (`MarkdownReader.css`) :
```css
/* Bloc */
div.formula-not-decoded {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--bl-bg);
  border: 1px solid var(--bl-bd);
  border-left: 4px solid var(--bl);
  border-radius: 4px;
  padding: 12px 16px; margin: 14px 0;
  font-family: var(--fm); font-size: 12px; color: var(--tx3); font-style: italic;
}
div.formula-not-decoded::before {
  content: "∑"; font-size: 18px; font-weight: 600; color: var(--bl); opacity: .5;
}

/* Inline */
span.formula-not-decoded {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bl-bg); border: 1px solid var(--bl-bd); border-radius: 3px;
  padding: 1px 7px; font-family: var(--fm); font-size: .85em;
  color: var(--tx3); font-style: italic; vertical-align: middle;
}
```

---

### P4.7 — Viewer PDF — fix worker PDF.js

**Problème** : `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"` échoue dans certains environnements Vite → "Setting up fake worker failed" → PDF non chargé.

**Fix** (`frontend/src/components/Viewer/Viewer.tsx`) :
```tsx
// Avant (cassé dans certains environnements Vite) :
// import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// Après (CDN unpkg, fonctionne partout) :
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
```

> cdnjs ne contient pas la version 5.4.296 → unpkg utilisé à la place.

---

### P4.8 — Patch filename pour les documents en cache (`main.py`)

**Problème** : Les documents extraits avant l'ajout du champ `filename` dans `result.json` affichaient l'ID du hash (`cc55c314`) au lieu du nom de fichier.

**Fix** (`backend/main.py`) — lors du retour du cache :
```python
if (ddir / "result.json").exists():
    with open(ddir / "result.json", encoding="utf-8") as f:
        cached = json.load(f)
    # Patch rétroactif : injecte filename si absent
    if not cached.get("filename") and file.filename:
        cached["filename"] = file.filename
        with open(ddir / "result.json", "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False, indent=2)
    return JSONResponse(cached)
```

---

### Nouveaux endpoints

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/doc/{id}/html` | HTML riche Docling avec images base64 embarquées |

### Fichiers modifiés (Phase 4)

| Fichier | Changements |
|---|---|
| `backend/pipeline.py` | `_merge_pdf_lines()`, `_extract_body()`, `_clean_html_spaces()`, export HTML `ImageRefMode.EMBEDDED` |
| `backend/main.py` | Endpoint `/doc/{id}/html`, patch filename rétroactif sur cache |
| `frontend/src/components/Viewer/Viewer.tsx` | Worker PDF.js via CDN unpkg |
| `frontend/src/components/Reader/MarkdownReader.tsx` | Refonte complète : `sectionizeHtml` récursif + `LEAF_DIV_CLASSES`, navigation focus mode, `extractPaperMeta`, typography popup, modes HTML/Markdown |
| `frontend/src/components/Reader/MarkdownReader.css` | Refonte complète : design Interactive Book, formules `formula-not-decoded`, figures pleine résolution, dark mode |
