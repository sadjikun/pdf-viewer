# FRONTEND APP — App.tsx

Dernière mise à jour : 2026-05-21

---

## Rôle
Shell principal de l'application. Gère :
- Upload et polling de l'extraction
- 3 modes de vue (PDF / Reader / Compare)
- Sidebar avec 3 onglets (Sommaire / Galerie / Tables)
- Synchronisation scroll viewer ↔ outline
- Thème clair/sombre

---

## State principal

```typescript
const [doc, setDoc]           = useState<DocResult | null>(null)
const [viewMode, setViewMode] = useState<"pdf" | "reader" | "compare">("pdf")
const [activeTab, setActiveTab] = useState<"outline" | "gallery" | "tables">("outline")
const [selectedSection, setSelectedSection] = useState<string | null>(null)
const [currentPage, setCurrentPage]         = useState<number>(1)
const [processing, setProcessing]           = useState<ProcessingState | null>(null)
```

---

## Refs exposés

```typescript
const viewerRef = useRef<PdfViewerHandle | null>(null)   // scrollToPage(n)
const readerRef = useRef<ReaderHandle | null>(null)       // scrollToSection(title)
```

---

## Modes de vue

| Mode | Description |
|------|-------------|
| `"pdf"` | react-pdf seul, toute la largeur |
| `"reader"` | MarkdownReader seul (HTML Docling + KaTeX) |
| `"compare"` | Split 50/50 : PDF viewer gauche + Reader droite, sync bidirectionnelle |

**`effectiveViewMode`** : calculé APRÈS le guard `if (!doc)` — vaut `"pdf"` si pas de doc.  
⚠️ FIX-010 : `handleSelect` et `handlePageChange` utilisent `viewMode`, pas `effectiveViewMode`.

---

## Handlers clés

### `handleSelect(node: OutlineNode)`
```typescript
// FIX-009 : en mode compare, les deux panneaux naviguent
if (viewMode === "compare") {
  if (node.page != null) viewerRef.current?.scrollToPage(node.page);
  readerRef.current?.scrollToSection(node.title);
} else if (viewMode === "pdf") {
  viewerRef.current?.scrollToPage(node.page);
} else {
  readerRef.current?.scrollToSection(node.title);
}
setSelectedSection(node.id);
```

### `handlePageChange(page: number)`
- Met à jour `currentPage`
- Highlight la section correspondante dans le sidebar
- Utilise `viewMode` (FIX-010)

---

## Polling traitement

```
upload → setProcessing({status: "processing", progress: 0})
↓ every 1.5s: GET /doc/{id}/status
↓ progress updates → LoadingDocling component
↓ status "ready" → fetchDoc() → setDoc(result)
```

---

## Onglets sidebar

| Onglet | Composant | Données |
|--------|-----------|---------|
| Sommaire | `<OutlineTree>` | `doc.outline` |
| Galerie | `<FigureGallery>` | `doc.figures` → `/figure/{id}` |
| Tables | `<TableView>` | `doc.tables` (html brut) |

---

## Composants importants

| Composant | Fichier | Rôle |
|-----------|---------|------|
| `PdfViewer` | `components/Viewer/PdfViewer.tsx` | react-pdf multi-pages, forwardRef handle |
| `MarkdownReader` | `components/Reader/MarkdownReader.tsx` | HTML Docling, sectionize, KaTeX |
| `OutlineTree` | `components/Outline/OutlineTree.tsx` | Arbre récursif, expand/collapse |
| `FigureGallery` | `components/Gallery/FigureGallery.tsx` | Grille thumbnails + overlay HD |
| `FigureOverlay` | `components/Gallery/FigureOverlay.tsx` | Modal HD, nav prev/next, Escape |
| `LoadingDocling` | `components/Loading/LoadingDocling.tsx` | Progress bar + étapes animées |
| `SearchBar` | `components/Search/SearchBar.tsx` | Recherche texte react-pdf |

---

## Types TypeScript (`src/types.ts`)

```typescript
interface DocResult {
  doc_id: string
  filename: string
  extraction_mode: "fast" | "native" | "docling"
  pages: Array<{number: number, width: number, height: number}>
  outline: OutlineNode[]
  figures: Figure[]
  tables: Table[]
  tesseract_available: boolean
}

interface OutlineNode {
  id: string
  level: 1 | 2 | 3 | 4
  title: string
  page: number | null
  bbox: [number, number, number, number] | null
  children: OutlineNode[]
}

interface Figure {
  id: string
  page: number
  bbox: [number, number, number, number] | null
  caption: string
  latex?: string
}

interface Table {
  id: string
  page: number
  bbox: [number, number, number, number] | null
  caption: string
  html: string
  n_rows: number
  n_cols: number
}
```

---

## Fonctionnalités d'Impression et d'Enregistrement (FIX-024)

- **Synchronisation du titre de la page** : Dès qu'un document est chargé, un effet `useEffect` met à jour `document.title` avec `doc.filename` (le nom d'origine du fichier PDF). Lorsque l'utilisateur lance une impression ou une sauvegarde de page, le navigateur suggère automatiquement ce nom comme nom de fichier par défaut.
- **Règles d'impression sémantiques (@media print)** : Définies dans `index.css`.
  - Masque les contrôles d'interface : `.app-hamburger`, `.app-sidebar`, `.app-view-toggle`, `.reader-toolbar`, `.reader-bc`, `.reader-focus-header`, etc.
  - Libère la contrainte de hauteur sur les blocs de défilement : `height: auto !important` et `overflow: visible !important` sur `html`, `body`, `#root`, `.app-container`, `.app-main`, et `.reader-content`. Cela permet d'imprimer l'intégralité du document HTML sans qu'il ne soit tronqué par le viewport du navigateur.
  - Force un affichage adapté au papier : arrière-plan transparent et couleur de texte noire `#000 !important`.

---

## Nettoyage du titre PDF (FIX-050)

- **`cleanPdfTitle(title?: string) -> string`** : Nettoie le titre extrait des métadonnées du document en enlevant les préfixes d'application indésirables comme `"Microsoft Word - "`, `"Microsoft PowerPoint - "`, ou `"Microsoft Excel - "`. Utilisé à la fois pour le titre dans l'onglet du navigateur (`document.title`) et pour le titre principal affiché en haut de la barre latérale (`docTitle`). Assure la compatibilité visuelle pour les fichiers nouveaux et ceux déjà présents en cache.

