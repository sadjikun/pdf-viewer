# Guide d'implémentation — pdf-viewer

> Document de référence technique. Audience : développeurs qui rejoignent le projet
> ou qui veulent comprendre comment les pièces s'assemblent.
>
> Pour les notes de session → `memory/LOG.md`  
> Pour les invariants critiques → `memory/fixes-registry.md`

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Structure du projet](#2-structure-du-projet)
3. [Backend — Traitement des PDFs](#3-backend--traitement-des-pdfs)
   - [Détection natif vs scanné](#31-détection-natif-vs-scanné)
   - [Fast path (PDFs natifs)](#32-fast-path-pdfs-natifs)
   - [Docling path (PDFs scannés)](#33-docling-path-pdfs-scannés)
   - [Pipeline formules LaTeX](#34-pipeline-formules-latex)
   - [Gestion des figures](#35-gestion-des-figures)
   - [Correction des PDFs problématiques](#36-correction-des-pdfs-problématiques)
4. [Backend — API REST](#4-backend--api-rest)
5. [Cache et persistance](#5-cache-et-persistance)
6. [Frontend — Architecture](#6-frontend--architecture)
   - [Shell principal App.tsx](#61-shell-principal-apptsx)
   - [PDF Viewer](#62-pdf-viewer)
   - [Reader (mode livre)](#63-reader-mode-livre)
   - [Mode Comparer](#64-mode-comparer)
7. [Flux de données complet](#7-flux-de-données-complet)
8. [Invariants critiques](#8-invariants-critiques)
9. [Variables d'environnement](#9-variables-denvironnement)
10. [Lancer le projet](#10-lancer-le-projet)

---

## 1. Vue d'ensemble

**pdf-viewer** est un lecteur PDF local self-hosted. Il n'y a pas de cloud, pas d'authentification, pas de base de données. L'application tourne entièrement sur la machine de l'utilisateur.

```
┌─────────────────────────────────────────────────────────┐
│                     NAVIGATEUR                          │
│                                                         │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │  PDF.js  │  │ Reader HTML   │  │  Mode Comparer   │ │
│  │ (viewer) │  │ (livre inter) │  │ (PDF + Reader)   │ │
│  └──────────┘  └───────────────┘  └──────────────────┘ │
│                                                         │
│  Sidebar : Sommaire | Galerie figures | Tables          │
└──────────────────────┬──────────────────────────────────┘
                       │ REST/JSON
┌──────────────────────▼──────────────────────────────────┐
│              FastAPI  (localhost:8000)                   │
│                                                         │
│  POST /process  → pipeline.py → cache/{id}/result.json  │
│  GET  /doc/{id}/pdf     → source.pdf ou cleaned.pdf     │
│  GET  /doc/{id}/html    → result.html (HTML Docling)    │
│  GET  /doc/{id}/outline → outline JSON                  │
│  GET  /doc/{id}/figure/{fig_id} → PNG                  │
│                                                         │
│  Moteurs : pypdfium2 (natif) · Docling (ML) · KaTeX    │
└─────────────────────────────────────────────────────────┘
```

**Stack :**
- Backend : Python 3.13, FastAPI, uvicorn
- Extraction ML : Docling 2.92 + RapidOCR (embarqué)
- Extraction natif : pypdfium2 (libpdfium Google)
- Frontend : React 19, TypeScript, Vite
- Rendu PDF : react-pdf (PDF.js)
- Formules : KaTeX auto-render

---

## 2. Structure du projet

```
pdf-viewer/
├── CLAUDE.md                    ← Entry point agent (lire en premier)
├── memory/                      ← Wiki technique persistant
│   ├── INDEX.md
│   ├── LOG.md
│   ├── fixes-registry.md
│   └── …13 pages
│
├── backend/
│   ├── main.py                  ← API FastAPI (endpoints)
│   ├── pipeline.py              ← Extraction PDF → JSON
│   ├── benchmark.py             ← Comparaison outils OCR
│   └── cache/                   ← Résultats mis en cache
│       └── {doc_id}/
│           ├── source.pdf
│           ├── result.json
│           ├── result.html
│           ├── result.md
│           ├── cleaned.pdf      ← si JPEG2000/ICC invalide
│           └── figures/
│               ├── f_0.png
│               └── …
│
└── frontend/
    ├── src/
    │   ├── App.tsx              ← Shell principal
    │   ├── api.ts               ← Client HTTP
    │   ├── types.ts             ← Types TypeScript
    │   └── components/
    │       ├── Reader/
    │       │   ├── MarkdownReader.tsx
    │       │   └── MarkdownReader.css
    │       ├── Viewer/          ← react-pdf
    │       ├── Outline/         ← Arbre sidebar
    │       ├── Gallery/         ← Galerie figures
    │       └── …
    └── index.html
```

---

## 3. Backend — Traitement des PDFs

Le point d'entrée est `pipeline.py::convertir_pdf(pdf_path, output_dir, progress_callback)`.

### 3.1 Détection natif vs scanné

```python
def has_native_text(pdf_path: Path) -> bool:
    """pypdfium2 extrait le texte des 3 premières pages.
    Si > 100 caractères : PDF natif (texte sélectionnable).
    Sinon : PDF scanné (images de pages).
    """
```

Cette décision détermine le chemin d'extraction :

| Type | Outil | Durée | Résultat |
|------|-------|-------|----------|
| **Natif** | pypdfium2 | ~1s | TOC + texte + régex titres |
| **Scanné** | Docling + RapidOCR | 25–80s | ML complet (layout, formules, tables) |

---

### 3.2 Fast path (PDFs natifs)

Pour les PDFs avec texte sélectionnable, on évite Docling (trop lent) :

```
1. Extraire le TOC natif pypdfium2
   └─ _toc_vers_outline(toc) → liste plate → _construire_outline() → arbre

2. Si TOC vide → détecter titres par regex dans le texte brut
   └─ _outline_depuis_texte(page_texts)

3. Compléter le TOC avec les annexes absentes (FIX-003)
   └─ Chercher "Attachment A", "Appendix B" etc. dans le texte
   └─ _ANNEX_PREFIX = re.compile(r"^\s*(Attachment|Appendix|Annex|Exhibit)…")
```

**Logique de détection de titres** (`_est_titre_section`) — critères cumulatifs :
- Format `X.Y` minimum (au moins un point dans le numéro) OU `Chapter N:` OU `Annex A`
- Texte après le numéro : ≥ 10 caractères, ≥ 50 % lettres, ≥ 1 mot de 3+ lettres
- Pas de symboles mathématiques (pour ne pas confondre équations et titres)

---

### 3.3 Docling path (PDFs scannés)

Docling est un framework ML d'IBM Research qui combine :
- **RapidOCR** (embarqué, sans dépendance système) pour le texte
- **TableFormer** pour l'extraction de tableaux structurés
- **CodeFormulaV2** (optionnel) pour les formules LaTeX

**Boucle par tranches de 10 pages** (`BATCH_SIZE = 10`) :

```python
for batch_start in range(0, n_pages, BATCH_SIZE):
    # 1. Découper le PDF en une tranche temporaire
    tranche_path = _split_pdf(pdf_path, batch_start, batch_end, tmp_dir)

    # 2. Lancer Docling sur la tranche
    doc = converter.convert(str(tranche_path)).document

    # 3. Pix2tex fallback sur les formules non décodées
    if PIX2TEX_FALLBACK:
        _appliquer_pix2tex(doc)

    # 4. Extraire sections, HTML, Markdown, figures, tables
    docling_sections.extend(_extraire_sections_doc(doc, …))
    all_html_parts.append(doc.export_to_html(image_mode=EMBEDDED))
    all_figures.extend(_extraire_figures_doc(doc, …))
    all_tables.extend(_extraire_tables_doc(doc, …))

    # 5. Si la tranche échoue → retry page par page
    except Exception:
        for single_page in range(batch_start, batch_end):
            # même logique, page unique
```

La stratégie de retry page-par-page garantit qu'une page corrompue n'élimine pas les 9 autres de la tranche.

**Configuration Docling :**
```python
PdfPipelineOptions(
    generate_picture_images = True,   # extraire images des figures
    images_scale            = 2.0,    # 144 DPI (vs 72 DPI par défaut)
    generate_page_images    = True,
    do_formula_enrichment   = FORMULA_ENRICHMENT,  # CodeFormulaV2
)
```

**Post-traitements HTML** (appliqués dans cet ordre) :
```python
html = _extract_body(raw_html)          # garde uniquement le <body>
html = _clean_html_spaces(html)         # normalise les espaces
html = _fix_formula_html(html)          # patch classes formules
html = _strip_page_headers_footers(html) # supprime numéros de page
```

---

### 3.4 Pipeline formules LaTeX

Les formules traversent jusqu'à deux passes avant rendu.

#### Passe 1 — CodeFormulaV2 (Docling built-in)

Activé avec `FORMULA_ENRICHMENT=1`. Docling utilise un modèle Transformers (~1-2 GB HuggingFace, téléchargé une seule fois) pour décoder les formules lors de l'extraction. Les items décodés ont la classe CSS `formula` et `item.text` contient le LaTeX brut.

#### Passe 2 — pix2tex (LaTeX-OCR, fallback)

Activé avec `PIX2TEX_FALLBACK=1` (défaut). S'applique après Docling aux items encore "not decoded" :

```python
for item, _lvl in doc.iterate_items():
    if "formula" not in label_str: continue
    if "not decoded" not in item.text.lower(): continue  # déjà décodé → skip

    img = item.get_image(doc)       # image PNG de la formule
    latex = _latex_model(img)       # ViT → LaTeX string

    if latex and 3 <= len(latex) <= 600:
        item.text = f"${latex.strip()}$"
```

#### Post-pass — `_fix_formula_html()`

Après export HTML, certains items pix2tex-décodés gardent encore la classe `formula-not-decoded` (Docling écrit la classe à partir du statut à l'extraction). Cette fonction corrige ça :

```python
# Cherche <div class="formula-not-decoded">$latex$</div>
# Si le contenu commence par $ → remplace la classe par "formula"
```

#### Rendu — KaTeX (frontend)

```typescript
renderMathInElement(docEl, {
  delimiters: [
    { left: "$$", right: "$$", display: true  },  // équation centrée
    { left: "$",  right: "$",  display: false },   // formule inline
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true  },
  ],
  throwOnError: false,  // formule non supportée → rouge, pas de crash
});
```

---

### 3.5 Gestion des figures

`_extraire_figures_doc()` extrait chaque figure Docling et l'enregistre en PNG.

**Filtre anti-bruit :** les éléments décoratifs (puces, séparateurs, icônes) sont détectés par taille et ignorés :

```python
MIN_DIM  = 50    # px — width ET height minimum
MIN_AREA = 2500  # px² — équivalent à 50×50

w, h = img.size
if w < MIN_DIM or h < MIN_DIM or w * h < MIN_AREA:
    continue  # puce/ligne/icône → ignoré
```

Chaque figure valide génère un fichier `figures/f_N.png` et une entrée dans `result.json` :
```json
{ "id": "f_0", "page": 3, "bbox": [72, 200, 400, 450], "caption": "Figure 1…", "latex": "" }
```

---

### 3.6 Correction des PDFs problématiques

Certains PDFs s'affichent mal dans PDF.js :

| Problème | Symptôme | Détection |
|----------|----------|-----------|
| **JPEG2000** (JPXDecode) | Images vides dans PDF.js | `img_dict["ext"] in ("jpx", "jp2")` |
| **ICC profile invalide** | Images blanches | Exception PyMuPDF contenant "cms/icc/profile" |

**Détection via `_needs_rasterize(pdf_path)`** (PyMuPDF) :
```python
for img in page.get_images(full=True):
    try:
        img_dict = doc.extract_image(xref)
        if img_dict["ext"] in ("jpx", "jp2"): found = True  # JPEG2000
    except Exception as e:
        err = str(e).lower()
        if any(k in err for k in ("cms", "icc", "profile", "format error")):
            found = True  # ICC invalide
```

**Correction via `_repair_icc_profiles(src, dst)`** :
- Chaque page est rendue en bitmap via pypdfium2 (libpdfium décode JPEG2000 nativement)
- Les bitmaps RGB sont réencodés en JPEG et empilés en PDF multi-pages
- Résultat : `cleaned.pdf` — PDF image (sans couche texte) mais toutes images visibles
- Durée : ~0.05s/page, mis en cache

---

## 4. Backend — API REST

Tous les endpoints sont dans `main.py`. Base URL : `http://localhost:8000`.

### Endpoints principaux

```
POST /process                       Upload PDF → lance extraction (background)
GET  /doc/{id}/status               Poll l'état (processing / ready / failed)
GET  /doc/{id}/outline              Arbre des sections JSON
GET  /doc/{id}/pdf                  PDF (source ou cleaned.pdf selon le cas)
GET  /doc/{id}/html                 HTML riche Docling (pour le Reader)
GET  /doc/{id}/figure/{fig_id}      Image PNG d'une figure
GET  /doc/{id}/raw                  result.json complet
GET  /doc/{id}/markdown             Export .md
POST /doc/{id}/reprocess            Invalide le cache et relance le pipeline
DELETE /doc/{id}                    Supprime tout le cache
```

### Endpoints avancés

```
GET  /doc/{id}/searchable-pdf       PDF + couche texte OCR (OCRmyPDF + Tesseract)
POST /doc/{id}/ocr-image/{fig_id}   OCR direct sur image de figure (pytesseract)
POST /doc/{id}/latex-ocr            Relance pix2tex sur les figures du document
GET  /doc/{id}/benchmark            Benchmark des outils d'extraction
GET  /tesseract/status              Disponibilité Tesseract (langues, version)
```

### Traitement asynchrone

`POST /process` répond immédiatement (`{status: "processing"}`) et lance le pipeline dans un thread background (`BackgroundTasks`). Le frontend poll `GET /doc/{id}/status` toutes les 1.5s jusqu'à `{status: "ready"}`.

```python
active_tasks: dict[str, dict]  # partagé entre threads, protégé par threading.Lock()
```

Si le pipeline réussit → `result.json` écrit.  
Si le pipeline échoue → `error.json` écrit avec le message d'erreur.

---

## 5. Cache et persistance

### Identifiant document

```python
doc_id = SHA256(pdf_bytes)[:16]  # 16 chars hex, 64 bits d'entropie
```

Avantage clé : **idempotent**. Re-uploader le même fichier retourne le cache immédiatement.

### Structure du cache

```
backend/cache/{doc_id}/
├── source.pdf         ← Original uploadé (jamais modifié)
├── result.json        ← Données extraites (outline, figures, tables)
├── result.html        ← HTML Docling (images base64 embedded)
├── result.md          ← Export Markdown
├── cleaned.pdf        ← Généré si JPEG2000 ou ICC invalide
├── searchable.pdf     ← Généré si OCRmyPDF demandé
└── figures/
    ├── f_0.png
    └── …
```

Pas de base de données. La liste des documents récents est stockée en `localStorage` côté frontend.

### `result.json` — structure complète

```json
{
  "doc_id": "a3f2c1b8e9d04512",
  "filename": "rapport.pdf",
  "extraction_mode": "fast",      // "fast" | "docling"
  "pages": [{ "number": 1, "width": 595.3, "height": 841.9 }],
  "outline": [
    {
      "id": "s_0", "level": 1, "title": "Introduction",
      "page": 1, "bbox": [72, 100, 523, 130],
      "children": [
        { "id": "s_1", "level": 2, "title": "1.1 Contexte", … }
      ]
    }
  ],
  "figures": [
    { "id": "f_0", "page": 3, "bbox": […], "caption": "Figure 1…", "latex": "" }
  ],
  "tables": [
    { "id": "t_0", "page": 5, "bbox": […], "caption": "Tableau 1",
      "html": "<table>…</table>", "n_rows": 4, "n_cols": 3 }
  ],
  "tesseract_available": true
}
```

---

## 6. Frontend — Architecture

### 6.1 Shell principal App.tsx

`App.tsx` est le point d'entrée React. Il orchestre tout :

**State principal :**
```typescript
doc          : DocResult | null    // données extraites du PDF
viewMode     : "pdf" | "reader" | "compare"
activeTab    : "outline" | "gallery" | "tables"
currentPage  : number              // page courante dans le viewer
selectedSection : string | null    // id section courante
processing   : { progress, message } | null
```

**Refs (handles vers composants enfants) :**
```typescript
viewerRef : PdfViewerHandle   // expose scrollToPage(n)
readerRef : ReaderHandle      // expose scrollToSection(title)
```

Ces refs permettent à `App.tsx` de commander la navigation dans les deux panneaux simultanément (mode Comparer).

**Cycle de vie upload :**
```
1. Utilisateur drop/sélectionne un PDF
2. POST /process → {status: "processing", doc_id}
3. setInterval(1500ms) → GET /doc/{id}/status
4. Affichage LoadingDocling (progress 0→100, étapes animées)
5. Status "ready" → GET /doc/{id}/raw → setDoc(result)
```

---

### 6.2 PDF Viewer

Utilise `react-pdf` (wrapper React de PDF.js).

**Worker PDF.js** chargé depuis CDN (pas via Vite `?url` qui casse le MIME type) :
```typescript
pdfjs.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@X.Y.Z/build/pdf.worker.min.mjs";
```

**Synchronisation scroll ↔ outline :**
- `IntersectionObserver` sur chaque page → détecte la page visible → highlight sidebar
- Clic outline → `viewerRef.current.scrollToPage(n)` → scroll vers la page

**Marqueurs de figures :**
- Overlay `<button>` positionnés en CSS `%` sur chaque page
- Coordonnées bbox converties depuis points PDF vers pourcentages via `src/bbox.ts`

---

### 6.3 Reader (mode livre)

Le Reader prend le HTML Docling brut (`GET /doc/{id}/html`) et le transforme en expérience de lecture interactive.

#### `sectionizeHtml(html, outline)` — le cœur du Reader

Cette fonction découpe le HTML en sections correspondant à l'outline backend :

```
HTML Docling brut
  ↓ DOMParser
  ↓ processNode() — parcourt <body> enfant par enfant
  ↓ Si <h1-h4> dont le texte normalisé ∈ outlineTitles → NOUVELLE section
  ↓ Sinon → ajouté à la section courante
  → Section[] (tableaux de {title, htmlContent, outlineId})
```

**Règles de découpage :**
1. `outlineTitles` = Set des titres de l'outline backend, normalisés (lowercase + collapse whitespace). Seuls ces titres créent une section (FIX-006).
2. `LEAF_DIV_CLASSES` = classes dans lesquelles on ne récurse pas : `["formula-not-decoded", "formula", "table-wrap", "fig-wrap", …]` (FIX-005).
3. `isPageHeaderFooter()` filtre les numéros de page et paragraphes courts en italique (FIX-007).
4. Post-pass logos : suppression des `<figure>` base64 < 30 kB sans légende.

**Focus mode :**
L'utilisateur voit une section à la fois. Navigation `[← Précédente]` / `[Suivante →]`. Clic sidebar → `scrollToSection(title)` → `useImperativeHandle` → `setCurrentSectionIndex`.

**KaTeX :** appliqué à chaque changement de section (`useEffect([currentSection])`).

---

### 6.4 Mode Comparer

PDF viewer (gauche, 50%) + Reader (droite, 50%), synchronisés :

```typescript
// Clic outline → les deux panneaux naviguent (FIX-009)
if (viewMode === "compare") {
  if (node.page != null) viewerRef.current?.scrollToPage(node.page);
  readerRef.current?.scrollToSection(node.title);
}
```

La synchronisation fonctionne via les `forwardRef` handles — `MarkdownReader` expose `scrollToSection` (FIX-008) et `PdfViewer` expose `scrollToPage`.

---

## 7. Flux de données complet

Voici le trajet d'un PDF du début à la fin :

```
[Utilisateur sélectionne "rapport.pdf"]
         │
         ▼
[POST /process]
  ├─ hash(bytes) → doc_id = "a3f2c1b8"
  ├─ result.json existe ? → retour cache immédiat
  └─ Non → source.pdf écrit → background thread

[Background thread — pipeline.py]
  ├─ has_native_text() → natif (pypdfium2) ou scanné (Docling)
  │
  ├─ NATIF :
  │   ├─ _toc_vers_outline() → outline hiérarchique
  │   ├─ Compléter annexes manquantes du TOC
  │   └─ Extraire texte page par page
  │
  └─ DOCLING (par tranches de 10 pages) :
      ├─ convert() → doc Docling
      ├─ pix2tex sur formula-not-decoded
      ├─ export_to_html(EMBEDDED) → all_html_parts
      ├─ _extraire_figures_doc() → figures/f_N.png (filtre < 50×50px)
      └─ _extraire_tables_doc() → tables HTML

  ├─ Post-traitement HTML :
  │   ├─ _extract_body()
  │   ├─ _clean_html_spaces()
  │   ├─ _fix_formula_html()        ← patch classes formules
  │   └─ _strip_page_headers_footers()
  │
  └─ Écriture cache :
      ├─ result.json   (outline + figures + tables + pages)
      ├─ result.html   (HTML Docling traité)
      └─ result.md     (export Markdown)

[Frontend poll /doc/{id}/status]
  ├─ processing → affiche LoadingDocling (progress bar)
  └─ ready → GET /doc/{id}/raw → setDoc(result)

[Affichage]
  ├─ Sidebar : arbre Sommaire depuis result.outline
  ├─ Onglet Galerie : thumbnails depuis result.figures
  ├─ Onglet Tables : HTML depuis result.tables
  │
  ├─ Mode PDF : GET /doc/{id}/pdf
  │   ├─ Si JPEG2000/ICC → cleaned.pdf (rastérisé)
  │   └─ Sinon → source.pdf
  │
  └─ Mode Reader : GET /doc/{id}/html
      ├─ sectionizeHtml() → Section[]
      ├─ Affiche section courante
      └─ KaTeX auto-render → formules rendues
```

---

## 8. Invariants critiques

Ces comportements NE DOIVENT PAS être régressés. Vérifier le snippet de code correspondant avant toute modification.

| FIX | Fichier | Invariant |
|-----|---------|-----------|
| **FIX-001** | `main.py` | `_needs_rasterize()` détecte JPEG2000 ET ICC invalide → `cleaned.pdf` |
| **FIX-002** | `pipeline.py` | `_ANNEX_PREFIX` reconnaît Attachment/Appendix/Annex/Exhibit comme sections |
| **FIX-003** | `pipeline.py` | Annexes absentes du TOC → scan texte complémentaire |
| **FIX-004** | `pipeline.py` | `_strip_page_headers_footers()` supprime numéros de page et italiques répétitifs |
| **FIX-005** | `MarkdownReader.tsx` | `LEAF_DIV_CLASSES` empêche la récursion dans les formules |
| **FIX-006** | `MarkdownReader.tsx` | Seuls les headings ∈ `outlineTitles` créent une section |
| **FIX-007** | `MarkdownReader.tsx` | `isPageHeaderFooter()` + suppression logos sans légende |
| **FIX-008** | `MarkdownReader.tsx` | `forwardRef<ReaderHandle>` exposant `scrollToSection` |
| **FIX-009** | `App.tsx` | Mode compare → navigate viewer ET reader |
| **FIX-010** | `App.tsx` | `handleSelect` utilise `viewMode`, jamais `effectiveViewMode` |

Détail complet avec snippets → `memory/fixes-registry.md`.

---

## 9. Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `FORMULA_ENRICHMENT` | `0` | `1` → active CodeFormulaV2 dans Docling (télécharge ~1-2 GB HF) |
| `PIX2TEX_FALLBACK` | `1` | `0` → désactive pix2tex même si installé |
| `TESSERACT_CMD` | auto | Chemin binaire tesseract (ex: `C:\…\tesseract.exe`) |
| `TESSDATA_PREFIX` | auto | Répertoire des données de langue Tesseract |

---

## 10. Lancer le projet

### Backend

```bash
cd backend
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/Mac

uvicorn main:app --reload --reload-exclude .venv
# API disponible : http://localhost:8000
# Docs interactives : http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install                     # première fois seulement
npm run dev
# → http://localhost:5173
```

### Activer les formules (optionnel)

```bash
# Option A : CodeFormulaV2 (Docling built-in, ~1-2 GB download)
set FORMULA_ENRICHMENT=1        # Windows
export FORMULA_ENRICHMENT=1     # Linux/Mac

# Option B : pix2tex (doit être installé)
pip install pix2tex              # ~400 MB modèle ViT
# PIX2TEX_FALLBACK=1 par défaut
```

### Activer l'OCR couche texte (optionnel)

```bash
# Installer Tesseract (Windows via scoop)
scoop install tesseract
scoop install tesseract-languages  # données langue eng + fra
pip install ocrmypdf
```

---

*Document généré le 2026-05-21. Mettre à jour via `memory/LOG.md` après chaque changement significatif.*
