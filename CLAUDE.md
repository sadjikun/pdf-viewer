# pdf-viewer — Instructions Claude Code

## Contexte

Outil de **visualisation de PDF avec navigation structuree** : pipeline d'extraction (PDF → Docling structured) + frontend de rendu (PDF.js) avec sidebar de table des matieres et figures cliquables. **Local / self-hosted** uniquement, pas de cloud.

Cas d'usage cible : papers scientifiques (multi-colonnes, formules, figures) + documents techniques (rapports, specs). Mix de PDFs natifs (texte extractible) et scannes (OCR via Docling/RapidOCR).

## Workflow

Lire `PROJECT_WAY.md` au debut de chaque session.

## Commandes custom

### `/update-progress`
Met a jour le suivi projet (BACKLOG, PROGRESS, TESTS, TECHNICAL_DEBT, PHASE_IMPLEMENT) apres une session. **Ne jamais ecrire sans validation utilisateur.**

## Stack

| Couche | Tech |
|---|---|
| Backend | Python 3.13 + FastAPI + Uvicorn |
| Extraction | **Docling 2.92** (DoclingDocument, RapidOCR backend) |
| Frontend | React 19 + Vite + TypeScript |
| Rendu PDF | `react-pdf` (wrapper PDF.js) |
| Cache | Disque, cle = sha256(PDF) tronque a 16 chars |
| Lancement | `uvicorn main:app --reload` (backend) + `npm run dev` (frontend) |

## Structure repo

```
pdf-viewer/
  backend/
    .venv/                 ← Python venv (jamais commite)
    main.py                ← FastAPI app + endpoints
    pipeline.py            ← Wrapper Docling (PDF → outline + figures)
    cache/<doc_id>/        ← source.pdf, result.json, figures/
  frontend/
    src/                   ← React app (Vite scaffold)
    package.json
  samples/                 ← PDFs de test (ne pas commiter les gros)
  CLAUDE.md
  PROJECT_WAY.md
  SPEC.md
  BACKLOG.md
  PROGRESS.md
  TESTS.md
  TECHNICAL_DEBT.md
  DRAFT.md                 ← Archive de la conversation initiale
  .claude/commands/        ← Slash commands custom
```

## Regles

- **Pas de sur-ingenierie** : POC d'abord, raffinage ensuite
- **Toujours utiliser le venv** (`source backend/.venv/bin/activate`) — jamais `pip install` global
- **Jamais de modeles dans git** : Docling telecharge ses modeles dans `.venv` au premier run
- **Convention bbox** : Docling utilise BOTTOMLEFT (origine bas-gauche, comme PDF natif). Pour mapper sur PDF.js (TOPLEFT), faire `y_topleft = page_height - y_bottomleft`
- **Dates absolues** dans toute la documentation (ex: `2026-05-04`, jamais "aujourd'hui")
- **Pas de Co-Authored-By** dans les commits
- **Humilite et rigueur** : ne pas affirmer un comportement Docling/PDF.js comme un fait sans verifier dans la doc/source
- **Demander avant de copier des fichiers depuis d'autres projets** (ex: prendre un PDF de `da-extraction/samples`)
