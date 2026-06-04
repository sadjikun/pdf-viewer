# Phase 5 — Intégration des features v2 (PR #5 décomposée)

> Décomposition de la PR #5 (`feat: v2 — Tables, Reader, OCR, multi-format, 10 themes`) — branche fork MHDINGBI, ~20 000 lignes, divergée avant les PRs #1–#4 — en **12 sous-PRs ciblées, reviewables, basées sur le `main` à jour**.

**Période** : 2026-05-29 → 2026-05-30
**Tag de l'état pré-v2** : `pre-v2` (commit `c427b08`), branche `old_main` (idem)
**PRs créées** : #6, #7, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18

---

## Contexte

PR #5 (MHDINGBI) apportait : Tables extraction, Markdown/HTML Reader, OCR (Tesseract+ocrmypdf+pix2tex), multi-format upload (DOCX/PPTX/XLSX/HTML/images via MarkItDown), 10 thèmes, Compare view, Library, async processing, Florence-2 captioning, Texify LaTeX-OCR. Mais : branche divergée avant les PRs #1–#4 (perdrait hardening sécurité, search V1, batch processing…), monolithique (3232 lignes `MarkdownReader.tsx`, 991 lignes `Library.css`, 829 lignes `convertir_pdf`), failles XSS et path traversal signalées en revue.

Stratégie retenue : **port sélectif par feature, sur main à jour**, avec correctifs sécurité préemptifs et tests structurels systématiques.

---

## Epics

### 5.1 — OCR optionnel (Tesseract + pix2tex) · PR #6

- Nouveau module `backend/ocr.py` : détection Tesseract multi-OS, helpers pix2tex (sanitize LaTeX, predict sans hijack clipboard), imports paresseux → 503 si deps absents.
- Endpoints : `GET /tesseract/status`, `GET /doc/{id}/searchable-pdf` (OCRmyPDF), `POST /doc/{id}/ocr-image/{fig_id}` (pytesseract), `POST /doc/{id}/latex-ocr` (pix2tex).
- `requirements.txt` : `ocrmypdf>=17.0`, `pytesseract>=0.3.10`, `pix2tex==0.1.4`.
- **Sécurité** : `/ocr-image` réutilise le regex `^f_\d+$` (path traversal bloqué) ; `/latex-ocr` écrit `result.json` de façon atomique.
- Rebasée tardivement (conflits imports `main.py` avec le stack async).

### 5.2 — Traitement asynchrone + polling de progression · PR #7

- `active_tasks` + `tasks_lock`, `update_task_progress`, `run_pipeline_bg` (try/except + atomic write + `finally` cleanup).
- `/process` PDF-only async : cache hit → `result.json` ; sinon `{doc_id, status:"processing", progress, message}`.
- `GET /doc/{id}/status` → `ready` | `processing` | `failed` | `not_found`.
- `pipeline.py` : `progress_callback` optionnel rétrocompatible sur `convertir_pdf` / `_convertir_simple` / `_convertir_batch` (progression par tranche).
- Frontend : `getDocStatus`, `processPdf` retourne `DocResult | ProcessingResponse`, `startPolling` avec cleanup (`useEffect` + `reset` + démontage), `LoadingDocling` avec barre de progression réelle.

### 5.3 — Bibliothèque locale · PR #12 (remplace #8 fermée par auto-deletion de sa base)

