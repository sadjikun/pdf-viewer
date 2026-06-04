# CACHE SCHEMA — Layout et spec result.json

Dernière mise à jour : 2026-06-04 (aligné sur la branche `develop`)

> ⚠️ Ce fichier décrit l'état de **`develop`**. Certaines features de la branche
> v2 d'origine (fast path pypdfium2, de-embedding d'images, rastérisation
> cleaned.pdf, endpoint benchmark) ne sont **pas** sur develop.

---

## Layout `backend/cache/{doc_id}/`

```
cache/
└── {doc_id}/                ← 16 hex (voir « doc_id » plus bas)
    ├── source.pdf           ← PDF original copié (absent pour un doc "registered" non analysé
    │                           et pour les non-PDF : source.docx / source.pptx / …)
    ├── result.json          ← Données (outline, figures, tables, pages, metadata)
    ├── result.html          ← 1re tranche HTML Docling (= html_part_0001.html)
    ├── html_part_0001.html  ← Tranche(s) HTML Docling (images base64 inline + marqueur page)
    ├── html_manifest.json   ← [{start, end, file}] des tranches HTML
    ├── result.md            ← Markdown Docling (export_to_markdown)
    ├── searchable.pdf       ← PDF avec couche texte OCRmyPDF (si /searchable-pdf appelé)
    ├── thumbnail.png         ← Miniature 1re page (~200 px, générée au register ou via /thumbnail)
    ├── annotations.json     ← Highlights + notes (si PUT /annotations)
    ├── error.json           ← Présent seulement si le pipeline a échoué
    └── figures/
        ├── f_0.png
        └── …
```

**Doc référencé (`extraction_mode = "registered"`)** : le dossier contient
uniquement `result.json` (avec `source_path` pointant vers le fichier d'origine)
et `thumbnail.png`. **Pas de copie** du PDF tant que l'analyse complète n'est pas
lancée (`POST /doc/{id}/process` copie alors le fichier en `source.pdf`).

---

## `doc_id` — deux schémas, toujours 16 hex (`^[a-f0-9]{16}$`)

| Origine | doc_id | Dé-duplication |
|---|---|---|
| Upload (`POST /process`) | `sha256(contenu_du_fichier)[:16]` | Même fichier → même ID |
| Référencement (`POST /register`) | `sha256(chemin_absolu_résolu)[:16]` | Même chemin → même ID |

La validation stricte `DOC_ID_RE = ^[a-f0-9]{16}$` est appliquée par `_doc_dir`
avant tout accès disque (protection path-traversal).

---

## Spec `result.json`

```json
{
  "doc_id": "a3f2c1b8e9d04512",
  "filename": "rapport-annuel-2025.pdf",
  "extraction_mode": "docling",
  "source_path": "/Users/moi/docs/rapport.pdf",
  "needs_reprocess": false,
  "n_pages": 12,
  "n_figures": 3,
  "n_tables": 2,
  "pdf_title": "Rapport annuel 2025",
  "pages": [
    { "number": 1, "width": 595.3, "height": 841.9 }
  ],
  "outline": [
    {
      "id": "s_0", "level": 1, "title": "Introduction",
      "page": 1, "bbox": [72.0, 100.0, 523.0, 130.0],
      "children": [
        { "id": "s_1", "level": 2, "title": "1.1 Contexte", "page": 2, "bbox": null, "children": [] }
      ]
    }
  ],
  "figures": [
    { "id": "f_0", "page": 3, "bbox": [72.0, 200.0, 400.0, 450.0],
      "caption": "Figure 1 : Diagramme des flux", "latex": "", "caption_ai": "" }
  ],
  "tables": [
    { "id": "t_0", "page": 5, "bbox": [72.0, 100.0, 523.0, 300.0],
      "caption": "Tableau 1 : Résultats", "html": "<table>...</table>" }
  ]
}
```

---

## Champs importants

| Champ | Type | Notes |
|-------|------|-------|
| `doc_id` | string | 16 hex (hash du contenu **ou** du chemin pour un registered) |
| `filename` | string | Nom original du fichier |
| `extraction_mode` | enum | `"docling"` (PDF, défaut) · `"markitdown"` (DOCX/PPTX/XLSX/HTML/images/notebooks) · `"registered"` (référencé, pas encore analysé) |
| `source_path` | string | (registered) chemin absolu du fichier d'origine, non copié |
| `needs_reprocess` | bool | `true` pour un registered tant qu'il n'est pas analysé |
| `pdf_title` | string | Titre métadonnée PDF (nettoyé des préfixes « Microsoft Word - ») |
| `pages[].width/height` | float | Points PDF (72 pts = 1 pouce) |
| `outline[].bbox` | float[4] ou null | `[x0, y0, x1, y1]` en points PDF (convention BOTTOMLEFT) |
| `figures[].id` | string | Correspond à `figures/{id}.png` |
| `figures[].latex` | string | LaTeX d'une formule-figure via `/latex-ocr` (pix2tex ou Texify). Vide par défaut |
| `figures[].caption_ai` | string | Légende IA Florence-2 via `/caption-figures`. Vide par défaut |
| `tables[].html` | string | HTML brut Docling — **sanitisé côté frontend** avant injection. Les dimensions `n×n` sont calculées dans le composant Tables, pas stockées ici |

> Note : `"fast"`/`"native"` (fast path pypdfium2) et `tesseract_available`,
> `n_rows`/`n_cols`, `result_html` post-traitements TOC/headers — décrits dans la
> v2 d'origine — **n'existent pas** sur develop.

---

## `result.html` / `html_part_*.html`

Générés par `_docling_html_body` = `doc.export_to_html(image_mode=ImageRefMode.EMBEDDED)`,
dont on conserve l'inner `<body>` (images base64 inline). `_write_html_artifacts`
écrit une tranche par batch :

- chaque `html_part_<start:04d>.html` est préfixée d'un marqueur de page
  `<div class="pdf-page-sep" data-page="{start}"></div>` (sync Lecteur ↔ PDF) ;
- `html_manifest.json` = `[{start, end, file}]` consommé par le Reader (`/html-manifest` → `/html-part/{start}`) ;
- `result.html` = copie de la 1re tranche (compat liens directs `/html`).

Si l'export HTML échoue, aucun artefact n'est écrit → le Lecteur retombe sur `/markdown`.

## `annotations.json`

Écrit par `PUT /doc/{id}/annotations` (atomique, limite 1 Mo) :
```json
{ "version": 1, "highlights": [ … ], "notes": { "<key>": "texte" }, "saved_at": 1717400000000 }
```
Consommé par `GET /annotations` et l'export `GET /fiche?format=html|md`.

## `error.json`

Présent si et seulement si le pipeline a échoué après démarrage en background :
```json
{ "error": "ExceptionType: message d'erreur complet" }
```
Purgé lors d'un retraitement (`POST /doc/{id}/reprocess`) ou d'une analyse (`POST /doc/{id}/process`).
