# pdf-viewer — Backlog

> Vue macro des phases et epics. Chaque phase terminee a un fichier `PHASE<N>_IMPLEMENT.md`.
> Suivi detaille : [`PROGRESS.md`](./PROGRESS.md) | Dette : [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md) | Spec : [`SPEC.md`](./SPEC.md)

**Derniere MAJ** : 2026-05-19 (4.8 Windows + 4.9 perf pipeline faits, TD-007 resolu)

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

## Phase 4 — Polish + robustesse — EN COURS

| # | Epic | Taches | Statut |
|---|---|---|---|
| 4.1 | **Tables structurees** | Affichage table extraite par Docling (TableFormer) | A faire |
| 4.2 | **Recherche dans le PDF** | `<SearchBar>` + highlight via `customTextRenderer` react-pdf (V0 : pas de compteur ni nav prev/next) | Fait (2026-05-05) |
| 4.3 | **Export markdown** | `result.md` ecrit a /process + endpoint `GET /doc/{id}/markdown` avec lazy regen pour les docs legacy. Bouton `.md` cote frontend. | Fait (2026-05-05) |
| 4.4 | **Mode sombre** | Toggle theme clair/sombre (deja sombre par defaut) | A faire |
| 4.5 | **Performance** | Virtualisation pages, code-splitting bundle JS (TD-008) | A faire |
| 4.6 | **Tests unitaires backend** | pytest sur `pipeline.py` (snapshot result.json sur PDFs samples, TD-006) | A faire |
| 4.7 | **Doc utilisateur** | `README.md` avec installation + lancement + cas d'usage + raccourcis. `requirements.txt` (pip freeze 106 packages) + `.gitignore` ajoutes. | Fait (2026-05-05) |
| 4.8 | **Compatibilite Windows** | `uvloop` conditionne `sys_platform != 'win32'`, `encoding='utf-8'` sur `open()` JSON, section Windows README (py -3.13, modeles, IPv6). Issu d'un rapport d'installation externe. | Fait (2026-05-18) |
| 4.9 | **Performance pipeline** | Batch processing PDFs > 50p (pypdfium2), auto-detection natif/scanne (skip OCR), singleton converter (cache modeles), filtres faux positifs outline (TD-007). Benchmark : 25s → 8.5s sur paper 12p. | Fait (2026-05-19) |
