# FRONTEND READER — MarkdownReader.tsx

Dernière mise à jour : 2026-05-22 (session 2)

---

## Rôle
Composant "Interactive Book" qui prend le HTML Docling (`GET /doc/{id}/html`)
et le présente comme un livre interactif avec navigation par sections.

---

## Signature

```typescript
export interface ReaderHandle {
  scrollToSection: (title: string) => void;
}

interface Props {
  docId: string
  outline: OutlineNode[]
  initialSection?: string | null
}

const MarkdownReader = forwardRef<ReaderHandle, Props>((props, ref) => {
  useImperativeHandle(ref, () => ({ scrollToSection }));
  // …
});
```

FIX-008 : `forwardRef` OBLIGATOIRE — `App.tsx` utilise `readerRef.current?.scrollToSection()`.

---

## Flux de données

```
GET /doc/{id}/html
  → htmlContent (string)
  → sectionizeHtml(htmlContent, outline)
  → Section[] (tableau de { title, htmlContent, id })
  → affiche currentSection uniquement (focus mode)
```

---

## `sectionizeHtml(html, outline)`

**Rôle :** Découpe le HTML Docling en sections alignées sur l'outline backend.

**Algorithme :**
1. Parse le HTML dans un `DOMParser` (côté browser)
2. Construit `outlineTitleMap` = Map `normalizedVariant → originalTitle` (FIX-006 + FIX-015)
   - Indexe le titre complet ET la version sans préfixe numérique ("quicklist" → "2. Quick list")
3. Parcourt les enfants du `<body>` avec `processNode()` :
   - `<h1>`-`<h4>` dont le texte normalisé est dans `outlineTitleMap` → **nouvelle section**
   - Le titre stocké est le titre outline (pas le heading HTML) → `scrollToSection` match exact
   - Autres nœuds → ajoutés à la section courante
4. `LEAF_DIV_CLASSES` : si un `<div>` a une de ces classes → ne pas récurser dedans (FIX-005)
5. `isPageHeaderFooter()` : skip des `<p>` numéros de page et courts italiques (FIX-007)
6. Post-pass logos : supprime les `<figure>` base64 < **10 kB** et **sans légende** (`wordCount === 0`) (FIX-007 + FIX-011)
7. Post-pass puces : supprime les caractères de puce PDF intégrés dans les `<li>` et `<p>` pour éviter le double-bullet avec `li::marker` CSS (FIX-012)
8. Post-pass TOC : supprime les points de conduite (`.....47`) des `<p>` de sommaire pour les docs en cache (FIX-014)
9. Post-pass listes : restructuration des listes plates hiérarchiques (alternant parents avec style de liste et descriptions sans style de liste) en listes imbriquées sémantiques, et mise en gras (`<strong>`) du titre parent (FIX-021)

```typescript
// FIX-005
const LEAF_DIV_CLASSES = [
  "formula-not-decoded", "formula", "equation",
  "table-wrap", "tw", "fig-wrap", "caption",
];

// FIX-006 + FIX-015 : Map normalizedVariant → originalTitle
const norm = (s: string) => s.toLowerCase().replace(/\W+/g, "");
const outlineTitleMap = new Map<string, string>();
// Indexes "2. Quick list" as "2quicklist" AND "quicklist" → both map to "2. Quick list"
// section.title = matchedOutlineTitle ?? headingText  (outline title, not heading)

// FIX-011 : seuil logo ultra-strict (wordCount===0 ET < 10_000 chars)
if (wordCount === 0) {
  const isSmallBase64 = src.startsWith("data:") && src.length < 10_000;
  if (isSmallBase64) fig.remove();
}

// FIX-012 : strip des puces PDF dans les <li> et <p> hors-liste
const LEAD_BULLET_RE = /^[·•‣◦▪●■]\s*/;
const LEAD_O_RE = /^o\s+(?=[A-ZÀ-Ü])/;
root.querySelectorAll("li").forEach((li) => { /* cleanBulletText sur firstChild */ });
root.querySelectorAll("p:not(li p, ul p, ol p)").forEach((p) => { /* strip LEAD_BULLET_RE seulement */ });
```

---

## Navigation focus mode

L'utilisateur voit **une section à la fois** :

