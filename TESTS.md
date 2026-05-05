# pdf-viewer — Registre des tests

> Liste des tests, statuts, couverture par phase.

**Derniere MAJ** : 2026-05-05 (Phase 4 partielle : 4.2/4.3/4.7)

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
