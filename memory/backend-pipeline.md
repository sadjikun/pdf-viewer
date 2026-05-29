# BACKEND PIPELINE — pipeline.py

Dernière mise à jour : 2026-05-22

---

## Point d'entrée principal

```python
convertir_pdf(pdf_path, output_dir, progress_callback=None) -> dict
```

Retourne le dict `result.json`. `progress_callback(percent, message)` est appelé tout au long.

---

## Décision natif vs Docling

```python
def has_native_text(pdf_path: Path) -> bool:
    """pypdfium2 : extrait texte des 3 premières pages, retourne True si > 100 chars."""
```

- **Natif** → `_extraire_natif()` : ~1s, preserve couche texte
- **Scanné** → Docling + RapidOCR : 25-80s selon taille

---

1. `_toc_vers_outline(toc)` : TOC natif pypdfium2 → outline hiérarchique
2. `_outline_depuis_texte_flat()` : scan texte pour annexes absentes du TOC (FIX-003) (saute les pages de sommaire via `_is_toc_page()`)
3. `_outline_depuis_texte()` : fallback si TOC vide → détection par regex (saute les pages de sommaire via `_is_toc_page()`)

**Détection de Table des Matières (TOC) (FIX-051) :**
- `_is_toc_page(text) -> bool` : Détecte si le texte d'une page correspond à une table des matières (TOC) en recherchant des indicateurs explicites ("Table of Contents", "Sommaire", etc.) ou un nombre de lignes ≥ 3 contenant des points de conduite (`...`). Évite que les titres d'annexes listés dans la TOC soient détectés sur la page de sommaire au lieu de leur page réelle.

**Regex de détection de titres :**
```python
_SECTION_PREFIX      = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?(?=\s|$)")       # 1.1, 2.3.4
_TOP_CHAPTER_PREFIX  = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ü])")         # 1. Titre (FIX-013)
_CHAPTER_PREFIX      = re.compile(r"^\s*Chapter\s+(\d+)\s*:", re.IGNORECASE) # Chapter 3:
_ANNEX_PREFIX        = re.compile(r"^\s*(Attachment|Appendix|Annex|Exhibit)\s+([A-Z0-9]+)\b", re.IGNORECASE)
_FALSE_POSITIVE_PATTERNS  # long regex filtrant phrases courantes non-section
```

**`_est_titre_section(line)` critères :**
- Format X.Y minimum (au moins un point), ou Chapter N:, ou Annex A, ou **`N. Titre`** (FIX-013)
- Texte après numéro ≥ 10 chars, ≥ 50 % lettres, ≥ 1 mot de 3+ lettres
- Pas de symboles mathématiques

---

## Docling Path (PDFs scannés)

### Configuration Docling
```python
FORMULA_ENRICHMENT = os.environ.get("FORMULA_ENRICHMENT", "0") == "1"
PIX2TEX_FALLBACK   = os.environ.get("PIX2TEX_FALLBACK", "1") == "1"

PdfPipelineOptions(
    generate_picture_images = True,
    images_scale            = 2.0,        # 144 DPI
    generate_page_images    = True,
    do_formula_enrichment   = FORMULA_ENRICHMENT,  # CodeFormulaV2 (~1-2 GB HF download)
)
```

### Boucle par tranches
```
BATCH_SIZE = 10 (pages par tranche)

Pour chaque tranche [batch_start:batch_end] :
  1. _split_pdf() → PDF temporaire de la tranche
  2. converter.convert(tranche)
  3. Si FORMULA_ENRICHMENT → CodeFormulaV2 déjà appliqué par Docling
  4. Si PIX2TEX_FALLBACK → boucle item par item, pix2tex sur formula-not-decoded
  5. _extraire_sections_doc()  → sections outline
  6. export_to_markdown()      → all_md_parts
  7. export_to_html(EMBEDDED)  → all_html_parts
  8. _extraire_figures_doc()   → all_figures (filtrage < 50×50px)
  9. _extraire_tables_doc()    → all_tables

  Si batch échoue → retry page-par-page (même logique, page unique)
```

### Post-traitement HTML
```python
# Chaîne complète (ordre important) :
_doc_id_for_html = out_dir.name   # doc_id déduit du chemin de cache
_html_images_dir = out_dir / "html_images"

for i, part in enumerate(all_html_parts):
    body = _fix_toc_entries(       # FIX-014 : supprime points de conduite "....47" du sommaire
        _fix_bullet_lists(             # FIX-012 : supprime puces PDF redondantes dans <li>
            _strip_page_headers_footers(   # FIX-004 : numéros de page, italiques courts
                _fix_formula_html(         # formules pix2tex : formula-not-decoded → formula
                    _clean_html_spaces(    # doubles espaces PDF
                        _annotate_split_page_divs(
                            _extract_body(part), page_starts[i]
                        )
                    )
                )
            )
        )
    )
    # FIX-035 : de-embed images base64 → html_images/bN/NNNNNN.ext
    body = _deembed_images(body, _html_images_dir, _doc_id_for_html, i)
```

