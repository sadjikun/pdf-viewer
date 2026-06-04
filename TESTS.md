# pdf-viewer — Registre des tests

> Liste des tests, statuts, couverture par phase.

**Derniere MAJ** : 2026-06-04 (Phase 6 develop : Windows installer/launcher, cleanup/thumbnail/reprocess, bibliotheque register, audit 5 bugs — 63 tests backend + 12 launcher)

---

## Legende statuts

- `A ECRIRE` | `ECRIT` | `PASSE` | `ECHEC` | `IGNORE`

---

## Phase 0 — Cadrage et scaffolding

Pas de test automatise. Verification :
- `pip show docling` retourne version 2.92 — **PASSE** (2026-05-04)
- `node --version` >= 20 — **PASSE** (v20.19.2, 2026-05-04)
- Structure `~/Others/pdf-viewer/{backend, frontend, samples}` creee — **PASSE** (2026-05-04)

---

## Phase 1 — POC backend

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T1.1 | Smoke | `pipeline.convertir_pdf` sur `samples/2510.04871v1.pdf` retourne `n_pages=12, n_figures=2, outline=33 sections` | **PASSE** (2026-05-04) |
| T1.2 | Smoke | Figures extraites comme PNG (335×689 et autres) dans `<out_dir>/figures/` | **PASSE** (2026-05-04) |
| T1.3 | Manuel | `uvicorn main:app` demarre sans erreur, GET `/` retourne `{"status":"ok"}` | **PASSE** (2026-05-04) |
| T1.4 | Manuel | POST `/process` avec un PDF retourne `result.json` valide | **PASSE** (2026-05-04, HTTP 200 24s) |
| T1.5 | Manuel | Cache : 2e POST avec meme PDF ne re-traite pas (~10ms vs ~24s) | **PASSE** (2026-05-04) |
| T1.6 | Manuel | GET `/doc/{id}/figure/f_0` retourne PNG correct (335×689) | **PASSE** (2026-05-04) |
| T1.7 | Hierarchie | Parser unitaire `_level_depuis_titre` : 8 cas (`1.`, `2.1.`, `2.1.3`, `Abstract`, `A.1`, etc.) | **PASSE** (2026-05-04) |
| T1.8 | Hierarchie | End-to-end arxiv 2510 : `2.1.` est enfant de `2.` dans l'arbre outline | **PASSE** (2026-05-04) |
| T1.9 | Validation | POST `/process` fichier non-PDF (extension) → 400 | **PASSE** (2026-05-04) |
| T1.10 | Validation | POST `/process` fichier vide → 400 "Fichier vide" | **PASSE** (2026-05-04) |
| T1.11 | Validation | POST `/process` fichier sans entete `%PDF` → 400 | **PASSE** (2026-05-04) |
| T1.12 | Validation | POST `/process` fichier de 101 Mo → 413 "trop volumineux" | **PASSE** (2026-05-04) |
| T1.13 | Validation | POST `/process` PDF entete OK mais corrompu → 422 + cache nettoye | **PASSE** (2026-05-04) |
| T1.14 | Variete | DA_0003_HSE_REV.pdf (FR, 1 page) → 0 sections, 1 figure, pas de crash | **PASSE** (2026-05-04) |
| T1.15 | Variete | CV WALY (FR, 1 page) → 8 sections flat, 1 figure | **PASSE** (2026-05-04) |
| T1.16 | Variete | DMT demission (FR, 2 pages) → 10 sections (incl. faux positifs Docling, voir TD-007) | **PASSE** (2026-05-04) |
| T1.17 | Variete | arxiv 2509.25140 (EN, 26 pages) → 57 sections, 14 figures, hierarchie depth 2 | **PASSE** (2026-05-04, ~80s) |

---

