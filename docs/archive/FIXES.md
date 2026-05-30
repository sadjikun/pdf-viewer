# FIXES — Comportements critiques à ne pas régresser

> **SUPERSEDED — Source de vérité : [`memory/fixes-registry.md`](memory/fixes-registry.md)**  
> Ce fichier est conservé pour l'historique git. Ne pas modifier.  
> FIX-001 a été mis à jour dans fixes-registry.md (couvre ICC profiles en plus de JPEG2000).

> Ce fichier est lu par Claude avant toute modification de code.
> Ajouter ici chaque correction importante dès qu'elle est validée.

---

## backend/main.py

### [FIX-001] PDF natif avec JPEG2000 → rastériser quand même
**Fichier** : `main.py` → endpoint `GET /doc/{doc_id}/pdf`  
**Problème** : Les PDFs natifs (extraction_mode = "native"/"fast") étaient servis tels quels.
PDF.js ne supporte pas JPEG2000 (JPXDecode) → images vides.  
**Fix** : Appeler `_has_jpeg2000()` sur les PDFs natifs. Si détecté → générer `cleaned.pdf`
via `_repair_icc_profiles()` exactement comme pour les scannés.  
**Code clé** :
```python
if is_native and not cleaned.exists():
    if _has_jpeg2000(source):
        needs_clean = True
```
**Ne jamais** revenir au pattern : `if not is_native: [rasterize]` sans ce bloc.

---

## backend/pipeline.py

### [FIX-002] Outline : Attachment/Appendix/Annex reconnus comme sections
**Fichier** : `pipeline.py`  
**Problème** : `_est_titre_section()` et `_extraire_sections_doc()` ne reconnaissaient pas
"Attachment A", "Appendix B", "Annex C" comme titres de section.  
**Fix** : Ajout de `_ANNEX_PREFIX` + check dans les deux fonctions.  
**Code clé** :
```python
_ANNEX_PREFIX = re.compile(
    r"^\s*(Attachment|Appendix|Annex|Exhibit)\s+([A-Z0-9]+)\b", re.IGNORECASE)
```

### [FIX-003] Annexes absentes du TOC interne → scan texte complémentaire
**Fichier** : `pipeline.py` → `convertir_pdf()` / `_extraire_natif()`  
**Problème** : Quand le PDF a un TOC natif, `_outline_depuis_texte()` n'était pas appelé.
Les Attachments absents du TOC n'apparaissaient donc jamais dans la sidebar.  
**Fix** : Après `_toc_vers_outline(toc)`, scanner le texte pour les annexes manquantes
et les ajouter à l'outline.

### [FIX-004] HTML : entêtes/pieds de page supprimés
**Fichier** : `pipeline.py` → `_strip_page_headers_footers()`  
**Fix** : Fonction de post-traitement supprimant :
- `<p>` avec numéros de page isolés (ex: "1-1", "A-3")
- `<p>` courts entièrement en italique (en-têtes courants)

---

## frontend/src/components/Reader/MarkdownReader.tsx

### [FIX-005] sectionizeHtml — LEAF_DIV_CLASSES préserve formula-not-decoded
**Problème** : La récursion dans `processNode()` pénétrait dans les `<div class="formula-not-decoded">`
et les détruisait (perte de la class CSS).  
**Fix** : `LEAF_DIV_CLASSES` liste les classes à ne PAS récurser :
```typescript
const LEAF_DIV_CLASSES = [
  "formula-not-decoded", "formula", "equation",
  "table-wrap", "tw", "fig-wrap", "caption",
];
```

### [FIX-006] sectionizeHtml — sections alignées sur l'outline backend
**Problème** : Chaque `<h1>`-`<h4>` créait une section, même les sous-titres internes
("See Attachment A:") → section vide dans le focus mode.  
**Fix** : Seuls les headings dont le texte normalisé correspond à un titre du sommaire backend
créent une nouvelle section. Les autres restent dans la section courante.

### [FIX-007] sectionizeHtml — filtrage entêtes/pieds et logos
**Fix** : 
- `isPageHeaderFooter()` : skip des `<p>` avec numéros de page et courts italiques
- Post-pass logos : suppression des `<figure>` avec image base64 < 30 kB sans légende

### [FIX-008] forwardRef + ReaderHandle pour compare mode synchronisé
**Fix** : `MarkdownReader` est un `forwardRef<ReaderHandle, Props>` exposant
`scrollToSection(title)`. Utilisé dans `App.tsx` pour synchroniser les deux
panneaux en mode Comparer.

---

## frontend/src/App.tsx

### [FIX-009] handleSelect — mode compare navigue les deux panneaux
```typescript
if (viewMode === "compare") {
  if (node.page != null) viewerRef.current?.scrollToPage(node.page);
  readerRef.current?.scrollToSection(node.title);
}
```

### [FIX-010] effectiveViewMode vs viewMode dans les handlers
Les fonctions `handleSelect` et `handlePageChange` sont déclarées AVANT le guard
`if (!doc)` donc AVANT le calcul de `effectiveViewMode`. Elles utilisent `viewMode`
directement. Ne jamais les remplacer par `effectiveViewMode`.

---

## Règle générale

Avant de modifier un fichier listé ici, vérifier que le fix correspondant est encore présent
dans le code. Si un grep ne trouve pas le code clé → NE PAS modifier, alerter l'utilisateur.