**`_deembed_images(html, images_dir, doc_id, batch_idx)` (FIX-035) :**  
Remplace chaque `src="data:image/..."` par `/doc/{doc_id}/html-image/bN/NNNNNN.ext`.  
Sauvegarde les images dans `html_images/bN/`. Réduction mesurée : 6.4 MB → 32 KB par batch.

**`_fix_bullet_lists(html)` (FIX-012) :**  
Supprime via regex les caractères de puce PDF (`·•‣◦▪●■`) et le "o" sous-puce (si suivi d'une majuscule) du contenu textuel des `<li>`. Évite le double-bullet CSS `li::marker` + caractère intégré.

---

## Filtre figures `_extraire_figures_doc()`

```python
MIN_DIM  = 50    # px minimum width ET height
MIN_AREA = 2500  # px² (50×50)

img = pic.get_image(doc)
w, h = img.size
if w >= MIN_DIM and h >= MIN_DIM and w * h >= MIN_AREA:
    img.save(img_path)
else:
    continue  # ignore — décoration (puces, lignes, icônes)
```

---

## Pipeline formules (deux passes)

### Passe 1 : CodeFormulaV2 (Docling built-in)
- Activé via `FORMULA_ENRICHMENT=1`
- Modèle Transformers ~1-2 GB téléchargé HuggingFace au premier lancement
- Docling écrit directement le LaTeX dans `item.text`
- Items décodés → classe CSS `formula` (pas `formula-not-decoded`)

### Passe 2 : pix2tex (fallback)
- Activé via `PIX2TEX_FALLBACK=1` (défaut activé) + `pip install pix2tex`
- S'applique aux items `formula`/`equation` dont le texte contient "not decoded"
- `_init_latex_ocr()` charge le modèle une seule fois (lazy singleton)
- Résultat : `item.text = f"${latex.strip()}$"`

### Post-pass : `_fix_formula_html(html)`
- Après export HTML, cherche `<div class="formula-not-decoded">` dont le contenu commence par `$`
- Remplace `formula-not-decoded` → `formula` dans les attributs
- KaTeX frontend rend alors la formule correctement

---

## Fonctions utilitaires clés

| Fonction | Rôle |
|----------|------|
| `_split_pdf(pdf_path, start, end, tmp_dir)` | Extrait pages [start:end) dans un PDF temporaire |
| `_construire_outline(flat_list)` | Transforme liste plate → arbre hiérarchique (level-based) |
| `_strip_page_headers_footers(html)` | Supprime `<p>` numéros de page et courts italiques |
| `_clean_html_spaces(html)` | Collapse whitespace, normalise espaces insécables |
| `_fix_formula_html(html)` | Patch class formula-not-decoded → formula si LaTeX présent |
| `_fix_toc_entries(html)` | Supprime les points de conduite (`.....47`) du HTML sommaire (FIX-014) |
| `_extract_body(html)` | Extrait contenu `<body>` du HTML complet Docling |
| `_init_latex_ocr()` | Initialise pix2tex singleton `_latex_model` |
| `has_native_text(pdf_path)` | Détecte PDF natif vs scanné |
| `_toc_vers_outline(toc)` | TOC pypdfium2 → outline |
| `_outline_depuis_texte(page_texts)` | Regex sur texte brut → outline |
| `_extraire_figures_doc(doc, page_offset, fig_offset, figures_dir)` | Figures Docling → PNG |
| `_extraire_tables_doc(doc, page_offset, table_offset)` | Tables Docling → dict HTML |
| `_extraire_sections_doc(doc, page_offset, id_offset)` | Sections Docling → outline |

---

## Variables d'environnement

| Variable | Défaut | Effet |
|----------|--------|-------|
| `FORMULA_ENRICHMENT` | `0` | `1` → active CodeFormulaV2 au lancement Docling |
| `PIX2TEX_FALLBACK` | `1` | `0` → désactive pix2tex (même si installé) |
| `TESSERACT_CMD` | auto-détecté | Chemin binaire tesseract |
| `TESSDATA_PREFIX` | auto-détecté | Dossier tessdata |
