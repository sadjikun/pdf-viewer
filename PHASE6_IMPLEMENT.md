# Phase 6 — Branche develop : outillage Windows + bibliothèque documentaire

> ⚠️ **Travail sur la branche `develop` uniquement** (PRs #26→#32). **Pas encore mergé sur `main`** (figé à #25). `develop` sert de base d'intégration synchronisée pour le travail collaboratif avec MHDINGBI.

**Période** : 2026-06-02 → 2026-06-04
**PRs** : #26, #27, #28, #29, #30, #31, #32

---

## Contexte

Après le découpage de la PR #5 (Phase 5, mergé sur main), MHDINGBI a continué sur sa branche fork (`feature/v2-tables-reader-ocr`) avec 43 commits (launcher pywebview, annotations, fiche, PWA, register, etc.). Une partie a été reprise en compléments post-Phase 5 (#20→#23, sur main). La Phase 6 reprend le **reste portable** sur `develop` : outillage Windows et direction « bibliothèque documentaire ».

`develop` a été recréée depuis `main` (l'ancienne, `8db822c`, était obsolète) pour servir de base à jour.

---

## Epics

### 6.1 — Installeur Windows amélioré · PR #26

- `install.bat` (= ex-`setup_dev.bat` de MHDINGBI) : **auto-installation de Python 3.13 via winget** (prompt interactif) si absent ou trop ancien, au lieu de juste suggérer le lien. Flag `SKIP_NODE` si `frontend/dist` pré-construit.
- Non porté : `setup.bat`/`build.bat`/`build_installer.py` (couplés au launcher → portés en 6.2). Message final → `start.bat`.

### 6.2 — Launcher desktop pywebview (Windows) · PR #27

- `launcher.py` (221 l.) : fenêtre native pywebview (splash, close-to-quit, dialogs).
- `launcher_core.py` (251 l.) : **GUI-free, testable** — `ServerManager` spawn `uvicorn main:app` + Vite/dist, détection WebView2, readiness via stdout uvicorn (« Application startup complete » — **pas** de dépendance `/health`), écrit `VITE_API_BASE`.
- Build/packaging : `build.bat`, `build_installer.py`, `scripts/{package_app,make_icon,generate_pwa_icons}.py`, `setup.bat` (installeur prod), `assets/{app.ico, MicrosoftEdgeWebview2Setup.exe}`.
- `requirements.txt` : `pywebview>=5.0` (import lazy → `launcher_core` importable sans).
- Renommage : `install.bat` → `setup_dev.bat` (paire cohérente avec `setup.bat`), `start.bat` mis à jour.
- **Zéro modif backend** : lance `main:app` tel quel.
- Tests : `tests/launcher/test_launcher_core.py` (12 tests, rendu cross-platform via `core._venv_python`).

### 6.3 — cleanup / thumbnail / reprocess · PR #28

- `POST /cache/cleanup?max_age_days` : purge les docs vieux (skip ceux en cours).
- `GET /doc/{id}/thumbnail` : miniature 1re page PDF (pypdfium2, cachée, `max-age 1j`).
- `POST /doc/{id}/reprocess?force_ocr` : retraite depuis la source ; `force_ocr` pour PDFs hybrides (corps natif + pages scannées).
- `convertir_pdf`/`_convertir_batch` : param `force_ocr` (`do_ocr=True` si forcé).
- Frontend : split-button « Retraiter | OCR », `thumbnailUrl`/`reprocessDoc`/`cleanupCache`, vignette PDF dans Library.

### 6.4 — Bibliothèque documentaire : référencement par chemin · PR #29

- **Référence des PDF (fichier/dossier) par chemin disque, sans copie** → pose la base du cap « centraliser tes documents » (VISION).
- **Amélioration vs la v2** : `doc_id = sha256(chemin absolu)[:16]` → reste un hex valide → **garde `DOC_ID_RE` strict** (la v2 dérivait l'ID du nom de fichier, cassant la protection path-traversal).
- Backend : `_path_doc_id`, `_register_pdf` (scan léger pypdfium2 + miniature, `extraction_mode:"registered"` + `source_path`, sans copie), `POST /register`, `GET /register/preview`, `POST /doc/{id}/process` (copie en cache + Docling à la demande) ; `_resolve_source` fallback `source_path` ; `get_pdf` sert la source résolue.
- Frontend : barre « Référencer un PDF/dossier », badge « Référencé », bouton « Analyser », doc référencé → vue PDF forcée.
- Windows : `Path.resolve()` gère `C:\...`, `/pdf` sert un chemin externe via FileResponse.
- Tests : `test_register.py` (8 tests).

### 6.5 — Audit develop : 5 bugs corrigés · PR #30

Audit ciblé (2 agents backend+frontend) sur les ajouts récents :

- **B1 (HAUTE)** : `_count_pages`/`_page_text_lengths`/`_extract_pages_pdf` ouvraient pypdfium2 **sans `_PDFIUM_LOCK`** → crash possible si `/process` & `/register` concurrents. Protégés par le lock.
- **F1 (HAUTE)** : vignette Library **sans `onError`** → image cassée si thumbnail 404/500. État `imgError` → fallback `PosterFallback`.
- **F3 (HAUTE)** : **race polling** — la Library reste cliquable pendant analyse/reprocess → ouvrir un autre doc voit le poll écraser l'affichage. `openDocument` appelle `stopPolling()`.
- **B2 (MOYENNE)** : reprocess conservait via `p.name == source.name` (fragile pour docs référencés) → conserve les fichiers `source.*`.
- **F2 (MOYENNE)** : `regMsg` persistait → réinitialisé à la ré-édition du chemin + `aria-describedby`.

Écartés (faux positifs) : « path traversal /register » (outil local mono-utilisateur, `get_pdf` limite au `.pdf`), « Docling doc non fermé » (modèle en mémoire), handlers non-mémoïsés (DocumentCard non memo).

### 6.6 — Réconciliation du wiki memory/ · PR #31

Le wiki `memory/` (de MHDINGBI, figé ~2026-05-25/31) décrivait sa branche v2 et divergeait de develop. Corrections factuelles :
- `cache-schema.md` : modes `markitdown`/`registered` + `source_path`/`needs_reprocess`/`caption_ai`, layout réel (thumbnail, html_part_*, annotations.json), 2 schémas de doc_id. Retrait des champs v2 absents (`fast`/`native`, `n_rows`/`n_cols`, `tesseract_available`).
- `architecture.md` : flux async + 3 voies d'entrée (process/register/reprocess), constantes réelles (BATCH_SIZE=30, FORMULA_ENGINE, `_PDFIUM_LOCK`), contrats à jour, stack complète.
- `LOG.md` : entrée 2026-06-04. `HANDOFF.md` : section 0 « État develop ». `INDEX.md` : note de fraîcheur.
- Laissés tels quels : VISION/PRD/ROADMAP/decisions (directionnels), fixes-registry/formulas (historiques v2).

### 6.7 — Skill /update-progress + memory/ · PR #32

Le skill `/update-progress` ne couvrait que les docs internes → le wiki `memory/` dérivait sans suivi. Ajout du périmètre « factuels seulement » (lecture + cohérence + résumé + ordre d'écriture pour `memory/{cache-schema,architecture,LOG,HANDOFF,INDEX}`). Directionnels = vérifier si pivot. `fixes-registry`/`formulas` exclus.

---

## Métriques

| | |
|---|---|
| PRs (Phase 6) | 7 (#26→#32) |
| Branche | `develop` (pas mergé sur main) |
| Endpoints backend | **27** (vs 24 fin Phase 5) |
| Nouveaux endpoints | `/cache/cleanup`, `/doc/{id}/thumbnail`, `/doc/{id}/reprocess`, `/register`, `/register/preview`, `/doc/{id}/process` |
| Nouveaux modules | `launcher.py`, `launcher_core.py`, `build_installer.py`, `scripts/` |
| Tests backend | **63** (55 + 8 register) |
| Tests launcher | 12 (`tests/launcher/`) |
| Nouvelle direction | Bibliothèque documentaire (référencement sans copie) |

---

## Divergences assumées (présent sur la branche v2, absent de develop)

Fast path pypdfium2 (`_extraire_natif`), de-embedding images (`/html-image`), `/health`, `/app-mode` (cassé avec notre lecture env à l'import), endpoint benchmark, Reader câblé aux hooks (hooks extraits mais non branchés — TD-025), ModeChooser. Documenté dans `memory/HANDOFF.md` section 0.
