# pdf-viewer — Point d'entrée agent (Gemini Code Assist)

> **Projet multi-agent.** Ce projet est aussi travaillé par Claude Code et Antigravity,
> qui lisent `CLAUDE.md`. Ce fichier (`GEMINI.md`) est le miroir maintenu en sync pour
> Gemini Code Assist. La source de vérité pour tous les agents est le wiki `memory/`.

---

## Ce qu'est ce projet
Viewer PDF local self-hosted. Backend Python 3.13 + FastAPI. Frontend React 19 + TypeScript + Vite.
Pas de cloud, pas d'auth. Mono-utilisateur, mono-machine.

## Lancer le projet
```bash
# Backend (terminal 1)
cd backend && .venv\Scripts\activate
uvicorn main:app --reload --reload-exclude .venv

# Frontend (terminal 2)
cd frontend && npm run dev
# → http://localhost:5173
```

---

## Système mémoire — LIRE AVANT DE CODER

Ce projet utilise un wiki markdown dans `memory/`. Tous les agents (Claude, Gemini, Antigravity)
doivent lire ET mettre à jour ce wiki après chaque changement de code.

**Commencer chaque session par :**
1. `memory/INDEX.md` — catalogue de toutes les pages
2. `memory/LOG.md` — 10 dernières entrées (ce qui a changé récemment)
3. `memory/fixes-registry.md` — comportements critiques à ne JAMAIS régresser

**Avant de modifier `backend/main.py` ou `backend/pipeline.py` :**
Lire `memory/fixes-registry.md` en entier. Vérifier la présence du snippet "Code clé" de
chaque FIX dans le code source. Snippet absent → STOP, alerter l'utilisateur.

---

## Architecture en un paragraphe
`POST /process` uploade un PDF → `pipeline.py` détecte texte natif (pypdfium2 fast path, ~1s)
ou scanné (Docling + RapidOCR, 25-80s) → `result.json` mis en cache sous
`backend/cache/{sha256[:16]}/`. Le frontend lit outline + figures + tables via REST.
3 modes vue : **PDF viewer** (react-pdf/PDF.js), **Reader** (HTML Docling + KaTeX), **Compare** (côte à côte).
Sidebar : onglets Sommaire / Galerie / Tables.

---

## Contraintes critiques (résumé — détail dans `memory/fixes-registry.md`)

