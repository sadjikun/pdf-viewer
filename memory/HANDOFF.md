# HANDOFF — Passage de relai inter-agents

> **Ce fichier est la première lecture pour tout agent reprenant ce projet.**  
> Il résume ce qui a été fait, ce qui reste à faire, et dans quel ordre attaquer.  
> Source de vérité détaillée : `memory/fixes-registry.md` + `memory/PRD.md` + `cache-schema.md` + `architecture.md`

---

## 0. ÉTAT ACTUEL — branche `develop` (MAJ 2026-06-04)

> 🚨 **À LIRE EN PREMIER — changement de base de travail.**
> **N'utilise plus `feature/v2-tables-reader-ocr`** (elle est `behind 48` commits,
> larguée et non rebasable proprement). La nouvelle base d'intégration synchronisée
> est **`develop`**, qui est désormais EN AVANCE sur v2 (la PR #5 a été découpée et
> mergée sur `main` en Phase 5, puis le reste portable repris sur `develop` en
> Phase 6 / PRs #26→#32). En début de session :
> ```
> git fetch origin
> git checkout develop && git pull --ff-only origin develop
> git checkout -b feature/ma-tache   # toujours créer tes branches DEPUIS develop
> ```
> Détail Git : tes commits sont signés `sadjikun <hadylimz@gmail.com>`, ce qui n'est
> pas l'identité du repo. Configure `git config user.name`/`user.email` côté ta
> machine pour une attribution correcte sur les prochaines PRs.

> ⚠️ Les sections 1-4 ci-dessous datent du **2026-05-25** et décrivent la branche
> v2 d'origine (FIX-033→068, Reader câblé, fast path, de-embedding). **Pour
> travailler sur `develop`, lire d'abord cette section + `cache-schema.md` +
> `architecture.md`** (mis à jour). Certains FIX référencent du code absent de develop.

**Travailler sur `develop`** : `git fetch origin && git checkout develop && git rebase origin/main`
régulièrement (ne pas laisser diverger comme la branche v2 l'a fait).

**Présent sur develop** : async + polling, Library, 10 thèmes, Reader Markdown/HTML
(hooks extraits dans `hooks/` mais **non câblés** dans MarkdownReader.tsx), multi-format
MarkItDown, OCR (Tesseract/pix2tex/Texify), Florence-2 captioning, annotations + fiche,
PWA, launcher pywebview Windows, cleanup/thumbnail/reprocess(force_ocr), **bibliothèque
documentaire** (référencement par chemin sans copie → `extraction_mode:"registered"`).
27 endpoints. doc_id toujours 16 hex (`^[a-f0-9]{16}$`).

**Absent de develop** (présent sur la branche v2) : fast path pypdfium2
(`_extraire_natif`), de-embedding images (`/html-image`), `/health`, `/app-mode`
(à refactorer — lecture env figée à l'import), endpoint benchmark, Reader câblé aux hooks,
ModeChooser, son installeur production complet.

**Prochaines pistes** : câbler les hooks dans MarkdownReader (TD côté équipe sadjikun),
tester les features ML en local (modèles non en cache CI), valider le rendu navigateur
(Compare/themes/Library/register), éventuellement de-embedding pour alléger le HTML.

---

## 1. Ce qui a été livré (session v2, FIX-033 → FIX-068 — historique branche v2)

| FIX | Résumé | Fichiers touchés |
|-----|--------|-----------------|
| FIX-033 | Pages A4 encadrées dans le Reader avec liseré bureau et marges documentaires | `MarkdownReader.css`, `App.css` |
| FIX-034 | Limite de 20 Mo sur le HTML brut pour éviter le plantage du Reader + FileResponse | `main.py`, `MarkdownReader.tsx` |
| FIX-035 | De-embedding des images base64 pour alléger drastiquement le HTML Docling | `pipeline.py`, `main.py` |
| FIX-036 | Traitement transparent des layout tables Docling pour éviter le style orange/scrollbar | `MarkdownReader.tsx` |
| FIX-037 | Debounce de 150 ms sur le scroll du PDF viewer pour éviter les saccades en Compare | `Viewer.tsx` |
| FIX-044 | Conversion des images de formules PICTURE via pix2tex en KaTeX backend | `pipeline.py` |
| FIX-045 | Définition des limites de chapitres par l'outline backend dans le Focus Mode | `MarkdownReader.tsx` |
| FIX-046 | Détection structurelle bilingue de la Table des Matières (TOC) | `pipeline.py`, `MarkdownReader.tsx` |
| FIX-047 | Parallélisation du pipeline (Docling, pix2tex ThreadPool, écritures HTML parallèles) | `pipeline.py` |
| FIX-048 | Protection thread-safe `_PDFIUM_LOCK` sur l'accès concurrent au document pypdfium2 | `pipeline.py` |
| FIX-049 | Tri par page réelle dans `_toc_vers_outline` pour conserver l'ordre logique | `pipeline.py` |
| FIX-050 | Suppression automatique des préfixes applicatifs comme "Microsoft Word - " | `pipeline.py`, `App.tsx` |
| FIX-051 | Exclusion des pages de Table des Matières (TOC) lors du scan outline | `pipeline.py` |
| FIX-052 | Surlignage de la recherche synchronisé entre la sidebar globale et le Reader | `App.tsx`, `MarkdownReader.tsx` |
| FIX-053 | Tâche asynchrone et route d'API `/cache/cleanup` pour le nettoyage du cache | `main.py` |
| FIX-054 | Extraction de secours (Fallback Chain: Docling -> MarkItDown -> pypdfium2) | `pipeline.py` |
| FIX-055 | Alignement vertical `<br>` des cellules de tableau avec tokens courts séparés par espaces | `MarkdownReader.tsx` |
| FIX-056 | Fusion en ligne des paragraphes se terminant par un deux-points (ex. Point 2.1.1) | `MarkdownReader.tsx` |
| FIX-057 | Correction des équations KaTeX display (doubles bordures et glissements au scroll) | `MarkdownReader.css` |
| FIX-058 | Compacité de la barre d'outils Reader, barre de chemin et bandeaux focus | `MarkdownReader.css` |
| FIX-059 | Pliage/dépliage interactif au clic sur les éléments du sommaire (Outline) | `Outline.tsx` |
| FIX-060 | Cache global de l'instance `DocumentConverter` pour éliminer la lenteur de rechargement | `pipeline.py` |
| FIX-061 | Désactivation de la vérification de mise à jour Albumentations en cas de réseau limité | `pipeline.py` |
| FIX-062 | Encodage UTF-8 et sanitation CP1252 sur console Windows pour empêcher les exceptions | `pipeline.py`, `main.py` |
| FIX-063 | Messages d'estimations réalistes dans l'overlay de chargement rouge | `LoadingDocling.tsx` |
| FIX-064 | Allocation de threads CPU adaptative (jusqu'à 12 threads) sur worker CPU unique | `pipeline.py` |
| FIX-065 | Skip table-wrap et promotion thead/th pour les layout tables | `MarkdownReader.tsx` |
| FIX-066 | Extraction des figures de cellules secondaires sur toutes les pages de layout | `MarkdownReader.tsx` |
| FIX-067 | Lightbox Premium interactive intégrée au Reader | `MarkdownReader.tsx`, `FigureOverlay.tsx` |
| FIX-068 | Suppression et nettoyage des warnings de formatage KaTeX | `MarkdownReader.tsx` |

> Détail complet de chaque FIX dans `memory/fixes-registry.md` sections FIX-033 à FIX-068.

---

## 2. État actuel des TDs

| ID | Statut | Description courte |
|----|--------|-------------------|
| TD-006 | ✅ Résolu | 16 tests pytest ajoutés dans `test_pipeline_unit.py` couvrant les fonctions du pipeline |
| TD-007 | ✅ Résolu (FIX-030) | Sur-détection sections petits docs |
| TD-008 | ✅ Résolu (FIX-029) | Virtualisation pages react-pdf |
| TD-009 | ✅ Résolu | `_log_memory()` branché pour le profiling mémoire RSS |
| TD-010 | ✅ Résolu | Mini-TOC flottante unifiée avec les données du sommaire backend |
| TD-011 | ✅ Résolu (FIX-028) | Tables dans Reader |
| TD-012 | ✅ Résolu | pix2tex installé et fonctionnel en local avec fallback KaTeX |
| TD-013 | ✅ Résolu | Détection de cache obsolète via versioning de pipeline (`PIPELINE_VERSION`) |

---

## 3. Tâches restantes — classées par priorité

### 🟢 Améliorations futures

- **Intégration continue & Déploiement** : Packaging de l'application (ex. Docker ou exécutable autonome) pour des déploiements facilités.
- **Recherche Ctrl+F avancée** : Améliorer la recherche par pertinence sémantique dans le Reader HTML.

---

## 4. Invariants critiques à ne jamais casser

> **Lire `memory/fixes-registry.md` entièrement avant tout changement.**

Les plus importants de cette session :

| FIX | Invariant |
|-----|-----------|
| FIX-026 | `isProgrammaticScrollRef` : `useRef(false)` dans MarkdownReader. Ne jamais appeler `onPageChange` depuis `scrollToSection` ou `scrollToPage` — boucle infinie sinon |
| FIX-028 | Dans TD-011 PASS A : seuil `textContent < 20` chars. Ne pas remonter — certaines vraies tables ont des cellules très courtes |
| FIX-029 | `viewer-stage` doit avoir `height: totalHeight` (px fixe). `.viewer-page` doit être `position: absolute`. Ne jamais remettre `margin` sur `.viewer-page` (marge déjà intégrée dans `slotHeights`) |
| FIX-030 | Seuil `n_total_pages <= 3` pour le filtre. Ne pas l'augmenter au-delà de 3 |
| FIX-032 | `PAGE_FULL_WIDTH = 1240` dans sectionizeHtml. Seuil 85 %. Ne jamais forcer `max-width` sur les images larges (> 85 %) |

---

## 5. Architecture en un paragraphe (rappel)

`POST /process` → `pipeline.py::convertir_pdf()` → fast path pypdfium2 (~1s) ou Docling+RapidOCR (~25-80s) → `cache/{sha256[:16]}/result.json + result.html`. Frontend : `App.tsx` gère 3 modes (PDF via `Viewer.tsx`, Reader via `MarkdownReader.tsx`, Compare côte-à-côte). `sectionizeHtml()` dans MarkdownReader transforme le HTML Docling en sections navigables avec post-passes de nettoyage (FIX-007, FIX-012, FIX-014, FIX-015, FIX-021, FIX-022, FIX-025, FIX-028, FIX-032).

---

## 6. Commandes de démarrage

```bash
# Backend (terminal 1)
cd backend && .venv\Scripts\activate
uvicorn main:app --reload --reload-exclude .venv

# Frontend (terminal 2)
cd frontend && npm run dev
# → http://localhost:5173
```

---

## 7. Fichiers à lire en priorité selon la zone de travail

| Zone | Fichiers mémoire à lire |
|------|------------------------|
| Backend `pipeline.py` | `backend-pipeline.md`, `fixes-registry.md` (FIX-001 à FIX-016, FIX-025, FIX-030/031) |
| Backend `main.py` | `backend-api.md`, `cache-schema.md` |
| Frontend Reader | `frontend-reader.md`, `fixes-registry.md` (FIX-005 à FIX-008, FIX-021, FIX-022, FIX-025/028/032) |
| Frontend Viewer | `fixes-registry.md` (FIX-029) |
| Frontend App | `frontend-app.md`, `fixes-registry.md` (FIX-009, FIX-010, FIX-017, FIX-018, FIX-019, FIX-020, FIX-026/027) |
| Nouveaux FIX | Lire `fixes-registry.md` entier → incrémenter depuis FIX-032 |

---

## 8. Points d'attention spécifiques (pièges connus)

1. **`effectiveViewMode` vs `viewMode`** (FIX-010) : dans `App.tsx`, `handleSelect` et `handlePageChange` doivent toujours utiliser `viewMode`, jamais `effectiveViewMode`. L'`effectiveViewMode` n'est là que pour le rendu des composants.

2. **`forwardRef` sur MarkdownReader** (FIX-008) : `MarkdownReader` est un `forwardRef<ReaderHandle>`. Ne jamais le transformer en composant ordinaire — `viewerRef` et `readerRef` en dépendent.

3. **Viewer CSS `position:absolute`** (FIX-029) : le `.viewer-page` est maintenant `position:absolute`. Si on ajoute un style, vérifier qu'il ne conflicte pas avec `left: 50%; transform: translateX(-50%)`.

4. **`pdf_title` peut être vide** (FIX-031) : `src.get_metadata_value("Title")` retourne `""` si pas de métadonnée — le fallback `filename` est obligatoire partout où `pdf_title` est utilisé.

5. **Seuil image-table** (FIX-028) : la condition `textContent.trim().length <= 20` doit précéder le test `img[src^='data:image/']`. Ne pas inverser l'ordre.

6. **`RENDER_BUFFER = 5`** (FIX-029) : réduire cette valeur rend le scroll de navigation brutal (pages blanches visibles). 5 est un minimum pour un scrolling fluide.