- `GET /library` : `documents` (scan cache → result.json), `processing` (`active_tasks`), `failed` (`error.json`).
- `_library_item_from_result` + `_clean_title`.
- Nom de fichier original conservé dans `result.json` (sinon tous les docs s'afficheraient `source.pdf`).
- `needs_reprocess` forcé à `False` (versioning du cache hors scope).
- Frontend : composant `Library.tsx`/`.css` (~1300 l. au total) porté verbatim avec adaptation `onUpload: (file) => void` (drop `fastMode`).
- App.tsx : accueil rend `<Library>` (plus d'auto-réouverture du dernier doc), `openDocument`/`handleDeleteDocument`/`refreshLibrary`.

### 5.4 — Design-system 10 thèmes · PR #9

- `index.css` : `:root` (défaut glassmorphism) + 10 blocs `.theme-*` (glassmorphism, minimalist, technical, vintage, oled, forest, cstb, swiss, eink, hud).
- **Approche bridge** : les anciennes variables (`--bg`, `--fg`, `--accent`, `--border`, `--muted`…) remappées sur le nouveau système dans `:root` → suivent automatiquement le thème actif → **zéro modification des composants existants** (Viewer/Outline/Gallery/…).
- App.tsx : `useAppTheme` (classe `theme-<id>` sur `documentElement` + persistance), composant `ThemeSelect` remplace les 2 toggles ☀/☾.
- Library.css : suppression du `:root` provisoire ajouté en #12.

### 5.5 — Vue Lecteur Markdown/HTML + fix XSS · PR #10

- Port verbatim de `MarkdownReader.tsx` (3232 l.) + `.css` (2352 l.) + `katex-auto-render.d.ts`.
- **Fix XSS** : `sectionizeHtml` strippe désormais `style=` (vecteur `url(javascript:…)`), aligné sur `Tables.tsx`.
- **Découpage** : ~950 l. de helpers purs (parsing/sectionisation HTML, métadonnées, surlignage) extraites dans `readerHtml.ts` → `MarkdownReader.tsx` passe de 3232 à 2278 l. (vérifié par tsc).
- Sous-découpage en `ReaderSettings`/`ReaderSync` reporté (refacto à risque sans navigateur → TD-025).
- Mode initial : le Reader retombe sur `/markdown` quand `/html-manifest` est absent.
- `api.ts` : `htmlUrl`/`htmlManifestUrl`/`htmlPartUrl` + export `API_BASE`.
- App.tsx : `viewMode "pdf"|"reader"`, toggle PDF/Lecteur, états `readerTheme`/`isDark`.

### 5.6 — Upload multi-format (MarkItDown) · PR #11

- `pipeline.py` : `convertir_generic` (MarkItDown → Markdown), `_outline_from_markdown` (depuis titres `#`), `MARKITDOWN_EXTENSIONS` (`.docx .pptx .xlsx .xls .html .htm .md .txt .csv .ipynb .png .jpg .jpeg .gif .bmp .webp`).
- `main.py` : `/process` valide l'extension `{.pdf} ∪ MARKITDOWN_EXTENSIONS`, route PDF→Docling / autres→MarkItDown, `source.<ext>` ; `run_pipeline_bg` gère le flag `is_pdf`.
- `requirements.txt` : `markitdown[all]>=0.1.1` (l'extra `[all]` embarque les lecteurs docx/pptx/xlsx).
- Frontend : `UploadZone` accept élargi ; `App.tsx` détecte les docs MarkItDown (`extraction_mode` / `pages` vides) → force la vue Lecteur, masque le toggle PDF ; `types.ts` étendu (`filename`, `file_type`, `extraction_mode`).
- **Testé E2E** côté backend avec un vrai `.docx` généré via `python-docx`.

### 5.7 — Reader backend HTML pleine fidélité · PR #13

- `pipeline.py` : `_docling_html_body` (`doc.export_to_html(image_mode=EMBEDDED)` → inner `<body>`, images base64 inline), `_write_html_artifacts` (parts + manifest + marqueurs `<div class="pdf-page-sep" data-page>`), wiring dans `_convertir_simple` (1 part) et `_convertir_batch` (1 part/batch), tout en `try/except` → si l'export échoue, le Reader retombe sur `/markdown`.
- `main.py` : `GET /doc/{id}/html`, `/html-manifest`, `/html-part/{start_page}` (`start_page` typé `int` → pas de path traversal). 404 si non généré (ex. doc MarkItDown).
- Hors scope assumé : `split_page_view=True` (structure non vérifiable au moment du port → marqueur par tranche, TD-027), pix2tex figure-formulas (chevauche OCR), dé-embed images (EMBEDDED rend ça inutile).
- **Testé E2E** : Docling tourne offline (modèles en cache local) → `convertir_pdf` sur 2 pages d'un arxiv natif → `result.html` + `html_manifest.json` + `html_part_0001.html` (105 KB, avec marqueur `pdf-page-sep` + images base64 + balises HTML rendues) ; endpoints `/html-manifest`, `/html-part/1`, `/html` retournent 200 via TestClient.

### 5.8 — Vue Compare PDF + Lecteur · PR #14

- `App.tsx` : `viewMode` gagne `"compare"`, `readerRef`, `splitRatio` (0.2–0.8), `startDividerDrag` (pointer events), bouton Compare (masqué si doc MarkItDown).
- Layout split : `<Viewer>` | diviseur draggable | `<MarkdownReader compareMode>`.
- **Sync via contrat existant du Reader (sans modification)** : Reader→PDF via `onPageChange` → `viewerRef.scrollToPage` ; clic sommaire → les deux panneaux (`Viewer.scrollToPage` + `Reader.scrollToSection`). Sync PDF→Reader **différée** (exigerait d'exposer `scrollToPage` dans `ReaderHandle`, TD-026).
- App.css : `.app-compare` / `.app-compare-pane` / `.app-compare-divider`.

### 5.9 — Arbitrage Tables + dimensions · PR #15

- Décision : on garde `Tables.tsx` de main (déjà intégré, sanitisation plus stricte — strippe `style=`, mémoïsé) et on écarte `TablesPanel.tsx` de la v2 (doublon, sans strip de `style` → faille XSS).
- Bonnes idées de `TablesPanel` portées dans `Tables.tsx` : **dimensions `lignes×colonnes`** calculées côté frontend depuis le HTML (zéro changement backend), **état vide enrichi** d'un hint.

### 5.10 — Florence-2 figure captioning · PR #16

- Nouveau module `backend/captioning.py` : `init_florence` (lazy singleton, `microsoft/Florence-2-base` ~450 Mo, `trust_remote_code=True`), `caption_figure`, `_FLORENCE_LOCK`, imports paresseux → 503 si modèle absent.
- `POST /doc/{id}/caption-figures` : itère figures, légende, stocke `caption_ai` dans `result.json` (écriture atomique).
- `requirements.txt` : `einops>=0.8`, `timm>=1.0` (transformers/torch déjà présents via Docling).
- Frontend : `types.Figure.caption_ai`, `api.captionFigures`, `FigureOverlay` affiche `caption_ai` avec badge IA, `Gallery` toolbar bouton « Légender (IA) » + affichage par vignette.
- App.tsx : `handleCaptionFigures` déclenche puis re-fetch le doc (commit séparé `fix: câbler le bouton` — App.tsx avait été oublié du `git add`).

### 5.11 — Texify LaTeX-OCR moteur alternatif · PR #17

- `ocr.py` : `FORMULA_ENGINE` (env `texify | pix2tex | auto`), `init_texify` (lazy), `_texify_predict`, `_resolve_engine`, `latex_engine_available`, `_FORMULA_LOCK`.
- `latex_ocr_figure` utilise désormais le moteur résolu (Texify batch unitaire ou pix2tex image-par-image) ; portée LaTeX 3–800 chars.
- `main.py` : `/latex-ocr` renvoie 503 si **aucun** moteur dispo (au lieu de pix2tex uniquement).
- `requirements.txt` : `texify>=0.2`.
- Rebasée pour résoudre un conflit `requirements.txt` après #16.

### 5.12 — Restauration docs/tooling v2 · PR #18

- `AGENTS.md`, `GEMINI.md`, `IMPLEMENTATION.md`, `GUIDE_IMPLEMENTATION.{md,html}`, `FIXES.md`, `CHANGELOG.md`, `docs/artifacts/backlog-dashboard.html`.
- `.claude/commands/{html,ui}.md` (slash commands `/html` et `/ui` désormais actifs côté Mouhamed aussi).
- `memory/{LOG,formulas}.md` (notes agent MHDINGBI).
- `install.bat`, `start.bat`.
- `backend/{benchmark,debug_outline,print_*}.py` (scripts inertes, non collectés par pytest).
- `frontend/src/components/Reader/MarkdownReader.css.search.py` (TD-028).
- **Exclus volontairement** : `backend/test_*.py` (×5, écrits pour l'API pipeline v2 absente de main → casseraient la collection pytest, TD-023) et `TablesPanel.{tsx,css}` (arbitré en #15).

---

## Améliorations transverses (bonus sécurité/qualité)

- **XSS Reader** : `sectionizeHtml` strippe `style=` (aligné Tables, préemptif).
- **Path traversal `/ocr-image`** : `fig_id` validé via le regex `^f_\d+$` existant.
- **Écritures atomiques** : `result.json` (`run_pipeline_bg`, `/latex-ocr`, `/caption-figures`) et `error.json`, via le helper `_write_json_atomic` (tmp + `os.replace`).
- **`print()` → `logging`** dans tous les modules portés (`ocr.py`, `captioning.py`, `main.py`).
- **Modularisation** : `ocr.py`, `captioning.py`, `readerHtml.ts` (au lieu d'alourdir `pipeline.py`/`MarkdownReader.tsx`).

---

## Incidents notables et résolutions

- **PR #8 (Library) auto-fermée par GitHub** suite à `--delete-branch` de #7 (Async) — la base `feature/async-processing` de #8 a été supprimée → GitHub ferme la PR (non-rouvrable). **Recréée en PR #12** depuis la branche `feature/document-library` (intacte) → main. Apprentissage : **ne plus utiliser `--delete-branch` avant retarget** des PRs stackées.
- **PR #6 (OCR) en CONFLICT** après le merge du stack #7–#11 (imports `main.py` chevauchants). **Rebasée** sur le nouveau main, conflit `requirements.txt` résolu, force-push, mergée.
- **App.tsx du wiring Florence oublié** du `git add` du commit Florence — détecté lors du switch sur la branche Texify (changement traîné non-staged), **déplacé via `git stash` vers la branche florence**, committé, poussé (`fix: câbler le bouton de légendage`).
- **PR #17 (Texify) en CONFLICT** sur `requirements.txt` après merge #16 (les deux ajoutent après `pix2tex==0.1.4`). **Rebasée + résolue**.

---

## Snapshots

- Tag annoté `pre-v2` → `c427b08` (état de main avant l'intégration), poussé sur origin.
- Branche `old_main` → `c427b08`, poussée sur origin.

---

## Compléments post-Phase 5 (2026-05-31 → 2026-06-01)

Portage de 3 features additionnelles découvertes lors de la revisite de la branche MHDINGBI (43 nouveaux commits post-PR #5, divergence depuis 2026-05-06) + audit code complet.

### 5.13 — Hooks Reader extraits + tests sectionizeHtml · PR #20

- 5 custom hooks copiés depuis la branche MHDINGBI : `useAppearance`, `usePdfPageSync`, `useSearch`, `useTts`, `useImageLightbox`.
- `buildExportHtml.ts` (constructeur HTML pour fiche export, 531 l.).
- `sectionizeHtml.test.ts` (156 l., régressions FIX-035 de-embedding).
- `vitest` ajouté en devDep + `vitest.config.ts` (jsdom).
- Import `Section` ajusté vers `readerHtml.ts`.
- **Non câblés dans MarkdownReader.tsx** (TD-025, à faire avec navigateur).

### 5.14 — Annotations durables + fiche export · PR #21

- Backend : `GET /doc/{id}/annotations` (highlights+notes, JSON), `PUT /doc/{id}/annotations` (écriture atomique, nettoyage orphelins, limite 1 Mo), constante `_EMPTY_ANNOTATIONS`.
- Backend : `GET /doc/{id}/fiche?format=html|md` (revision sheet depuis annotations), module `backend/fiche.py` (render_html, render_markdown, groupement par section).
- Frontend : types `StoredHighlight`/`AnnotationStore`, api `getAnnotations`/`saveAnnotations`/`ficheUrl`.
- Câblage Reader (panel notes, sync serveur) différé.

### 5.15 — PWA mobile · PR #22

- `manifest.json`, `service-worker.js` (cache-first assets), icônes 192/512.
- `index.html` : link manifest, meta Apple Web App, enregistrement SW.

### 5.16 — Audit bugs/perf/robustesse · PR #23

13 corrections issues d'un audit code approfondi (2 agents parallèles backend+frontend) :

**Backend (9 corrections) :**
- `get_markdown` : fallback Docling synchrone (5-30s bloquant) supprimé → 404 propre.
- `get_searchable_pdf`, `run_latex_ocr`, `caption_figures` : convertis en `async` + `asyncio.to_thread` (ne bloquent plus les workers Uvicorn).
- `delete_doc` : refuse 409 si doc en cours de traitement (évite crash pipeline concurrent).
- `_converter_cache` : `threading.Lock` (évite double instanciation Docling ~500 Mo en concurrence).
- PIL `Image.open` → context manager `with` (3 endroits : ocr_figure_image, latex_ocr_figure, caption_figures).
- `_library_item_from_result` : mtime passé en param, glob `source.pdf` d'abord (réduit syscalls).
- `get_outline`/`get_raw` : try/except `JSONDecodeError` → 422 propre.
- `put_annotations` : limite 1 Mo (413).

**Frontend (4 corrections) :**
- Polling : `pollAbortRef` ignore les fetch en vol après `stopPolling`.
- Reader scroll : throttle via `requestAnimationFrame` (60 setState/sec → 1/frame).
- 5 handlers App.tsx wrappés dans `useCallback`.
- Diviseur Compare : cleanup listeners `pointermove`/`pointerup` au démontage.

---

## Métriques (mises à jour 2026-06-01)

| | |
|---|---|
| PRs créées | 17 (#6 → #23, hors #8 auto-fermée) |
| PRs mergées | 16 |
| PR fermée (superseded) | #5 (avec commentaire récap listant #6→#18) |
| Lignes ajoutées (cumul) | ~24 500 |
| Nouveaux modules backend | `ocr.py`, `captioning.py`, `fiche.py` |
| Nouveaux modules frontend | `Library/`, `Reader/` (+ hooks/), `readerHtml.ts`, `buildExportHtml.ts`, `katex-auto-render.d.ts` |
| Routes backend totales | 24 (vs 8 avant Phase 5) |
| Endpoints E2E vérifiés | `/process`, `/status`, `/library`, `/markdown`, `/html*`, `/tesseract/status`, `/searchable-pdf`, `/ocr-image`, `/latex-ocr`, `/caption-figures`, `/annotations` GET/PUT, `/fiche`, DELETE `/doc/{id}` |