## Phase 2 — POC frontend

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T2.1 | Build | `npm run build` (tsc -b + vite build) passe sans erreur TS | **PASSE** (2026-05-05) |
| T2.2 | Lint | `npm run lint` (eslint) passe sans warning | **PASSE** (2026-05-05) |
| T2.3 | Manuel | Drop d'un PDF → spinner `<LoadingDocling>` → render PDF + outline | **PASSE** (2026-05-05, validation user) |
| T2.4 | Manuel | Outline cliquable, expand/collapse par node fonctionne | **PASSE** (2026-05-05, validation user) |
| T2.5 | Manuel | Clic sur entree outline → scroll viewer vers la bonne page | **PASSE** (2026-05-05, validation user) |
| T2.6 | Manuel | Erreur backend (e.g. fichier non-PDF) → message clair `[400] ...`, pas de crash | **PASSE** (2026-05-05) |
| T2.7 | Manuel | Persistance localStorage : refresh → doc restore depuis cache backend instantanement | **PASSE** (2026-05-05) |
| T2.8 | Manuel | Cache backend purge → restore tombe en 404 → fallback UploadZone propre | **PASSE** (2026-05-05) |
| T2.9 | Bug | Mismatch versions pdfjs (5.4.296 vs 5.6.205) → fix via `--save-exact` | **RESOLU** (2026-05-05) |

---

## Phase 3 — Sync bidirectionnelle + figures

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T3.1 | Manuel | Scroll viewer → highlight de la section courante dans l'outline + auto-scroll sidebar | **PASSE** (2026-05-05, validation user) |
| T3.2 | Manuel | Clic figure (galerie ou marker) → overlay HD avec caption + bouton "Aller à la page" | **PASSE** (2026-05-05, validation user) |
| T3.3 | Manuel | Markers figures positionnes au bon endroit (bbox BOTTOMLEFT → CSS %) | A VALIDER VISUELLEMENT (verification empirique faite, validation finale a faire avec un PDF reel) |
| T3.4 | Manuel | Navigation clavier : ↑/↓ outline, ←/→ overlay, Escape ferme overlay | **PASSE** (2026-05-05) |
| T3.5 | Manuel | Galerie : grille de figures cliquables, caption tronque, etat vide si 0 figures | **PASSE** (2026-05-05, validation user) |
| T3.6 | Manuel | Tabs Sommaire/Galerie dans la sidebar | **PASSE** (2026-05-05) |
| T3.7 | Manuel | Mobile (< 768px) : drawer sidebar, hamburger, backdrop, auto-fermeture apres clic | A VALIDER VISUELLEMENT |
| T3.8 | Manuel | Largeur page dynamique (ResizeObserver) sur resize fenetre | A VALIDER VISUELLEMENT |
| T3.9 | Build | `npm run build` + `npm run lint` propres apres Phase 3 | **PASSE** (2026-05-05) |

---

