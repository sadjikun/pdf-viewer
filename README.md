# pdf-viewer

Visualiseur de PDF **local et self-hosted** avec navigation structurée :

- **Sommaire** reconstitué à partir de la numérotation, même quand le PDF n'a pas d'outline natif
- **Galerie de figures** extraites comme objets de première classe (clic → preview HD + caption)
- **Onglet Tables** : aperçu HTML des tableaux Docling avec lien vers la page
- **Recherche plein-texte** dans le PDF avec highlight
- **Export Markdown** du document
- **Reader Markdown** avec 2 thèmes (reading / interactive) et rendu KaTeX pour les équations
- **PDF cherchable** généré à la demande via OCRmyPDF + Tesseract (bouton OCR sidebar)
- Synchronisation bidirectionnelle scroll viewer ↔ outline
- **Fast path natif** : PDFs avec texte embarqué traités en ~1s (vs 25s+ Docling)
- Mix natif + scanné géré automatiquement (OCR auto via Docling/RapidOCR)

Pas de cloud, pas d'authentification, pas de stockage partagé. Un user, une machine.

## Quick Start

> [!IMPORTANT]
> **Python 3.13 requis** (le `requirements.txt` est figé sur cette version). Sur macOS : `brew install python@3.13`. Sur Linux : `pyenv install 3.13`.

```bash
git clone git@github.com:sadjikun/pdf-viewer.git
cd pdf-viewer

# Backend (~2 Go de deps via Docling/torch — patiente quelques minutes)
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --reload-exclude .venv &
cd ..

# Frontend (autre terminal recommandé)
cd frontend
npm install
npm run dev
```

Puis ouvre **http://localhost:5173**. Pour un PDF de test rapide :

```bash
mkdir -p samples && curl -L -o samples/test.pdf https://arxiv.org/pdf/2510.04871v1.pdf
```

Et drop `samples/test.pdf` dans la zone d'upload. ~25s de traitement la première fois (Docling + téléchargement modèles RapidOCR ~40 Mo), instantané ensuite via le cache.

### Lancement rapide (Windows)

Après une première installation, plus besoin de lancer les serveurs à la main :

- **`install.bat`** — une seule fois : crée le venv Python + installe les dépendances (Python et npm).
- **`launcher.exe`** — double-clic : ouvre l'application dans une **fenêtre de bureau** (pywebview). Un splash s'affiche pendant le démarrage des serveurs, puis l'app se charge et propose un choix **Standard** (extraction rapide) / **Mode IA** (Florence-2 + Texify). Fermer la fenêtre arrête tout.
- **`launcher.bat`** — relance la fenêtre sans reconstruire l'exe (utile en dev).
- **`build.bat`** — régénère `launcher.exe` après modification de `launcher.py`.

## Stack

