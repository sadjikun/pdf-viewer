# pdf-viewer — Status

> Vue globale du projet.
> Backlog : [`BACKLOG.md`](./BACKLOG.md) | Spec : [`SPEC.md`](./SPEC.md) | Dette : [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md)

**Derniere MAJ** : 2026-05-05 (Phase 4 partielle : 4.2/4.3/4.7)

---

## Etat du projet

| Composant | Stack | Statut | Detail |
|---|---|---|---|
| Backend | Python 3.13 + FastAPI 0.136 | **Stable** | venv, endpoints OK, validations 400/413/422, cache testes |
| Extraction | Docling 2.92 | **Stable** | Hierarchie outline reconstruite, 5 PDFs varies testes |
| Frontend | React 19 + Vite + TS | **Stable** | App, UploadZone, Outline, Viewer, FigureOverlay, Galerie, mobile drawer |
| Rendu PDF | react-pdf 10.4.1 + pdfjs-dist 5.4.296 | **Integre** | ResizeObserver page width, IntersectionObserver highlight, markers figures |
| Cache | Disque, sha256(PDF) + localStorage `lastDocId` | **Implemente** | `backend/cache/<doc_id>/` + restore client au refresh |
| Documentation | CLAUDE / PROJECT_WAY / SPEC / BACKLOG / PROGRESS / TESTS / TECHNICAL_DEBT / DRAFT / PHASE1/2/3_IMPLEMENT / **README** | **OK** | Methodologie + doc utilisateur |
| Reproductibilite | `backend/requirements.txt` (106 packages figes) + `.gitignore` | **OK** | Install backend reproductible |

---

## Phase en cours

**Phase 0 — Cadrage et scaffolding : TERMINEE** (2026-05-04)
**Phase 1 — POC backend : TERMINEE** (2026-05-04, voir [`PHASE1_IMPLEMENT.md`](./PHASE1_IMPLEMENT.md))
**Phase 2 — POC frontend : TERMINEE** (2026-05-05, voir [`PHASE2_IMPLEMENT.md`](./PHASE2_IMPLEMENT.md))
**Phase 3 — Sync bidirectionnelle + figures : TERMINEE** (2026-05-05, voir [`PHASE3_IMPLEMENT.md`](./PHASE3_IMPLEMENT.md), 3.5 partiel)
**Phase 4 — Polish + robustesse : EN COURS** (4.2/4.3/4.7 faits ; 4.1, 4.4, 4.5, 4.6 a faire)

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