| FIX | Invariant |
|-----|-----------|
| FIX-001 | PDFs natifs avec JPEG2000 ou ICC invalide → rastériser quand même (`_needs_rasterize`) |
| FIX-002 | Attachment/Appendix/Annex reconnus comme sections (`_ANNEX_PREFIX`) |
| FIX-003 | TOC + scan texte complémentaire pour les annexes absentes du TOC |
| FIX-004 | Supprimer entêtes/pieds de page du HTML via `_strip_page_headers_footers()` |
| FIX-005 | `LEAF_DIV_CLASSES` dans `sectionizeHtml` — ne pas récurser dans formula-not-decoded |
| FIX-006 | Seuls les headings matchant l'outline backend créent une section |
| FIX-007 | `isPageHeaderFooter()` + post-pass logos dans `sectionizeHtml` |
| FIX-008 | `MarkdownReader` est `forwardRef<ReaderHandle>` — ne pas supprimer |
| FIX-009 | `handleSelect` en compare mode navigue viewer ET reader |
| FIX-010 | `handleSelect`/`handlePageChange` utilisent `viewMode`, jamais `effectiveViewMode` |
| FIX-011 | Filtre logo : `wordCount === 0` ET `src.length < 10_000` (ne jamais remonter à 30 000) |
| FIX-012 | `_fix_bullet_lists()` backend + post-pass DOM frontend : strip puces PDF dans `<li>` |
| FIX-013 | `_TOP_CHAPTER_PREFIX` dans `_est_titre_section` : chapitres "1. Titre" détectés |
| FIX-014 | `_fix_toc_entries()` backend + post-pass DOM frontend : supprime points de conduite TOC |
| FIX-015 | `outlineTitleMap` dans `sectionizeHtml` : Docling supprime préfixes → sections non cliquables |
| FIX-016 | `split_page_view=True` + `_annotate_split_page_divs()` → séparateurs pages PDF dans Reader |
| FIX-017 | `compareRatio` state + `handleCompareDividerDown` → divider compare déplaçable |
| FIX-018 | `appTheme` prop sur MarkdownReader → thèmes Reader = thèmes app (oled/forest = dark) |
| FIX-019 | `.app-hamburger` visible desktop, toggle `sidebarCollapsed` vs `sidebarOpen` selon breakpoint |
| FIX-020 | Thème global CSTB et synchronisation globale du mode sombre (App.tsx + MarkdownReader.tsx) |
| FIX-021 | Restructuration et mise en gras des listes hiérarchiques plates dans le MarkdownReader |
| FIX-022 | Strip rasters pleine-page à l'intérieur des docling-page + en-tête/pied PDF |
| FIX-023 | ~~Filtre rasters > 150 000 chars~~ REVERT — trop agressif, images manquantes |
| FIX-024 | Impression sémantique du Reader seul et synchronisation du titre avec le PDF |
| FIX-025 | `_fix_toc_entries()` PASS 2 : éclater les blobs TOC concaténés en `<p>` individuels |
| FIX-026 | Sync bidirectionnelle Reader→PDF : `onPageChange` + `isProgrammaticScrollRef` anti-boucle |
| FIX-027 | Reader pleine largeur : `--max-w: 100%` + `padding: 0 20px` sur `.reader-content` |
| FIX-028 | Strip image-tables Docling + wrap `.table-wrap` + promotion `<thead>` dans sectionizeHtml |
| FIX-029 | Virtual rendering Viewer PDF : `position:absolute` + scroll handler + cumulative heights |
| FIX-030 | Filtre sur-détection sections Docling sur docs ≤ 3 pages (CV, lettres) |
| FIX-031 | Titre PDF depuis métadonnées : `pdf_title` dans result.json + sidebar + onglet Chrome |
| FIX-032 | Images proportionnelles Reader : retire attrs HTML, lit largeur PNG header, `min(Npx, 100%)` |
| FIX-033 | Pages A4 encadrées : `--doc-px` + bande bureau 36px bleed + `overflow-x:clip` + `--desk` thèmes |
| FIX-034 | Reader vide sur HTML > 20MB : guard Content-Length + FileResponse backend + Reader pleine largeur |
| FIX-035 | De-embedding images base64 : `_deembed_images()` extrait data URIs → `html_images/bN/` + endpoint `/html-image/{path}` |
| FIX-036 | `isLayoutTable()` + traitement transparent dans `processNode` : layout tables Docling ne créent plus d'orange ni de scrollbar |
| FIX-037 | Debounce 150 ms sur `onPageChange` dans Viewer scroll handler (anti-jitter compare mode) |
| FIX-038 | Nettoyage TOC : recherche sur tous `h1-h4`, pas seulement `section[data-sid]` |
| FIX-039 | Layout table colonne vide → fallthrough vers colonnes avec rasters (annexes Excel) |
| FIX-040 | Strip `<mi>$</mi>` artefacts Docling dans MathML avant rendu KaTeX |
| FIX-041 | Layout table : inclure images des cellules image-seulement (page de couverture) |
| FIX-042 | `isLayoutTable` : vérifier caption/th uniquement sur THIS table (pas les imbriquées) |
| FIX-043 | `compareMode` prop sur MarkdownReader : séparateurs PDF + nav page cachés en reader seul |
| FIX-044 | `_convert_figure_formulas()` backend : figures-formules PICTURE → pix2tex → KaTeX annotation |
| FIX-045 | Focus mode boundary par `outline` top-level (pas level HTML) — sous-sections affichées correctement |
| FIX-046 | Détection TOC structurelle : `toc-entry` backend + page-boundary frontend (bilingue, sans heading) |
| FIX-047 | Pipeline parallèle : `DOCLING_WORKERS` batches Docling en parallèle + pix2tex `ThreadPoolExecutor` + HTML writes parallèles |
| FIX-048 | `_PDFIUM_LOCK` dans `_split_pdf` : pypdfium2 non thread-safe → Data format error si accès concurrent au même fichier |
| FIX-049 | `flat.sort(key=...)` dans `_toc_vers_outline` : outline trié par page réelle → Attachments/Annexes restent en fin de sidebar même si le PDF les met en tête de bookmarks |
| FIX-050 | Nettoyage du préfixe "Microsoft Word - " dans le titre du document (backend/frontend) |
| FIX-051 | Saut des pages de Table des Matières (TOC) pour la détection de l'outline |
| FIX-052 | Synchronisation de la recherche globale avec la recherche interne du Reader |
| FIX-053 | Nettoyage automatique du cache (tâche de fond au startup + endpoint /cache/cleanup) |
| FIX-054 | Routage d'extraction de secours (Fallback Chain: Docling -> MarkItDown -> pypdfium2) |
| FIX-055 | Alignement vertical des codes/valeurs séparés par des espaces dans les cellules de tableau |
| FIX-056 | Fusion en ligne des énonciations se terminant par deux-points avec leur valeur (Point 2.1.1) |
| FIX-057 | Correctif des équations KaTeX display (disparition au scroll / doubles bordures) |
| FIX-058 | Réduction de l'espace vertical de la barre d'outils et de navigation du Reader |
| FIX-059 | Interaction de pliage/dépliage interactif des sections de la sidebar (sommaire) |
| FIX-060 | Mise en cache globale de DocumentConverter pour éviter les rechargements de modèles ML |
| FIX-061 | Skip check d'update Albumentations pour éviter les timeouts réseau lors de l'init |
| FIX-062 | Encodage UTF-8 et sanitation CP1252 sur console Windows pour empêcher les crashs de log |
| FIX-063 | Messages d'estimations réalistes dans l'overlay de chargement rouge |
| FIX-064 | Threads CPU dynamiques (Dynamic Thread Scaling) sur worker unique en RAM restreinte |
| FIX-065 | Skip table-wrap et promotion thead/th pour les layout tables (MarkdownReader.tsx) |
| FIX-066 | Extraction des figures de cellules secondaires sur toutes les pages de layout (MarkdownReader.tsx) |
| FIX-067 | Lightbox Premium interactive intégrée au Reader (MarkdownReader.tsx + FigureOverlay.tsx) |
| FIX-068 | Suppression et nettoyage des warnings de formatage KaTeX (ignore strict warn) (MarkdownReader.tsx) |
| FIX-069 | Restreindre l'extraction des images secondaires de layout table à la page 1 (MarkdownReader.tsx) |
| FIX-070 | Focus mode récursif basé sur l'outline/sommaire PDF (MarkdownReader.tsx) |
| FIX-071 | Synchronisation et affichage du nom du PDF dans le Reader (App.tsx + MarkdownReader.tsx) |
| FIX-072 | Annotations durables côté serveur : `cache/{doc}/annotations.json`, endpoints GET/PUT `/doc/{id}/annotations`, écriture atomique, notes orphelines supprimées (main.py + fiche.py) |
| FIX-073 | Restauration surlignage section-scopée multi-nœuds : clés `{section}::{shortHash}`, `wrapRange` pose `backgroundColor` (MarkdownReader.tsx) |
| FIX-074 | Sync Option B (localStorage primaire + sync serveur débouncé 1000ms, I-B) + auto-migration localStorage→serveur (MarkdownReader.tsx) |

