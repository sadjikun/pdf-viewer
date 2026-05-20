# pdf-viewer

Visualiseur de PDF **local et self-hosted** avec navigation structurée :

- **Sommaire** reconstitué à partir de la numérotation, même quand le PDF n'a pas d'outline natif
- **Galerie de figures** extraites comme objets de première classe (clic → preview HD + caption)
- **Recherche plein-texte** dans le PDF avec highlight
- **Export Markdown** du document
- **Tables structurées** extraites et rendues dans la sidebar
- Synchronisation bidirectionnelle scroll viewer ↔ outline
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
uvicorn main:app --reload &
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

### Windows

```powershell
git clone https://github.com/sadjikun/pdf-viewer.git
cd pdf-viewer\backend

# Utiliser py -3.13 pour cibler la bonne version (pas juste "python")
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Pre-telecharger les modeles Docling (une seule fois, ~400 Mo)
python -m docling.cli.models download

uvicorn main:app --reload
```

```powershell
# Frontend (second terminal)
cd pdf-viewer\frontend
npm install
npm run dev
```

> [!NOTE]
> **IPv6 / Hugging Face** : si le téléchargement des modèles échoue avec `WinError 10054`, c'est un problème IPv6. Contournement : forcer IPv4 en ajoutant en tête de `pipeline.py` :
> ```python
> import socket
> _orig = socket.getaddrinfo
> def _ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
>     return _orig(host, port, socket.AF_INET, type, proto, flags)
> socket.getaddrinfo = _ipv4_only
> ```

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
   - Onglet **Tables** : aperçu des tables extraites avec saut vers la page
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
| `Cmd/Ctrl+F` | Focus recherche |
| `Enter` / `Shift+Enter` (recherche) | Résultat suivant / précédent |

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
      components/         ← Outline, Viewer, Gallery, Figure, Tables, Loading, Search, Upload
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
| `POST` | `/process` | Upload un PDF, retourne `{doc_id, outline, pages, figures, …}` |
| `GET` | `/doc/{id}/raw` | result.json complet |
| `GET` | `/doc/{id}/outline` | Arbre des sections |
| `GET` | `/doc/{id}/figure/{fig_id}` | PNG d'une figure |
| `GET` | `/doc/{id}/pdf` | PDF source |
| `GET` | `/doc/{id}/markdown` | Export Markdown (généré à la demande si absent) |
| `DELETE` | `/doc/{id}` | Purge le cache du document |

## Limitations connues

- **Taille max upload** : 100 Mo (constante `MAX_UPLOAD_BYTES` dans `main.py`)
- **Performance** : ≈8–17s pour un paper natif de 12 pages après chargement des modèles, plus long sur PDFs scannés/OCR. Les très gros documents restent à valider sur un corpus réel.
- **Sur-détection SectionHeader** possible sur docs admin (CV, formulaires) malgré les filtres conservateurs. Bruit visuel, pas de crash.
- **Pas de packaging Docker / exe** : lancement manuel via `uvicorn` + `npm run dev`.

Détail dans [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md).

## Documentation projet

- [SPEC.md](./SPEC.md) — spécification stable (source de vérité)
- [BACKLOG.md](./BACKLOG.md) — phases et épics
- [PROGRESS.md](./PROGRESS.md) — état global, derniers changements
- [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) — dettes ouvertes/résolues
- [TESTS.md](./TESTS.md) — registre des tests
- `PHASE<N>_IMPLEMENT.md` — détail de ce qui a été codé phase par phase
