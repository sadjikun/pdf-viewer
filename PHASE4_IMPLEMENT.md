# PHASE 4 — Implementation reelle

> Etat reel des epics Phase 4 implementes. Ce qui a ete code (pas la spec).

**Statut Phase 4** : TERMINEE (2026-05-20)
**Spec de reference** : [`SPEC.md`](./SPEC.md)

---

## Ce qui a ete livre

### 4.2 Recherche dans le PDF (V0) — 2026-05-05

**`frontend/src/components/Search/SearchBar.tsx`** : input avec bouton clear, emet `onSearch(query)`.

**`frontend/src/components/Viewer/Viewer.tsx`** : prop `searchQuery` transmise a `customTextRenderer` de react-pdf. Helper `makeTextRenderer(query)` wrap les matches dans `<mark class="search-hit">`. Recherche insensible a la casse.

Limitation V0 : pas de compteur de resultats, pas de navigation prev/next.

### 4.3 Export Markdown — 2026-05-05

**`backend/pipeline.py`** : `doc.export_to_markdown()` appele en fin de `convertir_pdf`, ecrit `result.md` dans le cache. Try/except pour ne pas bloquer le pipeline principal.

**`backend/main.py`** : endpoint `GET /doc/{id}/markdown` avec lazy regen via `_converter().convert()` pour les docs legacy (caches avant l'ajout de l'export).

**`frontend/src/App.tsx`** : bouton `.md` dans la sidebar, telecharge via `markdownUrl(docId)`.

### 4.7 Documentation utilisateur — 2026-05-05

**`README.md`** : sections Quick Start, Stack, Prerequis, Utilisation, Raccourcis clavier, Mobile, Structure repo, Endpoints API, Limitations.

**`backend/requirements.txt`** : `pip freeze` complet (106 packages figes).

**`.gitignore`** : Python, Node, cache, samples, OS, IDE, secrets, doc interne.

### 4.8 Compatibilite Windows — 2026-05-18

Issu d'un rapport d'installation Windows detaille (Windows 11, Python 3.14, Node 22).

**`backend/requirements.txt`** : `uvloop==0.22.1; sys_platform != 'win32'` — conditionne a Linux/macOS, debloque `pip install` sur Windows.

**`backend/main.py`** : `encoding='utf-8'` explicite sur les 4 `open()` JSON — corrige `UnicodeEncodeError` cp1252 sur Windows.

**`README.md`** : section Windows ajoutee — `py -3.13`, `.venv\Scripts\activate`, pre-telechargement modeles Docling, contournement IPv6/Hugging Face (monkey-patch `socket.getaddrinfo`).

### 4.9 Performance pipeline — 2026-05-19

**Batch processing** (`backend/pipeline.py`) :
- `_count_pages()` via pypdfium2 pour compter les pages sans charger Docling
- `_extract_pages_pdf()` decoupe le PDF en tranches via pypdfium2
- `_convertir_batch()` traite chaque tranche de `BATCH_SIZE` pages (defaut 30) independamment puis fusionne pages/figures/sections avec correction des offsets
- Seuil configurable via `PDF_BATCH_THRESHOLD` (defaut 50) et `PDF_BATCH_SIZE` (defaut 30)
- `images_scale` reduit a 1.0 en mode batch pour economiser la RAM
- Refactoring : extraction pages/figures/sections separee en helpers (`_extraire_pages`, `_extraire_figures`, `_extraire_sections`, `_construire_arbre`)

**Auto-detection PDF natif** (`backend/pipeline.py`) :
- `_is_native_pdf()` : extrait le texte des 3 premieres pages via pypdfium2. Si > 50 chars de texte → PDF natif → `do_ocr=False`
- Gain mesure sur paper arxiv 12p : 25s → 16.7s (1er appel) → 8.5s (suivants)

**Singleton converter** (`backend/pipeline.py`) :
- `_converter_cache` : dict `(batch_mode, do_ocr) → DocumentConverter`
- Evite le rechargement des modeles PyTorch a chaque requete
- Gain mesure : ~50% au 2e PDF et suivants

**Filtres faux positifs outline** (`backend/pipeline.py`, TD-007) :
- `_est_faux_positif()` : filtre titres < 3 chars, > 120 chars, doublons par titre normalise
- `_CHAPTER_PREFIX` : regex `chapter\s+(\d+)` assigne niveau 1
- `seen_titles` partage entre batches pour deduplication cross-tranches
- Teste sur 6 docs caches : -34 parasites livre 190p, -6 doublons paper 26p, 0 faux negatif paper 12p

