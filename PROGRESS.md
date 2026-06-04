# pdf-viewer — Status

> Vue globale du projet.
> Backlog : [`BACKLOG.md`](./BACKLOG.md) | Spec : [`SPEC.md`](./SPEC.md) | Dette : [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md)

**Derniere MAJ** : 2026-06-04 (Phase 6 sur `develop` : outillage Windows + bibliotheque documentaire — non merge sur main)

---

## Etat du projet

| Composant | Stack | Statut | Detail |
|---|---|---|---|
| Backend | Python 3.13 + FastAPI 0.136 | **Stable** | venv, **27 endpoints** (+ register/preview/process, reprocess, thumbnail, cache/cleanup sur develop), validations 400/409/413/422/503, async ML via `to_thread`, `_PDFIUM_LOCK`/`_converter_lock` thread-safe |
| Extraction | Docling 2.92 + MarkItDown | **Stable** | Hierarchie outline reconstruite, auto-detection natif/scanne, batch > 50p, export HTML EMBEDDED, multi-format (DOCX/PPTX/XLSX/HTML/images/notebooks) |
| OCR / ML (optionnels) | Tesseract + ocrmypdf + pix2tex + Texify + Florence-2 | **Integre opt-in** | Modules dedies `ocr.py` (LaTeX-OCR avec FORMULA_ENGINE) et `captioning.py` (Florence-2). 503 gracieux si deps/modeles absents. Modeles non en cache localement → TD-021/022 |
| Frontend | React 19 + Vite + TS | **Stable** | + Library (catalogue local + **referencement par chemin**, vignettes thumbnail, badge Refere/bouton Analyser, split-button Retraiter\|OCR), Reader Markdown/HTML (KaTeX, GFM), vue Compare, 10 themes, polling progression |
| Desktop (Windows) | pywebview + WebView2 | **Integre (develop)** | `launcher.py`/`launcher_core.py` (spawn uvicorn + Vite/dist), `install.bat` (winget Python 3.13), `setup.bat`/`build_installer.py`. Runtime non testable hors Windows → TD-030 |
| Rendu PDF | react-pdf 10.4.1 + pdfjs-dist 5.4.296 | **Integre** | ResizeObserver, IntersectionObserver, markers figures, lazy-load |
| Cache | Disque, sha256(PDF) + result.json + html_part_*.html | **Implemente** | + `caption_ai`/`latex` ajoutes a la demande, ecritures atomiques (tmp + rename) |
| Documentation | CLAUDE / PROJECT_WAY / SPEC / BACKLOG / PROGRESS / TESTS / TECHNICAL_DEBT / DRAFT / PHASE1..**5**_IMPLEMENT / README + (depuis #18) AGENTS / GEMINI / IMPLEMENTATION / GUIDE_IMPLEMENTATION / FIXES / CHANGELOG / memory/ / .claude/commands | **OK** | Methodologie + doc utilisateur + doc/tooling MHDINGBI |
| Reproductibilite | `backend/requirements.txt` (+ markitdown[all], ocrmypdf, pytesseract, pix2tex, texify, einops, timm) + `.gitignore` + `install.bat`/`start.bat` | **OK** | Install reproductible, compatible Windows |

---

## Phase en cours

**Phase 0 — Cadrage et scaffolding : TERMINEE** (2026-05-04)
**Phase 1 — POC backend : TERMINEE** (2026-05-04, voir [`PHASE1_IMPLEMENT.md`](./PHASE1_IMPLEMENT.md))
**Phase 2 — POC frontend : TERMINEE** (2026-05-05, voir [`PHASE2_IMPLEMENT.md`](./PHASE2_IMPLEMENT.md))
**Phase 3 — Sync bidirectionnelle + figures : TERMINEE** (2026-05-05, voir [`PHASE3_IMPLEMENT.md`](./PHASE3_IMPLEMENT.md), 3.5 partiel)
**Phase 4 — Polish + robustesse : TERMINEE** (2026-05-20, tous epics 4.1-4.9 faits, voir [`PHASE4_IMPLEMENT.md`](./PHASE4_IMPLEMENT.md))
**Phase 5 — Integration des features v2 (PR #5 decomposee) : TERMINEE** (2026-05-30, 12 sous-PRs mergees #6→#18, voir [`PHASE5_IMPLEMENT.md`](./PHASE5_IMPLEMENT.md))
**Phase 6 — Branche develop : outillage Windows + bibliotheque documentaire : EN COURS** (2026-06-04, 7 PRs #26→#32 sur `develop`, **pas merge sur main**, voir [`PHASE6_IMPLEMENT.md`](./PHASE6_IMPLEMENT.md))

---

## Derniers changements

| Date | Quoi |
|---|---|
| 2026-05-04 | Conversation cadrage claude.ai → choix Docling + FastAPI + React/Vite |
| 2026-05-04 | Creation `~/Others/pdf-viewer/{backend, frontend, samples}` |
| 2026-05-04 | Backend venv + FastAPI + Docling 2.92 installes (telechargement modeles RapidOCR ~40 Mo au premier run) |
| 2026-05-04 | `main.py` ecrit (endpoints `/process`, `/doc/{id}/outline`, `/figure/{fig_id}`, `/raw`, `/pdf`, `/`, DELETE) |
| 2026-05-04 | `pipeline.py` ecrit (wrapper Docling → outline + figures + bbox) |
| 2026-05-04 | Frontend scaffold Vite React TS + react-pdf + pdfjs-dist |
| 2026-05-04 | Smoke test pipeline sur `samples/2510.04871v1.pdf` : 12 pages, 33 sections, 2 figures PNG extraites ✅ |
| 2026-05-04 | Methodologie repliquee depuis tps-senegal (CLAUDE / PROJECT_WAY / SPEC / BACKLOG / PROGRESS / TESTS / TECHNICAL_DEBT / DRAFT) |
| 2026-05-04 | **1.4 hierarchie outline** : parser `_level_depuis_titre` (regex sur numerotation) — `2.1.` enfant de `2.` (TD-001 RESOLU) |
| 2026-05-04 | **1.5 robustesse `/process`** : limite 100 Mo (413), check `%PDF` (400), try/except Docling (422) + nettoyage cache partiel (TD-004 et TD-005 RESOLUS) |
| 2026-05-04 | **1.6 PDFs varies** : 5 PDFs traites (papers EN 12p/26p, doc HSE 1p, CV FR, DMT FR) — observation : Docling sur-detecte SectionHeader sur docs admin (TD-007 ouvert) |
| 2026-05-04 | Phase 1 cloturee, `PHASE1_IMPLEMENT.md` cree |
| 2026-05-05 | **Phase 2 codee** : `App.tsx` orchestre etat, `<UploadZone>`, `<Outline>` recursif avec expand/collapse, `<Viewer>` react-pdf, `<LoadingDocling>` avec timer + etapes, `src/api.ts`/`types.ts`. `npm run build` + `npm run lint` propres |
| 2026-05-05 | **Fix mismatch pdfjs-dist** : 5.6.205 → 5.4.296 (alignement avec transitive react-pdf 10.4.1). `<Document onLoadError>` capture le message reel |
| 2026-05-05 | **Persistance localStorage** : `lastDocId` ecrit au upload, `getResult()` au boot pour restore depuis cache backend |
| 2026-05-05 | **Phase 3 codee** : `<FigureOverlay>` (modal HD + nav prev/next + Escape + Aller à la page), `<Gallery>` (grille thumbnails) + tabs Sommaire/Galerie sidebar |
| 2026-05-05 | **3.1 IntersectionObserver** : pages visibles → page courante (haut), helper `findActiveSection`, auto-scroll sidebar via `data-section-id` |
| 2026-05-05 | **3.3 Markers figures** : `src/bbox.ts` convertit Docling BOTTOMLEFT → CSS %. Verification empirique (`t > b` systematique) → TD-002 RESOLU |
| 2026-05-05 | **3.4 Clavier** : ↑/↓ outline (focus), ←/→ overlay, Escape ferme overlay |
| 2026-05-05 | **Mobile-friendly** : drawer sidebar (< 768px), bouton hamburger, backdrop, `ResizeObserver` largeur page dynamique, `100dvh`, auto-fermeture drawer apres clic |
| 2026-05-05 | Phases 2 et 3 cloturees, `PHASE2_IMPLEMENT.md` et `PHASE3_IMPLEMENT.md` crees |
| 2026-05-05 | **4.2 Recherche dans le PDF (V0)** : `<SearchBar>` dans la sidebar, highlight via `customTextRenderer` de react-pdf (wrap dans `<mark.search-hit>`), insensible a la casse |
| 2026-05-05 | **4.3 Export Markdown** : `pipeline.py` ecrit `result.md` au /process. Endpoint `GET /doc/{id}/markdown` avec lazy regen via Docling pour les docs legacy. Bouton `.md` cote frontend |
| 2026-05-05 | **4.7 README utilisateur** : sections quoi/stack/install/lancement/utilisation/raccourcis/structure/endpoints/limitations + liens vers les autres docs (TD-003 RESOLU au passage) |
| 2026-05-05 | **`backend/requirements.txt`** : `pip freeze` complet (106 packages, transitives Docling) pour install reproductible |
| 2026-05-05 | **`.gitignore`** : Python (.venv, __pycache__, caches), Node (node_modules, dist, .vite), backend/cache/, samples/*.pdf, OS, IDE, secrets |
| 2026-05-05 | **Init git + 1er push public** : repo cree https://github.com/sadjikun/pdf-viewer (commit `8f1be0d`, 54 fichiers) |
| 2026-05-05 | **Retrait doc interne du repo public** (commit `093722e`) : CLAUDE/DRAFT/PROGRESS/PROJECT_WAY/SPEC/TECHNICAL_DEBT/TESTS/PHASE_IMPLEMENT gitignored. Repo public garde uniquement README + BACKLOG. |
| 2026-05-06 | **README Quick Start + alerte Python 3.13** (commit `7d0a603`) : section copy-paste minimale au debut, callout `[!IMPORTANT]`, commande curl arxiv pour PDF de test, fusion Installation/Lancement |
| 2026-05-18 | **4.8 Compatibilite Windows** (commit `0de39db`, PR #1 mergee) : `uvloop` conditionne `sys_platform != 'win32'`, `encoding='utf-8'` sur tous les `open()` JSON dans `main.py`, section Windows dans README (py -3.13, modeles, IPv6). Issu d'un rapport d'installation externe. |
| 2026-05-19 | **4.9 Batch processing** (commit `6303d5c`) : PDFs > 50 pages decoupes en tranches de 30 via pypdfium2, traites independamment, fusionnes avec correction offsets. `images_scale=1.0` en batch. Configurable via `PDF_BATCH_SIZE`/`PDF_BATCH_THRESHOLD`. |
| 2026-05-19 | **4.9 Auto-detection natif + singleton converter** (commit `754dac4`) : `_is_native_pdf()` via pypdfium2 → skip OCR sur PDFs natifs. `_converter_cache` reutilise le DocumentConverter entre requetes. Benchmark : 25s → 16.7s (1er) → 8.5s (suivants). |
| 2026-05-19 | **4.9 Filtres faux positifs outline** (commit `eceb81d`, TD-007 RESOLU) : `_est_faux_positif()` filtre titres < 3 chars, > 120 chars, doublons. `_CHAPTER_PREFIX` → niveau 1. Teste sur 6 docs caches. |
| 2026-05-19 | **4.2 Recherche V1** (commit `67435ee`, PR #3) : compteur N/M, nav prev/next (▲/▼ + Enter/Shift+Enter), Cmd+F focus, match actif en orange, scroll auto. |
| 2026-05-20 | **4.6 pytest backend** (commit `69d5159`) : 35 tests (7 unitaires _level, 6 _est_faux_positif, 5 helpers pypdfium2, 14 snapshot arxiv, 3 snapshot HSE). TD-006 RESOLU. |
| 2026-05-20 | **4.1 Tables structurees** (commit `f5fab84`) : `_extraire_tables()` backend (HTML Docling), composant `<Tables>` frontend, 3e onglet sidebar. 5 tables sur arxiv. |
| 2026-05-20 | **4.4 Mode sombre/clair + 4.5 Code-splitting** (commit `67f8963`) : variables CSS dark/light, toggle persiste localStorage. React.lazy Viewer, chunk 627→206 kB. TD-008 RESOLU. |
| 2026-05-20 | **Phase 4 cloturee**, `PHASE4_IMPLEMENT.md` complete. |
| 2026-05-29 | **Revue PR #5** : monolithe ~20k lignes branche divergee avant #1-#4 (perdrait hardening security, search V1, batch, tests pytest, dark mode), failles XSS + path traversal signalees. **Decision : decomposition par feature sur main a jour.** Snapshot pre-v2 cree (branche locale `old_main` sur `c427b08`). |
| 2026-05-29 | **PRs #7 Async, #12 Library (replace #8), #9 Themes, #10 Reader, #11 Multi-format, #13 Reader HTML, #14 Compare, #15 Tables : mergees** dans main. Stack lineaire empilee, retarget manuel apres l'incident `--delete-branch` ferme #8 (PR auto-fermee suite a la suppression de sa base → recreee en #12). |
| 2026-05-29 | **PR #13 testee end-to-end** : Docling tourne offline (modeles en cache local `~/.cache/huggingface/hub/`) → `convertir_pdf` sur 2 pages arxiv natif avec `HF_HUB_OFFLINE=1` + proxies unset → `result.html` 105 KB avec marqueur `pdf-page-sep`, images base64 inline, contenu reel rendu ; endpoints `/html-manifest`/`/html-part`/`/html` 200. Decouverte importante : Docling **est** testable en dev (memoire `project_docling_no_run_dev.md` corrigee). |
| 2026-05-29 | **PR #6 OCR rebasee** sur le main post-stack (conflits imports `main.py` et `requirements.txt` resolus) et mergee. Modules dedies : `backend/ocr.py` (Tesseract + pix2tex helpers) ; sécurité : `/ocr-image` reutilise le regex `^f_\d+$`, ecriture atomique `result.json` dans `/latex-ocr`. |
| 2026-05-29 | **Revisite PR #5** : 2 features ajoutees par MHDINGBI apres le snapshot initial (Florence-2 captioning `eb1a2d6`, Texify LaTeX-OCR `fb579e7`). **Portees** en #16 (Florence avec module `captioning.py` + bouton dans Gallery) et #17 (Texify integre dans `ocr.py` avec selecteur `FORMULA_ENGINE`). Mergees. |
| 2026-05-29 | **PR #16 commit complementaire** `fix: cabler le bouton de legendage` — App.tsx avait ete oublie du `git add` initial (decouvert via stray change traine sur la branche Texify, deplace via `git stash`). |
| 2026-05-30 | **PR #18 docs/tooling v2** : 21 fichiers de doc/tooling de MHDINGBI restaures sur main (AGENTS/GEMINI/IMPLEMENTATION/GUIDE_IMPLEMENTATION/FIXES/CHANGELOG/.claude/commands/memory/install.bat/start.bat/debug scripts/MarkdownReader.css.search.py). **Exclus** : 5 `backend/test_*.py` (ecrits pour l'API du pipeline v2 absente de main → casseraient pytest, TD-023) et `TablesPanel.{tsx,css}` (arbitre en #15). |
| 2026-05-30 | **PR #5 fermee** avec commentaire recap listant les sous-PRs #6→#18. Nettoyage : 5 branches `feature/*` supprimees du remote ; tag annote `pre-v2` cree sur `c427b08` + branche `old_main` poussee sur origin (double sauvegarde de l'etat pre-v2). |
| 2026-05-30 | **Verification main integre final** : `tsc -b` + `eslint` + `vite build` verts ; backend `py_compile` + `import main` OK ; `pytest --collect-only` 39 tests inchange ; 21 endpoints (vs 8 avant Phase 5). **Phase 5 cloturee**, `PHASE5_IMPLEMENT.md` cree. |
| 2026-06-01 | **PR #20 hooks Reader** : port des 5 custom hooks MHDINGBI (`useAppearance`, `usePdfPageSync`, `useSearch`, `useTts`, `useImageLightbox`) + `buildExportHtml.ts` + `sectionizeHtml.test.ts` (vitest). Non cables dans MarkdownReader (TD-025). |
| 2026-06-01 | **PR #21 annotations durables** : `GET/PUT /doc/{id}/annotations` (highlights+notes, ecriture atomique, limite 1 Mo), `GET /doc/{id}/fiche?format=html|md` (revision sheet), module `backend/fiche.py`, types+api frontend (`StoredHighlight`, `AnnotationStore`, `getAnnotations`, `saveAnnotations`, `ficheUrl`). Cablage Reader (panel notes, sync) differe. |
| 2026-06-01 | **PR #22 PWA** : `manifest.json`, `service-worker.js` (cache-first), icones 192/512, meta iOS, enregistrement SW. Port du commit `7ccb33c` (MHDINGBI). |
| 2026-06-01 | **PR #23 audit bugs/perf** : 13 corrections. Backend : `get_markdown` fallback Docling supprime (→404), 3 endpoints ML async via `asyncio.to_thread`, `delete_doc` refuse 409 si pipeline actif, `_converter_cache` thread-safe (`Lock`), PIL `Image.open` → `with` (3 endroits), library N+1 optimise, `get_outline`/`get_raw` try/except 422, `put_annotations` limite 1 Mo. Frontend : polling `pollAbortRef` (race condition), Reader scroll throttle `requestAnimationFrame`, 5 handlers `useCallback`, diviseur Compare cleanup listeners. |
| 2026-06-01 | **Branche `develop` recréée** depuis main (l'ancienne etait obsolete, `8db822c`). Destinee au travail de MHDINGBI (synchronisee avec main). |
| 2026-06-01 | **Main integre final** : 24 endpoints, backend compile, `tsc`+`eslint`+`vite build` verts, 22 tests pytest passent. |
| 2026-06-02 | **PR #26 (develop) installeur Windows** : `install.bat` auto-installe Python 3.13 via winget (port de `setup_dev.bat` MHDINGBI). |
| 2026-06-03 | **PR #27 (develop) launcher pywebview** : `launcher.py`/`launcher_core.py` (fenetre native, spawn uvicorn + Vite/dist, WebView2), `setup.bat`/`build_installer.py`/`scripts/`, `pywebview>=5.0`. 12 tests launcher. Zero modif backend. `install.bat` → `setup_dev.bat`. |
| 2026-06-03 | **PR #28 (develop) cleanup/thumbnail/reprocess** : `POST /cache/cleanup`, `GET /doc/{id}/thumbnail` (pypdfium2), `POST /doc/{id}/reprocess?force_ocr` (PDFs hybrides) + `force_ocr` dans `convertir_pdf`. Frontend : split-button Retraiter\|OCR, vignettes Library. |
| 2026-06-03 | **PR #29 (develop) bibliotheque documentaire** : `POST /register` (reference PDF/dossier par chemin **sans copie**), `/register/preview`, `POST /doc/{id}/process` (analyse a la demande). `doc_id = sha256(chemin)[:16]` (garde `DOC_ID_RE` — amelioration vs v2). `extraction_mode:"registered"` + `source_path`. UI : barre Referencer + badge + bouton Analyser. 8 tests. |
| 2026-06-04 | **PR #30 (develop) audit 5 bugs** : B1 pypdfium2 sans `_PDFIUM_LOCK` (crash concurrent) ; F3 race polling/ouverture doc ; F1 vignette sans onError ; B2 reprocess `p.name` fragile ; F2 regMsg persistant. |
| 2026-06-04 | **PR #31 (develop) reconciliation wiki memory/** : cache-schema (modes registered/markitdown + source_path), architecture (flux async + register, 27 endpoints), LOG (entree develop), HANDOFF (section 0), INDEX (fraicheur). VISION/PRD/ROADMAP/decisions inchanges ; fixes-registry/formulas = historique v2. |
| 2026-06-04 | **PR #32 (develop) skill /update-progress + memory/** : le skill couvre desormais le wiki memory/ (perimetre « factuels seulement »). |
| 2026-06-04 | **Etat develop** : 27 endpoints, 63 tests backend + 12 launcher, `tsc`/`eslint`/`vite` verts. `develop` a 7 PRs d'avance sur `main` (fige a #25). |

---

## Decisions cles

| Date | Decision | Raison |
|---|---|---|
| 2026-05-04 | **Docling** comme moteur d'extraction (vs MinerU) | Sortie hierarchique native (DoclingDocument), figures premiere classe, OCR auto, CPU-friendly |
| 2026-05-04 | **React + Vite + TS** (vs Vue) | Maturite `react-pdf`, ecosysteme |
| 2026-05-04 | **Bbox exposees BOTTOMLEFT** (telles que Docling) | Frontend convertit a la demande (connait page.height). Decision revisable si plusieurs frontends. |
| 2026-05-04 | **Pas de Docker / packaging** v1 | POC d'abord, packaging plus tard si demande utilisateur |
| 2026-05-04 | **Methodologie tps-senegal repliquee** | Coherence cross-projet, slash command `/update-progress` reutilisable |
| 2026-05-04 | **Limite upload 100 Mo** | Garde-fou simple, ajustable, evite OOM RAM (TD-005) |
| 2026-05-04 | **Niveau outline = nombre de segments numerotation** | Plus fiable que `level` Docling (tous = 1) ; fallback level brut sur sections sans numerotation |
| 2026-05-05 | **Conversion bbox cote frontend** (TD-002) | SPEC §4.2 conserve, helper `bboxToPct` dans `src/bbox.ts`. Verification empirique BOTTOMLEFT confirmee. Backend non modifie. |
| 2026-05-05 | **Largeur page dynamique** via `ResizeObserver` | Plafonnee a `MAX_PAGE_WIDTH = 900`. Adaptation a la largeur du viewer (mobile + tres grand ecran). |
| 2026-05-05 | **Layout drawer sidebar mobile** (< 768px) | Sidebar fixed + transform, hamburger top-left, backdrop, auto-fermeture apres clic section/figure |
| 2026-05-05 | **1 doc actif persiste en localStorage** (POC) | Cle `pdf-viewer:lastDocId`. Liste docs recents reportee si besoin. |
| 2026-05-05 | **Onglet Galerie** (3.6, ajoute en cours de session) | Inspire UX Le Reef/Batipedia (norme NF EN 1991-1-4). Reutilise `<FigureOverlay>`. |
| 2026-05-05 | **Recherche V0 sans compteur ni nav** | Highlight visuel suffisant pour POC ; compteur global + prev/next reportes a une V1 si demande user |
| 2026-05-05 | **Export MD avec lazy regen** | Genere a la demande pour les docs legacy (cout 30s une fois). Plus user-friendly que de forcer un re-upload. |
| 2026-05-05 | **Separation repo public / doc interne** | Code + README + BACKLOG sur GitHub, doc workflow (CLAUDE, PROGRESS, SPEC, etc.) gardee en local. Permet de publier sans exposer le suivi interne ni les choix narratifs. |
| 2026-05-05 | **Sample PDF non inclus dans le repo** | License arxiv perpetual ne garantit pas la redistribution. Le README pointe vers une commande `curl https://arxiv.org/...` pour download a la demande, plus safe legalement. |
| 2026-05-19 | **Batch sequentiel, pas parallele** | Objectif = reduire RAM, pas accelerer. Paralleliser multiplierait la consommation memoire. |
| 2026-05-19 | **Detection native via pypdfium2 (pas Docling)** | pypdfium2 deja dans les deps, extraction texte instantanee vs chargement complet Docling. |
| 2026-05-19 | **Pas d'extraction legere pour PDFs natifs** | Perdrait detection figures, SectionHeader, export MD structure — la valeur du produit. |
| 2026-05-19 | **Filtres outline conservateurs** | Min/max length + dedup. Mieux garder des faux positifs que filtrer des vrais titres. |
| 2026-05-20 | **Code-splitting via React.lazy** | Viewer charge en lazy, chunk principal sous 500 kB. Le worker pdfjs (~1 Mo) reste separee mais est un asset statique. |
| 2026-05-20 | **dangerouslySetInnerHTML pour tables Docling** | HTML genere par Docling (pas d'input utilisateur), risque faible. Sanitization reportee si besoin (TD-010). |
| 2026-05-29 | **Decomposition de la PR #5 par feature** (vs cherry-pick monolithique ou rebase) | PR de 20k lignes divergee avant #1-#4 ; rebaser perdrait les ameliorations de main et exposerait les failles signalees en revue. Decomposition = PRs reviewables + correctifs securite preemptifs + tests structurels. |
| 2026-05-29 | **Approche bridge pour les 10 themes** (vs migration de tous les composants) | `:root` remappe les anciennes variables (`--bg`, `--accent`…) sur le nouveau design-system → zero modification des composants existants. Substitution CSS resolue a l'usage → suit le theme actif. |
| 2026-05-29 | **Reader frontend en mode markdown-first** | Le Reader v2 etait HTML-first avec ~400 lignes de post-traitement non testable au moment du port. Le composant retombe sur `/markdown` quand `/html-manifest` 404 → on porte le frontend verbatim (avec fix XSS) et le backend HTML (`pipeline.py` + 3 endpoints) en PR distincte (#13), testee separement. |
| 2026-05-29 | **Pas de `--delete-branch` sur les PRs stackees** | GitHub ferme automatiquement les PRs dont la base est supprimee (et ne les rouvre pas). Apprentissage incident #8. Pour les PRs sans dependant (independantes de main), `--delete-branch` reste OK. |
| 2026-05-29 | **Ne pas porter `TablesPanel.{tsx,css}` de la v2** | `Tables.tsx` deja sur main est integre + plus sur (strip `style=`) + memoise. `TablesPanel` est un doublon sans strip `style` (faille XSS). Bonnes idees (dimensions, hint) portees dans `Tables.tsx`. |
| 2026-05-30 | **Ne pas porter les 5 `backend/test_*.py` de la v2** | Ecrits pour l'API du pipeline v2 (`_outline_depuis_texte`, `_est_titre_section`) absente de main → casseraient `pytest --collect-only` (ImportError). A adapter avant reintegration (TD-023). |
| 2026-05-30 | **Garder les fichiers de doc/tooling de MHDINGBI sur main** | Decision projet (memoire `project_mhdingbi_collaborator.md`) : ses outils d'orchestration multi-agents (AGENTS/GEMINI/.claude/commands/memory) restent dans le repo public. Restaurés via PR #18. |
| 2026-05-30 | **Snapshot pre-v2 via tag annote + branche** | Le tag `pre-v2` (annote, `c427b08`) est le repere fige ideal ; `old_main` reste disponible pour comparaisons rapides. Les deux poussees sur origin. |
| 2026-06-03 | **`develop` comme branche d'integration (Phase 6)** | Le travail Windows + bibliotheque s'accumule sur `develop` (recreee depuis main) avant un merge groupe vers `main`. MHDINGBI part de `develop` a jour, rebase regulier sur `origin/main`. |
| 2026-06-03 | **doc_id = hash du chemin pour les docs references** (vs nom de fichier chez MHDINGBI) | Garde la validation stricte `^[a-f0-9]{16}$` (protection path-traversal) tout en permettant le referencement sans copie. Amelioration de securite vs la v2. |
| 2026-06-03 | **Referencement sans copie + analyse a la demande** | `/register` fait un scan leger pypdfium2 (instantane, pas de copie) → visible dans la bibliotheque ; Docling complet seulement sur clic « Analyser » (`/doc/{id}/process`). Evite de dupliquer/traiter des dossiers entiers d'emblee. |
| 2026-06-03 | **Launcher : zero modif backend** | `launcher_core` lance `uvicorn main:app` tel quel et detecte le demarrage via stdout (« Application startup complete »), sans dependre du `/health` de la v2 (non porte). Le launcher reste un wrapper. |
| 2026-06-04 | **Le skill `/update-progress` couvre desormais `memory/`** | Apres la derive du wiki, integration du perimetre « factuels seulement » (cache-schema/architecture/LOG/HANDOFF/INDEX). Evite une nouvelle desynchronisation silencieuse. |