## Phase 4 — Polish

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T4.1 | Manuel | Search bar : tape un mot → highlight jaune sur les matches dans le viewer (TextLayer) | A VALIDER UTILISATEUR |
| T4.2 | Manuel | Export MD : nouveau PDF processed → `result.md` cree dans `cache/<id>/`, bouton `.md` telecharge | A VALIDER UTILISATEUR |
| T4.3 | Manuel | Export MD legacy : doc deja en cache sans `result.md` → endpoint regenere via Docling depuis `source.pdf` | A VALIDER UTILISATEUR |
| T4.4 | Build | `npm run build` + `npm run lint` propres apres ajout SearchBar + bouton MD | **PASSE** (2026-05-05) |
| T4.5 | Manuel | README : `pip install -r requirements.txt` reproduit l'env backend depuis zero | A VALIDER UTILISATEUR |
| T4.6 | Manuel | Windows : `uvloop` conditionne `sys_platform != 'win32'`, install OK sur Windows 11 | **PASSE** (2026-05-18, rapport externe) |
| T4.7 | Manuel | Windows : `encoding='utf-8'` sur `open()` JSON, pas de `UnicodeEncodeError` cp1252 | **PASSE** (2026-05-18, rapport externe) |
| T4.8 | Auto | `_count_pages` + `_extract_pages_pdf` sur arxiv 12p : 5 pages extraites, taille correcte | **PASSE** (2026-05-19) |
| T4.9 | Auto | Batch path (seuil=5, taille=4) sur arxiv 12p : 12 pages, 2 figures, 15 sections, pages 1-12 | **PASSE** (2026-05-19) |
| T4.10 | Auto | Simple path refactore sur arxiv 12p : meme resultat qu'avant refactoring | **PASSE** (2026-05-19) |
| T4.11 | Auto | `_is_native_pdf` sur arxiv 12p → True (texte extractible) | **PASSE** (2026-05-19) |
| T4.12 | Auto | Singleton converter : 2e appel reutilise le cache, ~50% plus rapide | **PASSE** (2026-05-19, 16.7s → 8.5s) |
| T4.13 | Auto | Filtres outline : -34 parasites livre 190p, -6 doublons paper 26p, 0 faux negatif paper 12p | **PASSE** (2026-05-19) |
| T4.14 | Manuel | Recherche V1 : compteur N/M, nav prev/next, Cmd+F focus, match actif orange | **PASSE** (2026-05-19, validation user) |
| T4.15 | Auto | pytest 35 tests (unitaires + snapshots) : 35/35 passed | **PASSE** (2026-05-20) |
| T4.16 | Auto | Snapshot tables arxiv : n_tables=5, HTML non vide, pages 1-12 | **PASSE** (2026-05-20) |
| T4.17 | Manuel | Onglet Tables sidebar : 5 tables avec HTML rendu, bouton "p.N" scroll | **PASSE** (2026-05-20) |
| T4.18 | Manuel | Toggle theme dark/light : variables CSS switchent, persiste en localStorage | **PASSE** (2026-05-20) |
| T4.19 | Build | Code-splitting : chunk principal 627→206 kB, plus de warning Vite | **PASSE** (2026-05-20) |
| T4.20 | Build | `npm run build` + `npm run lint` propres apres 4.1/4.4/4.5 | **PASSE** (2026-05-20) |

---

## Phase 5 — Integration des features v2 (PR #5 decomposee)

> Strategie : verifications structurelles systematiques sans navigateur ni modeles ML lourds. Backend teste via TestClient ; Docling teste end-to-end en mode offline grace aux modeles deja en cache local.

### Backend — TestClient

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T5.1 | Async | `/process` PDF-only valide (.txt → 400, fichier vide → 400, mauvais magic → 400) ; flow `processing → ready` ; cache hit synchrone ; chemin d'erreur → `failed` avec `error.json` ecrit et `active_tasks` vide | **PASSE** (2026-05-29, pipeline mocke) |
| T5.2 | OCR | `/tesseract/status` 200 ; `/ocr-image/{fig_id}` valide regex (400 sur `notvalid`/`f_`/`F_0`/`f_0abc`, 503 sur `f_12` si Tesseract absent) ; path traversal `..%2F..%2F` → 404 (route ne match pas) ; `/searchable-pdf`/`/latex-ocr` 404 sur doc inconnu | **PASSE** (2026-05-29) |
| T5.3 | Library | `/library` retourne `documents` (depuis result.json scannes), `processing` (depuis `active_tasks`), `failed` (depuis error.json) ; titre derive du `filename`, `cover_figure_id`, `n_pages/figures/tables/sections` ; `DELETE /doc/{id}` retire l'entree | **PASSE** (2026-05-29) |
| T5.4 | Multiformat | `.docx` accepte (rejette `.zip` en 400) ; `source.docx` enregistree ; flux `processing → ready` ; `extraction_mode=markitdown` ; outline hierarchique correct depuis les `#` ; `/markdown` rend le contenu ; `/library` affiche `file_type: docx` (vrai .docx genere via `python-docx`) | **PASSE** (2026-05-29) |
| T5.5 | HTML helpers | `_write_html_artifacts` produit `html_manifest.json` correct (`[{start,end,file}]`), `html_part_*.html` avec marqueur `<div class="pdf-page-sep" data-page>`, `result.html == part1` | **PASSE** (2026-05-29, isolation) |
| T5.6 | HTML endpoints (sans artefacts) | `/html`, `/html-manifest` → 404 ; `/html-part/abc` → 422 (validation `int` → pas de path traversal) ; `/html-part/1` → 404 | **PASSE** (2026-05-29) |
| T5.7 | Florence | `/caption-figures` 404 (doc inconnu), 400 (doc_id invalide), 503 si modele Florence-2 absent ; helpers `init_florence` / `caption_figure` callables | **PASSE** (2026-05-29, modele non en cache) |
| T5.8 | Texify | `_resolve_engine()` → `none` quand aucun moteur installe ; `/latex-ocr` → 503 « Aucun moteur LaTeX-OCR » ; `FORMULA_ENGINE=auto` par defaut | **PASSE** (2026-05-29) |