```
[← Section précédente]  [Titre section courante]  [Section suivante →]
```

- Clic sidebar (`handleSelect` App.tsx) → `scrollToSection(title)` → cherche section par titre normalisé → setCurrentSectionIndex
- `scrollToSection` expose l'implémentation via `useImperativeHandle` (FIX-008)

---

## KaTeX auto-render

```typescript
import renderMathInElement from "katex/dist/contrib/auto-render.js";

useEffect(() => {
  const docEl = contentRef.current;
  if (!docEl) return;
  renderMathInElement(docEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true  },
      { left: "$",  right: "$",  display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true  },
    ],
    throwOnError: false,
    // Pas d'ignoredClasses — les formules décodées par pix2tex dans $…$ s'affichent
  });
}, [currentSection]);
```

⚠️ `ignoredClasses: ["formula-not-decoded"]` a été **supprimé** (permettait KaTeX de rater les formules décodées).

---

## Classes CSS importantes (MarkdownReader.css)

```css
/* Figures — pas de box, pleine largeur */
.reader-doc figure,
.reader-doc .fig-wrap {
  margin: 36px auto;
  text-align: center;
  overflow-x: auto;
}

.reader-doc figure img,
.reader-doc .fig-wrap img,
.reader-doc img {
  max-width: 100%;   /* jamais plus large que le conteneur */
  width: auto;
  height: auto;
  display: block;
  margin: 0 auto;
}

/* FIX-011 : figures côte à côte — conteneur flex automatique */
.reader-doc div:has(> figure + figure),
.reader-doc section:has(> figure + figure) {
  display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
}
.reader-doc div:has(> figure + figure) figure {
  flex: 1 1 auto; min-width: 120px; max-width: 48%; margin: 0;
}

/* Formules non décodées */
.reader-doc .formula-not-decoded {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--formula-bg);
  border: 1px dashed var(--formula-bd);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 12px;
  color: var(--formula-color);
}
```

---

## Thème

- Source Serif 4 (texte corps), police variable
- Accent orange (`--accent: #e07b3a`)
- Dark mode via `data-theme="dark"` sur `<html>`
- Progress bar lecture en haut (scroll % de la section)
- Popup typography (taille police, interlignage)

---

## Fonctionnalités interactives (Livre Interactif)

Les fonctionnalités suivantes sont implémentées en mode structuré (HTML) :

1. **Surlignage (Highlighting) :**
   - Sélection du texte par l'utilisateur quand le mode surlignage est actif.
   - Choix de 6 couleurs pastel (Jaune, Vert, Lime, Orange, Rose, Violet).
   - Les surlignages sont appliqués en insérant dynamiquement des balises `<span class="reader-hl">` dans le DOM.
   - Nettoyage et restauration automatiques via `useEffect` à chaque rendu ou changement de section (pour préserver le focus mode).
   - Persistance automatique dans le `localStorage` sous la clé `reader-hl-{docId}`.

2. **Notes Adhésives / Annotations :**
   - Un clic sur un span `.reader-hl` ouvre le panneau flottant `.reader-note-panel`.
   - L'utilisateur peut saisir/modifier une note textuelle.
   - Si une note est active, l'élément surligné reçoit la classe `.reader-hl--has-note` (soulignement pointillé violet).
   - Persistance dans le `localStorage` sous la clé `reader-notes-{docId}`.

3. **Synthèse vocale (Text-to-Speech - TTS) :**
   - Utilise `window.speechSynthesis` configuré en langue française (`fr-FR`).
   - Lit le texte épuré des formules KaTeX, scripts et styles via `getSpeakText()`.
   - Contrôles complets : Lecture, Pause, Reprise, Arrêt.
   - Vitesse réglable dynamiquement de 0.5x à 2.0x (réinitialise l'utterance en cours).
   - Nettoyage systématique lors du démontage ou du changement de document.

4. **Téléchargement Premium HTML autonome :**
   - Bouton de sauvegarde 💾 générant un fichier HTML complet et autonome.
   - Incorpore le document, les surlignages, les notes et un panneau d'affichage hors ligne des notes.
   - Intègre les CDN de KaTeX et le script d'auto-rendu mathématique pour fonctionner hors ligne de l'application.

