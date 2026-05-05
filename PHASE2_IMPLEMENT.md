# PHASE 2 — Implementation reelle

> Etat reel a la cloture de la Phase 2. Ce qui a ete code (pas la spec).

**Statut Phase 2** : TERMINEE (2026-05-05)
**Spec de reference** : [`SPEC.md`](./SPEC.md) — section 5 (frontend)

---

## Ce qui a ete livre

### 2.1 App shell + layout 2 colonnes — `src/App.tsx`, `src/App.css`

- Etat global : `doc`, `loading`, `error`, `activeId`, `figureIdx`, `tab`.
- Si pas de doc : `<UploadZone>` + spinner `<LoadingDocling>` + zone d'erreur.
- Si doc : sidebar 320px (desktop) avec onglets Sommaire/Galerie + viewer flex.
- Bouton "Nouveau doc" qui purge l'etat et `localStorage`.

### 2.2 API client + types TS — `src/api.ts`, `src/types.ts`

- `processPdf(file)` → POST FormData + lecture detail erreur HTTP propre via classe `ApiError` (status + message).
- `getResult(docId)` → GET `/doc/{id}/raw` (pour restore depuis cache backend).
- `pdfUrl(docId)` et `figureUrl(docId, figId)` helpers d'URL.
- Base URL configurable via `import.meta.env.VITE_API_BASE` (defaut `http://127.0.0.1:8000`).
- Types : `Bbox`, `PageInfo`, `OutlineNode`, `Figure`, `DocResult` — alignes sur le format de sortie `pipeline.py`.

### 2.3 Composant Outline — `src/components/Outline/Outline.tsx`

- Arbre recursif (composant `OutlineItem` qui s'invoque sur ses enfants).
- Expand/collapse par node via `useState` local (defaut : ouvert).
- Etat "Aucune structure detectee" si `nodes.length === 0` (cas DA_0003_HSE_REV).
- `data-section-id` sur chaque row (utilise par 3.1 pour highlight + auto-scroll).
- Fleche ▾/▸ devant les nodes a enfants, espace fixe pour les feuilles (alignement).

### 2.4 Composant Viewer — `src/components/Viewer/Viewer.tsx`

- `pdfjs.GlobalWorkerOptions.workerSrc` configure via `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"`.
- Imports CSS `react-pdf/dist/Page/AnnotationLayer.css` et `TextLayer.css`.
- `<Document>` avec `useMemo` pour stabiliser le `file` prop (evite re-charge sur re-render).
- Rendu de **toutes les pages** sequentiellement (pas de virtualisation — POC).
- Map de refs `pageRefs` par page pour scroll programmatique.
- Largeur initiale fixee a `MAX_PAGE_WIDTH = 800` (puis dynamique via Phase 3).

### 2.5 Clic outline → scroll viewer

- `forwardRef` + `useImperativeHandle` exposent `scrollToPage(page: number)`.
- App stocke un `viewerRef` et l'appelle dans `handleSelect` quand le user clique une section.
- `scrollIntoView({behavior: "smooth", block: "start"})`.

### 2.6 Loading + error states

- Spinner CSS pur (animation rotation), pas de lib externe.
- Component dedie `<LoadingDocling>` (Phase 2 final) avec timer en temps reel, etape texte qui evolue (init → layout/OCR → extraction → construction), hint sur les ordres de grandeur (5–30s court, 60–90s paper 20+ p, +10s 1er traitement).
- Erreurs HTTP backend remontees au format `[413] Fichier trop volumineux (max 100 Mo)`.

### 2.7 Build + lint

- `npm run build` (tsc -b + vite build) : OK, sans erreur.
- `npm run lint` (eslint) : OK, sans warning.
- Warning bundle > 500 kB (pdfjs ~1 Mo worker, ~620 kB index) : non bloquant, voir TD-008.

---

## Persistance localStorage (3.5 partiel, code en Phase 2)

- Cle `pdf-viewer:lastDocId` ecrite apres chaque upload reussi.
- Au mount d'`<App>`, lecture de la cle puis `getResult(lastId)`. Si 404 (cache backend purge entre-temps) → suppression de la cle, fallback sur l'`UploadZone`.
- "Nouveau doc" purge la cle.
- Limite : 1 doc actif (pas de liste de docs recents). Extension reportee.

---

## Bug majeur fixe : mismatch versions pdfjs-dist

Au 1er rendu d'un PDF, `<Document>` declenchait `onLoadError` avec :
```
The API version "5.4.296" does not match the Worker version "5.6.205".
```

**Cause** : `react-pdf 10.4.1` embarque `pdfjs-dist@5.4.296` en transitive, mais le `package.json` top-level pinait `^5.6.205`. Le worker (5.6.205) ne matchait pas le main thread (5.4.296).

**Fix** : `npm install --save-exact pdfjs-dist@5.4.296` pour aligner exactement sur la version transitive de react-pdf. Plus aussi un nettoyage du cache `.vite` et hard-reload navigateur (le worker etait servi depuis le cache HTTP).

**Bonus** : `<Document onLoadError>` capture maintenant le message reel et l'affiche sous le texte d'erreur (au lieu du generique "Echec de chargement du PDF.").

---

## Ecarts par rapport a la SPEC

- **SPEC §5.1 layout** : conforme (sidebar gauche + viewer principal, virtualisation reportee). Phase 3 ajoute le mode mobile (drawer).
- **SPEC §5.3 composants** : `<App>`, `<UploadZone>`, `<Outline>`, `<Viewer>` codes. `<FigureOverlay>` repousse en Phase 3.2. `src/api.ts` et `src/types.ts` codes.

---

## Bilan

Phase 2 close, frontend operationnel, doc persistant entre sessions.
**Pret pour Phase 3** (sync bidirectionnelle + figures).