### Backend — Docling offline (modeles en cache local)

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T5.9 | E2E HTML export | `convertir_pdf` sur 2 pages de `samples/2510.04871v1.pdf` (arxiv natif, `do_ocr=False`) avec `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` + proxies unset → `n_pages=2`, `n_figures=1`, `result.html`, `html_manifest.json` (1 entree), `html_part_0001.html` (105 KB) avec marqueur `pdf-page-sep`, balises HTML, images base64 inline (`data:image`), titre du paper rendu | **PASSE** (2026-05-29) |
| T5.10 | E2E API HTML | Apres T5.9 : `/html-manifest` 200 (JSON correct), `/html-part/1` 200 (text/html, contient `<h>`), `/html` 200 (105 KB) | **PASSE** (2026-05-29) |

### Cas non testables ici (a valider en local)

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T5.11 | ML | Florence-2 reel (`POST /caption-figures` → caption_ai genere) | **NON TESTE** (modele ~450 Mo non en cache, TD-021) |
| T5.12 | ML | Texify reel (`POST /latex-ocr` avec `FORMULA_ENGINE=texify`) | **NON TESTE** (modele ~500 Mo non en cache, TD-021) |
| T5.13 | ML | pix2tex (`/latex-ocr` avec `FORMULA_ENGINE=pix2tex`) | **NON TESTE** (deps non installees, TD-021) |
| T5.14 | OCR | Tesseract `/searchable-pdf`/`/ocr-image` reels | **NON TESTE** (Tesseract absent du systeme, TD-021) |
| T5.15 | Visuel | Compare view (drag du diviseur, sync scroll Reader→PDF, clic sommaire → les deux) | **NON TESTE** (navigateur indispo, TD-022) |
| T5.16 | Visuel | 10 themes : lisibilite/contraste sur composants existants (Viewer/Outline/Gallery/Tables/Library) | **NON TESTE** (TD-022) |
| T5.17 | Visuel | Reader markdown rendu (KaTeX, coloration syntax, GFM tables) ; fallback markdown quand `/html-manifest` 404 | **NON TESTE** (TD-022) |
| T5.18 | Visuel | Library : grille de cartes, vignettes de couverture, recherche/tri/filtre, rails « En cours »/« Erreurs » | **NON TESTE** (TD-022) |
| T5.19 | Visuel | Bouton « Legender (IA) » dans Gallery → caption_ai affiche avec badge IA | **NON TESTE** (TD-021+022) |