---

## Fichiers clés

| Rôle | Fichier |
|------|---------|
| Endpoints API | `backend/main.py` |
| Pipeline extraction | `backend/pipeline.py` |
| Client API TS | `frontend/src/api.ts` |
| Types TypeScript | `frontend/src/types.ts` |
| Shell principal | `frontend/src/App.tsx` |
| Reader HTML Docling | `frontend/src/components/Reader/MarkdownReader.tsx` |
| Styles Reader | `frontend/src/components/Reader/MarkdownReader.css` |

---

## PROTOCOLE LECTURE (début de session Gemini)
1. Lire ce fichier (GEMINI.md)
2. Lire `memory/INDEX.md`
3. Lire les 10 dernières entrées de `memory/LOG.md`
4. Lire `memory/fixes-registry.md` en entier
5. Lire les pages `memory/` spécifiques à la zone de travail :
   - Modif `backend/pipeline.py` → `memory/backend-pipeline.md`
   - Modif `backend/main.py`    → `memory/backend-api.md`
   - Modif composants frontend  → `memory/frontend-app.md`
   - Modif MarkdownReader        → `memory/frontend-reader.md`
   - Travail formules/LaTeX      → `memory/formulas.md`
6. Vérifier `memory/technical-debt.md` pour les TD ouverts dans la zone concernée

---

## PROTOCOLE ÉCRITURE (après chaque changement — tous agents)
1. Mettre à jour la/les page(s) `memory/` concernée(s)
2. Si nouvelle contrainte introduite → ajouter FIX-NNN dans `memory/fixes-registry.md`
    (incrémenter depuis FIX-020)
3. Si TD résolu → le marquer résolu avec la date dans `memory/technical-debt.md`
4. Si décision architecturale → ajouter ADR-NNN dans `memory/decisions.md`
5. Ajouter une entrée dans `memory/LOG.md` (format ci-dessous) — en HAUT du fichier
6. Si nouvelle page créée → ajouter une ligne dans `memory/INDEX.md`
7. **Mettre à jour le tableau FIX dans GEMINI.md ET dans CLAUDE.md** si de nouveaux FIX sont ajoutés
8. Mettre à jour `memory/phases.md` si tâche terminée ou nouvelle phase

### Format d'entrée LOG
```
### AAAA-MM-JJ — Titre court (verbe impératif, < 70 car)
**Fichiers modifiés :** `chemin/fichier1`, `chemin/fichier2`
**Résumé :** Ce qui a été fait et pourquoi (1-3 phrases).
**Fixes introduits :** FIX-NNN — description, ou "aucun"
**Points ouverts :** travaux différés, ou "aucun"

---
```

---

## Contexte multi-agent
Ce projet est développé simultanément par plusieurs agents IA :

| Agent | Fichier lu au démarrage | Notes |
|-------|------------------------|-------|
| Claude Code | `CLAUDE.md` | Agent principal, auteur des FIX-001 à FIX-019 |
| Antigravity | `CLAUDE.md` | Lit le même fichier que Claude Code |
| Gemini Code Assist | `GEMINI.md` (ce fichier) | Miroir de CLAUDE.md |

**Règle de synchronisation :** Quand le tableau FIX ou les protocoles dans `CLAUDE.md`
changent, mettre à jour `GEMINI.md` en même temps (et vice-versa). La source de vérité
détaillée reste toujours `memory/fixes-registry.md`.
