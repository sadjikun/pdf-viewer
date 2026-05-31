# FIXES REGISTRY — Invariants critiques

> **Source de vérité.** FIXES.md est archivé (historique git). Écrire ici uniquement.
>
> **PROTOCOLE :** Avant toute modification d'un fichier listé ci-dessous,
> grep le "Code clé" du FIX correspondant dans le code source.
> Snippet absent → STOP, alerter l'utilisateur avant de toucher quoi que ce soit.

Dernière mise à jour : 2026-05-29  
FIX actifs : FIX-001 à FIX-074 (FIX-023 revert)

---

## backend/main.py

### FIX-001 — PDFs natifs avec JPEG2000 ou ICC invalide → rastériser
**Fichier :** `main.py` → `GET /doc/{doc_id}/pdf`  
**Problème :** Les PDFs natifs étaient servis tels quels.  
- JPEG2000 (JPXDecode) : non supporté par PDF.js → images vides  
- Profils ICC invalides/corrompus (`cmsOpenProfileFromMem failed`) → images blanches dans PDF.js  

**Fix :** `_needs_rasterize()` détecte les deux cas via PyMuPDF. Si détecté → générer `cleaned.pdf`
via `_repair_icc_profiles()` (rendu pypdfium2 page par page à 108 DPI → PDF image JPEG).  

**Code clé :**
```python
def _needs_rasterize(pdf_path: Path) -> bool:
    # … PyMuPDF : détecte jpx/jp2 ET exceptions ICC/CMS …
    if any(k in err for k in ("cms", "icc", "profile", "format error", "colorspace")):
        found = True

if is_native and not cleaned.exists():
    if _needs_rasterize(source):
        needs_clean = True
```

**Ne jamais** revenir au pattern `if not is_native: [rasterize]` sans ce bloc.  
`_has_jpeg2000 = _needs_rasterize` (alias maintenu pour compatibilité).

---

## backend/pipeline.py

### FIX-002 — Outline : Attachment/Appendix/Annex reconnus comme sections
**Fichier :** `pipeline.py`  
**Problème :** `_est_titre_section()` et `_extraire_sections_doc()` ne reconnaissaient pas
"Attachment A", "Appendix B", "Annex C" comme titres de section.  
**Fix :** Ajout de `_ANNEX_PREFIX` + vérification dans les deux fonctions.

**Code clé :**
```python
_ANNEX_PREFIX = re.compile(
    r"^\s*(Attachment|Appendix|Annex|Exhibit)\s+([A-Z0-9]+)\b", re.IGNORECASE)
```

---

### FIX-003 — Annexes absentes du TOC interne → scan texte complémentaire
**Fichier :** `pipeline.py` → `convertir_pdf()` / `_extraire_natif()`  
**Problème :** Quand le PDF a un TOC natif, `_outline_depuis_texte()` n'était pas appelé.
Les Attachments absents du TOC n'apparaissaient donc jamais dans la sidebar.  
**Fix :** Après `_toc_vers_outline(toc)`, scanner le texte pour les annexes manquantes
et les ajouter à l'outline.

**Code clé :**
```python
# Après construction outline depuis TOC :
annex_from_text = [s for s in _outline_depuis_texte_flat(page_texts)
                   if _ANNEX_PREFIX.match(s["title"])]
# Filtrer celles déjà présentes → append aux top-level
```

---

### FIX-004 — HTML : entêtes/pieds de page supprimés
**Fichier :** `pipeline.py` → `_strip_page_headers_footers()`  
**Fix :** Post-traitement supprimant :
- `<p>` avec numéros de page isolés (ex: "1-1", "A-3", chiffres seuls)
- `<p>` courts entièrement en italique (en-têtes courants répétitifs)

**Code clé :**
```python
def _strip_page_headers_footers(html: str) -> str:
    # Regex sur <p> isolés : numéros de page et paragraphes courts entièrement en italique
```

---

## frontend/src/components/Reader/MarkdownReader.tsx

### FIX-005 — sectionizeHtml : LEAF_DIV_CLASSES préserve formula-not-decoded
**Problème :** La récursion dans `processNode()` pénétrait dans les `<div class="formula-not-decoded">`
et détruisait la classe CSS (rendu cassé).  
**Fix :** `LEAF_DIV_CLASSES` liste les classes dans lesquelles la récursion s'arrête.

**Code clé :**
```typescript
const LEAF_DIV_CLASSES = [
  "formula-not-decoded", "formula", "equation",
  "table-wrap", "tw", "fig-wrap", "caption",
];
```

---

### FIX-006 — sectionizeHtml : sections alignées sur l'outline backend
**Problème :** Chaque `<h1>`-`<h4>` créait une section, même les sous-titres internes
("See Attachment A:") → section vide dans le focus mode.  
**Fix :** Seuls les headings dont le texte normalisé correspond à un titre du sommaire backend
(`outlineTitles` set) créent une nouvelle section. Les autres restent dans la section courante.

**Code clé :**
```typescript
// normalizeTitle : lowercase, trim, collapse whitespace
const outlineTitles = new Set(props.outline.map(n => normalizeTitle(n.title)));
// Dans processNode : if (outlineTitles.has(normalizeTitle(heading.text))) → new section
```

---

### FIX-007 — sectionizeHtml : filtrage entêtes/pieds et logos
**Fix :**
- `isPageHeaderFooter()` : skip des `<p>` avec numéros de page et courts italiques
- Post-pass logos : suppression des `<figure>` avec image base64 < 10 kB et **sans légende du tout** (wordCount === 0)
  - ⚠️ Seuil délibérément strict : 10 000 chars ≈ 7 kB. Ne jamais remonter à 30 000 (ancien seuil trop agressif → FIX-011).

**Code clé :**
```typescript
function isPageHeaderFooter(el: Element): boolean {
  // Détecte numéros de page et paragraphes courts entièrement en <em>/<i>
}
// Post-pass logos — wordCount DOIT être === 0 (pas ≤ 4) et seuil DOIT être < 10_000
if (wordCount === 0) {
  const isSmallBase64 = src.startsWith("data:") && src.length < 10_000;
  if (isSmallBase64) fig.remove();
}
```

---

### FIX-008 — forwardRef + ReaderHandle pour compare mode synchronisé
**Fix :** `MarkdownReader` est un `forwardRef<ReaderHandle, Props>` exposant `scrollToSection(title)`.
Utilisé dans `App.tsx` pour synchroniser les deux panneaux en mode Comparer.

**Code clé :**
```typescript
export interface ReaderHandle { scrollToSection: (title: string) => void; }
const MarkdownReader = forwardRef<ReaderHandle, Props>((props, ref) => {
  useImperativeHandle(ref, () => ({ scrollToSection }));
```

---

## frontend/src/App.tsx

### FIX-009 — handleSelect : mode compare navigue les deux panneaux
**Code clé :**
```typescript
if (viewMode === "compare") {
  if (node.page != null) viewerRef.current?.scrollToPage(node.page);
  readerRef.current?.scrollToSection(node.title);
}
```

---

### FIX-010 — effectiveViewMode vs viewMode dans les handlers
**Problème :** `handleSelect` et `handlePageChange` sont déclarées AVANT le guard `if (!doc)`,
donc AVANT le calcul de `effectiveViewMode`. Utiliser `effectiveViewMode` ici serait `undefined`.  
**Fix :** Ces fonctions utilisent `viewMode` directement.

**Code clé :**
```typescript
// handleSelect et handlePageChange : utiliser viewMode, JAMAIS effectiveViewMode
const effectiveViewMode = doc ? viewMode : "pdf"; // calculé APRÈS les handlers
```

---

---

## frontend/src/components/Reader/MarkdownReader.tsx (suite)

