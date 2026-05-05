# pdf-viewer — Brouillon initial (archive)

> Archive de la conversation initiale (claude.ai, 2026-05-04) qui a fixe le perimetre et la stack. **Ne plus modifier**. La spec stable est dans [`SPEC.md`](./SPEC.md).

---

## Genese

Conversation de cadrage sur claude.ai pour batir un outil de visualisation de PDF avec :
- Navigation a travers un sommaire / table des matieres
- Recuperation et formatage des figures
- Reference initiale : liste GitHub `MHDINGBI/lists/pdf-ocr`

## Questions/reponses de cadrage

| Question | Reponse |
|---|---|
| Type d'outil ? | **Pipeline d'extraction** (PDF → structure) |
| Type de PDF ? | **Mix natif et scanne** |
| Contraintes deploiement ? | **Tout local / self-hosted** |

## Stack proposee (et validee)

| Couche | Choix | Raison |
|---|---|---|
| Backend extraction | **Docling** (1er choix), MinerU (fallback) | Sortie hierarchique native (DoclingDocument), figures comme objets de premiere classe avec bbox, OCR auto pour scannes, tout local CPU |
| Backend API | **FastAPI** | Simple, async, multipart upload natif |
| Frontend SPA | **React + Vite + TypeScript** | `react-pdf` mature, ecosysteme |
| Rendu PDF | **PDF.js** via `react-pdf` | Standard, support outline natif |
| Cache | **Disque, hash sha256** | Pas de re-traitement si meme PDF |

## Architecture cible

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                            │
│  ┌──────────────┬──────────────────────────────┐   │
│  │  Sidebar     │  Viewer (react-pdf)          │   │
│  │  Outline     │  - rendu page par page       │   │
│  │  (arbre)     │  - overlay figures cliquables│   │
│  │              │  - sync scroll ↔ section     │   │
│  └──────────────┴──────────────────────────────┘   │
└─────────────────────┬───────────────────────────────┘
                      │ REST
┌─────────────────────▼───────────────────────────────┐
│  Backend FastAPI                                    │
│  POST /process       → Docling pipeline             │
│  GET  /doc/{id}/...  → outline, figures, raw        │
│  Cache disque (hash PDF)                            │
└─────────────────────────────────────────────────────┘
```

## Point critique identifie

Le **lien sommaire ↔ viewer** (mapping bbox Docling → coordonnees PDF.js). Docling fournit page_no + bbox pour chaque element, ce qui permet :
- Clic sommaire → `pdfViewer.scrollPageIntoView({ pageNumber, destArray: [...bbox] })`
- Scroll viewer → highlight section courante
- Clic figure → overlay HD + caption

**Piege** : convention de coordonnees (BOTTOMLEFT chez Docling vs TOPLEFT cote PDF.js). Conversion necessaire.

## Sprint propose (initial)

1. POC backend (FastAPI + Docling, endpoint `/process`) — 2-3h
2. Frontend minimal : PDF.js + sidebar arbre outline
3. Cabler clic sommaire → scroll page (le plus payant visuellement)
4. Figures cliquables en overlay
5. Tables/formules en iterations suivantes

## Ce qui a ete fait pendant la session de scaffolding (2026-05-04)

- `~/Others/pdf-viewer/{backend, frontend, samples}` cree
- Backend venv Python 3.13 + FastAPI + Docling 2.92 installes
- `main.py` (endpoints `/process`, `/doc/{id}/outline`, `/doc/{id}/figure/{fig_id}`, `/doc/{id}/raw`, `/doc/{id}/pdf`)
- `pipeline.py` (wrapper Docling : outline + figures + bbox)
- Frontend Vite + React TS scaffold + `react-pdf` + `pdfjs-dist`
- Smoke test pipeline sur paper arxiv (`2510.04871v1.pdf`) : **12 pages, 33 sections, 2 figures extraites en PNG** ✅
- Limites observees : sections toutes en `level=1` (hierarchie a reconstituer), bbox en BOTTOMLEFT (a convertir cote frontend)

## Ressources

- Liste outils du user : https://github.com/stars/MHDINGBI/lists/pdf-ocr
- Docling : https://github.com/docling-project/docling
- MinerU : https://github.com/opendatalab/MinerU