---

## Decisions techniques

| Decision | Raison |
|---|---|
| Batch processing sequentiel (pas parallele) | Objectif = reduire RAM, pas accelerer. Paralleliser multiplierait la RAM. |
| Seuil batch 50 pages | En dessous, single-pass plus efficace. Au-dessus, risque de `std::bad_alloc`. |
| Detection native via pypdfium2 (pas Docling) | pypdfium2 deja dans les deps, extraction texte instantanee. |
| Filtres outline conservateurs (min/max length + dedup) | Mieux vaut garder des faux positifs que filtrer des vrais titres ("Abstract", "Foreword"). |
| Pas d'extraction legere pypdfium2 pour natifs | Perdrait la detection figures, SectionHeader, export MD structure — la valeur du produit. |

---

### 4.2 Recherche V1 — 2026-05-19

**`frontend/src/components/Search/SearchBar.tsx`** : refonte complete. Compteur N/M, boutons ▲/▼ prev/next, Enter/Shift+Enter pour naviguer, Escape efface. Cmd+F / Ctrl+F focus le champ via `useEffect` global keydown.

**`frontend/src/components/Viewer/Viewer.tsx`** : `data-match-index` sur chaque `<mark>`, `scrollToMatch(index)` via imperative handle, match actif en orange via CSS class toggle (`search-hit-active`), pas de re-render des pages.

**`frontend/src/App.tsx`** : gestion `matchIndex`/`matchTotal`, `onMatchCountChange` callback, prev/next cyclent avec modulo.

### 4.1 Tables structurees — 2026-05-20

**`backend/pipeline.py`** : `_extraire_tables(doc, page_offset, table_offset)` extrait HTML via `table.export_to_html(doc)`, page, bbox, caption. Integre dans `_convertir_simple` et `_convertir_batch` (avec `table_counter` cross-batches).

**`frontend/src/types.ts`** : type `TableItem` (id, page, bbox, caption, html). `DocResult` enrichi avec `tables` et `n_tables`.

**`frontend/src/components/Tables/Tables.tsx`** : composant avec cards HTML rendues via `dangerouslySetInnerHTML`, header avec caption + bouton "p.N" pour aller a la page. Etat vide si 0 tables.

**`frontend/src/App.tsx`** : 3e onglet "Tables" dans la sidebar (Sommaire/Galerie/Tables). Compteur tables dans le meta.

### 4.6 Tests unitaires backend (pytest) — 2026-05-20

**`backend/tests/test_pipeline.py`** : 35 tests au total.
- `TestLevelDepuisTitre` (7) : numerotation decimale, Chapter X, cas sans numero
- `TestEstFauxPositif` (6) : min/max length, dedup, case insensitive
- `TestCountPages` (2), `TestIsNativePdf` (2), `TestExtractPagesPdf` (1) : helpers pypdfium2
- `TestConvertirArxiv` (14) : snapshot end-to-end arxiv 12p (pages, figures, outline, tables, markdown, PNGs)
- `TestConvertirHSE` (3) : snapshot HSE 1p

Skip automatique si PDFs samples absents. Temps total ~75s (dominé par Docling).

### 4.4 Mode sombre/clair toggle — 2026-05-20

**`frontend/src/index.css`** : variables CSS `:root` (dark) et `[data-theme="light"]` (light). 14 variables : `--bg`, `--fg`, `--sidebar-bg`, `--viewer-bg`, `--card`, `--border`, `--row-hover`, `--muted`, `--accent`, etc.

**`frontend/src/App.tsx`** : hook `useTheme()` avec state persiste en `localStorage` (`pdf-viewer:theme`), `data-theme` sur `<html>`. Bouton toggle dans le header (page accueil) et dans la sidebar (page document).

### 4.5 Code-splitting (TD-008) — 2026-05-20

**`frontend/src/App.tsx`** : `React.lazy()` sur `Viewer`, wrappé dans `<Suspense>`. Le chunk principal passe de 627 kB a 206 kB. Le Viewer (423 kB avec react-pdf + pdfjs) est charge uniquement au 1er document.

Resultat build :
- `index.js` : 206 kB (app shell, sidebar, upload)
- `Viewer.js` : 423 kB (react-pdf, pdfjs, lazy)
- Plus de warning Vite "chunks > 500 kB"