| Couche | Tech |
|---|---|
| Backend | Python 3.13 + FastAPI + Uvicorn |
| Extraction | [Docling](https://github.com/docling-project/docling) 2.92 (DoclingDocument + RapidOCR) |
| Frontend | React 19 + Vite + TypeScript |
| Rendu PDF | [react-pdf](https://github.com/wojtekmaj/react-pdf) (wrapper PDF.js) |
| Cache | Disque, clé `sha256(PDF)` tronqué 16 hex |

## Prérequis

- **Python 3.13** (impératif — `requirements.txt` fige les versions transitives sur cette version)
- **Node.js ≥ 20**

`requirements.txt` fige Docling + toutes ses transitives (106 packages, install reproductible). Docling télécharge les modèles RapidOCR (~40 Mo) au premier traitement de PDF, pas au `pip install`.

## Utilisation

1. **Drop un PDF** dans la zone d'upload (ou clic sur "Choisir un fichier…")
2. Patiente pendant l'extraction Docling (5–30s pour un doc court, 60–90s pour un paper de 20+ pages)
3. Une fois traité :
   - Onglet **Sommaire** : navigation par section (clic → scroll viewer)
   - Onglet **Galerie** : grille des figures du document (clic → preview HD)
   - **Recherche** : tape un mot dans la barre, matches surlignés en jaune dans le PDF
   - **Markers figures** : rectangles bleus cliquables sur chaque figure dans le viewer
   - Bouton **`.md`** dans la sidebar : télécharge l'export Markdown du document

Le doc actif est mémorisé dans `localStorage` — au prochain refresh, il est restauré instantanément depuis le cache backend (clé `sha256(PDF)`).

### Raccourcis clavier

| Touche | Action |
|---|---|
| `↑` / `↓` (focus dans l'outline) | Naviguer entre les sections |
| `Enter` / `Space` (focus section) | Activer la section |
| `←` / `→` (overlay figure) | Figure précédente / suivante |
| `Escape` (overlay figure) | Fermer |

### Mobile

Sous 768px de large, la sidebar devient un drawer accessible par le bouton hamburger en haut à gauche.

## Structure du repo

```
pdf-viewer/
  backend/
    .venv/                ← venv Python (jamais commité)
    main.py               ← FastAPI + endpoints
    pipeline.py           ← Wrapper Docling
    cache/<doc_id>/       ← source.pdf, result.json, result.md, figures/
  frontend/
    src/
      components/         ← Outline, Viewer, Gallery, Figure, Loading, Search, Upload
      api.ts, types.ts, bbox.ts, outline.ts
    package.json
  samples/                ← PDFs de test (gros fichiers non commités)
  CLAUDE.md, PROJECT_WAY.md, SPEC.md
  BACKLOG.md, PROGRESS.md, TESTS.md, TECHNICAL_DEBT.md
  PHASE1_IMPLEMENT.md, PHASE2_IMPLEMENT.md, PHASE3_IMPLEMENT.md
```

## Endpoints API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/process` | Upload un PDF, retourne `{doc_id, outline, pages, figures, tables, …}` |
| `GET` | `/doc/{id}/raw` | result.json complet |
| `GET` | `/doc/{id}/outline` | Arbre des sections |
| `GET` | `/doc/{id}/figure/{fig_id}` | PNG d'une figure |
| `GET` | `/doc/{id}/pdf` | PDF source |
| `GET` | `/doc/{id}/markdown` | Export Markdown (généré à la demande si absent) |
| `GET` | `/doc/{id}/searchable-pdf` | PDF avec couche texte OCR (OCRmyPDF + Tesseract) |
| `POST` | `/doc/{id}/ocr-image/{fig_id}` | OCR pytesseract direct sur une figure PNG |
| `POST` | `/doc/{id}/latex-ocr` | Lance pix2tex sur toutes les figures (optionnel) |
| `GET` | `/tesseract/status` | Disponibilité Tesseract, version, langues |
| `DELETE` | `/doc/{id}` | Purge le cache du document |

## Limitations connues

- **Taille max upload** : 100 Mo (constante `MAX_UPLOAD_BYTES` dans `main.py`)
- **Performance** : ≈25s pour un paper de 12 pages, ≈80s pour 26 pages, sur CPU. Pas adapté à de très gros documents en l'état.
- **Sur-détection SectionHeader** sur docs admin (CV, formulaires) — Docling classe parfois des fragments inline en titres de section. Bruit visuel, pas de crash.
- **Lancement** : sous Windows, `launcher.exe` (fenêtre pywebview) démarre tout en un double-clic. Nécessite toujours le venv + `node_modules` (pas de vrai standalone, pas de Docker) ; sinon lancement manuel `uvicorn` + `npm run dev`.
- **Tests** : suite pytest sur les zones sensibles (annotations durables, export fiche, launcher) — pas une couverture exhaustive : `backend/.venv/Scripts/python.exe -m pytest backend/tests tests/launcher`.

Détail dans [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md).

## Documentation projet

- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — **journal complet de toutes les fonctionnalités ajoutées** (fast path, tables, OCR, Reader, LaTeX-OCR)
- [SPEC.md](./SPEC.md) — spécification stable (source de vérité)
- [BACKLOG.md](./BACKLOG.md) — phases et épics
- [PROGRESS.md](./PROGRESS.md) — état global, derniers changements
- [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) — dettes ouvertes/résolues
- [TESTS.md](./TESTS.md) — registre des tests
- `PHASE<N>_IMPLEMENT.md` — détail de ce qui a été codé phase par phase
