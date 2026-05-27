# FORMULAS — Pipeline LaTeX

Dernière mise à jour : 2026-05-27

---

## Vue d'ensemble

Trois passes backend + un rendu frontend :

```
PDF (formules)
  │
  ├─ Passe 1 : CodeFormulaV2 (Docling built-in)
  │   └─ FORMULA_ENRICHMENT=1 → Transformers ViT → LaTeX dans item.text
  │
  ├─ Passe 2 : LaTeX-OCR batch (Texify ou pix2tex, selon FORMULA_ENGINE)
  │   └─ PIX2TEX_FALLBACK=1 + pip install texify  (ou pix2tex)
  │   └─ Collecte tous les items "not decoded" → _latex_ocr_batch() → item.text
  │   └─ _convert_figure_formulas() : figures HTML sans caption → batch OCR
  │
  ├─ Post-pass : _fix_formula_html()
  │   └─ class formula-not-decoded → formula si contenu commence par $
  │
  └─ Frontend : KaTeX auto-render
      └─ $…$ → math inline, $$…$$ → math display
```

## Moteur actif : FORMULA_ENGINE

| Valeur | Comportement |
|--------|-------------|
| `auto` (défaut) | Texify si installé, sinon pix2tex, sinon désactivé |
| `texify` | Force Texify (erreur si non installé) |
| `pix2tex` | Force pix2tex legacy |

```bash
set FORMULA_ENGINE=texify   # forcer Texify
set FORMULA_ENGINE=pix2tex  # forcer pix2tex (legacy)
```

### Comparaison moteurs

| Critère | Texify | pix2tex |
|---------|--------|---------|
| Précision | Meilleure (formules multi-lignes, fractions, matrices) | Correcte sur formules simples |
| Batch | `batch_inference(imgs, model, proc)` — un seul appel | Image par image |
| Modèle | ~500 MB (Donut/Swin) | ~400 MB (ViT) |
| Clipboard | Non pollué | **Oui** — `_pix2tex_predict` neutralise ça (FIX) |
| Délimiteurs sortie | Aucun (LaTeX brut) | Parfois avec `$...$` |

### Fonctions unifiées

| Fonction | Rôle |
|----------|------|
| `_resolve_engine()` | Retourne `"texify"`, `"pix2tex"` ou `"none"` selon disponibilité |
| `_latex_ocr_batch(imgs)` | OCR batch sur liste d'images PIL — dispatche vers l'engine actif |
| `_latex_ocr_single(img)` | Raccourci `_latex_ocr_batch([img])[0]` |
| `_latex_ocr_figure(path)` | OCR depuis un fichier PNG (filtre ratio/taille) |

---

## Passe 1 : CodeFormulaV2

**Activation :** `FORMULA_ENRICHMENT=1` (variable d'environnement)  
**Impl :** `PdfPipelineOptions(do_formula_enrichment=True)`  
**Modèle :** Téléchargé automatiquement HuggingFace (~1-2 GB, premier lancement uniquement)  
**Résultat :** Items Docling avec label `formula` ont `item.text` = LaTeX brut  
**Classe CSS produite :** `formula` (pas `formula-not-decoded`)

```bash
# Activer pour une session :
set FORMULA_ENRICHMENT=1
uvicorn main:app --reload --reload-exclude .venv
```

---

## Passe 2 : pix2tex (LaTeX-OCR)

**Activation :** `PIX2TEX_FALLBACK=1` (défaut) + `pip install pix2tex`  
**Dépendance :** pas encore installé sur cette machine (2026-05-21)

**Logique :**
```python
for item, _lvl in doc.iterate_items():
    label_str = str(getattr(item, "label", "") or "").lower()
    if "formula" not in label_str and "equation" not in label_str:
        continue
    text = (getattr(item, "text", "") or "").strip()
    if text and "not decoded" not in text.lower() and len(text) > 3:
        continue  # déjà décodé → skip
    img = item.get_image(doc)
    if img is not None:
        _init_latex_ocr()         # singleton lazy
        latex = _latex_model(img) # ViT → LaTeX string
        if latex and 3 <= len(latex.strip()) <= 600:
            item.text = f"${latex.strip()}$"
```

**`_init_latex_ocr()`** : charge `LatexOCR()` une seule fois dans `_latex_model` global.

---

## Post-pass : `_fix_formula_html(html)`

Après export HTML de Docling, certains items pix2tex-décodés ont encore la classe `formula-not-decoded` dans le HTML (Docling écrit la classe à partir du statut original).

```python
_LATEX_RE = re.compile(r'^\s*(\$\$|\$|\\[\(\[]|\\begin\{)')

def _fix_formula_html(html: str) -> str:
    def _replace(m) -> str:
        tag, attrs, content = m.group(1), m.group(2), m.group(3)
        if _LATEX_RE.search(content):
            new_attrs = re.sub(r'\bformula-not-decoded\b', 'formula', attrs)
            return f'<{tag}{new_attrs}>{content}</{tag}>'
        return m.group(0)  # inchangé si contenu n'est pas LaTeX
    return re.sub(
        r'<(div|span)([^>]*\bformula-not-decoded\b[^>]*)>(.*?)</\1>',
        _replace, html, flags=re.DOTALL,
    )
```

---

## Rendu frontend : KaTeX

**Lib :** `katex/dist/contrib/auto-render.js`  
**Délimiteurs détectés :**
| Délimiteur | Mode |
|-----------|------|
| `$...$` | Inline (simple dollar) |
| `$$...$$` | Display (double dollar) |
| `\(...\)` | Inline |
| `\[...\]` | Display |

**Pas d'`ignoredClasses`** : pix2tex écrit `$latex$` dans le contenu — KaTeX doit pouvoir le rendre même si la div a encore la classe `formula-not-decoded`.

---

## Endpoint POST /doc/{id}/latex-ocr

Relance pix2tex manuellement sur les figures existantes (PNG stockés dans `cache/{id}/figures/`).  
Met à jour `result.json` avec le champ `figure.latex`.  
Filtre : skip les images dont `h > w * 0.6` ou `w * h > 1_000_000` (images trop grandes → pas des formules).

---

## Statuts possibles d'une formule

| Classe CSS | Origine | Rendu frontend |
|-----------|---------|---------------|
| `formula` | Docling natif ou pix2tex décodé | KaTeX rendu si contenu `$…$` |
| `formula-not-decoded` | Formule non décodée | Chip orange `∑ formula not decoded` |
| (texte inline) | pix2tex dans item.text | Passé par `_fix_formula_html` → `formula` |

---

## Installation pix2tex

```bash
# Dans le venv backend :
pip install pix2tex

# Test rapide :
python -c "from pix2tex.cli import LatexOCR; m = LatexOCR(); print('OK')"
# Premier lancement : télécharge modèle ViT (~400 MB)
```
