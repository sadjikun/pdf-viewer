# CACHE SCHEMA — Layout et spec result.json

Dernière mise à jour : 2026-05-21

---

## Layout `backend/cache/{doc_id}/`

```
cache/
└── {doc_id}/               ← SHA256(pdf_bytes)[:16], ex: "a3f2c1b8e9d04512"
    ├── source.pdf           ← PDF original (ou source.docx / source.pptx pour markitdown)
    ├── result.json          ← Données complètes (outline, figures, tables, pages)
    ├── result.html          ← HTML riche Docling (export_to_html, embedded images)
    ├── result.md            ← Markdown Docling (export_to_markdown)
    ├── cleaned.pdf          ← PDF rastérisé pypdfium2 (si JPEG2000 ou ICC invalide)
    ├── searchable.pdf       ← PDF avec couche texte OCRmyPDF (si généré)
    ├── benchmark.json       ← Résultats benchmark (si lancé via /benchmark)
    ├── benchmark.html       ← Rapport HTML benchmark
    ├── error.json           ← Présent seulement si le pipeline a échoué
    └── figures/
        ├── f_0.png
        ├── f_1.png
        └── …
```

**`doc_id`** est deterministe : même PDF → même ID. Permet la dé-duplication.

---

## Spec `result.json`

```json
{
  "doc_id": "a3f2c1b8e9d04512",
  "filename": "rapport-annuel-2025.pdf",
  "extraction_mode": "fast",
  "pages": [
    { "number": 1, "width": 595.3, "height": 841.9 }
  ],
  "outline": [
    {
      "id": "s_0",
      "level": 1,
      "title": "Introduction",
      "page": 1,
      "bbox": [72.0, 100.0, 523.0, 130.0],
      "children": [
        {
          "id": "s_1",
          "level": 2,
          "title": "1.1 Contexte",
          "page": 2,
          "bbox": null,
          "children": []
        }
      ]
    }
  ],
  "figures": [
    {
      "id": "f_0",
      "page": 3,
      "bbox": [72.0, 200.0, 400.0, 450.0],
      "caption": "Figure 1 : Diagramme des flux",
      "latex": ""
    }
  ],
  "tables": [
    {
      "id": "t_0",
      "page": 5,
      "bbox": [72.0, 100.0, 523.0, 300.0],
      "caption": "Tableau 1 : Résultats",
      "html": "<table>...</table>",
      "n_rows": 4,
      "n_cols": 3
    }
  ],
  "tesseract_available": true
}
```

---

## Champs importants

| Champ | Type | Notes |
|-------|------|-------|
| `doc_id` | string | SHA256(bytes)[:16] — identique pour le même fichier |
| `filename` | string | Nom original du fichier uploadé |
| `extraction_mode` | enum | `"fast"` = pypdfium2 natif, `"docling"` = ML full pipeline |
| `pages[].width/height` | float | Points PDF (72 pts = 1 pouce) |
| `outline[].bbox` | float[4] ou null | `[x0, y0, x1, y1]` en points PDF page |
| `figures[].id` | string | Correspond au nom `figures/{id}.png` |
| `figures[].latex` | string | Décodé par pix2tex (peut être vide) |
| `tables[].html` | string | HTML brut TableFormer (non sanitisé) |

---

## `result.html`

Généré par `doc.export_to_html(image_mode=ImageRefMode.EMBEDDED)`.  
Images inline en base64 (PNG). Pas de CSS externe.

Post-traitements appliqués à l'écriture :
1. `_clean_html_spaces()` : collapse whitespace
2. `_fix_formula_html()` : `formula-not-decoded` → `formula` si LaTeX détecté
3. `_strip_page_headers_footers()` : suppression entêtes/pieds répétitifs
4. Seul le `<body>` est conservé (pas de `<html>/<head>`)

## `error.json`

Présent si et seulement si le pipeline a échoué après démarrage en background :
```json
{ "error": "ExceptionType: message d'erreur complet" }
```
Nettoyé automatiquement lors d'un retraitement (`POST /doc/{id}/reprocess`).
