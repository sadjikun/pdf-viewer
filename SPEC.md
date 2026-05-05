# pdf-viewer — Specification

> Specification stable. Source de verite.
> Brouillon initial : [`DRAFT.md`](./DRAFT.md) (archive)

**Version** : 1.0 — 2026-05-04

---

## 1. Objectif

Outil **local self-hosted** de visualisation de PDF avec navigation structuree :
- Affichage du PDF natif dans le navigateur
- Sidebar avec table des matieres reconstituee (meme si le PDF n'a pas d'outline natif)
- Figures extraites comme objets de premiere classe (clic → preview HD + caption)
- Synchronisation bidirectionnelle scroll ↔ outline

Pas de cloud, pas de backend partage, pas de comptes utilisateur. Un user, une machine.

---

## 2. Cas d'usage cibles

| Persona | Type de PDF | Besoin principal |
|---|---|---|
| Chercheur / lecteur de papers | Papers scientifiques (arxiv, IEEE) — multi-colonnes, formules, figures | Naviguer rapidement entre sections, citer figures |
| Ingenieur / consultant | Rapports techniques, specs, normes | Sauter aux sections pertinentes, extraire figures |
| Lecteur de documents legaux | Contrats, decisions de justice | Naviguer par titres meme sans bookmarks |

**Mix natif + scanne** : le pipeline doit gerer les deux automatiquement (Docling route vers OCR si necessaire).

---

## 3. Architecture

```
Frontend (React+Vite+TS)              Backend (FastAPI+Docling)
─────────────────────                 ─────────────────────────
Outline sidebar  ──┐                  POST /process
                   │                    └→ Docling pipeline
Viewer (react-pdf) ┼─── REST ────→     └→ cache/<doc_id>/
                   │                       ├─ source.pdf
Figures overlay  ──┘                       ├─ result.json
                                            └─ figures/*.png

                                       GET /doc/{id}/outline
                                       GET /doc/{id}/figure/{fig_id}
                                       GET /doc/{id}/pdf
                                       GET /doc/{id}/raw
```

---

## 4. Backend — pipeline d'extraction

### 4.1 Format de sortie

Endpoint `POST /process` retourne :

```json
{
  "doc_id": "abcdef0123456789",
  "n_pages": 12,
  "n_figures": 2,
  "pages": [{"number": 1, "width": 612, "height": 792}, ...],
  "outline": [
    {
      "id": "s_3",
      "level": 1,
      "title": "1. Introduction",
      "page": 1,
      "bbox": [l, t, r, b],
      "children": [
        {"id": "s_5", "level": 2, "title": "1.1. ...", ...}
      ]
    }
  ],
  "figures": [
    {"id": "f_0", "page": 3, "bbox": [...], "caption": "Figure 1: ..."}
  ]
}
```

### 4.2 Convention bbox

- **Docling renvoie BOTTOMLEFT** (origine bas-gauche, points PDF, comme la convention native)
- L'API expose les bbox **telles quelles** (BOTTOMLEFT) et c'est au frontend (qui connait la hauteur de la page via `pages[].height`) de convertir en TOPLEFT pour PDF.js
- Decision pourra etre revue (centraliser la conversion dans `pipeline.py`) si plusieurs frontends apparaissent

### 4.3 Cache

- Cle = sha256(bytes PDF) tronque a 16 caracteres hex
- Stockage : `backend/cache/<doc_id>/`
- `result.json` re-utilise si deja calcule
- Endpoint `DELETE /doc/{id}` pour purger

### 4.4 OCR

- Docling detecte automatiquement les pages scannees
- Backend OCR : RapidOCR (telecharge ~40 Mo de modeles au premier run)
- Pas d'override manuel utilisateur dans la v1

---

## 5. Frontend — viewer

### 5.1 Layout

```
┌────────────┬──────────────────────────────────┐
│            │   ┌──────────────────────────┐  │
│  Outline   │   │                          │  │
│            │   │  PDF page (react-pdf)    │  │
│  ▾ Section │   │                          │  │
│    ▾ 1.    │   │  [figure clickable]      │  │
│      • 1.1 │   │                          │  │
│      • 1.2 │   └──────────────────────────┘  │
│    ▾ 2.    │   ┌──────────────────────────┐  │
│            │   │  page suivante           │  │
│            │   └──────────────────────────┘  │
└────────────┴──────────────────────────────────┘
```

### 5.2 Interactions

| Action | Resultat |
|---|---|
| Drop / select PDF | POST /process → render des qu'on a la reponse |
| Clic sur entree outline | Scroll vers la page + zone bbox de la section |
| Scroll dans le viewer | Highlight de la section courante dans l'outline |
| Clic sur figure | Overlay modal avec image HD + caption + lien vers la page |
| Toggle expand/collapse outline | Etat local (pas persiste) |

### 5.3 Composants principaux (proposition)

- `<App>` — gere l'etat global (doc charge, doc_id, outline, figures)
- `<UploadZone>` — drag-and-drop de PDF
- `<Outline>` — arbre recursif, avec highlight de la section courante
- `<Viewer>` — `<Document>` + `<Page>` de react-pdf, virtualisation des pages
- `<FigureOverlay>` — modal au clic sur une figure
- `src/api.ts` — wrapper fetch + types TS
- `src/types.ts` — types partages (DocResult, OutlineNode, Figure)

---

## 6. Scope explicite — ce que le projet est / n'est pas

### Est
- Visualiseur web local pour PDF
- Avec outline reconstitue + figures extraites
- Fonctionne offline une fois Docling + modeles installes
- Mix natif + scanne

### N'est pas (v1)
- Pas multi-utilisateur, pas d'auth, pas de comptes
- Pas de stockage cloud
- Pas d'edition / annotation de PDF
- Pas de recherche full-text dans le viewer (a ajouter v1.1+ si besoin)
- Pas de Docker / packaging exe (manuel : `uvicorn` + `npm run dev`)
- Pas d'export markdown (Docling le supporte, on l'ajoutera si besoin metier)

---

## 7. Indicateurs de succes (POC → MVP)

| Critere | Cible POC | Cible MVP |
|---|---|---|
| Temps de traitement (12 pages, CPU) | < 60s | < 30s |
| Outline correct sur paper arxiv | 80%+ titres extraits | Hierarchie correcte (numerotation `2.1.` → enfant de `2.`) |
| Figures extraites | Toutes les figures detectees par Docling | + caption + overlay HD |
| Sync scroll ↔ outline | Clic sommaire → scroll | + scroll → highlight reciproque |
| Stabilite | Pas de crash sur 5 PDF de test | Pas de crash sur 20 PDF de test varies (papers + rapports + scannes) |
