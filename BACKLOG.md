# pdf-viewer — Backlog

> Vue macro des phases et epics. Chaque phase terminee a un fichier `PHASE<N>_IMPLEMENT.md`.
> Suivi detaille : [`PROGRESS.md`](./PROGRESS.md) | Dette : [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md) | Spec : [`SPEC.md`](./SPEC.md)

**Derniere MAJ** : 2026-06-04 (Phase 6 EN COURS sur `develop` : Windows + bibliotheque documentaire, #26→#32 — non merge sur main)

---

## Phase 0 — Cadrage et scaffolding

| # | Epic | Taches | Statut |
|---|---|---|---|
| 0.1 | **Cadrage** | Conversation claude.ai → choix Docling + FastAPI + React/Vite | Fait |
| 0.2 | **DRAFT initial** | Synthese conversation cadrage | Fait |
| 0.3 | **Methodologie projet** | CLAUDE, PROJECT_WAY, SPEC, BACKLOG, PROGRESS, TESTS, TECHNICAL_DEBT, /update-progress | Fait |
| 0.4 | **Init structure** | `~/Others/pdf-viewer/{backend, frontend, samples}` | Fait |
| 0.5 | **Backend venv + deps** | Python 3.13 venv, FastAPI, uvicorn, python-multipart, **Docling 2.92** | Fait |
| 0.6 | **Frontend scaffold** | Vite + React + TS + react-pdf + pdfjs-dist | Fait |

---

## Phase 1 — POC backend (extraction Docling stable) — TERMINEE (2026-05-04)

| # | Epic | Taches | Statut |
|---|---|---|---|
| 1.1 | **Squelette FastAPI** | `main.py` avec endpoints `/process`, `/doc/{id}/outline`, `/figure/{fig_id}`, `/raw`, `/pdf`, CORS frontend | Fait |
| 1.2 | **Wrapper pipeline.py** | `convertir_pdf` : Docling → outline + figures + bbox | Fait (TD-002 bbox convention OUVERT) |
| 1.3 | **Smoke test** | Pipeline run sur paper arxiv `2510.04871v1.pdf` | Fait (12 pages, 33 sections, 2 figures extraites) |
| 1.4 | **Hierarchie outline** | Reconstruire la hierarchie depuis numerotation (`2.1.` enfant de `2.`) | Fait (TD-001 RESOLU) |
| 1.5 | **Robustesse `/process`** | Limite 100 Mo, check `%PDF`, try/except Docling, nettoyage cache partiel | Fait (TD-004 et TD-005 RESOLUS) |
| 1.6 | **Test sur PDFs varies** | 5 PDFs : papers EN 12p/26p, doc HSE 1p, CV FR, DMT FR | Fait (TD-007 RESOLU 2026-05-19 via filtres outline) |

Voir [`PHASE1_IMPLEMENT.md`](./PHASE1_IMPLEMENT.md) pour le detail.

---

## Phase 2 — POC frontend (rendu + outline + sync clic) — TERMINEE (2026-05-05)

| # | Epic | Taches | Statut |
|---|---|---|---|
| 2.1 | **App shell** | Layout 2 colonnes (sidebar + viewer), upload zone | Fait |
| 2.2 | **API client** | `src/api.ts` (POST /process, types TS, gestion erreurs `ApiError`) | Fait |
| 2.3 | **Component Outline** | Arbre recursif depuis `result.outline`, expand/collapse, etat vide | Fait |
| 2.4 | **Component Viewer** | `react-pdf` Document + Page, scroll multi-page, refs par page | Fait |
| 2.5 | **Clic outline → scroll viewer** | `forwardRef` + `scrollToPage(page)` via `scrollIntoView` | Fait |
| 2.6 | **Loading + error states** | `<LoadingDocling>` (timer + etapes), erreurs HTTP au format `[code] msg` | Fait |
| 2.7 | **Build + lint** | `npm run build` + `npm run lint` propres | Fait |

Voir [`PHASE2_IMPLEMENT.md`](./PHASE2_IMPLEMENT.md) pour le detail.

---

## Phase 3 — Sync bidirectionnelle + figures — TERMINEE (2026-05-05)

| # | Epic | Taches | Statut |
|---|---|---|---|
| 3.1 | **Scroll viewer → highlight outline** | `IntersectionObserver` + helpers `flattenOutline`/`findActiveSection` + auto-scroll sidebar via `data-section-id` | Fait |
| 3.2 | **Component FigureOverlay** | Modal HD + nav prev/next + Escape + Aller à la page | Fait |
| 3.3 | **Markers figures dans le viewer** | Overlay `<button>` en CSS % sur chaque page, conversion bbox via `src/bbox.ts` (TD-002 RESOLU) | Fait |
| 3.4 | **Navigation clavier** | ↑/↓ outline (focus), ←/→ overlay, Escape ferme overlay | Fait |
| 3.5 | **Persistance localStorage** | Memoriser les docs traites, reprise au refresh | Fait partiel (2026-05-05, 1 doc actif via `lastDocId`) — extension liste docs recents reportee si besoin |
| 3.6 | **Vue Galerie figures** | Tabs Sommaire/Galerie sidebar, grille thumbnails cliquable, reutilise `<FigureOverlay>`. Inspire UX Le Reef/Batipedia. | Fait |

**Bonus integre** : mobile-friendly (drawer sidebar, ResizeObserver page width, hamburger, backdrop, `100dvh`).

Voir [`PHASE3_IMPLEMENT.md`](./PHASE3_IMPLEMENT.md) pour le detail.

---

## Phase 4 — Polish + robustesse — TERMINEE (2026-05-20)

| # | Epic | Taches | Statut |
|---|---|---|---|
| 4.1 | **Tables structurees** | Extraction HTML Docling (`export_to_html`), composant `<Tables>` frontend, 3e onglet sidebar (Sommaire/Galerie/Tables). | Fait (2026-05-20) |
| 4.2 | **Recherche dans le PDF** | V0 (2026-05-05) : highlight `customTextRenderer`. **V1** (2026-05-19) : compteur N/M, nav prev/next, Cmd+F, match actif orange. | Fait (2026-05-19) |
| 4.3 | **Export markdown** | `result.md` ecrit a /process + endpoint `GET /doc/{id}/markdown` avec lazy regen pour les docs legacy. Bouton `.md` cote frontend. | Fait (2026-05-05) |
| 4.4 | **Mode sombre/clair** | Variables CSS dark/light, toggle via `data-theme` sur `<html>`, persiste localStorage. Bouton dans header et sidebar. | Fait (2026-05-20) |
| 4.5 | **Performance frontend** | Code-splitting `React.lazy()` sur Viewer. Chunk principal 627→206 kB (TD-008 RESOLU). | Fait (2026-05-20) |
| 4.6 | **Tests unitaires backend** | pytest 35 tests : unitaires (_level, _est_faux_positif, helpers) + snapshots end-to-end (arxiv 12p, HSE 1p). TD-006 RESOLU. | Fait (2026-05-20) |
| 4.7 | **Doc utilisateur** | `README.md` avec installation + lancement + cas d'usage + raccourcis. `requirements.txt` (pip freeze 106 packages) + `.gitignore` ajoutes. | Fait (2026-05-05) |
| 4.8 | **Compatibilite Windows** | `uvloop` conditionne `sys_platform != 'win32'`, `encoding='utf-8'` sur `open()` JSON, section Windows README (py -3.13, modeles, IPv6). Issu d'un rapport d'installation externe. | Fait (2026-05-18) |
| 4.9 | **Performance pipeline** | Batch processing PDFs > 50p (pypdfium2), auto-detection natif/scanne (skip OCR), singleton converter (cache modeles), filtres faux positifs outline (TD-007). Benchmark : 25s → 8.5s sur paper 12p. | Fait (2026-05-19) |

Voir [`PHASE4_IMPLEMENT.md`](./PHASE4_IMPLEMENT.md) pour le detail.

---

## Phase 5 — Integration des features v2 (PR #5 decomposee) — TERMINEE (2026-05-30)

> Decomposition de la PR #5 (fork MHDINGBI, ~20k lignes, divergee avant #1-#4) en 12 sous-PRs ciblees, reviewables, basees sur main a jour. Snapshot pre-v2 conserve : tag `pre-v2` + branche `old_main` (commit `c427b08`).

| # | Epic | PR | Statut |
|---|---|---|---|
| 5.1 | **OCR optionnel** (Tesseract + ocrmypdf + pix2tex) | #6 | Fait (rebasee tardivement) |
| 5.2 | **Traitement asynchrone + polling** (`/process` background + `/status`) | #7 | Fait |
| 5.3 | **Bibliotheque locale** (catalogue, ouvrir/supprimer/recherche/tri/filtre) | #12 (replace #8 auto-fermee) | Fait |
| 5.4 | **Design-system 10 themes** (selecteur, classe `theme-*` sur `<html>`, bridge anciennes variables) | #9 | Fait |
| 5.5 | **Vue Lecteur Markdown/HTML** (react-markdown + KaTeX + GFM + coloration), fix XSS `sectionizeHtml`, decoupage helpers vers `readerHtml.ts` | #10 | Fait |
| 5.6 | **Upload multi-format** (MarkItDown : DOCX/PPTX/XLSX/HTML/images/notebooks), force Lecteur pour non-PDF | #11 | Fait (E2E sur .docx reel) |
| 5.7 | **Reader backend HTML pleine fidelite** (export Docling EMBEDDED, manifest, parts) + endpoints `/html`/`/html-manifest`/`/html-part` | #13 | Fait (E2E avec Docling offline) |
| 5.8 | **Vue Compare** (PDF + Lecteur cote a cote + diviseur draggable + sync Reader→PDF) | #14 | Fait |
| 5.9 | **Arbitrage Tables** : garder `Tables.tsx` (plus sur), ecarter `TablesPanel`, porter dimensions + hint vide | #15 | Fait |
| 5.10 | **Florence-2 figure captioning** (`POST /caption-figures`, module `captioning.py`, badge IA dans FigureOverlay, bouton dans Gallery) | #16 | Fait (port apres revisite PR #5) |
| 5.11 | **Texify LaTeX-OCR moteur alternatif** (`FORMULA_ENGINE=texify|pix2tex|auto`, integre dans `ocr.py`) | #17 | Fait (port apres revisite PR #5) |
| 5.12 | **Restauration docs/tooling v2** (AGENTS/GEMINI/IMPLEMENTATION/GUIDE_IMPLEMENTATION/FIXES/CHANGELOG/memory/.claude/commands/install.bat/start.bat/debug scripts) | #18 | Fait (5 `test_*.py` v2 et `TablesPanel` exclus) |

**Bonus securite preemptif** : XSS Reader, path traversal `/ocr-image`, ecritures atomiques `result.json`/`error.json`, `print()` → `logging`.

Voir [`PHASE5_IMPLEMENT.md`](./PHASE5_IMPLEMENT.md) pour le detail (epics, incidents `--delete-branch` → #8 auto-fermee + reprise via #12, decisions assumees, metriques).

---

## Phase 6 — Branche develop : outillage Windows + bibliotheque documentaire — EN COURS (2026-06-04)

> ⚠️ Sur la branche **`develop`** (PRs #26→#32). **Pas merge sur `main`** (fige a #25). Reprise du reste portable de la branche v2 de MHDINGBI + nouvelle direction « bibliotheque ».

| # | Epic | PR | Statut |
|---|---|---|---|
| 6.1 | **Installeur Windows** : `install.bat` auto-installe Python 3.13 via winget | #26 | Fait |
| 6.2 | **Launcher desktop pywebview** : `launcher.py`/`launcher_core.py` (spawn uvicorn + Vite/dist, WebView2), build/installeur prod, `pywebview>=5.0`. Zero modif backend | #27 | Fait (runtime Windows non teste → TD-030) |
| 6.3 | **cleanup / thumbnail / reprocess** : `/cache/cleanup`, `/doc/{id}/thumbnail`, `/doc/{id}/reprocess?force_ocr` + `force_ocr` dans `convertir_pdf` | #28 | Fait |
| 6.4 | **Bibliotheque documentaire** : `/register` (reference par chemin sans copie), `/register/preview`, `/doc/{id}/process` (analyse a la demande). `extraction_mode:"registered"`, doc_id = hash du chemin | #29 | Fait |
| 6.5 | **Audit develop** : 5 bugs corriges (pypdfium2 sans lock, race polling, thumbnail onError, reprocess fragile, regMsg) | #30 | Fait |
| 6.6 | **Reconciliation wiki memory/** : cache-schema/architecture/LOG/HANDOFF/INDEX alignes sur develop | #31 | Fait |
| 6.7 | **Skill /update-progress + memory/** : le skill couvre le wiki (perimetre factuels) | #32 | Fait |

**Reste / a decider** : merger `develop` → `main` (groupe), validation locale Windows (launcher + register UI), cablage hooks Reader (TD-025).

Voir [`PHASE6_IMPLEMENT.md`](./PHASE6_IMPLEMENT.md) pour le detail.
