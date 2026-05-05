# PHASE 3 — Implementation reelle

> Etat reel a la cloture de la Phase 3. Ce qui a ete code (pas la spec).

**Statut Phase 3** : TERMINEE (2026-05-05) — 3.5 reste partiel (1 doc actif, pas de liste docs recents)
**Spec de reference** : [`SPEC.md`](./SPEC.md) — section 5.2 (interactions)

---

## Ce qui a ete livre

### 3.1 Scroll viewer → highlight outline

**`src/components/Viewer/Viewer.tsx`** : `IntersectionObserver` avec thresholds `[0, 0.25, 0.5, 0.75, 1]` et `root = containerRef`. Pour chaque page visible >25%, ajout dans un `Set`. La page "courante" emise via `onPageChange` est la plus haute (`Math.min(...visible)`) — comportement attendu de "section visible en haut de l'ecran".

**`src/outline.ts`** : helpers `flattenOutline(nodes)` et `findActiveSection(flat, page)`. La section active = la derniere section dont `.page <= currentPage` dans l'ordre du document. Fallback null si aucune.

**`src/App.tsx`** : `handlePageChange` re-calcule l'active + setActiveId (no-op si identique → pas de boucle avec le scroll programmatique).

**`src/components/Outline/Outline.tsx`** : `useEffect` sur `activeId` + `querySelector('[data-section-id="..."]')` + `scrollIntoView({block: "nearest"})` pour rendre la section active visible dans la sidebar sans scroll inutile.

### 3.2 FigureOverlay — `src/components/Figure/FigureOverlay.tsx`

- Modal au clic figure (depuis galerie OU marker viewer).
- Image HD via `<img src={figureUrl(docId, figure.id)}>`.
- Header : compteur `Figure 4/12` + bouton fermer.
- Boutons navigation precedente/suivante (flèches `‹` `›`) — passes en props `onPrev`/`onNext`, undefined si bord.
- Footer : caption + page + bouton "Aller à la page" (callback `onGotoPage`).
- Fermeture : clic backdrop (`stopPropagation` sur le modal lui-meme), Escape.
- Clavier : `←` / `→` naviguent (si dispo), `Escape` ferme.

### 3.3 Markers figures dans le viewer

**`src/bbox.ts`** : helper `bboxToPct(bbox, page)` qui convertit la bbox Docling (BOTTOMLEFT, points PDF) en rectangle CSS en % (origine haut-gauche). Verification empirique prealable : sur le `result.json` d'arxiv 2510 et Eurocode, Docling renvoie systematiquement `t > b` (= BOTTOMLEFT confirme).

Formule centrale :
```ts
{
  left: (l / pw) * 100,
  top: ((ph - t) / ph) * 100,
  width: ((r - l) / pw) * 100,
  height: ((t - b) / ph) * 100,
}
```

**`Viewer.tsx`** : pour chaque page rendue, overlay `<div.viewer-figmarkers>` avec `position: absolute; inset: 0`, contenant un `<button.viewer-figmark>` par figure de cette page (positionne en %). Clic → callback `onFigureClick(index)` → ouverture overlay.

CSS : marker = rectangle bleu transparent (`rgba(94, 155, 255, 0.08)` + bordure 1.5px), z-index 2, hover → opacite + bordure plus marquee.

**Decision TD-002** : conversion **cote frontend** (pas backend). SPEC §4.2 conserve, l'API expose les bbox brutes. Helper centralise dans `bbox.ts`.

### 3.4 Navigation clavier

- **Outline** : `↑`/`↓` deplacent le focus sur le titre precedent/suivant (flat order via `querySelectorAll('.outline-title')`). Enter/Space activent (comportement natif `<button>`).
- **FigureOverlay** : Escape ferme, `←`/`→` naviguent.

### 3.5 Persistance localStorage (PARTIEL)

**Code en Phase 2** (cle `pdf-viewer:lastDocId`) — voir `PHASE2_IMPLEMENT.md`.

**Limite assumee** : 1 doc actif uniquement, pas de liste de docs recents. Extension reportee si besoin.

### 3.6 Vue Galerie figures

**`src/components/Gallery/Gallery.tsx`** : grille CSS 2 colonnes responsive, thumbnails via `<img loading="lazy">` (l'endpoint `figureUrl` charge a la demande), caption tronque a 3 lignes (`-webkit-line-clamp`). Etat "Aucune figure detectee" si `figures.length === 0`. Clic tile → `onSelect(index)` → ouverture overlay.

**Sidebar tabs** dans `App.tsx` : 2 onglets `Sommaire` / `Galerie`, switch via state local `tab`. Header de sidebar adapte (titre dynamique).

Inspiration UX : Le Reef / Batipedia (vu dans la video du user, norme NF EN 1991-1-4).

---

## Mobile-friendly (ajout 2026-05-05, integre a Phase 3)

Le user a remonte que l'app n'etait pas exploitable sur mobile (sidebar 320px, page PDF 800px fixe).

### Sidebar drawer

- Bouton hamburger fixe en haut-gauche, visible uniquement sur `max-width: 768px`.
- Sidebar passe en `position: fixed`, `transform: translateX(-100%)` par defaut, `translateX(0)` quand `app.sidebar-open`.
- Backdrop semi-transparent qui ferme au clic.
- Auto-fermeture du drawer apres clic section ou figure (UX mobile).

### Largeur de page dynamique

`Viewer.tsx` : `ResizeObserver` sur le container. `pageWidth = clamp(200, MAX_PAGE_WIDTH, container.width - PAGE_PADDING)` avec `MAX_PAGE_WIDTH = 900`. Pas de ratio cassant : les markers figures sont en `%` donc ils suivent.

### Tweaks responsifs

- `100dvh` (au lieu de `100vh`) pour gerer correctement les barres URL/nav iOS/Android.
- `min-width: 0` sur `.app-main` pour eviter overflow.
- `FigureOverlay` : padding reduit + boutons nav legerement plus petits sur < 600px.

### Limites non couvertes

- Drag-and-drop tactile non verifie (HTML5 DnD touch est partiellement supporte ; le bouton "Choisir un fichier…" reste la voie standard).
- Zone tap < 44×44 px sur petites figures (iOS guideline). Pas de fix specifique, accepte pour le POC.
- Erreurs JS console sur appareils mobiles non remontees aux logs serveur (Sentry recommande pour un monitoring client complet).

---

## Bugs/incidents fixes durant la Phase 3

- **Spinner sans info** → composant `<LoadingDocling>` avec timer + etape rotative (technically code en Phase 2 mais finalise apres feedback user).
- **Limite 100 Mo non visible** → ajout dans le hint de `<UploadZone>`.

---

## Ecarts par rapport a la SPEC

- **SPEC §5.2 interactions** : tout est conforme. La galerie etait mentionnee implicitement ; ajoutee comme epic 3.6 explicitement (decision 2026-05-05 inspirée Le Reef).
- **SPEC §6 scope "n'est pas"** : aucun ajout interdit (pas d'edition, pas d'auth, pas de stockage cloud).

---

## Bilan

Phase 3 close. UX deja proche de l'attendu : navigation outline + viewer bidirectionnelle, figures cliquables (markers + galerie), modal HD, clavier. Mobile-friendly ajoute.

**Pret pour Phase 4** (polish + robustesse).