### FIX-011 — Images côte à côte non affichées dans le Reader
**Fichier :** `MarkdownReader.tsx` → `sectionizeHtml()` + `MarkdownReader.css`  
**Problème :** Les images apparaissant côte à côte dans le PDF (ex : boîte de dialogue + barre d'icônes) n'étaient pas toutes rendues dans le Reader. Le filtre anti-logo (`wordCount ≤ 4 && src.length < 30 000`) supprimait les images sans légende de taille modeste (barres d'icônes toolbar < 30 kB base64).  
**Fix :**
- Seuil logo resserré : `wordCount === 0` et `src.length < 10_000` (voir FIX-007 mis à jour).
- CSS ajouté dans `MarkdownReader.css` : conteneur flex pour les `<div>` / `<section>` contenant plusieurs `<figure>` consécutives → disposition côte à côte fidèle au PDF.

**Code clé :**
```typescript
// wordCount === 0 ET seuil 10_000 — NE PAS remonter ces valeurs
if (wordCount === 0) {
  const isSmallBase64 = src.startsWith("data:") && src.length < 10_000;
  if (isSmallBase64) fig.remove();
}
```
```css
/* CSS side-by-side figures */
.reader-doc div:has(> figure + figure) {
  display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
}
.reader-doc div:has(> figure + figure) figure {
  flex: 1 1 auto; min-width: 120px; max-width: 48%; margin: 0;
}
```

---

## backend/pipeline.py (suite)

### FIX-012 — Double puces dans les listes Docling (`• · text`, `• o text`)
**Fichier :** `pipeline.py` → `_fix_bullet_lists()` + `MarkdownReader.tsx` → `sectionizeHtml()`  
**Problème :** Docling préserve les caractères de puce PDF (Unicode · U+00B7, • U+2022, et le caractère "o" utilisé comme puce de sous-liste dans les PDFs Word) comme premier caractère du texte des éléments `<li>`. Le CSS `li::marker` ajoute déjà un symbole de puce coloré → double puce visible : `• · Modeling…` ou `• o Advance Design…`.  
**Fix :** Deux couches complémentaires :
1. **Backend** (`pipeline.py`) : nouvelle fonction `_fix_bullet_lists(html)` dans la chaîne de post-traitement HTML, utilise regex sur `<li>…</li>` pour supprimer les caractères redondants à la source (bénéficie au cache). Branchée après `_strip_page_headers_footers`.
2. **Frontend** (`sectionizeHtml`) : post-pass DOM sur `root.querySelectorAll("li")` et `root.querySelectorAll("p")` pour nettoyer les caractères résiduels côté client (couvre les documents en cache ancien).

**Garde-fous :**
- Le "o" n'est supprimé que s'il est suivi d'une lettre majuscule (`/^o\s+(?=[A-ZÀ-Ü])/`) pour ne pas affecter des mots normaux comme "or", "on", "other".
- Seuls les caractères Unicode de puce bien définis sont ciblés (`·•‣◦▪●■`), pas les tirets qui peuvent être légitimes.

**Code clé :**
```python
# backend : _fix_bullet_lists() branchée dans la chaîne
body_parts = [
    _fix_bullet_lists(
        _strip_page_headers_footers(
            _fix_formula_html(
                _clean_html_spaces(_extract_body(part))
            )
        )
    )
    for part in all_html_parts
]
```
```typescript
// frontend : sectionizeHtml post-pass
const LEAD_BULLET_RE = /^[·•‣◦▪●■]\s*/;
const LEAD_O_RE = /^o\s+(?=[A-ZÀ-Ü])/;
root.querySelectorAll("li").forEach((li) => {
  cleanBulletText(li.firstChild);
  const firstP = li.querySelector(":scope > p:first-child");
  if (firstP) cleanBulletText(firstP.firstChild);
});
```

---

### FIX-013 — Chapitres top-level "1. Titre" absents de l'outline (fast path)
**Fichier :** `pipeline.py` → `_est_titre_section()` + `_TOP_CHAPTER_PREFIX`  
**Problème :** `_SECTION_PREFIX` exige le format `X.Y` (au moins un point dans le numéro). Les chapitres numérotés à un seul niveau ("1. Welcome", "2. Quick list", ...) n'étaient jamais détectés par le scan de texte → absents de la sidebar.  
**Fix :** Ajout de `_TOP_CHAPTER_PREFIX = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ü])")` et branche correspondante dans `_est_titre_section` avec les mêmes garde-fous (≥5 chars, mot de 3+ lettres, ratio lettres ≥ 50 %, pas de symboles math, pas de faux positif).

**Code clé :**
```python
_TOP_CHAPTER_PREFIX = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ü])")

# Dans _est_titre_section, avant le bloc _SECTION_PREFIX :
m_top = _TOP_CHAPTER_PREFIX.match(line)
if m_top:
    rest = line[m_top.end() - 1:].strip()
    if (len(rest) >= 5 and _ALPHA_WORD.search(rest)
            and not _MATH_HEAVY.search(rest)
            and not _FALSE_POSITIVE_PATTERNS.match(line)):
        alpha_ratio = sum(c.isalpha() for c in rest) / max(len(rest), 1)
        if alpha_ratio >= 0.50:
            return True, 1
```

---

### FIX-014 — Points de conduite TOC (`.....47`) affichés dans le Reader
**Fichier :** `pipeline.py` → `_fix_toc_entries()` + `MarkdownReader.tsx` → `sectionizeHtml()`  
**Problème :** Le sommaire du PDF contient des lignes du type "7. Results and reports .....47". Docling les exporte telles quelles en HTML → les points de conduite et le numéro de page s'affichent dans le Reader.  
**Fix :**
1. **Backend** (`pipeline.py`) : `_fix_toc_entries(html)` branchée en tête de la chaîne de post-traitement. Détecte les `<p>` avec ≥3 points consécutifs et supprime le suffixe `\.{3,}\s*\d*`.
2. **Frontend** (`sectionizeHtml`) : post-pass DOM sur `root.querySelectorAll("p")` avec `TOC_LEADER_RE = /[\s.·]{3,}\s*\d*\s*$/` pour couvrir les documents en cache.

**Code clé :**
```python
# Pipeline : _fix_toc_entries ajoutée en tête de chaîne
body_parts = [
    _fix_toc_entries(
        _fix_bullet_lists(
            _strip_page_headers_footers(...)
        )
    )
    for part in all_html_parts
]
```
```typescript
// Frontend : sectionizeHtml post-pass
const TOC_LEADER_RE = /[\s.·]{3,}\s*\d*\s*$/;
root.querySelectorAll("p").forEach((p) => {
  if (/\.{3,}/.test(p.textContent ?? "")) {
    const cleaned = (p.textContent ?? "").replace(TOC_LEADER_RE, "").trim();
    if (cleaned) p.textContent = cleaned; else p.remove();
  }
});
```

---

## frontend/src/components/Reader/MarkdownReader.tsx (suite)

### FIX-015 — Sections non cliquables : Docling supprime les préfixes numériques des titres
**Fichier :** `MarkdownReader.tsx` → `sectionizeHtml()`  
**Problème :** Docling exporte les titres de section sans leur préfixe numérique. L'outline backend a "2. Quick list" mais le heading HTML est `<h2>Quick list</h2>`. La comparaison `outlineTitles.has(norm("Quick list"))` échoue car le Set ne contient que `"2quicklist"` → la section n'est jamais créée → le clic sidebar ne navigue nulle part.  
**Fix :** Remplacement du `Set<string>` par un `Map<string, string>` (`normalizedVariant → originalTitle`). Pour chaque titre de l'outline, on enregistre deux clés : le titre complet normalisé ET le titre normalisé après suppression du préfixe numérique (`^\s*\d+(?:\.\d+)*\.?\s+`). La valeur est toujours le titre original de l'outline. Le titre stocké dans `sections[]` est le titre de l'outline (pas le texte du heading HTML) → `scrollToSection` match exactement.

**Code clé :**
```typescript
// outlineTitleMap : normalisedVariant → originalOutlineTitle
const outlineTitleMap = new Map<string, string>();
function collectTitles(nodes: OutlineNode[]) {
  for (const n of nodes) {
    outlineTitleMap.set(norm(n.title), n.title);                          // "2quicklist" → "2. Quick list"
    const stripped = norm(n.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "")); // "quicklist" → "2. Quick list"
    if (stripped && stripped !== norm(n.title)) outlineTitleMap.set(stripped, n.title);
    if (n.children?.length) collectTitles(n.children);
  }
}
// section.title = matchedOutlineTitle ?? headingText  ← outline title, not heading
```

---

## backend/pipeline.py + frontend (FIX-016)

### FIX-016 — Logique de pages PDF dans le Reader (séparateurs + navigation)
**Fichiers :** `pipeline.py` + `MarkdownReader.tsx` + `MarkdownReader.css`  
**Problème :** Le Reader ignorait complètement les limites de pages PDF. Tout le contenu s'affichait en flux continu sans correspondance avec les pages du PDF.  
**Fix :**
1. **Backend** : `export_to_html(split_page_view=True)` → Docling produit `<div class='page'>` par page. `_annotate_split_page_divs(html, batch_page_start)` remplace chaque `<div class='page'>` par `<div class="pdf-page-sep" data-page="N">` + `<div class="docling-page" data-page-no="N">`. Fallback : marqueur unique au début si Docling ne produit pas de divs pages.
2. **Frontend** (`sectionizeHtml`) : détecte `<div class="pdf-page-sep">` → insère `.pdf-page-marker` visuels dans la section courante, collecte `pdfPageNos[]`. Détecte `<div class="docling-page">` → wrapper transparent (récursion).
3. **Frontend** (toolbar) : compteur "p.N/M" + boutons ‹/›. `scrollToPage(n)` navigue vers le marqueur. Scroll event met à jour `currentPdfPage` en temps réel.
4. **CSS** : `.pdf-page-marker` = séparateur "─── Page N ───". `.reader-content--page-mode` + `scroll-snap-type: y mandatory` + `.pdf-page-marker { scroll-snap-align: start }` = mode page-à-page.

**Code clé :**
```python
# backend : split_page_view=True + annotation
doc.export_to_html(image_mode=ImageRefMode.EMBEDDED, split_page_view=True)
_annotate_split_page_divs(html, batch_start + 1)

# Regex : <div class='page'> → pdf-page-sep + docling-page
_re.sub(r"<div\s+class=['\"]page['\"]>", inject, html)
```
```typescript
// frontend sectionizeHtml : détection marqueur
if (tag === "DIV" && el.classList?.contains("pdf-page-sep")) {
  const pageNo = parseInt(el.getAttribute("data-page") ?? "0");
  // insert .pdf-page-marker, push to pdfPageNos
}
// toolbar :
<button onClick={() => setPageMode(v => !v)}>p.{currentPdfPage}/{lastPage}</button>
```

---

---

## frontend/src/App.tsx (suite)

### FIX-017 — Séparateur compare non déplaçable
**Fichier :** `App.tsx` + `App.css`  
**Problème :** Le divider entre les deux panneaux du mode Compare avait `cursor: col-resize` CSS mais aucun handler d'événement → non draggable.  
**Fix :** `compareRatio` state (0.2–0.8, défaut 0.5, persisté `LS_COMPARE_RATIO`). `handleCompareDividerDown` (même pattern que `handleResizeStart`). Panel PDF : `width: ${compareRatio * 100}%`. Panel Reader : `flex: 1`. Divider : `onMouseDown={handleCompareDividerDown}`.

**Code clé :**
```typescript
const [compareRatio, setCompareRatio] = useState<number>(
  () => parseFloat(localStorage.getItem(LS_COMPARE_RATIO) ?? "0.5"),
);
const handleCompareDividerDown = useCallback((e: React.MouseEvent) => {
  // … même pattern sidebar resize …
  const r = Math.max(0.2, Math.min(0.8, startRatio + dx / totalW));
  setCompareRatio(r);
}, []);
```

---

### FIX-018 — Thèmes Reader désynchronisés des thèmes de l'application
**Fichier :** `MarkdownReader.tsx` + `MarkdownReader.css` + `App.tsx`  
**Problème :** Le Reader avait ses propres thèmes (Minimalist/Tufte/Report/Interactive) déconnectés des thèmes de l'app (Glass/Clair/Tech/Sépia/OLED/Forêt). Les modes sombre (OLED, Forêt) ne déclenchaient pas `isDark` dans le Reader.  
**Fix :** Ajout de `type AppTheme` et `appTheme?: AppTheme` dans `Props`. `isDark` synchronisé : si `appTheme` fourni → `darkThemes.includes(appTheme)` (oled/forest → dark). Classe `.reader--app-${appTheme}` appliquée sur l'élément root. CSS : 6 blocs de variables `--bg/--tx/--or` par thème. `appTheme={theme}` passé depuis `App.tsx`.

**Code clé :**
```typescript
type AppTheme = "glassmorphism"|"minimalist"|"technical"|"vintage"|"oled"|"forest";
const darkThemes: AppTheme[] = ["oled", "forest"];
useEffect(() => {
  if (appTheme) setIsDark(darkThemes.includes(appTheme));
}, [appTheme]);
// docClasses : appTheme ? `reader--app-${appTheme}` : ""
```
```css
.reader--app-oled { --bg:#000;--tx:#f5f5f5;--or:#f97316; }
.reader--app-forest { --bg:#0d1f0f;--tx:#d1fae5;--or:#34d399; }
```

---

### FIX-019 — Hamburger caché sur desktop, non câblé à la sidebar
**Fichier :** `App.tsx` + `App.css`  
**Problème :** `.app-hamburger` avait `display: none` en CSS → invisible sur desktop. Sur mobile uniquement il toggleait `sidebarOpen` (overlay), sans affecter `sidebarCollapsed` sur desktop.  
**Fix :** CSS : `.app-hamburger { display: flex }` sur toutes les tailles. Position fixée `top: 0.6rem; left: 0.6rem; z-index: 60`. Quand sidebar collapsée → `left: calc(44px + 0.4rem)`. onClick : `window.innerWidth <= 768` → `setSidebarOpen` (mobile) sinon `setSidebarCollapsed` (desktop). Icône : `☰` quand collapsed, `✕` sinon.

**Code clé :**
```css
.app-hamburger { display: flex; position: fixed; top: 0.6rem; left: 0.6rem; z-index: 60; }
.sidebar-collapsed .app-hamburger { left: calc(44px + 0.4rem); }
```
```typescript
onClick={() => {
  if (window.innerWidth <= 768) setSidebarOpen(v => !v);
  else setSidebarCollapsed(v => !v);
}}
// {sidebarCollapsed ? "☰" : "✕"}
```

---

### FIX-020 — Thème global CSTB et synchronisation globale du mode sombre
**Fichiers :** `App.tsx`, `MarkdownReader.tsx`, `index.css`, `MarkdownReader.css`, `Outline.css`, `FigureOverlay.css`  
**Problème :** L'utilisateur souhaitait un thème visuel dédié et par défaut inspiré de CSTB / Le Reef (orange solide actif, notes vertes avec le préfixe textuel "NOTE" gras). De plus, le mode sombre/clair n'était pas synchronisé de manière globale entre le Reader et l'application shell.  
**Fix :**
- Création du thème global `theme-cstb` (clair et sombre) dans `index.css`.
- Passage d'un état `isDark` global de `App.tsx` au Reader pour synchroniser les modes clair/sombre de toute l'application.
- Largeur par défaut de la sidebar ajustée à `340px`.
- Surcharges CSS pour éléments actifs (orange solide `#ff8c00` et texte blanc dans `Outline.css`) et pour les notes vertes (dans `MarkdownReader.css`).

**Code clé :**
```typescript
const [theme, setTheme] = useState<"glassmorphism" | "minimalist" | "technical" | "vintage" | "oled" | "forest" | "cstb">(
  () => (localStorage.getItem("theme") as any) || "cstb"
);
const [isDark, setIsDark] = useState<boolean>(() => { ... });
```

---

### FIX-021 — Restructuration des listes hiérarchiques plates en listes imbriquées sémantiques
**Fichier :** `MarkdownReader.tsx` → `sectionizeHtml()`  
**Problème :** Docling extrait les listes hiérarchiques sous une forme plate de `<li>` successifs, où les titres de niveau supérieur (niveau 1) ont un attribut `style="list-style-type: ..."` et leurs descriptions (niveau 2) n'en ont pas. Cela cassait la hiérarchie visuelle et aplatissait tout.  
**Fix :** Ajout d'une passe de post-traitement DOM dans `sectionizeHtml` qui parcourt les listes `<ul>` / `<ol>`. Si une liste contient des éléments avec et sans styles de liste, elle regroupe et imbrique les descriptions (sans style) sous le parent précédent dans un nouveau `<ul>` et applique un style gras (`<strong>`) sur le titre parent.  

**Code clé :**
```typescript
    if (hasStyled && hasUnstyled) {
      let lastParentLi: HTMLElement | null = null;
      let currentSubList: HTMLUListElement | null = null;

      lis.forEach((li) => {
        const style = li.getAttribute("style") ?? "";
        const isParent = style.includes("list-style-type");

        if (isParent) {
          lastParentLi = li;
          currentSubList = null;
          // Wrap parent's inline children in <strong>
          const inlineNodes = Array.from(li.childNodes).filter((node) => {
            return node.nodeName !== "UL" && node.nodeName !== "OL";
          });
          // ... insert <strong> ...
        } else {
          // Child item (description) -> move inside a sub-list under lastParentLi
          if (lastParentLi) {
            if (!currentSubList) {
              currentSubList = root.ownerDocument.createElement("ul");
              lastParentLi.appendChild(currentSubList);
            }
            currentSubList.appendChild(li);
          }
        }
      });
    }
```

---

### FIX-022 — Strip rasters pleine-page à l'intérieur des docling-page + en-tête/pied PDF
**Fichiers :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.css`  
**Problème :** `split_page_view=True` (Docling) peut placer le raster pleine-page DANS le `<div class='page'>` (premier enfant) plutôt qu'avant. Le frontend passait ce premier nœud sans contrôle, rendant l'image pleine-page dans le Reader → grand espace blanc. Par ailleurs, les marqueurs de page étaient juste une ligne horizontale sans header/footer, sans titre du document ni numéro de page.  
**Fix :**
- **Backend PASS 2** dans `_annotate_split_page_divs` : regex qui strip la première `<figure><img src="data:image..."></figure>` sans `<figcaption>` apparaissant immédiatement après `<div class="docling-page">`.  
- **Frontend `processNode`** dans `sectionizeHtml` : quand on recurse dans `docling-page`, on skip le premier enfant s'il est une figure/img captionless avec src `data:image/`.  
- **FIX-011 étendu** : filtre post-pass retire aussi les figures > 150 000 chars (rasters qui auraient échappé aux deux passes précédentes).  
- **Marqueurs de page enrichis** : `docFilename` passé à `sectionizeHtml`, marker HTML génère `pdf-page-footer-bar` (pied N-1) + `pdf-page-divider-line` + `pdf-page-header-bar` (en-tête page N).  
- **Compare mode CSS** : `.app-compare-panel--reader .reader-cw { padding: 20px 24px 60px; max-width: 100% }` pour utiliser tout l'espace disponible.

**Code clé :**
```typescript
// sectionizeHtml — docling-page handler (frontend strip raster)
if (tag === "DIV" && el.classList?.contains("docling-page")) {
  ...
  if (firstEl.tagName === "FIGURE" && !firstEl.querySelector("figcaption")) {
    const src = img?.getAttribute("src") ?? "";
    if (src.startsWith("data:image/")) startIdx++; // skip raster
  }
```
```python
# pipeline.py — PASS 2 (backend)
result = _re.sub(
    r'(<div\s+class="docling-page"[^>]*>)\s*'
    r'<figure[^>]*>\s*<img\s[^>]*src="data:image[^"]*"[^>]*/?\s*>\s*</figure>',
    _maybe_strip_inner_raster, result, flags=_re.DOTALL,
)
```

---

### FIX-023 — ~~FIX-011 étendu > 150 000 chars~~ REVERT (images manquantes)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx`  
**Problème initial :** Les rasters pleine-page qui échappaient aux filtres backend passaient dans le Reader.  
**Tentative :** Filtre `src.length > 150_000` → retirait les très grandes images captionless.  
**REVERT 2026-05-23 :** Le seuil de 150 000 chars est trop agressif. Des figures de contenu légitimes
(captures d'écran, schémas haute résolution, photos 144 DPI) dépassent facilement 200 000–500 000 chars
en base64. Résultat : images manquantes dans le Reader (bug utilisateur).
Les rasters pleine-page sont désormais supprimés EXCLUSIVEMENT par :
  – backend `_annotate_split_page_divs()` PASS 2 (sans figcaption dans docling-page)
  – frontend skip du premier enfant captionless dans chaque `<div class="docling-page">`
Le post-pass FIX-011 ne retire plus que les micro-images < 10 000 chars (logos/icônes).  
**Code clé actuel :**
```typescript
const isLogo = src.length < 10_000;  // FIX-011 : logos/icônes seulement
if (isLogo) fig.remove();            // NE PAS filtrer sur taille max
```

---

### FIX-024 — Impression sémantique du Reader seul et synchronisation du titre avec le PDF
**Fichiers :** `frontend/src/App.tsx`, `frontend/src/index.css`  
**Problème :** Lors de l'enregistrement en PDF via l'impression (`Ctrl+P` ou dialogue d'impression), l'utilisateur souhaite n'enregistrer que le contenu du Reader HTML sans les barres d'outils, la barre latérale ou les onglets. De plus, le nom du fichier suggéré par le navigateur doit correspondre au nom d'origine du fichier PDF.  
**Fix :**
1. **Titre dynamique** : Ajout d'un hook `useEffect` dans `App.tsx` qui définit `document.title = doc.filename` lorsque le document est chargé. Ainsi, le navigateur propose le nom du fichier PDF comme nom de fichier par défaut lors de l'enregistrement.
2. **Stylesheet d'impression** : Ajout d'une règle `@media print` globale dans `index.css` qui masque les éléments d'interface (sidebar, hamburger, barres d'outils, onglets) et réinitialise les hauteurs et propriétés d'overflow (remplacement de `height: 100%` et `overflow: auto/hidden` par `visible`) afin d'assurer que l'intégralité du document HTML est imprimée.

**Code clé :**
```typescript
// App.tsx
useEffect(() => {
  if (doc && doc.filename) {
    document.title = doc.filename;
  } else {
    document.title = "pdf-viewer";
  }
}, [doc]);
```
```css
/* index.css */
@media print {
  .app-hamburger, .app-sidebar, .reader-toolbar, ... {
    display: none !important;
  }
  html, body, #root, .app-container, .reader-content {
    height: auto !important;
    overflow: visible !important;
  }
}
```

---

### FIX-025 — Éclater les paragraphes TOC concaténés dans `_fix_toc_entries()`
**Fichier :** `backend/pipeline.py` → `_fix_toc_entries()` PASS 2  
**Problème :** Docling peut extraire toute une page de sommaire PDF comme un seul gros bloc de texte
sans séparateurs entre les entrées. Exemple :
`"1. Welcome to Advance Design 20262.1Composite beams2.2Modeling of pile foundations..."`
`_fix_toc_entries()` PASS 1 nettoyait les dot-leaders mais ne détectait pas cette concaténation.  
**Fix :** PASS 2 ajouté dans `_fix_toc_entries()` :
- Détection : `<p>` long (> 100 chars) contenant ≥ 3 numéros de section `N.M`
- Division : regex `([A-Za-zÀ-ÿ\d])(\d+\.\d+\s*[A-ZÀ-ÿ])` insère `\n` entre fin de texte
  et début du numéro de section collé. Chaque ligne devient un `<p>` distinct.
- Cas couverts : `"beams2.2Modeling"` → `"beams" / "2.2Modeling"` et
  `"20262.1Composite"` → `"2026" / "2.1Composite"`  
**Code clé :**
```python
# backend/pipeline.py — _fix_toc_entries() PASS 2
split = _re.sub(
    r'([A-Za-zÀ-ÿ\d])(\d+\.\d+\s*[A-ZÀ-ÿ])',
    lambda s: s.group(1) + '\n' + s.group(2),
    text,
)
```

---

### FIX-026 — Synchronisation bidirectionnelle Reader → PDF (anti-boucle infinie)
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/App.tsx`  
**Problème :** La synchronisation PDF→Reader existait (scroll PDF → `handlePageChange` → `scrollToSection`),
mais pas la direction inverse. Quand l'utilisateur faisait défiler le Reader en mode compare,
le PDF viewer ne bougeait pas.  
**Fix :**
1. Nouvelle prop `onPageChange?: (page: number) => void` ajoutée à `MarkdownReader`.
2. `isProgrammaticScrollRef` (useRef) ajouté dans le composant. Mis à `true` pendant 700 ms
   lors des appels `scrollToSection()` ou `scrollToPage()` (scrolls programmatiques).
3. Le scroll handler Reader appelle `onPageChange(pg)` uniquement si
   `!isProgrammaticScrollRef.current` (scroll utilisateur, pas rebond de synchro PDF).
4. Dans `App.tsx` : `handleReaderPageChange` → `viewerRef.current?.scrollToPage(page)`,
   passé au Reader compare via `onPageChange={handleReaderPageChange}`.  
**Invariant CRITIQUE :** Ne jamais supprimer `isProgrammaticScrollRef` sinon boucle infinie
Reader→PDF→Reader lors de tout scroll.  
**Code clé :**
```typescript
// MarkdownReader.tsx — dans useImperativeHandle
isProgrammaticScrollRef.current = true;
setTimeout(() => { isProgrammaticScrollRef.current = false; }, 700);

// Scroll handler — condition anti-boucle
if (!isProgrammaticScrollRef.current && onPageChange) onPageChange(pg);

// App.tsx
const handleReaderPageChange = (page: number) => {
  if (viewMode !== "compare") return;
  viewerRef.current?.scrollToPage(page);
};
```

---

### FIX-027 — Reader pleine largeur : `--max-w: 100%` + padding bureau
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.css`  
**Problème :** La variable `--max-w: 840px` limitait la largeur de la carte-document à 840 px,
laissant d'importantes zones grises inutilisées sur les écrans larges.  
**Fix :** `--max-w: 100%` dans `.reader` (base). `.reader-content` reçoit `padding: 0 20px`
pour laisser une fine marge de "bureau" gris visible de chaque côté.
Mode compare : override `padding: 0` (pas de marges latérales, la carte occupe tout le panneau).  
**Invariant :** Les thèmes de lecture étroits (`.t-reading` → 680px, `.t-article` → 720px,
`.t-report` → 820px, `.t-interactive` → 780px) gardent leur `--max-w` propre. Seul le thème
par défaut (CSTB) bénéficie de la pleine largeur.  
**Code clé :**
```css
.reader { --max-w: 100%; }
.reader-content { padding: 0 20px; }
.app-compare-panel--reader .reader-content { padding: 0; }
```

---

### FIX-028 — Strip image-tables Docling + wrap `.table-wrap` + promotion `<thead>`
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Problème :** Docling génère deux types de `<table>` indésirables : (1) des « image-tables » — `<table><tbody><tr><td><figure><img src="data:image/png;base64,..."/>` — qui enveloppent des rasters pleine-page (les mêmes rasters que FIX-022 cible, mais via le chemin table), et (2) des vraies tables sans `<table-wrap>` ni `<thead>`, rendant le style CSS inopérant.  
**Fix :** Deux post-passes dans `sectionizeHtml` :
- **PASS A** : si `textContent.trim().length < 20` **ET** la table contient un `img[src^='data:image/']` → retirer la table (et son éventuel wrapper).
- **PASS B** : envelopper chaque table restante dans un `<div class="table-wrap">` puis promouvoir la 1ère `<tr>` en `<thead>` si aucun `<thead>` n'existe (Docling ne génère jamais de `<thead>`), en convertissant ses `<td>` en `<th>`.
CSS : bordures complètes des cellules (`border-right`), sélecteur `tbody tr:nth-child(even)` (sans `tbody` il ne matchait rien), `vertical-align: top`.  
**Invariant :** Ne jamais abaisser le seuil `textContent < 20` — certaines vraies tables ont des cellules très courtes (numéros de section). Ne jamais supprimer les PASS A/B de `sectionizeHtml`.  
**Code clé :**
```typescript
// PASS A
root.querySelectorAll("table").forEach((table) => {
  if ((table.textContent ?? "").trim().length > 20) return;
  if (table.querySelector("img[src^='data:image/']")) {
    (table.closest(".table-wrap, .tw") ?? table).remove();
  }
});
// PASS B
root.querySelectorAll("table").forEach((table) => {
  if (table.closest(".table-wrap, .tw")) return;
  const wrapper = table.ownerDocument.createElement("div");
  wrapper.className = "table-wrap";
  table.parentNode?.insertBefore(wrapper, table);
  wrapper.appendChild(table);
  if (!table.querySelector("thead")) { /* promote first tr */ }
});
```

---

### FIX-029 — Virtual rendering Viewer PDF : position:absolute + scroll handler + cumulative heights
**Fichiers :** `frontend/src/components/Viewer/Viewer.tsx`, `frontend/src/components/Viewer/Viewer.css`  
**Problème :** TD-008. Le viewer montait TOUS les `<div>` de pages dans le DOM même si elles n'étaient pas visibles. Sur un PDF de 500 pages : 500 divs, 500 canvases potentiels → perf et mémoire dégradées. Le guard `shouldRender ±2` existant évitait les canvases mais pas les wrappers.  
**Fix :** Architecture virtualisation complète :
1. `slotHeights[i]` = hauteur estimée de la page i depuis `PageInfo.width/height` (pas besoin de monter la `<Page>`)
2. `cumulativeHeights[i]` = somme préfixe de slotHeights
3. `viewer-stage` = `<div position:relative; height:totalHeight>` — height fixe → scrollbar correcte
4. Chaque `viewer-page` = `position:absolute; top:cumulativeHeights[p-2]; left:50%; transform:translateX(-50%)`
5. Seules les pages dans `[activePage - 5, activePage + 5]` sont montées dans le DOM (11 max)
6. `scrollToPage(p)` → `el.scrollTop = cumulativeHeights[p-2]` — saut instantané si delta > 5 000 px
7. Scroll handler (passsive) + recherche dichotomique remplace IntersectionObserver
**Invariant :** Ne jamais remettre `margin` sur `.viewer-page` (marge basse intégrée dans `slotHeights`). Ne pas supprimer `.viewer-stage`. `RENDER_BUFFER = 5` minimum pour le scrolling fluide.  
**Code clé :**
```typescript
const slotHeights = useMemo(() => Array.from({ length: numPages }, (_, i) => {
  const info = pages?.find((p) => p.number === i + 1);
  const aspect = info?.width && info?.height ? info.width / info.height : 595 / 842;
  return Math.round(pageWidth / aspect) + PAGE_MARGIN;
}), [numPages, pages, pageWidth]);
// position: absolute; top: cumulativeHeights[p-2]
// viewer-stage: height = totalHeight (sum of all slotHeights)
```

---

### FIX-030 — Filtre sur-détection sections sur docs courts (TD-007)
**Fichiers :** `backend/pipeline.py`  
**Problème :** Sur les docs ≤ 3 pages (CV, lettres), `_extraire_sections_doc` extrait des section_headers Docling sur des rubriques sans numérotation ("Experience", "Objet:", "Dear Sir") → faux sommaire.  
**Fix :** Après `docling_sections.extend(...)` pour tous les batches, si `n_total_pages <= 3`, filtrer pour ne garder que les sections dont le titre match `_SECTION_PREFIX | _TOP_CHAPTER_PREFIX | _ANNEX_PREFIX | _CHAPTER_PREFIX`.  
**Invariant :** Ne pas remonter le seuil au-delà de 3 pages. Les docs numériques de 1-3 pages avec de vraies sections numérotées passent le filtre.  
**Code clé :**
```python
if n_total_pages <= 3 and docling_sections:
    numbered = [s for s in docling_sections if _SECTION_PREFIX.match(s["title"]) or ...]
    if len(numbered) < len(docling_sections):
        docling_sections = numbered
```

---

### FIX-031 — Titre PDF depuis métadonnées (`pdf_title`)
**Fichiers :** `backend/pipeline.py`, `frontend/src/types.ts`, `frontend/src/App.tsx`  
**Problème :** La sidebar et l'onglet Chrome affichaient le nom de fichier uploadé ("source.pdf") au lieu du vrai titre du document.  
**Fix :** Lecture de `src.get_metadata_value("Title")` avant `src.close()` dans `convertir_pdf`. Champ `pdf_title` ajouté au dict de retour, à `DocResult`, et utilisé dans App.tsx (priorité : `pdf_title > filename > doc_id`).  
**Invariant :** `pdf_title` peut être vide (`""`). Toujours avoir un fallback sur `filename` puis `doc_id`.  
**Code clé :**
```python
pdf_title = (src.get_metadata_value("Title") or "").strip()
# ...
"pdf_title": pdf_title,
```

---

### FIX-032 — Images à taille proportionnelle dans le Reader (F6.7)
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx`  
**Problème :** Docling peut poser des attributs `width`/`height` sur les `<img>` qui forcent des tailles incorrectes. Les petits schémas (logos, diagrammes mineurs) s'étirent jusqu'à la pleine largeur du conteneur.  
**Fix :** Post-pass dans `sectionizeHtml` : (1) retire `width`, `height` et les styles correspondants de chaque `<img>` ; (2) lit la largeur naturelle depuis le header PNG (IHDR bytes 16-19, via `atob` sur les 32 premiers chars base64) ; (3) si largeur < 85 % de la largeur page A4 (1240px), pose `max-width: min(Npx, 100%)`.  
**Invariant :** Ne jamais bloquer les images dont la largeur PNG ≥ 85 % PAGE_FULL_WIDTH — elles doivent pouvoir aller à 100 % du conteneur. La valeur `PAGE_FULL_WIDTH = 1240` ne doit pas changer sans recalculer le seuil.  
**Code clé :**
```typescript
const pngW = _getPngWidth(img.src);
if (pngW && pngW < PAGE_FULL_WIDTH * 0.85) {
  img.style.maxWidth = `min(${pngW}px, 100%)`;
}
```

---

### FIX-033 — Pages A4 encadrées : bande "bureau" pleine largeur entre pages Reader (F6.1/F6.5)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.css`  
**Problème :** Le séparateur entre pages PDF dans le Reader était une fine ligne de 2px (gradient), ne donnant pas l'effet "feuilles posées sur un bureau".  
**Fix :** Plusieurs changements coordonnés :
1. `--doc-px: 72px` défini sur `.reader-doc` et utilisé dans `padding: 52px var(--doc-px) 72px`
2. `.pdf-page-divider-line` → bande de 36px en `background: var(--desk)` avec `margin: 0 calc(-1 * var(--doc-px))` pour saigner jusqu'aux bords du `.reader-cw`, plus `box-shadow inset` pour l'effet profondeur
3. `.reader-cw` → `overflow-x: clip` pour empêcher la barre de défilement horizontale due au bleed
4. `--desk` ajouté dans `.reader--dark` (#111115) et dans chaque thème coloré correspondant au fond `.reader-content`
5. Responsive : `--doc-px: 40px` à 900px, `--doc-px: 20px` à 600px, suppression du `padding: 24px 20px 80px` incohérent de `.reader-cw` en mode tablette  
**Invariant :** `overflow-x: clip` sur `.reader-cw` est requis dès que `--doc-px` est utilisé avec bleed. Ne jamais le supprimer. La valeur de `--desk` DOIT correspondre à `background` de `.reader-content` pour chaque thème.  
**Code clé :**
```css
.reader-doc { --doc-px: 72px; padding: 52px var(--doc-px) 72px; }
.reader-cw  { overflow-x: clip; }
.pdf-page-divider-line {
  height: 36px;
  background: var(--desk);
  margin: 0 calc(-1 * var(--doc-px));
}
```

---

### FIX-034 — Reader vide sur gros HTML + Reader pleine largeur
**Fichiers :** `backend/main.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Problème :** (1) Le HTML Docling du doc "Computational Structural Engineering" pèse 599 MB (images base64 embedded). `DOMParser` du browser crashe silencieusement → `sectionizeHtml` retourne `html: ""` → `visibleHtml` falsy → écran blanc. (2) Le Reader était étroit (padding latéral sur `.reader-content` + card centrée) vs le PDF viewer qui occupe toute la largeur.  
**Fix :**
- Backend : `expose_headers=["Content-Length"]` dans CORS ; endpoint `/html` passe de `HTMLResponse(read_text(...))` à `FileResponse(...)` → streaming + Content-Length auto
- Frontend : Guard 3 niveaux : (a) `Content-Length` avant `r.text()` si > 20MB → skip ; (b) `raw.length > 20MB` → skip ; (c) `!html` après sectionizeHtml → skip. Indicateur "⚠️ HTML trop lourd" dans la toolbar.
- CSS : `.reader-content { padding: 0 }` (pleine largeur), `.reader-cw { margin: 0 0 40px; border-radius: 0 }`.  
**Invariant :** La limite 20MB NE DOIT PAS être supprimée sans implémenter une alternative (ex. streaming DOM). Ne jamais charger un HTML > 20MB entier en mémoire JS.  
**Code clé :**
```typescript
const HTML_SIZE_LIMIT = 20 * 1024 * 1024;
const cl = parseInt(r.headers.get("content-length") ?? "0", 10);
if (cl > HTML_SIZE_LIMIT) { setHtmlTooLarge(true); throw new Error("html_too_large"); }
```

---

### FIX-035 — De-embedding images base64 : HTML 571 MB → quelques KB par batch
**Fichier :** `backend/pipeline.py` → `_deembed_images()` + `backend/main.py` → `GET /doc/{id}/html-image/{path}`  
**Problème :** Docling exporte les images en base64 EMBEDDED dans le HTML. Sur un doc de 542 pages, le HTML total atteignait 571 MB, chaque batch de 10 pages pouvant dépasser 6 MB. Le guard FIX-034 (20 MB) rendait le Reader vide pour les batches lourds.  
**Fix :**
1. `_deembed_images(html, images_dir, doc_id, batch_idx)` ajoutée dans la boucle de post-traitement : regex sur `src="(data:image/[^"]+)"`, décode chaque base64, écrit le fichier PNG/JPEG dans `out_dir/html_images/bN/NNNNNN.ext`, remplace le src par `/doc/{doc_id}/html-image/bN/NNNNNN.ext`.
2. Appelée APRÈS `_annotate_split_page_divs` (qui strip les rasters pleine-page) et toute la chaîne de nettoyage.
3. Endpoint `GET /doc/{doc_id}/html-image/{file_path:path}` dans `main.py` sert depuis `html_images/` avec protection path-traversal (`p.resolve().relative_to(images_root.resolve())`).
4. Import `base64` ajouté en tête de `pipeline.py`.

**Résultat mesuré :** 6.4 MB → 32 KB pour un batch réel (200x de réduction).

**Code clé :**
```python
# pipeline.py — dans la boucle post-traitement HTML
body = _deembed_images(body, _html_images_dir, _doc_id_for_html, i)

# pipeline.py — fonction
def _deembed_images(html, images_dir, doc_id, batch_idx):
    batch_dir = images_dir / f"b{batch_idx}"
    batch_dir.mkdir(parents=True, exist_ok=True)
    # ... regex replace src="data:image/..." → API URL
```
```python
# main.py
@app.get("/doc/{doc_id}/html-image/{file_path:path}")
def get_html_image(doc_id: str, file_path: str) -> FileResponse:
    p = (_doc_dir(doc_id) / "html_images" / file_path)
    p.resolve().relative_to(images_root.resolve())  # anti path-traversal
    return FileResponse(p, ...)
```

---

## frontend/src/components/Reader/MarkdownReader.tsx (sectionizeHtml)

### FIX-036 — Layout tables Docling traitées comme conteneurs transparents
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → `isLayoutTable` + `processNode`  
**Problème :** Docling rend certains documents (2 colonnes, layouts) comme `<table><tr><td>…sections…</td></tr>`. `processNode` clonait la table entière dans la section. PASS B la wrappait en `.table-wrap { overflow-x: auto }` ET promouvait la 1ère ligne en `<thead>`. Résultat : contenu orange (gradient `thead tr`) + scrollbar horizontale sur tout le document.  
**Fix :** `isLayoutTable()` détecte les tables layout (cellules contenant `h1-h4`, `div.docling-page`, `div.pdf-page-sep`, ou >3 `<p>`). Dans `processNode`, les layout tables sont récursées cell par cell (transparent) → leur contenu traité normalement sans être mis dans `.table-wrap` ni avoir de `<thead>` promu.  
**Code clé :**
```typescript
const isLayoutTable = (table: Element): boolean => {
  const cells = Array.from((table as HTMLTableElement).cells);
  for (const cell of cells) {
    if (cell.querySelector("h1,h2,h3,h4,div.docling-page,div.pdf-page-sep")) return true;
    if (cell.querySelectorAll("p").length > 3) return true;
  }
  return false;
};
// Dans processNode :
if (tag === "TABLE" && isLayoutTable(el)) {
  const tbl = el as HTMLTableElement;
  for (const row of Array.from(tbl.rows)) {
    for (const cell of Array.from(row.cells)) {
      for (const sub of Array.from(cell.childNodes)) processNode(sub as ChildNode);
    }
  }
  return;
}
```

---

### FIX-037 — Debounce onPageChange (150 ms) dans Viewer pour éviter le jitter compare
**Fichier :** `frontend/src/components/Viewer/Viewer.tsx` → scroll handler  
**Problème :** Scroll rapide dans le PDF Viewer inondait `onPageChange` → Reader sautait en mode compare.  
**Fix :** Debounce 150 ms avant de propager `onPageChange`.  
**Code clé :**
```typescript
debounceTimer = setTimeout(() => { onPageChange?.(p); }, 150);
```

---

### FIX-038 — Nettoyage TOC depuis tous les headings (pas seulement les sections indexées)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml`  
**Problème :** Le heading "Contents" n'est jamais dans l'outline, donc il n'a pas de `section[data-sid]`. La recherche initiale dans `section[data-sid]` ne trouvait rien.  
**Fix :** Rechercher TOUS les `h1-h4`, tester le texte contre `TOC_TITLE_RE`, puis supprimer les siblings jusqu'au prochain heading ou `.pdf-page-marker`.  
**Code clé :**
```typescript
const TOC_TITLE_RE = /^(table\s+of\s+)?contents?$|^sommaire$/i;
root.querySelectorAll("h1,h2,h3,h4").forEach((heading) => {
  if (!TOC_TITLE_RE.test((heading.textContent ?? "").trim())) return;
  // … supprimer siblings …
});
```

---

### FIX-039 — Layout table colonne vide → fallthrough vers colonnes avec rasters (pages annexe)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → processNode layout table  
**Problème :** Pages 33-40 d'un doc Excel : Docling met le raster pleine page dans la colonne gauche, `docling-page` vide à droite. Le Reader n'affichait rien.  
**Fix :** Après traitement de `contentCell`, si elle est vide (pas de texte ni d'image), traiter aussi les autres cellules.  
**Code clé :**
```typescript
const hasText = !!(contentCell.textContent ?? "").trim();
const hasImg  = !!contentCell.querySelector("img");
if (!hasText && !hasImg) {
  for (const cell of Array.from(cells)) {
    if (cell === contentCell) continue;
    for (const sub of Array.from(cell.childNodes)) processNode(sub as ChildNode);
  }
}
```

---

### FIX-040 — Strip artefacts `$` Docling dans les éléments MathML
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` (post-pass)  
**Problème :** Docling enveloppe les formules comme `<mi>$</mi>content<mi>$</mi>` dans le corps MathML. Ces `<mi>` rendent des `$$` visibles avant que KaTeX remplace l'élément.  
**Fix :** Post-pass sur tous les `<math>` : supprimer tout `<mi>` ou `<mo>` dont le textContent est exactement `$`.  
**Code clé :**
```typescript
root.querySelectorAll("math").forEach((mathEl) => {
  mathEl.querySelectorAll("mi, mo").forEach((el) => {
    if ((el.textContent ?? "").trim() === "$") el.remove();
  });
});
```

---

### FIX-041 — Image de page de couverture dans les layout tables (colonne image-seulement)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → processNode layout table  
**Problème :** La page de couverture avait le logo/raster dans la colonne gauche et le texte (titre, auteurs) dans la colonne `docling-page` (droite). Le Reader ne traitait que la colonne contenu → image de couverture absente.  
**Fix :** Après traitement de `contentCell`, si d'autres cellules n'ont PAS de texte mais ont des `<figure>` ou `<img>` directs, les inclure aussi.  
**Code clé :**
```typescript
} else {
  for (const cell of Array.from(cells)) {
    if (cell === contentCell) continue;
    if ((cell.textContent ?? "").trim()) continue;
    for (const fig of Array.from(cell.querySelectorAll(":scope > figure, :scope > img"))) {
      processNode(fig as ChildNode);
    }
  }
}
```

---

### FIX-044 — `_convert_figure_formulas()` : figures-formules → KaTeX via pix2tex backend
**Fichier :** `backend/pipeline.py` — nouvelle fonction `_convert_figure_formulas`, appelée après `_fix_toc_entries` et avant `_deembed_images`  
**Problème :** Docling classe certaines formules comme `PICTURE` (pas `FORMULA`). Le pix2tex fallback existant (lignes 825-851) ne tourne que sur les items labellés formula/equation. Ces formules sont exportées en HTML comme `<figure><img base64>` sans figcaption → ni MathML ni KaTeX.  
**Fix :** Nouveau pass HTML qui scanne les `<figure>` sans `<figcaption>` avec une image base64. Heuristique aspect ratio (`w/h > 1.2` ET `w*h < 1.5M px`) pour distinguer formules des schémas. Si pix2tex réussit → remplace le `<figure>` par `<div class="formula"><math><annotation encoding="TeX">...</annotation></math></div>`.  
**Code clé :**
```python
def _convert_figure_formulas(html: str) -> str:
    FIG_RE = _re.compile(r'<figure>(.*?)</figure>', _re.DOTALL)
    # ... aspect ratio check: w/h > 1.2 and w*h < 1_500_000
    # → remplace par <div class="formula"><math>...</math></div>
```
**Invariant :** Ne JAMAIS retirer cet appel du pipeline — le frontend KaTeX hook lit `<annotation encoding="TeX">` pour rendre les formules.

---

### FIX-045 — Focus mode : boundary chapitres par outline (outline-based, pas level HTML)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` — `visibleHtml` useMemo  
**Problème :** Quand Docling émet tous les titres au même niveau HTML (ex. tous `<h2>`), `sections[i].level > focusLevel` vaut toujours false → boucle s'arrête immédiatement → aucune sous-section n'est affichée en mode focus.  
**Fix :** Utilisation de `outline` (prop backend) comme source de vérité des chapitres top-level. Pour un chapitre top-level : inclure toutes les sections suivantes jusqu'à rencontrer un titre qui correspond à un AUTRE chapitre top-level. Pour un sous-chapitre : fallback level-based.  
**Code clé :**
```typescript
const topLevelNorms = new Set((outline ?? []).map((o) => n(o.title)));
const isFocusTopLevel = topLevelNorms.size > 0 && topLevelNorms.has(focusedTitle);
for (let i = focusIdx + 1; i < sections.length; i++) {
  if (isFocusTopLevel && topLevelNorms.has(sn) && sn !== focusedTitle) break;
  if (!isFocusTopLevel && sections[i].level <= (sections[focusIdx]?.level ?? 1)) break;
}
```
**Invariant :** Ajouter `outline` dans le tableau de dépendances du useMemo. Ne PAS revenir au level-based pour les chapitres top-level.

---

### FIX-046 — Détection TOC structurelle bilingue (toc-entry + page-boundary)
**Fichiers :** `backend/pipeline.py` → `_strip_leaders()` | `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml()`  
**Problème :** FIX-038 ne détecte la table des matières que si le titre du heading correspond à une liste de mots-clés (français/anglais). Un TOC sans heading, ou dans une autre langue, ou où le heading a déjà été supprimé, n'était pas détecté → les entrées TOC restaient visibles dans le Reader comme du corps de texte.  
**Fix :** Deux couches :  
- **Layer 1 (FIX-038 amélioré) :** `TOC_TITLE_RE` étendu (DE/ES/RU/NL + "Index"). Le heading lui-même est maintenant supprimé (`parent.replaceChild(_makeTocNote(), heading)`) plutôt qu'uniquement son contenu.  
- **Layer 2 (structurel FIX-046) :** `_strip_leaders()` backend taggue chaque paragraphe TOC nettoyé avec `class="toc-entry"`. Dans `sectionizeHtml`, on itère les `pdf-page-marker` ; si une page contient ≥ 4 `p.toc-entry` et que ceux-ci représentent ≥ 60 % des paragraphes → toute la page TOC est remplacée par une note sidebar, sans dépendre du nom du heading.  
**Code clé :**
```python
# pipeline.py — _strip_leaders
return f'<p class="toc-entry">{cleaned}</p>'
```
```typescript
// sectionizeHtml — Layer 2
const tocPs = paras.filter(p => p.classList.contains("toc-entry"));
if (tocPs.length >= 4 && tocPs.length >= paras.length * 0.6) { /* replace */ }
```
**Invariant :** Ne jamais supprimer `class="toc-entry"` du `_strip_leaders` return. Ne pas abaisser le seuil 60 % (faux positifs). Le tag `toc-entry` est la jointure backend↔frontend — les deux côtés doivent rester cohérents.

---

### FIX-047 — Pipeline parallèle : Docling batches + pix2tex + HTML writes
**Fichier :** `backend/pipeline.py`  
**Problème :** Le pipeline était entièrement séquentiel : chaque batch Docling attendait le précédent, chaque inférence pix2tex bloquait la suivante, chaque écriture HTML était bloquante.  
**Fix :** Quatre pistes cumulatives (Pistes A-C-E du plan performance) :  
- **Piste A :** `_RE_FIG_FIGURE`, `_RE_FIG_B64`, `_RE_LATEX_START` pré-compilés au niveau module. `_LATEX_RE` local dans `_fix_formula_html` remplacé par `_RE_LATEX_START`. Alias `_re = re` au lieu de `import re as _re`.  
- **Piste B :** `_convert_figure_formulas()` utilise `finditer()` + `ThreadPoolExecutor(max_workers=4)` pour paralléliser les prédictions pix2tex HTML-level. Reconstruction du HTML en une seule passe après futures.  
- **Piste C :** Boucle Docling réécrite autour d'un `ThreadPoolExecutor(max_workers=DOCLING_WORKERS)`. Chaque worker `_run_one_batch()` crée son propre `_converter()` (thread-safe via `_CONVERTER_LOCK`). Pix2tex item-level sérialisé via `_PIX2TEX_LOCK`. IDs figures/tables/sections recalculés après tri des résultats.  
- **Piste E :** Boucle écriture HTML parts remplacée par `ThreadPoolExecutor` + `pool.map(_process_and_write_part, ...)` — traitement régex + écriture disque en parallèle.  
**Code clé :**
```python
DOCLING_WORKERS = int(os.environ.get("DOCLING_WORKERS", "2"))
_CONVERTER_LOCK = threading.Lock()
_PIX2TEX_LOCK   = threading.Lock()

with ThreadPoolExecutor(max_workers=effective_workers) as pool:
    batch_results = sorted(pool.map(_run_one_batch, batch_starts), key=...)
```
**Invariant :** Ne JAMAIS partager un `DocumentConverter` entre threads (non thread-safe). Chaque `_run_one_batch` crée le sien. `_CONVERTER_LOCK` protège uniquement la construction, pas l'utilisation. `_PIX2TEX_LOCK` protège `_pix2tex_predict()` car PyTorch n'est pas thread-safe en inférence partagée. Pour désactiver le parallélisme : `DOCLING_WORKERS=1`.

---

### FIX-048 — `_split_pdf` thread-safe via `_PDFIUM_LOCK`
**Fichier :** `backend/pipeline.py` → `_split_pdf()`  
**Problème :** FIX-047 a introduit des appels parallèles à `_split_pdf()` depuis plusieurs threads (`_run_one_batch` via `ThreadPoolExecutor`). Chaque appel ouvrait le même `pdf_path` avec `pdfium.PdfDocument(str(pdf_path))` simultanément. pypdfium2 (bibliothèque C PDFium) n'est pas thread-safe pour des accès concurrents au même fichier → corruption interne → `PdfiumError: Failed to load document (PDFium: Data format error)`.  
**Fix :** Ajout de `_PDFIUM_LOCK = threading.Lock()` et enrobage de tout le corps de `_split_pdf` dans `with _PDFIUM_LOCK:`. Le chunking pypdfium2 est rapide (ms) donc la sérialisation n'annule pas le gain de FIX-047.  
**Code clé :**
```python
_PDFIUM_LOCK = threading.Lock()

def _split_pdf(pdf_path, start, end, tmp_dir):
    with _PDFIUM_LOCK:
        src = pdfium.PdfDocument(str(pdf_path))
        ...
```
**Invariant :** Tout appel à `pdfium.PdfDocument(str(pdf_path))` depuis un contexte multi-thread DOIT être protégé par `_PDFIUM_LOCK`. Cela inclut la boucle de retry page-par-page dans `_run_one_batch`.

---

### FIX-049 — flat.sort dans _toc_vers_outline (précédemment FIX-102)
**Fichier :** `backend/pipeline.py` → `_toc_vers_outline()`  
**Problème :** Certains PDF placent les Attachments/Annexes en tête de leurs bookmarks/TOC interne alors qu'ils se trouvent à la fin du document. Cela perturbait l'ordre d'affichage dans la sidebar du frontend.  
**Fix :** Tri de la liste des items TOC par numéro de page réelle (les entrées sans page sont placées à la fin) avant de construire la hiérarchie.  
**Code clé :**
```python
flat.sort(key=lambda x: (x["page"] is None, x["page"] or 0))
```
**Invariant :** Ne jamais supprimer ce tri sous peine de voir les Annexes s'afficher en début de sommaire pour certains PDFs.

---

### FIX-050 — Nettoyage du préfixe "Microsoft Word -" dans le titre du document
**Fichiers :** `backend/pipeline.py` → `convertir_pdf()` | `frontend/src/App.tsx` → `cleanPdfTitle()`  
**Problème :** Le titre du document stocké dans le cache ou affiché dans l'onglet/sidebar contenait des préfixes d'applications comme `"Microsoft Word - "` ou `"Microsoft PowerPoint - "`, ce qui nuisait à l'esthétique.  
**Fix :** 
1. **Backend** : Expression régulière pour supprimer les préfixes applicatifs lors de l'extraction des métadonnées du PDF.
2. **Frontend** : Fonction utilitaire `cleanPdfTitle` qui fait le même nettoyage pour assurer la rétrocompatibilité avec les documents déjà en cache.  
**Code clé :**
```python
# backend/pipeline.py
pdf_title = re.sub(r'^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)', '', pdf_title, flags=re.IGNORECASE).strip()
```
```typescript
// frontend/src/App.tsx
const cleanPdfTitle = (title?: string) => {
  if (!title) return "";
  return title.replace(/^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)/i, "").trim();
};
```
**Invariant :** Maintenir la synchronisation du nettoyage entre backend et frontend.

---

### FIX-051 — Saut des pages de Table des Matières (TOC) pour l'extraction de l'outline
**Fichier :** `backend/pipeline.py` → `_is_toc_page()` | `_outline_depuis_texte()` | `_outline_depuis_texte_flat()`  
**Problème :** Sur certains PDF sans TOC native (comme *anchor-bolt-design-guide*), les titres des annexes (ex: `"Attachment A"`) figurent sur la page de Table des Matières sans points de conduite (`....`). Le scanner de sections les détectait donc en page 2 (la TOC) au lieu de leurs pages réelles (page 33, etc.), ce qui les plaçait en début de sommaire dans le frontend en raison de la déduplication et du tri par page.  
**Fix :** Ajout d'une fonction `_is_toc_page()` qui détecte si le texte d'une page correspond à une Table des Matières (présence explicite de mots-clés ou de 3+ lignes contenant des points de conduite `...`). Si c'est le cas, la page est ignorée pour la détection de l'outline, permettant aux annexes de n'être détectées que sur leur page de début réelle.  
**Code clé :**
```python
def _is_toc_page(text: str) -> bool:
    # ...
    if dot_leader_lines >= 3:
        return True
    return False

# Dans _outline_depuis_texte / _outline_depuis_texte_flat :
for pno, text in enumerate(page_texts):
    if _is_toc_page(text):
        continue
```
**Invariant :** Ne jamais scanner la page de Table des Matières pour l'outline sous peine de faux positifs sur les annexes ou autres titres.

---

### FIX-052 — Synchronisation de la recherche globale avec la recherche interne du Reader
**Fichiers :** `frontend/src/App.tsx` | `frontend/src/components/Reader/MarkdownReader.tsx`  
**Problème :** L'outil de recherche dans la barre latérale (sidebar) ne surlignait les termes de recherche que dans le PDF Viewer de gauche, laissant le Reader HTML de droite non mis en surbrillance, ce qui nuisait à l'expérience utilisateur et limitait la navigabilité.  
**Fix :** Ajout de la prop `searchQuery` à `MarkdownReader` (transmise depuis `query` dans `App.tsx`) et branchement d'un `useEffect` pour aligner l'état de recherche interne du Reader sur la prop. Si la prop change, elle ouvre automatiquement la barre de recherche interne du Reader si elle n'est pas vide.  
**Code clé :**
```typescript
// App.tsx
<MarkdownReader ... searchQuery={query} />

// MarkdownReader.tsx
useEffect(() => {
  if (propSearchQuery !== undefined) {
    setSearchQuery(propSearchQuery);
    if (propSearchQuery.trim()) setShowSearch(true);
    else { setShowSearch(false); setSearchCount(0); }
  }
}, [propSearchQuery]);
```
**Invariant :** La prop `searchQuery` doit toujours mettre à jour l'état local `searchQuery` et ouvrir la zone de recherche interne du Reader (`setShowSearch(true)`) si du texte est saisi.

---

---

### FIX-053 — Nettoyage automatique du cache
**Fichier :** `backend/main.py`  
**Problème :** Le répertoire de cache de l'application (`backend/cache/`) grossissait indéfiniment sans mécanisme de purge automatique.  
**Fix :** 
1. Ajout d'une tâche de fond au démarrage de l'application (`@app.on_event("startup")`) qui purge de manière asynchrone les dossiers plus vieux que 30 jours.
2. Ajout d'un endpoint `POST /cache/cleanup` permettant un nettoyage manuel ou programmé avec un paramètre `max_age_days` ajustable.  
**Code clé :**
```python
# Dans main.py
for item in CACHE_DIR.iterdir():
    if not item.is_dir() or item.name in active_ids:
        continue
    # ...
    if mtime < cutoff:
        shutil.rmtree(item)
```
**Invariant :** Ne jamais purger le cache associé à un document dont le traitement est actif (présent dans `active_tasks`).

---

### FIX-054 — Routage d'extraction de secours (Fallback Chain)
**Fichier :** `backend/pipeline.py`  
**Problème :** Si Docling levait une exception (OOM CUDA, erreur d'initialisation, crash de modèle) sur un PDF non natif, le backend renvoyait une erreur HTTP 500, bloquant l'utilisation.  
**Fix :** Enveloppement de la boucle Docling dans un bloc `try/except` général. Si une exception survient ou si aucun HTML n'est généré sur un PDF non natif, le système tente successivement :
1. **Fallback 1** : `MarkItDown` (convertit le PDF en markdown, génère un HTML simple de secours et l'outline).
2. **Fallback 2** : `pypdfium2` (extraction directe de texte et TOC/outline, HTML simple).  
**Code clé :**
```python
# Dans pipeline.py
except Exception as e:
    # ...
    # Fallback 1: MarkItDown
    # ...
    # Fallback 2: pypdfium2
```
**Invariant :** Renvoyer les variables `outline`, `figures`, `tables` et renseigner `extraction_mode` avec la valeur de repli correspondante (`markitdown_fallback` ou `pypdfium2_fallback`).

---

### FIX-055 — Alignement vertical des codes/valeurs séparés par des espaces dans les tableaux
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → PASS B/traitement des tables
**Problème :** Des cellules de tableaux contenant des codes ou valeurs séparés par des espaces (ex: `D1 D2` ou `4,0 5,0`) s'affichaient sur une seule ligne, alors que sur le PDF d'origine elles étaient superposées/alignées verticalement.
**Fix :** Les cellules de tableau (`<td>`/`<th>`) contenant des tokens courts séparés par des espaces ou virgules sont automatiquement reformatées en remplaçant les espaces par des sauts de ligne `<br>`.
**Code clé :**
```typescript
if (tag === "TD" || tag === "TH") {
  const text = el.textContent ?? "";
  const parts = text.trim().split(/\s+/);
  if (parts.length > 1 && parts.every(p => p.length <= 4)) {
    el.innerHTML = parts.join("<br>");
  }
}
```

---

### FIX-056 — Alignement des paragraphes se terminant par un deux-points (Point 2.1.1)
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml`
**Problème :** Les énonciations suivies de deux-points (`:`) étaient renvoyées à la ligne suivante par rapport aux valeurs associées, créant des lignes vides ou un décalage par rapport à la même ligne affichée sur le PDF original.
**Fix :** Si un paragraphe se termine par `:` et que le paragraphe suivant est court ou commence par une minuscule/chiffre, on fusionne les deux paragraphes sur la même ligne.
**Code clé :**
```typescript
if (text.endsWith(":") && nextText && (nextText.length < 50 || /^[a-z0-9]/.test(nextText))) {
  // Fusionne p avec p_next en les séparant par un espace
}
```

---

### FIX-057 — KaTeX display double bordure et glissement vertical
**Fichier :** `frontend/src/components/Reader/MarkdownReader.css`
**Problème :** Les équations KaTeX hors-ligne (`.katex-display`) apparaissaient dans un encadré visible au survol de la page mais disparaissaient lors du défilement (scroll) à cause d'une double bordure/fond appliqué de façon redondante et des décalages d'overflow.
**Fix :** Suppression des styles de bordure, couleur de fond et bordure gauche sur les éléments KaTeX imbriqués ou dans `.formula`, et gestion propre du dépassement horizontal.
**Code clé :**
```css
.reader-doc .formula .katex-display {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  margin: 0.5em 0 !important;
  padding: 0 !important;
}
```

---

### FIX-058 — Compacité de la barre d'outils et des panneaux de navigation
**Fichier :** `frontend/src/components/Reader/MarkdownReader.css`
**Problème :** La barre d'outils supérieure et les panneaux de navigation occupaient trop d'espace vertical utile sur l'écran.
**Fix :** Réduction des paddings et hauteurs des classes `.reader-toolbar`, `.reader-stats`, `.reader-bc`, `.reader-focus-header` et `.reader-focus-nav` pour maximiser la zone de lecture.
**Code clé :**
```css
.reader-toolbar {
  padding: 6px 12px;
  min-height: 40px;
}
```

---

### FIX-059 — Interaction de pliage/dépliage interactif du sommaire (Outline)
**Fichier :** `frontend/src/components/Outline/Outline.tsx`
**Problème :** Lors du clic sur un point du sommaire (ex: Point 2), ses sous-points n'étaient pas affichés ou restaient figés.
**Fix :** Ajout d'un état d'expansion local gérant le dépliage interactif des sous-sections au clic sur les nœuds parents.
**Code clé :**
```typescript
const [expanded, setExpanded] = useState<Record<string, boolean>>({});
const toggleExpand = (title: string) => {
  setExpanded(prev => ({ ...prev, [title]: !prev[title] }));
};
```

---

### FIX-060 — Mise en cache globale de DocumentConverter
**Fichier :** `backend/pipeline.py`
**Problème :** Une nouvelle instance de `DocumentConverter` (Docling) était créée à chaque traitement de batch de 10 pages, entraînant un rechargement coûteux des modèles ML (plusieurs secondes à chaque fois), des pics de consommation mémoire et une forte latence globale.
**Fix :** Introduction d'un cache global de `DocumentConverter` (`_CONVERTERS`) chargé une unique fois et réutilisé pour tous les traitements de documents.
**Code clé :**
```python
_CONVERTERS: dict[bool, DocumentConverter | None] = {True: None, False: None}
```

---

### FIX-061 — Skip check d'update d'Albumentations en environnement réseau restreint
**Fichier :** `backend/pipeline.py`
**Problème :** Lors de l'initialisation du pipeline ou des threads de traitement, la bibliothèque Albumentations tentait de vérifier si une mise à jour était disponible sur Internet, provoquant un timeout bloquant de 10 à 30 secondes en cas d'absence de connexion ou de restriction réseau.
**Fix :** Ajout de la variable d'environnement `NO_ALBUMENTATIONS_UPDATE` au tout début du pipeline pour désactiver cette vérification.
**Code clé :**
```python
os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"
```

---

### FIX-062 — Output UTF-8 et sanitation CP1252 sur console Windows
**Fichiers :** `backend/pipeline.py`, `backend/main.py`
**Problème :** Sous Windows, le terminal utilise par défaut un encodage CP1252/cp850. L'affichage de caractères Unicode (comme `→`, `≥`, `é`, `à`, `×`) provoquait des exceptions `UnicodeEncodeError` lors des écritures dans le terminal en arrière-plan, ce qui faisait planter le générateur HTML.
**Fix :** Reconfiguration des sorties standard standard/erreur en UTF-8 et remplacement des caractères problématiques par des équivalents ASCII (ex: `->`, `>=`, `x`, `e`, `a`) dans les prints de console.
**Code clé :**
```python
# Re-route sys.stdout to UTF-8 on Windows
```

---

### FIX-063 — Adaptation des messages de chargement
**Fichier :** `frontend/src/components/Loading/LoadingDocling.tsx`
**Problème :** Les estimations de temps affichées dans l'encadré d'avertissement rouge ne correspondaient pas au comportement réel du traitement, notamment pour les PDFs scannés traités sur CPU.
**Fix :** Adaptation des temps de traitement annoncés (1 à 3 secondes par page pour les PDFs natifs et 3 à 5 secondes pour les PDFs scannés avec OCR).
**Code clé :**
```typescript
const LoadingDocling = ({ ... }) => {
```

---

### FIX-064 — Threads CPU dynamiques basés sur la RAM disponible
**Fichier :** `backend/pipeline.py`
**Problème :** Sur des machines disposant de nombreux cœurs CPU (ex: 32 cœurs) mais d'une mémoire RAM disponible faible (ex: ~1.7 GB), le nombre de workers est limité à 1 pour éviter l'Out of Memory (OOM). Si ce worker unique n'utilise que 4 threads, 28 cœurs restent inactifs, limitant la vitesse de traitement.
**Fix :** Amélioration de `_compute_docling_workers` pour augmenter dynamiquement le nombre de threads attribués au worker unique (`threads_per = max(4, min(cpu_cores // n, 12))`), permettant un gain de vitesse de 22% sans consommer de RAM supplémentaire.
**Code clé :**
```python
threads_per = max(4, min(cpu_cores // n, 12))
```

---

### FIX-065 — Skip table-wrap et promotion thead/th pour les layout tables
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → PASS B
**Problème :** Docling génère des tableaux de mise en page (ex: 2 colonnes avec texte à gauche et images à droite). Le pré-traitement du Reader (PASS B) enveloppait TOUTES les tables dans `.table-wrap` et promouvait leur première ligne en `thead`/`th`. Cela modifiait la structure DOM, provoquant le renvoi d'un `false` par `isLayoutTable` et forçant le navigateur à afficher des colonnes réduites et décalées.
**Fix :** Ajout d'une condition dans le PASS B pour ignorer les tables identifiées comme layout tables via `isLayoutTable(table)`.
**Code clé :**
```typescript
root.querySelectorAll("table").forEach((table) => {
  if (isLayoutTable(table)) return; // Skip layout tables from wrapping & promotions
```

---

### FIX-066 — Extraction des figures de cellules secondaires sur toutes les pages
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `processNode` layout table
**Problème :** Les figures et images contenues dans la colonne secondaire des tables de mise en page (layout tables) n'étaient extraites et rendues que sur la page 1 (cover). Sur les pages suivantes (ex: page 4, types d'ancres), ces figures étaient totalement masquées.
**Fix :** Retrait de la restriction `pageNo === 1 && firstOutlinePage > 1` afin d'extraire et de traiter récursivement les figures des colonnes secondaires sur toutes les pages du document.
**Code clé :**
```typescript
// Process images from other cells on all pages (FIX-041 extended)
for (const cell of Array.from(cells)) {
  if (cell === contentCell) continue;
  if ((cell.textContent ?? "").trim()) continue; // has text → skip
  for (const fig of Array.from(cell.querySelectorAll(":scope > figure, :scope > img"))) {
    processNode(fig as ChildNode);
  }
}
```

---

### FIX-067 — Lightbox Premium interactive intégrée au Reader
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Figure/FigureOverlay.tsx`
**Problème :** Le Reader disposait d'un lightbox très basique (simple tag `<img>` centré sans contrôles) et ne permettait pas de naviguer d'une image à une autre. L'utilisateur souhaitait disposer des mêmes contrôles que dans le viewer PDF (zoom, rotation, impression, navigation séquentielle).
**Fix :**
1. **Frontend overlay** : Adaptation de `FigureOverlay` pour accepter des identifiants d'image de type chemin relatif, URI de données base64, ou URL absolue.
2. **Reader** : Remplacement de l'état `lightboxSrc` par un index `readerImageIdx` et un tableau `readerImages` de type `Figure[]` récolté via le DOM (`getReaderImages`).
3. Remplacement du JSX du lightbox basique par le composant `FigureOverlay`.
**Code clé :**
```typescript
const getReaderImages = (): Figure[] => {
  // Query all img tags, build list of virtual Figure objects with page and captions
};
```

---

### FIX-068 — Nettoyage et suppression des warnings de formatage KaTeX
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx`
**Problème :** Le rendu des formules mathématiques générait des milliers d'avertissements et d'erreurs (warnings) dans la console du navigateur en raison de caractères non-breaking space (160), zero-width space (8203) ou de nouvelles lignes dans les formules en bloc.
**Fix :**
1. Remplacement de `\u00a0` par un espace standard et suppression de `\u200b` de la chaîne de formules avant le rendu.
2. Ajout de l'option `strict: "ignore"` dans la configuration d'appel `katex.render`.
**Code clé :**
```typescript
latex = latex.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
// ...
katex.render(latex, container, {
  displayMode: isDisplay,
  output: "html",
  throwOnError: false,
  strict: "ignore",
});
```

---

### FIX-069 — Restreindre l'extraction des images secondaires de layout table à la page 1
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `sectionizeHtml` → `processNode` layout table  
**Problème :** Suite à l'extension excessive du FIX-041 dans le FIX-066, les images secondaires des layout tables (qui contiennent les captures pleine page de chaque page de PDF) étaient extraites de façon systématique sur toutes les pages, entraînant l'affichage d'un screenshot de chaque page dans le Reader.  
**Fix :** Ajout de la variable `currentPageNo` dans `sectionizeHtml` et ré-introduction d'une restriction stricte `if (currentPageNo === 1)` sur l'extraction des images secondaires afin de ne garder que l'éventuelle couverture ou logo front-matter.  
**Code clé :**
```typescript
if (currentPageNo === 1) {
  for (const cell of Array.from(cells)) {
    if (cell === contentCell) continue;
    if ((cell.textContent ?? "").trim()) continue;
    for (const fig of Array.from(cell.querySelectorAll(":scope > figure, :scope > img"))) {
      processNode(fig as ChildNode);
    }
  }
}
```

---

### FIX-070 — Focus mode récursif basé sur l'outline/sommaire PDF
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `visibleHtml` useMemo  
**Problème :** En mode focus, l'inclusion des sous-sections reposait uniquement sur les niveaux de balises HTML. Si Docling extrayait par exemple tous les titres en `<h2>`, ou si les niveaux de balises étaient incohérents, le focus mode s'arrêtait immédiatement sans afficher les sous-sections. De plus, cela ne supportait pas de cliquer sur une sous-section pour n'importer que ses sous-parties propres.  
**Fix :** Utilisation de l'arborescence `outline` complète du document comme source de vérité. Recherche récursive du nœud cliqué et collecte de tous ses descendants. Une section HTML est visible dans le Reader si son titre correspond à l'un de ces descendants de l'outline.  
**Code clé :**
```typescript
const searchOutline = (nodes: OutlineNode[]): Set<string> | null => {
  for (const node of nodes) {
    if (nodeNorm === focusNorm || (strippedNode && strippedNode === focusNorm)) {
      const set = new Set<string>();
      collectDescendantTitles(node, set);
      return set;
    }
  }
};
```

---

### FIX-071 — Synchronisation et affichage du nom du PDF dans le Reader
**Fichiers :** `frontend/src/App.tsx`, `frontend/src/components/Reader/MarkdownReader.tsx`  
**Problème :** Le nom du document ou du PDF n'était pas affiché dans le Reader (affichage générique "Document" dans le breadcrumb à l'état initial), et le visualiseur de page n'utilisait que le nom de fichier sans métadonnées nettoyées.  
**Fix :** Prop `pdfTitle` ajoutée à `MarkdownReader`. Initialisation et mise à jour dynamique du `breadcrumb` au changement de document avec le titre nettoyé ou le nom de fichier. Passage de `pdfTitle` à `sectionizeHtml` pour l'en-tête et pied de page des pages Reader.  
**Code clé :**
```typescript
setBreadcrumb(cleanPdfTitle(pdfTitle) || (filename ? filename.replace(/\.[^.]+$/, "") : "Document"));
```

---

### FIX-072 — Annotations durables côté serveur (`annotations.json`)
**Fichiers :** `backend/main.py` (routes `/doc/{id}/annotations`), `backend/fiche.py`, `backend/conftest.py`, `backend/tests/`
**Problème :** Surlignages et notes ne vivaient que dans `localStorage` → perdus au vidage du cache navigateur, non sauvegardables, non portables.
**Fix :** Stockage serveur `cache/{doc}/annotations.json`. `GET /doc/{id}/annotations` (struct vide si fichier absent, 404 si doc inconnu, corrompu → vide). `PUT /doc/{id}/annotations` valide la forme (422 si `highlights` pas une liste ou `notes` pas un dict), supprime les notes orphelines — clé sans highlight (I-C), estampille `saved_at` en ms serveur (I-D), écrit de façon atomique (tmp + `os.replace`, I-A). Body parsé en `dict` simple (pas Pydantic, convention projet).
**Code clé :**
```python
valid_keys = {h.get("key") for h in highlights if isinstance(h, dict)}
notes = {k: v for k, v in notes.items() if k in valid_keys}   # I-C orphelines
store = {"version": 1, "highlights": highlights, "notes": notes,
         "saved_at": int(time.time() * 1000)}                 # I-D
tmp = ddir / "annotations.json.tmp"
tmp.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
os.replace(tmp, ddir / "annotations.json")                    # I-A atomique
```
**Sécurité :** l'export fiche (`fiche.py` `render_html`) échappe le champ `color` (contrôlé par l'utilisateur — le PUT ne valide que la forme) avant interpolation dans l'attribut `class` → garde anti-XSS stocké. Les couleurs hex `#rrggbb` sont validées (`_resolve_color`) puis rendues telles quelles ; le n° de page est coercé en `int` (`_safe_page`).

---

### FIX-073 — Restauration surlignage section-scopée multi-nœuds
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `restoreHighlight` / `collectTextNodes` / `wrapRange`
**Problème :** L'ancien `highlightTextInElement` faisait un `indexOf` mono-nœud (échec dès qu'un surlignage chevauchait plusieurs nœuds texte) et les clés `slice(0,50)` n'étaient ni stables ni portables.
**Fix :** Restauration via carte d'offsets sur la chaîne concaténée des nœuds texte de la `section[data-sid]` du highlight (fallback : document entier). `prefix`/`suffix` (30 chars) désambiguïsent les phrases répétées. `wrapRange` enveloppe chaque segment **back-to-front**. Clés déterministes `${section}::${shortHash(normForKey(text))}` (djb2→base36). Le TreeWalker exclut toujours `.reader-hl, script, style, .formula, .equation`.
**Garde-fou CRITIQUE :** `wrapRange` DOIT poser `span.style.backgroundColor = color` — la classe CSS `.reader-hl` n'a **aucune** couleur de fond, et l'export HTML autonome n'a pas le CSS de l'app. Sans cette ligne → surlignages invisibles in-app ET dans l'export.
**Code clé :**
```typescript
span.className = `reader-hl${hasNote ? " reader-hl--has-note" : ""}`;
span.style.backgroundColor = color;            // seule source de couleur
const key = `${section}::${shortHash(normForKey(selectedText))}`;
```

---

### FIX-074 — Sync Option B (localStorage primaire) + auto-migration
**Fichier :** `frontend/src/components/Reader/MarkdownReader.tsx` → `persistAll`, effet de chargement
**Problème :** Rendre les annotations durables sans bloquer l'UI ni risquer une perte de données hors-ligne.
**Fix :** `persistAll` écrit `localStorage` immédiatement (copie primaire) puis programme un sync serveur **débouncé 1000 ms**. Un sync échoué (offline / serveur down) ne touche **jamais** `localStorage` (I-B). Au montage : on charge le serveur d'abord ; si vide, on migre `localStorage` (recalcul des clés en section vide, remap des notes) puis on pousse au serveur. Le timer est nettoyé à l'unmount.
**Code clé :**
```typescript
syncTimerRef.current = window.setTimeout(() => {
  saveAnnotations(docId, { highlights: hls, notes: nts }).catch(() => {
    /* offline — on garde la copie locale (I-B) */
  });
}, 1000);
```

---

### FIX-075 — `get_pdf` : servir `cleaned.pdf` existant (régression servait source)
**Fichier :** `backend/main.py` → `GET /doc/{doc_id}/pdf`  
**Problème :** Quand `cleaned.pdf` existait déjà en cache, `needs_clean` restait `False`
(le branch `if is_native and not cleaned.exists()` était ignoré), et la fonction
tombait sur `return FileResponse(source, ...)` → servait le PDF original avec images
JPEG2000 invisibles dans PDF.js.  
**Fix :** Vérification anticipée : si `cleaned.pdf` existe déjà, le retourner immédiatement
avant tout calcul de `needs_clean`.  
**Code clé :**
```python
if cleaned.exists():
    return FileResponse(cleaned, media_type="application/pdf")
# puis logique needs_clean / _needs_rasterize / _repair_icc_profiles
```
**Invariant :** La présence de `cleaned.pdf` est la seule preuve qu'une rasterisation était
nécessaire. Ne jamais la contourner.

---

### FIX-076 — Outline texte : niveaux "N.0" et faux positifs items de liste
**Fichiers :** `backend/pipeline.py` → `_est_titre_section()` + `_outline_depuis_texte*`  
**Problème :** (a) `_SECTION_PREFIX` comptait les points : "1.0 Introduction" = 1 point →
niveau 2, identique à "2.1 Types of Anchors" → tout l'outline plat au niveau 2, sans
hiérarchie. (b) `_TOP_CHAPTER_PREFIX` ("N. Titre") capturait les items de liste numérotés
des sections de spec ("1. Cutting Tools - ...", "3. A706 - ...") comme chapitres L1 parasites.
(c) Titres courts comme "3.1. GENERAL" (7 chars) filtrés par `len(rest) < 10`.  
**Fix :**
- `has_x0_chapters` : détecte le style "N.0 TITRE" via `_X0_CHAPTER = re.compile(r"^\s*\d{1,3}\.0\s+[A-ZÀ-Ü]")`. Transmis à `_est_titre_section`.
- Quand `has_x0_chapters=True` : désactive `_TOP_CHAPTER_PREFIX` ; les sections "N.0" reçoivent `level = max(1, dot_count)` (ex. "1.0" → 1, "2.0" → 1).
- Seuil longueur minimum : `len(rest) < 5` (au lieu de 10) pour capturer "GENERAL", "CRITERIA".  
**Code clé :**
```python
_X0_CHAPTER = re.compile(r"^\s*\d{1,3}\.0\s+[A-ZÀ-Ü]")

# Dans _est_titre_section :
if has_x0_chapters and len(parts) >= 2 and parts[-1] == "0":
    level = max(1, m.group(1).count("."))  # "1.0" → 1
else:
    level = m.group(1).count(".") + 1

# Dans _outline_depuis_texte* :
has_x0_chapters = not has_chapters and any(
    _X0_CHAPTER.match(l.strip()) for t in page_texts for l in t.splitlines() if l.strip()
)
```
**Invariant :** Ne pas réduire le seuil de longueur en dessous de 5 (évite les faux positifs
sur des fragments de texte comme "1.2. A" ou "3.1. -"). `has_x0_chapters` n'est activé que si
`has_chapters=False` (les deux styles ne coexistent pas dans un même doc).  
**Résultat :** Outline correctement hiérarchique pour les PDFs à numérotation "N.0"
(ex. anchor-bolt-design-guide : 1.0→L1, 2.1→L2/enfant de 2.0, 6.0→L1 avec sous-sections L2).  
**Nécessite retraitement** du document pour prendre effet (outline en cache non mis à jour).

---

### FIX-077 — `force_ocr` : retraitement OCR forcé pour PDFs hybrides
**Fichiers :** `backend/pipeline.py` → `convertir_pdf` | `backend/main.py` → `run_pipeline_bg` + `POST /reprocess` | `frontend/src/api.ts` → `reprocessDoc` | `frontend/src/App.tsx` + `App.css`  
**Problème :** Les PDFs hybrides (corps natif + pièces jointes scannées, ex. pages 33-82 scannées dans un doc natif) étaient classés "natif" entier (`chars > _NATIVE_CHAR_MIN` sur les 3 premières pages) → `do_ocr=False` → pages scannées traitées sans OCR → vides dans le Reader.  
**Fix :** Nouveau paramètre `force_ocr: bool = False` dans `convertir_pdf`. Quand `True`, force `is_native = False` même si la densité de texte est élevée → Docling+OCR activé sur tout le document. Propagé via `run_pipeline_bg(force_ocr=...)` → `POST /doc/{id}/reprocess?force_ocr=true`. Frontend : split-button "Retraiter | OCR" (bouton "OCR" en orange `.app-reset--ocr`).  
**Code clé :**
```python
# pipeline.py — convertir_pdf
if force_ocr and is_native:
    is_native = False
    print("[pipeline] force_ocr=True → mode Docling+OCR forcé")
```
```typescript
// api.ts
export async function reprocessDoc(docId, fastMode?, forceOcr?) {
  const params = new URLSearchParams();
  if (fastMode) params.set("fast_mode", "true");
  if (forceOcr) params.set("force_ocr", "true");
  ...
}
```
```tsx
// App.tsx — split-button
<div className="app-reprocess-group">
  <button onClick={() => handleReprocess(false)}>Retraiter</button>
  <button className="app-reset--ocr" onClick={() => handleReprocess(true)}>OCR</button>
</div>
```
**Invariant :** `force_ocr=True` désactive aussi `fast_mode` (ils sont mutuellement exclusifs — `fast_mode` bypasse Docling, `force_ocr` en a besoin). Cette logique est dans `handleReprocess`: `const fastMode = !forceOcr && appMode === "standard"`.

---

### FIX-079 — Popover copie/surlignage sur sélection de texte
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx` | `frontend/src/components/Reader/MarkdownReader.css`

**Problème :** Le Reader ne permettait pas de sélectionner et copier du texte facilement. `handleMouseUp` ne faisait rien sans `hlMode` actif. Aucun retour visuel lors d'une sélection.

**Fix :** `handleMouseUp` refactorisé pour toujours afficher un popover flottant (`reader-sel-pop`) dès qu'une sélection ≥ 2 caractères est faite — que `hlMode` soit actif ou non. Le popover contient :
- **Copier** : copie via `navigator.clipboard.writeText()` + fallback `execCommand("copy")` pour les contextes http.
- **Surligner** (HTML uniquement) : applique le surlignage depuis `selectionCache` sans nécessiter `hlMode`.

Si `hlMode` est déjà actif, le surlignage est appliqué immédiatement dans `handleMouseUp` et le popover est supprimé.

**Code clé :**
```typescript
// MarkdownReader.tsx — popover affiché sur toute sélection
const handleMouseUp = () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) { setShowCopyPop(false); return; }
  const selectedText = selection.toString().trim();
  if (!selectedText || selectedText.length < 2) { setShowCopyPop(false); return; }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  setCopyPopPos({ x: rect.left + rect.width / 2, y: rect.top });
  setSelectionCache({ text: selectedText, section, sectionTitle, page, prefix, suffix });
  setShowCopyPop(true);
  // ... auto-highlight si hlMode actif
};
```
```tsx
// JSX — popover fixed, ancré sur la sélection
<div className="reader-sel-pop" style={{ left: copyPopPos.x, top: copyPopPos.y }}
     onMouseDown={(e) => e.preventDefault()}>
  <button className="reader-sel-btn" onClick={handleCopySelection}>Copier</button>
  {renderMode === "html" && (
    <button className="reader-sel-btn reader-sel-btn--hl" onClick={handleHighlightFromPop}>Surligner</button>
  )}
</div>
```
**Invariant :** `onMouseDown={e.preventDefault()}` sur le popover est obligatoire — sans lui le clic efface la sélection avant l'exécution du handler.

---

### FIX-078 — Faux TOC en milieu de doc + formules sans badge
**Fichiers :** `frontend/src/components/Reader/MarkdownReader.tsx` | `backend/pipeline.py` → `_fix_toc_entries`, `_convert_figure_formulas`

**Problème A — `_SECTION_NO_RE` trop large :** `/^\s*\d+(?:\.\d+)*\.?(?:\s|$)/` matchait les valeurs d'ingénierie comme "4.6 M20" (classe de boulon), "8.8 M20", "600 mm". Ces faux positifs dans la première colonne d'une table de données faisaient croire à FIX-046b que c'était un sommaire → table supprimée, remplacée par le banner "↑ Table of contents available in sidebar".

**Problème B — `_maybe_strip` et l'ellipse académique :** Le pattern `\.{3,}` détectait n'importe quel "..." dans un paragraphe (y compris "(imperfections, ...)") comme un point de conduite TOC → tag `toc-entry` incorrect.

**Problème C — Formules non décodées silencieuses :** `_convert_figure_formulas` identifiait correctement les figures-formules mais, en cas d'échec OCR (pix2tex/texify), laissait le `<figure><img>` intact — pas de badge "Formula not decoded" → image muette dans le Reader.

**Fixes :**
1. `_SECTION_NO_RE` : `/^\s*\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z]/` — exige majuscule + lettre après l'espace. "4.6 M20" → 'M' puis '2' (pas une lettre) → NO MATCH. "2.1 Introduction" → 'In' → MATCH.
2. `_maybe_strip` : `r'\.{3,}\s*\d*\s*$'` — les points doivent être EN FIN DE CHAÎNE (avant numéro de page optionnel). "(imperfections, ...)" → `...` pas en fin → NO MATCH.
3. `_convert_figure_formulas` : candidates OCR en échec → emballés dans `<div class="formula-not-decoded"><img .../></div>` pour que le Reader affiche le badge.

**Code clé :**
```typescript
// MarkdownReader.tsx — FIX-046b pattern corrigé
const _SECTION_NO_RE = /^\s*\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z]/;
```
```python
# pipeline.py — _maybe_strip condition corrigée
if _re.search(r'\.{3,}\s*\d*\s*$|(?:[\s\.]{2,}\d+\s*$)', inner):
```
```python
# pipeline.py — fallback formula-not-decoded
failed_task_indices = {task_idx for task_idx, _ in tasks if task_idx not in replacements}
for task_idx in failed_task_indices:
    replacements[task_idx] = f'<div class="formula-not-decoded"><img {img_src}/></div>'
```
**Invariant :** `_SECTION_NO_RE` doit exiger `[A-Z][A-Za-z]` (2 chars dont majuscule) après le numéro — ne jamais revenir à `(?:\s|$)` ou `[A-Za-z]{2}` (matcherait "mm", "kN").

---

## Ajouter un nouveau FIX

Incrémenter depuis le dernier existant. Format :

```markdown
### FIX-NNN — Titre court décrivant l'invariant
**Fichier :** `chemin/fichier`
**Problème :** Description du bug original.
**Fix :** Ce qui a été fait.
**Code clé :**
```lang
snippet minimal permettant de vérifier la présence du fix
```
```



