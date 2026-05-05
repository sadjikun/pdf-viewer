# PROJECT WAY — pdf-viewer

Document vivant. Mis a jour au fil des sessions.

---

## 1. Cycle de vie d'une feature

```
SPEC → IMPLEMENT → TEST → COMMIT → UPDATE-PROGRESS
```

### 1.1 Spec
- Spec globale : `SPEC.md` (source de verite)
- Backlog phases : `BACKLOG.md`
- Brouillon initial (archive) : `DRAFT.md`

### 1.2 Implement
- Fichier `PHASE<N>_IMPLEMENT.md` cree a la fin de chaque phase — documente **ce qui a ete reellement implemente** (pas la spec)
- Ecarts spec/code traces dans `TECHNICAL_DEBT.md`

### 1.3 Test
- **Backend** : tests manuels via `curl` ou script smoke-test sur PDFs `samples/`. Pas de pytest pour l'instant (POC)
- **Frontend** : `npm run build` + `npm run lint` + verification visuelle dans le navigateur
- Registre : `TESTS.md`

### 1.4 Commit
- Commits atomiques par feature/fix
- Format : `feat|fix|refactor|docs(scope): message`
- Scopes : `backend`, `pipeline`, `frontend`, `viewer`, `outline`, `figures`, `setup`, `docs`
- **Pas de Co-Authored-By**

### 1.5 Update progress
- Lancer `/update-progress` en fin de session
- Ne modifie les fichiers de suivi qu'apres validation utilisateur

---

## 2. Organisation des documents

```
CLAUDE.md                ← Instructions Claude (contexte + stack + regles)
PROJECT_WAY.md           ← Ce document — workflow, conventions, lecons
SPEC.md                  ← Specification stable (source de verite)
BACKLOG.md               ← Phases, epics, statuts
PROGRESS.md              ← Etat global, derniers changements
TESTS.md                 ← Registre des tests
TECHNICAL_DEBT.md        ← Ecarts, dettes, placeholders
PHASE<N>_IMPLEMENT.md    ← Ce qui a ete fait phase N
DRAFT.md                 ← Brouillon initial (archive)
samples/                 ← PDFs de test
```

| Document | Quand le mettre a jour |
|---|---|
| **CLAUDE** | Si stack ou regles cles changent |
| **PROJECT_WAY** | Fin de session si nouvelle lecon apprise |
| **SPEC** | Si decision change le perimetre |
| **BACKLOG** | Quand une epic commence/finit/est ajoutee |
| **PROGRESS** | Apres chaque session (via `/update-progress`) |
| **PHASE_IMPLEMENT** | Apres chaque phase |
| **TESTS** | Apres chaque phase |
| **TECHNICAL_DEBT** | Des qu'une dette est identifiee ou resolue |

---

## 3. Conventions code

### Backend Python (FastAPI + Docling)
- **Type hints partout** (`from __future__ import annotations`)
- **Pas de globals mutables** sauf le cache disque
- Imports differes pour Docling (chargement long) → import dans le handler, pas au module level
- `pipeline.py` produit du **JSON serialisable directement** : pas d'objets Docling exposes a l'API
- Convention bbox : Docling renvoie en **BOTTOMLEFT** (origine bas-gauche, points PDF). Convertir en TOPLEFT seulement au moment de mapper sur PDF.js cote frontend (ou centraliser la conversion dans `pipeline.py` — a trancher en Phase 2)

### Frontend React/TS
- **Function components**, pas de classes
- **Strict TypeScript** (laisser les options strictes par defaut Vite)
- Components : `src/components/<Domain>/<Component>.tsx`
- Etat : `useState` / `useReducer` pour le local, pas de store global tant que le besoin n'apparait pas
- API calls : un module `src/api.ts` qui encapsule fetch + types

### General
- **Pas de sur-ingenierie** : pas de Docker tant que ce n'est pas demande, pas de tests unitaires tant qu'on n'a pas de regression
- **Pas de framework UI lourd** (Material, Chakra) : Tailwind si besoin, sinon CSS modules
- **Performance** : viser un PDF de 12 pages traite en < 30s sur CPU (cible Docling)

---

## 4. Lecons apprises

_(Sera complete au fil des sessions)_

- **2026-05-04** : Docling telecharge ses modeles RapidOCR au premier run (~40 Mo, dans `.venv/lib/.../rapidocr/models/`). Pas un probleme pour le dev mais a documenter pour packaging futur.
- **2026-05-04** : Docling sort tous les SectionHeader avec `level=1` sur le sample arxiv teste. Reconstruire la hierarchie depuis la numerotation (`2.1.` enfant de `2.`) plutot que de faire confiance au champ `level` brut. → TD a creer.

---

## 5. Sources de reference

- **Docling** : https://github.com/docling-project/docling
- **PDF.js** : https://mozilla.github.io/pdf.js/
- **react-pdf** : https://github.com/wojtekmaj/react-pdf
- **MinerU** (alternative a Docling, garde sous le coude pour layouts complexes) : https://github.com/opendatalab/MinerU
- **Liste des outils PDF/OCR de l'utilisateur** : https://github.com/stars/MHDINGBI/lists/pdf-ocr