### Build / lint / typecheck

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T5.20 | Build | `tsc -b` + `eslint` + `vite build` verts apres chaque PR frontend (#9/#10/#11/#12/#14/#15/#16) | **PASSE** (2026-05-29/30) |
| T5.21 | Build | `vite build` du main integre final : 76 modules, `MarkdownReader` code-splitte (~195 kB gz), CSS 36 kB | **PASSE** (2026-05-30) |
| T5.22 | Compile | `py_compile` + `import main` apres chaque PR backend (#6/#7/#11/#13/#16/#17) et apres rebase #6 | **PASSE** (2026-05-29/30) |
| T5.23 | Pytest | `pytest --collect-only` post-#18 → 39 tests collectes (inchange vs pre-Phase 5 ; les scripts debug `benchmark/debug_outline/print_*.py` ne sont pas collectes car non prefixes `test_`) | **PASSE** (2026-05-30) |
| T5.24 | Routes | 21 endpoints sur main integre (vs 8 avant Phase 5) — tous presents et repondent | **PASSE** (2026-05-30) |

### Complements post-Phase 5 (2026-06-01)

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T5.25 | Test frontend | `sectionizeHtml.test.ts` (156 l., vitest + jsdom) : regressions FIX-035 de-embedding. vitest installe en devDep. | **CREE** (2026-06-01, non execute ici — require `npx vitest run`) |
| T5.26 | Backend | `/annotations` GET 404 (doc inconnu), PUT shape invalide → 422, PUT > 1 Mo → 413 ; `/fiche` 404 (doc inconnu), `?format=zip` → 400 ; routes enregistrees | **PASSE** (2026-06-01, TestClient) |
| T5.27 | Backend | `delete_doc` refuse 409 si doc en cours de traitement (pipeline bg actif) ; `get_outline`/`get_raw` retournent 422 sur JSON corrompu | **PASSE** (2026-06-01, TestClient implicite via py_compile + import) |
| T5.28 | Build | `tsc -b` + `eslint` + `vite build` verts apres les 4 PRs (#20/#21/#22/#23) ; `py_compile` backend OK ; 22 tests pytest passent | **PASSE** (2026-06-01) |
| T5.29 | Routes | 24 endpoints sur main integre final (vs 21 avant complements) | **PASSE** (2026-06-01) |

### Phase 6 — Branche develop (outillage Windows + bibliotheque)

> Tests sur `develop` (PRs #26→#32, pas sur main).

| ID | Type | Description | Statut |
|----|------|-------------|--------|
| T6.1 | Backend | `test_register.py` (8 tests) : `_path_doc_id` hex valide/stable/distinct, register fichier (mode registered, source_path, pas de copie, /pdf 200, re-register skipped), register dossier (txt ignore), chemin inexistant → not_found, chemin vide → 400, non-PDF → invalid_extension, preview fichier/dossier/inexistant | **PASSE** (2026-06-04) |
| T6.2 | Launcher | `tests/launcher/test_launcher_core.py` (12 tests, GUI-free) : `classify_ready_line`, `missing_prereqs` (rendu cross-platform via `_venv_python`), env file, WebView2 detect, etc. | **PASSE** (2026-06-04) |
| T6.3 | Backend E2E | thumbnail sur vrai PDF (samples) → PNG 32 Ko cache + 404 sans source ; register fichier → mode registered + /pdf depuis source_path + /thumbnail ; process (mock pipeline) → copie source.pdf + upgrade docling + filename conserve | **PASSE** (2026-06-04, Docling offline / TestClient) |
| T6.4 | Backend | cleanup (vieux supprime/recent garde/en-cours saute), reprocess (404 sans source, purge cache derive, garde source, propage force_ocr) | **PASSE** (2026-06-04, TestClient) |
| T6.5 | Concurrence | `_count_pages`/`_page_text_lengths`/`_needs_ocr` lockes (`_PDFIUM_LOCK`) sans deadlock (Docling offline) | **PASSE** (2026-06-04) |
| T6.6 | Pytest | suite backend complete : **63 tests** collectes (55 + 8 register) ; 46 passent hors reseau, 17 deselected (Docling reseau) | **PASSE** (2026-06-04) |
| T6.7 | Build | `tsc -b` + `eslint` + `vite build` verts apres #26→#30 ; `py_compile` backend OK | **PASSE** (2026-06-04) |
| T6.8 | Routes | 27 endpoints sur develop (vs 24 fin Phase 5) | **PASSE** (2026-06-04) |
| T6.9 | Visuel | Launcher pywebview (fenetre native, compilation EXE), register UI (barre, badge, bouton Analyser), thumbnails Library | **NON TESTE** (Windows/navigateur indispo → TD-030, TD-022) |
