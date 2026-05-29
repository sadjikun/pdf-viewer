# LOG — Journal de changements

Append-only. Entrées les plus récentes en haut.
Une entrée par session de travail significative.

### 2026-05-27 — Florence-2 : correctifs compatibilité transformers 5.x
**Fichiers modifiés :** `backend/pipeline.py`, `~/.cache/huggingface/modules/transformers_modules/microsoft/Florence_hyphen_2_hyphen_base/.../configuration_florence2.py`
**Résumé :** Florence-2-base est incompatible avec transformers 5.x sur deux points : (1) `configuration_florence2.py` accède à `self.forced_bos_token_id` directement alors que 5.x le supprime de `__getattribute__` → corrigé via `getattr(self, "forced_bos_token_id", None)` dans le fichier cache; (2) `Florence2ForConditionalGeneration` ne définit pas `_supports_sdpa` attendu par le dispatcher SDPA de 5.x → corrigé en passant `attn_implementation="eager"` à `from_pretrained`. Florence-2 OK confirmé.
**Fixes introduits :** aucun (comportements déjà couverts par FIX-044)
**Points ouverts :** le patch `configuration_florence2.py` est dans le cache HF local (~/.cache/huggingface/modules/) — si le cache est supprimé, le patch est perdu et doit être réappliqué.

---

### 2026-05-27 — Texify : moteur LaTeX-OCR unifié (remplace pix2tex en moteur primaire)
**Fichiers modifiés :** `backend/pipeline.py`, `backend/main.py`, `backend/requirements.txt`, `memory/formulas.md`
**Résumé :** Intégration de Texify (VikParuchuri) comme moteur LaTeX-OCR primaire. Nouvelle abstraction `_latex_ocr_batch(imgs)` + `_resolve_engine()` qui dispatche vers Texify (batch, ~500 MB) ou pix2tex (fallback). Toutes les call-sites (harvest Docling, _convert_figure_formulas, _latex_ocr_figure, endpoint /latex-ocr) utilisent désormais les fonctions unifiées. Texify bénéficie d'une inférence batch native au lieu de ThreadPoolExecutor. Variable `FORMULA_ENGINE` (auto/texify/pix2tex).
**Fixes introduits :** aucun
**Points ouverts :** `pip install texify` pour activer

---

### 2026-05-27 — Florence-2 : captioning IA des figures
**Fichiers modifiés :** `backend/pipeline.py`, `backend/main.py`, `backend/requirements.txt`, `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/components/Gallery/Gallery.tsx`, `frontend/src/components/Gallery/Gallery.css`, `frontend/src/components/Figure/FigureOverlay.tsx`, `frontend/src/components/Figure/FigureOverlay.css`
**Résumé :** Intégration de Florence-2-base (microsoft) pour générer automatiquement des descriptions textuelles des figures extraites. Singleton lazy avec `_init_florence()` + verrou `_FLORENCE_LOCK`, activé via `FLORENCE2_CAPTION=1`. Nouveau endpoint `POST /doc/{id}/caption-figures` pour lancer le captioning à la demande. Frontend : badge "IA" dans la galerie et dans la lightbox, bouton "Décrire les figures" dans l'onglet galerie, `caption_ai` stocké dans `result.json`.
**Fixes introduits :** aucun
**Points ouverts :** `einops` et `timm` à installer (`pip install einops timm`) si pas encore dans le venv

---

### 2026-05-25 — Correctif layout tables, Lightbox Premium Reader et suppression warnings KaTeX
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Figure/FigureOverlay.tsx`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** Résolution de la disposition des images dans le Reader en ignorant les tables de mise en page (layout tables) lors de la promotion thead/th et de l'enveloppement table-wrap, et en restaurant l'extraction des figures des cellules secondaires sur toutes les pages. Intégration du composant FigureOverlay dans le Reader (Lightbox Premium avec contrôles de zoom, rotation, impression, navigation et redirection de page) connecté à la liste des images de la page. Suppression des warnings et erreurs de syntaxe KaTeX dans la console du navigateur par sanitation des espaces Unicode et configuration strict: "ignore".
**Fixes introduits :** FIX-065 — Skip table-wrap pour layout tables, FIX-066 — Figures cellules secondaires sur toutes pages, FIX-067 — Lightbox Premium dans Reader, FIX-068 — Silence warnings KaTeX.
**Points ouverts :** aucun

---

### 2026-05-25 — Optimisations de performance, mise en page et correctifs Windows
**Fichiers modifiés :** `backend/main.py`, `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/components/Outline/Outline.tsx`, `frontend/src/components/Loading/LoadingDocling.tsx`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** Implémentation d'une gestion plus efficace des threads CPU sur machine limitée en RAM (Dynamic Thread Scaling), mise en cache globale du DocumentConverter, désactivation des vérifications réseau bloquantes au chargement (Albumentations version update check) et encodage UTF-8/sanitation des caractères Unicode pour éviter les plantages sur Windows (cp1252). Ajustements d'interface : compacité de la barre d'outils, alignement vertical des cellules de tableau avec séparateurs multiples, fusion en ligne des paragraphes se terminant par deux-points, élimination des doubles bordures/glissements des équations KaTeX et pliage/dépliage interactif du sommaire.
**Fixes introduits :** FIX-055 — Alignement cellules espacées, FIX-056 — Alignement paragraphes colons, FIX-057 — KaTeX display double bordure, FIX-058 — Compacité barre d'outils/navigation, FIX-059 — Interaction dépliage outline, FIX-060 — Mise en cache DocumentConverter, FIX-061 — Skip update Albumentations, FIX-062 — Output UTF-8 et sanitation CP1252, FIX-063 — Adaptation des messages de chargement, FIX-064 — Threads CPU dynamiques.
**Points ouverts :** aucun

---

### 2026-05-25 — FIX-053, FIX-054 : nettoyage du cache et routage de secours (fallback)
**Fichiers modifiés :** `backend/main.py`, `backend/pipeline.py`, `backend/test_pipeline_unit.py`, `memory/fixes-registry.md`, `memory/phases.md`, `BACKLOG.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** (1) Implémentation du nettoyage automatique du cache via une tâche de fond au démarrage et d'un endpoint `POST /cache/cleanup` avec max_age_days personnalisable (FIX-053). (2) Ajout d'une chaîne de routage de secours (Fallback Chain) dans le pipeline pour PDF non natifs : en cas de crash de Docling, basculement vers MarkItDown, puis pypdfium2. Déclenchement automatique du fallback si aucun HTML n'est généré (FIX-054). (3) Ajout de tests unitaires pour valider la robustesse du fallback (16 tests pytest pass).
**Fixes introduits :** FIX-053 — nettoyage automatique du cache, FIX-054 — routage de secours (Fallback Chain)
**Points ouverts :** aucun

---

### 2026-05-25 — FIX-050, FIX-051 : nettoyage titre PDF et correction placement Annexes
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/App.tsx`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** (1) Nettoyage automatique du titre PDF extrait en supprimant les préfixes d'application tels que "Microsoft Word - " ou "Microsoft PowerPoint - " dans le backend, complété par une fonction utilitaire `cleanPdfTitle` dans le frontend pour assurer la rétrocompatibilité des documents en cache (FIX-050). (2) Ajout d'une fonction `_is_toc_page()` dans le backend pour détecter les pages de Table des Matières (TOC) via des expressions régulières et les points de conduite. Ces pages sont désormais ignorées lors de l'extraction de l'outline à partir du texte, évitant ainsi que les annexes listées dans la TOC sans points de conduite ne soient détectées à tort sur la page de sommaire (page 2) et placées en début d'outline au lieu de leurs pages réelles (page 33, 52, 70) (FIX-051).
**Fixes introduits :** FIX-050 — nettoyage titre PDF, FIX-051 — saut des pages de Table des Matières (TOC) pour l'outline
**Points ouverts :** aucun

---

### 2026-05-25 — FIX-049 : tri outline par page dans _toc_vers_outline
**Fichiers modifiés :** `backend/pipeline.py`
**Résumé :** Certains PDFs placent leurs Attachments/Annexes en tête de l'arbre de bookmarks alors qu'ils apparaissent à la fin du document. `_toc_vers_outline` construisait l'outline en respectant l'ordre des bookmarks → Attachment A/B/C remontaient en tête de la sidebar. Fix : `flat.sort(key=lambda x: (x["page"] is None, x["page"] or 0))` avant `_construire_outline`. L'arbre est maintenant toujours trié par numéro de page réel ; les relations parent-enfant sont préservées car les enfants ont toujours des pages ≥ leur parent.
**Fixes introduits :** FIX-049 — tri par page dans `_toc_vers_outline`
**Points ouverts :** aucun

---

### 2026-05-25 — Contrôle de zoom Word + profondeur mini-TOC limitée
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`
**Résumé :** (1) `flattenOutline()` reçoit un paramètre `maxDepth` — la mini-TOC est désormais appelée avec `maxDepth=1` : affiche la racine + un seul niveau d'enfants directs (supprime les feuilles profondes comme les entrées de références). (2) Contrôle de zoom style Word dans la barre d'outils : boutons −/+ (pas de 10 %, plage 50–200 %), bouton « 100% » cliquable ouvrant un popup de préréglages (50 %, 75 %, 100 %, 125 %, 150 %, 200 %, « Largeur de la page » → 100 %, « Plusieurs pages » → 65 %). Le zoom CSS `zoom: N%` est appliqué directement sur `.reader-doc` (mode HTML et Markdown), compatible tous thèmes. Le popup zoom se ferme quand les autres popups s'ouvrent.
**Fixes introduits :** aucun nouveau FIX-NNN
**Points ouverts :** aucun

---

### 2026-05-25 — Mini-TOC unifiée avec la sidebar (même source outline backend)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`
**Résumé :** Bug : deux "Sommaire" affichaient des structures différentes — la sidebar utilisait `outline` (TOC natif PDF backend) et la mini-TOC utilisait `sections` (headings extraits du DOM HTML par `sectionizeHtml`). Fix : ajout de `flattenOutline()` helper + réécriture de la mini-TOC pour itérer sur `flattenOutline(outline)` au lieu de `sections`. Navigation conservée via `matchSection(sections, node.title)` + fallback heading text. Résultat : les deux sommaires sont identiques et cohérents.
**Fixes introduits :** aucun
**Points ouverts :** aucun

---

### 2026-05-25 — `_sanitize_latex` : nettoyage LaTeX pix2tex avant KaTeX
**Fichiers modifiés :** `backend/pipeline.py`
**Résumé :** Analyse des logs LOGS/127.0.0.1-1779686954744.log : 4 catégories d'erreurs KaTeX, toutes dues à pix2tex générant du LaTeX imparfait. Ajout de `_UNICODE_TO_LATEX` (table de 10 caractères Unicode → commandes LaTeX) et `_sanitize_latex()` appelée dans `_pix2tex_predict`. Corrige : caractères `′ ˙ ˉ ˊ ∅ ⊤ ⊥ †` + espaces insécables/zero-width + `\begin{array}` avec spec de colonnes trop courte (auto-expansion `cccc...`).
**Fixes introduits :** aucun nouveau FIX-NNN (amélioration qualité LaTeX sans régression d'invariants)
**Points ouverts :** `Expected node of symbol group type` (KaTeX crash) nécessite un try/catch côté frontend si LaTeX structurellement invalide

---

### 2026-05-25 — Allocation complète CPU/GPU : AcceleratorDevice.AUTO + threads par worker
**Fichiers modifiés :** `backend/pipeline.py`
**Résumé :** Trois améliorations coordonnées. (1) `_detect_compute()` détecte CUDA/MPS/CPU et logue le GPU. (2) `_compute_docling_workers()` retourne maintenant `(n_workers, threads_per_worker)` : sweet-spot 4 threads/worker en mode CPU (32 cores → 8 workers × 4 threads = 32 cœurs utilisés sans contention), réduit à 4 workers × N threads si GPU disponible. `torch.set_num_threads()` et `torch.set_num_interop_threads()` configurés au démarrage. (3) `_converter()` utilise `AcceleratorOptions(num_threads=THREADS_PER_WORKER, device=AcceleratorDevice.AUTO)` — Docling bascule automatiquement sur CUDA/MPS si disponible. Variables globales `COMPUTE_DEVICE`, `COMPUTE_VRAM_GB`, `THREADS_PER_WORKER` exposées.
**Fixes introduits :** aucun
**Points ouverts :** aucun

---

### 2026-05-25 — DOCLING_WORKERS auto-détecté selon RAM + CPU disponibles
**Fichiers modifiés :** `backend/pipeline.py`
**Résumé :** Remplacement de la valeur fixe `DOCLING_WORKERS=4` par `_compute_docling_workers()` : calcul dynamique au démarrage basé sur `psutil.virtual_memory().available` et `os.cpu_count()`. Formule : `min((available_gb - 2) / 1.5, cpu//2, 8)`. L'env var `DOCLING_WORKERS` surcharge toujours. Log de démarrage affiche RAM dispo, total, et workers choisis. Timing par batch conservé.
**Fixes introduits :** aucun
**Points ouverts :** aucun

---

### 2026-05-25 — DOCLING_WORKERS=4 + timing par batch
**Fichiers modifiés :** `backend/pipeline.py`
**Résumé :** Machine a 32 GB RAM. `DOCLING_WORKERS` passé de 2 à 4 par défaut → 9 batches en 3 rounds au lieu de 5 = ~40% plus rapide. `import time` ajouté. Timing `perf_counter` autour de la conversion OCR et du batch complet. Log total Docling `[pipeline] Docling total : Xs (N workers, M batches)`. L'env var `DOCLING_WORKERS` permet toujours de surcharger.
**Fixes introduits :** aucun
**Points ouverts :** pix2tex item-level sérialise encore via `_PIX2TEX_LOCK` entre workers (overhead estimé ~1.5 min sur doc 80p avec formules)

---

### 2026-05-25 — FIX-048 : `_split_pdf` thread-safe via `_PDFIUM_LOCK`
**Fichiers modifiés :** `backend/pipeline.py`, `memory/fixes-registry.md`, `CLAUDE.md`
**Résumé :** FIX-047 avait introduit des appels parallèles à `_split_pdf()` depuis `ThreadPoolExecutor`. Chaque thread ouvrait le même PDF avec `pdfium.PdfDocument(str(pdf_path))` simultanément → pypdfium2 (C/PDFium) non thread-safe → `PdfiumError: Data format error`. Fix : ajout de `_PDFIUM_LOCK = threading.Lock()` et enrobage du corps de `_split_pdf` dans `with _PDFIUM_LOCK:`.
**Fixes introduits :** FIX-048
**Points ouverts :** aucun

---

### 2026-05-25 — TD-010/Piste D/TD-006/TD-009/TD-013 : mini-TOC, regex fusionnée, tests, RAM, version
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `backend/pipeline.py`, `backend/main.py`, `backend/test_pipeline_unit.py` (nouveau)
**Résumé :** TD-010 : panneau mini-TOC flottant (position:fixed droite) avec état `showMiniToc`/`activeSid`, bouton bascule loupe-liste dans la toolbar, surlignage de la section active au scroll. Piste D : `_RE_COMBINED` module-level fusionne `_clean_html_spaces` + `_fix_formula_html` + `_strip_page_headers_footers` en une passe via `_apply_combined_passes()`. TD-006 : 15 tests pytest dans `test_pipeline_unit.py` (15/15 pass). TD-009 : `_log_memory()` helper psutil loggue RSS aux points clés du pipeline. TD-013 : `PIPELINE_VERSION = "2026-05-25"` dans pipeline.py + `needs_reprocess` flag dans `_load_result()` de main.py.
**Fixes introduits :** aucun nouveau FIX-NNN (améliorations internes sans régression d'invariants)
**Points ouverts :** aucun

---

### 2026-05-24 — FIX-047 : pipeline parallèle Docling (DOCLING_WORKERS + pix2tex ThreadPool)
**Fichiers modifiés :** `backend/pipeline.py`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** Quatre optimisations cumulatives (plan Pistes A-C-E). A : pré-compilation des patterns regex au niveau module (`_RE_FIG_FIGURE`, `_RE_FIG_B64`, `_RE_LATEX_START`). B : `_convert_figure_formulas()` parallélisé via `ThreadPoolExecutor` — `finditer` + map de prédictions pix2tex + reconstruction HTML en une passe. C : boucle Docling remplacée par `ThreadPoolExecutor(max_workers=DOCLING_WORKERS)` — chaque worker `_run_one_batch` crée son propre converter, résultats triés et IDs recalculés après fusion. E : boucle écriture HTML parts parallélisée (`_process_and_write_part` via pool). Locks `_CONVERTER_LOCK` et `_PIX2TEX_LOCK` protègent les ressources non thread-safe.
**Fixes introduits :** FIX-047
**Points ouverts :** Piste D (fusion des 6 passes regex HTML en 1-2 passes) non implémentée — gain estimé 20-40% post-traitement.

---

### 2026-05-24 — FIX-046 : détection TOC structurelle bilingue (toc-entry + page-boundary)
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`
**Résumé :** Deux couches de détection TOC. Layer 1 (FIX-038 amélioré) : `TOC_TITLE_RE` étendu (DE/ES/RU/NL + "Index") ; heading lui-même supprimé et remplacé par une note sidebar. Layer 2 (FIX-046) : `_strip_leaders()` backend taggue chaque paragraphe TOC nettoyé `class="toc-entry"` ; `sectionizeHtml` frontend détecte les pages contenant ≥4 `toc-entry` représentant ≥60 % des paragraphes → remplace toute la page par une note, sans dépendre du nom du heading (langues multiples).
**Fixes introduits :** FIX-046
**Points ouverts :** Les documents déjà en cache nécessitent un retraitement pour bénéficier du tag `toc-entry` backend. TD-010 mini-TOC flottante reste ouvert.

---

### 2026-05-24 — Fidélité visuelle F6.1/F6.5/F6.6 + TD-012 résolu
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `memory/technical-debt.md`, `memory/PRD.md`
**Résumé :** F6.6 : police par défaut changée de Lora (serif) à Calibri/Segoe (sans, document-like) — bouton renommé "Document". F6.1 : `.reader-content` avec `padding: 20px 16px 40px` → bureau gris visible au-dessus de la carte. Compare mode : bureau et shadow supprimés. `--fb` corrigée (suppression du `var(--font-ui)` erroné). H4 : suppression du uppercase/letterSpacing magazine. TD-012 marqué résolu (pix2tex 0.1.4 installé, pipeline branché).
**Fixes introduits :** aucun (pas de nouveau FIX-NNN — améliorations CSS non régressives)
**Points ouverts :** TD-010 mini-TOC flottante, TD-013 cache 72 DPI

---

### 2026-05-24 — Focus + 6 améliorations UX Reader (recherche, raccourcis, skeleton, print)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `memory/fixes-registry.md`, `CLAUDE.md`
**Résumé :** (1) FIX-045 : focus mode utilise désormais `outline` top-level comme boundary de chapitres au lieu du niveau HTML `<h2>` — corrige le cas où Docling émet tous les headings au même niveau. (2) Recherche dans le Reader : barre de recherche (bouton loupe + Ctrl+F simulé), navigation ↑↓, highlights `<mark>`. (3) Raccourcis clavier : J/K (section suivante/précédente en focus), Esc (ferme focus/lightbox/recherche). (4) Skeleton loader animé pendant le chargement HTML. (5) CSS print `@media print`. (6) Copy LaTeX au clic sur formule.
**Fixes introduits :** FIX-045
**Points ouverts :** aucun

---

### 2026-05-24 — FIX-044 : figures-formules converties en KaTeX via pix2tex backend
**Fichiers modifiés :** `backend/pipeline.py`, `memory/fixes-registry.md`
**Résumé :** Nouvelle fonction `_convert_figure_formulas()` dans le pipeline. Certaines formules labellisées PICTURE par Docling échappent au pix2tex fallback existant et restent en `<figure><img>`. Ce nouveau pass HTML (avant deembed) détecte les figures sans figcaption dont l'aspect ratio est large et plat (formule), les soumet à pix2tex, et les remplace par `<div class="formula"><math><annotation encoding="TeX">...</annotation></math></div>` → rendu KaTeX par le frontend.
**Fixes introduits :** FIX-044
**Points ouverts :** Nécessite re-traitement du PDF (vider le cache) pour activer sur documents déjà traités

---

### 2026-05-24 — Lightbox images, tables vides, formules-images stylisées
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`
**Résumé :** (1) Lightbox plein écran au clic sur toute image du Reader (event delegation + state `lightboxSrc`, fermeture Echap/clic). (2) PASS C dans `sectionizeHtml` : tables avec caption mais sans `<tr>` (Docling n'a pas extrait les données) → remplacées par `.table-unavailable` avec notice. (3) CSS `:has()` : figures sans figcaption (images de formules raster) reçoivent le même traitement visuel que `.formula` (fond bleu, bordure gauche bleue, badge "∑ Formule", overflow-x). (4) Largeur lecture : `--max-w: 860px` par défaut, centré, valeurs par thème ; taille XXL 24px ajoutée.
**Fixes introduits :** aucun (améliorations UX)
**Points ouverts :** formule 43 = image raster pur (Docling), conversion LaTeX nécessiterait pix2tex backend

---

### 2026-05-24 — Focus mode affiche section + sous-sections (TOC sidebar)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`
**Résumé :** `visibleHtml` useMemo : quand `focusSid` est défini, on affiche la section cliquée ET toutes les sections consécutives de niveau supérieur (ses sous-sections). Avant : `display:none` sur tout sauf l'ID exact → sous-sections cachées. Après : on calcule les IDs visibles via boucle sur `sections[focusIdx+1...]` tant que `level > focusLevel`. Dépendances du useMemo mises à jour (`focusIdx`, `sections`).
**Fixes introduits :** aucun (amélioration comportement focus mode)
**Points ouverts :** aucun

---

### 2026-05-24 — isLayoutTable caption fix + compareMode prop + reader libre
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.tsx`, `CLAUDE.md`
**Résumé :** FIX-042 : `isLayoutTable` vérifiait `table.querySelector("caption")` qui descendait dans les tables imbriquées → la table principale split_page_view était mal classifiée quand elle contenait une table-données avec caption. Fix : `el.closest("table") === table` pour vérifier uniquement la table courante. FIX-043 : nouveau prop `compareMode` sur MarkdownReader — en reader seul, `.pdf-page-marker { display: none }` et nav page masquée ; en compare, classe `reader--compare` re-active tout. Également : FIX-041 restreint à `pageNo === 1` seulement ; themes width `--max-w: 100%` ; formulas `formula-not-decoded` ajoutées au hook KaTeX.
**Fixes introduits :** FIX-042 — isLayoutTable caption scope, FIX-043 — compareMode prop reader libre
**Points ouverts :** aucun

---

### 2026-05-24 — Strip $ MathML + image couverture layout table
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `memory/fixes-registry.md`, `CLAUDE.md`
**Résumé :** (1) FIX-040 : post-pass dans `sectionizeHtml` supprime les `<mi>`/`<mo>` contenant seulement `$` dans tous les éléments `<math>` — artefacts Docling qui rendaient des `$$` visibles avant KaTeX. (2) FIX-041 : dans le traitement des layout tables, quand la cellule contenu (`docling-page`) a du texte et que d'autres cellules n'ont que des `<figure>`/`<img>` (pas de texte), ces images sont aussi incluses via `processNode` — corrige l'image de couverture absente du Reader.
**Fixes introduits :** FIX-040 — strip `<mi>$</mi>` MathML, FIX-041 — images couverture layout table
**Points ouverts :** aucun

---

### 2026-05-24 — FIX-036 : Layout tables Docling rendues en orange + scrollbar horizontale
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`  
**Résumé :** Docling rend certains documents en tableau 2 colonnes (`<table><tr><td>…</td><td>…</td></tr>`). Notre PASS B (`sectionizeHtml`) promouvait la 1ère ligne en `<thead>`, déclenchant le gradient orange `thead tr { background: linear-gradient(var(--or)...) }`. Le `.table-wrap { overflow-x: auto }` autour de ce tableau géant créait en plus une scrollbar horizontale indésirable. Fix : ajout de `isLayoutTable()` (détecte cellules contenant headings/divs bloc) et traitement transparent dans `processNode` — la table layout est récursée cell par cell, son contenu est traité normalement sans être cloné en bloc.  
**Fixes introduits :** FIX-036  
**Points ouverts :** aucun

---

### 2026-05-23 — FIX-035 : De-embedding images base64 HTML (6 MB → 32 KB par batch)
**Fichiers modifiés :** `backend/pipeline.py`, `backend/main.py`  
**Résumé :** Les fichiers HTML Docling atteignaient 571 MB (542 pages) car chaque image était embarquée en base64 (EMBEDDED mode). Ajout de `_deembed_images()` dans la boucle de post-traitement HTML : extrait chaque `data:image/...` en PNG/JPEG sur le disque (`html_images/bN/NNNNNN.ext`), remplace le src par `/doc/{id}/html-image/bN/NNNNNN.ext`. Ajout de l'endpoint `GET /doc/{id}/html-image/{path}` dans `main.py` avec protection path-traversal. Testé : 6.4 MB → 32 KB pour un batch de 10 pages (200x de réduction). L'import `base64` a été ajouté aux imports de pipeline.py.  
**Fixes introduits :** FIX-035  
**Points ouverts :** Les documents déjà en cache gardent leurs anciens HTML embarqués (FIX-034 guard à 20 MB toujours actif). Retraiter avec `/reprocess` pour bénéficier de la réduction.

---

### 2026-05-23 — FIX-034 : Reader vide sur HTML > 20MB + Reader pleine largeur
**Fichiers modifiés :** `backend/main.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Résumé :** Le document "Computational Structural Engineering" avait un HTML Docling de 599 MB. DOMParser crashait silencieusement → écran blanc dans le Reader. Ajout d'un guard 3 niveaux (Content-Length header, taille du raw, html vide après parsing) limitant à 20 MB. Indication "⚠️ HTML trop lourd" dans la toolbar. Backend : FileResponse pour l'endpoint /html (streaming + Content-Length auto), expose_headers CORS. CSS : Reader pleine largeur comme le PDF viewer (padding: 0, margin: 0, border-radius: 0).  
**Fixes introduits :** FIX-034  
**Points ouverts :** Pour les très gros documents, envisager ImageRefMode.REFERENCED au lieu de EMBEDDED dans Docling (réduirait drastiquement la taille HTML)

---

### 2026-05-23 — F6.1/F6.5 : bande "bureau" pleine largeur entre pages Reader (FIX-033)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.css`  
**Résumé :** Le séparateur de pages PDF dans le Reader est maintenant une bande de 36px couleur "bureau" (gris neutre #dfe0e2) qui saigne pleine largeur grâce à `margin: 0 calc(-1 * var(--doc-px))`. Nouveauté : variable CSS `--doc-px` sur `.reader-doc` comme référence unique pour les marges latérales du document, `overflow-x: clip` sur `.reader-cw`, ombres inset sur le séparateur, `--desk` décliné en dark + thèmes colorés, responsive 900px/600px.  
**Fixes introduits :** FIX-033 — pages A4 encadrées CSS (F6.1/F6.5)  
**Points ouverts :** TD-010 (TOC flottante Reader), TD-006 (tests backend), Ctrl+F Reader

---

### 2026-05-23 — Création HANDOFF.md + mise à jour PRD/phases/INDEX
**Fichiers modifiés :** `memory/HANDOFF.md` (nouveau), `memory/INDEX.md`, `memory/PRD.md`, `memory/phases.md`
**Résumé :** Fichier de passage de relai créé dans `memory/HANDOFF.md` : résumé des FIX-025→032 livrés cette session, état de tous les TDs, tâches restantes classées par priorité avec estimation d'effort et instructions d'implémentation, invariants critiques à ne jamais casser, pièges connus. Ajouté à `INDEX.md`. Statuts `PRD.md` et `phases.md` mis à jour (4.1 Tables ✅, 4.5 Virt ✅, F6.7 ✅).
**Fixes introduits :** aucun
**Points ouverts :** TD-006 (tests), TD-010 (TOC flottante), F6.1/F6.5 (pages A4), F6.6 (police), TD-012 (pix2tex)

---

### 2026-05-23 — TD-007 / Item 9 / F6.7 : sections, titre PDF, images proportionnelles
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/types.ts`, `frontend/src/App.tsx`, `frontend/src/components/Reader/MarkdownReader.tsx`
**Résumé :** (1) **TD-007** : filtre post-`_extraire_sections_doc` sur docs ≤ 3 pages — seules les sections numérotées/annexes sont conservées, éliminant les faux positifs de type "Experience", "Education" sur CV scannés. (2) **Item 9** : lecture du titre PDF via `src.get_metadata_value("Title")` (pypdfium2) ; ajouté au dict de retour (`pdf_title`), au type `DocResult`, à la sidebar et au titre de l'onglet Chrome — priorité `pdf_title > filename > id`. (3) **F6.7** : post-pass `sectionizeHtml` — retire attributs `width`/`height` HTML des `<img>`, lit la largeur depuis le header PNG (IHDR bytes 16-19 via `atob`), pose `max-width: min(Npx, 100%)` si < 85 % de la largeur page → les petits schémas ne s'étirent plus en pleine largeur.
**Fixes introduits :** FIX-030 (TD-007 filtre court doc), FIX-031 (Item 9 pdf_title), FIX-032 (F6.7 images proportionnelles)
**Points ouverts :** aucun

---

### 2026-05-23 — Virtualisation Viewer PDF (TD-008) — FIX-029
**Fichiers modifiés :** `frontend/src/components/Viewer/Viewer.tsx`, `frontend/src/components/Viewer/Viewer.css`
**Résumé :** Remplace le montage de TOUS les `<div>` de pages (500 divs pour un gros PDF) par une fenêtre virtuelle basée sur `position: absolute` + scroll handler. Un seul `<div class="viewer-stage">` de hauteur fixe (`totalHeight = Σ slotHeights`) contient uniquement les pages dans `[activePage ± RENDER_BUFFER=5]` soit 11 pages max montées à la fois. `scrollToPage(p)` calcule le `scrollTop` depuis les sommes préfixes (`cumulativeHeights`) sans ref par page. Saut > 5 000 px = scroll instantané. Supprime IntersectionObserver (remplacé par écouteur `scroll` + recherche dichotomique). L'interface publique `ViewerHandle` est inchangée — App.tsx inchangé.
**Fixes introduits :** FIX-029 — Virtual rendering Viewer PDF (position:absolute + scroll handler + cumulative heights)
**Points ouverts :** aucun

---

### 2026-05-23 — Tables dans Reader : strip image-tables + thead + styles (TD-011)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`
**Résumé :** TD-011 résolu. Deux post-passes dans `sectionizeHtml` : PASS A supprime les « image-tables » (tables Docling contenant uniquement un raster base64, textContent < 20 chars) ; PASS B enveloppe les vraies tables dans `.table-wrap` et promeut la 1ère `<tr>` en `<thead>` (convertit `<td>` → `<th>`) si aucun `<thead>` n'existe, ce qui Docling ne génère pas. CSS mis à jour : bordures complètes des cellules, en-tête orange dégradé actif, `vertical-align: top`, `:nth-child` corrigé sur `tbody tr`.
**Fixes introduits :** FIX-028 — strip image-tables Docling + wrap `.table-wrap` + promotion `<thead>` dans sectionizeHtml
**Points ouverts :** aucun

---

### 2026-05-23 — Sync Reader→PDF, Reader pleine largeur, TOC frontend, FIX-026/027
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/App.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.css`, `memory/fixes-registry.md`, `CLAUDE.md`, `GEMINI.md`  
**Résumé :** (1) **Sync bidirectionnelle Reader→PDF** (FIX-026) : ajout prop `onPageChange` dans `MarkdownReader`. Ref `isProgrammaticScrollRef` (700 ms) empêche la boucle Reader→PDF→Reader. Quand l'utilisateur scrolle le Reader en compare, le PDF viewer suit automatiquement. (2) **Reader pleine largeur** (FIX-027) : `--max-w` passe de `840px` à `100%` dans le thème CSTB par défaut. `.reader-content` reçoit `padding: 0 20px` pour laisser un liseré de "bureau" gris visible. Mode compare : override `padding: 0`. (3) **TOC frontend** (FIX-025 mirror) : port du correctif backend dans `sectionizeHtml` — éclate les paragraphes TOC concaténés sur les docs déjà en cache, sans nécessiter `/reprocess`. (4) **Explications boutons** : OCR, .md, Bench, Retraiter documentés dans LOG.  
**Fixes introduits :** FIX-026 (sync Reader→PDF), FIX-027 (reader pleine largeur)  
**Points ouverts :** Titre "source" = nom du fichier uploadé, pas un bug. Rasters pleine-page : PASS 2 backend suffisant pour les nouveaux docs ; docs en cache → `/reprocess`.

---

### 2026-05-23 — Fix images manquantes (revert FIX-023) + fix TOC concaténée (FIX-025)
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `backend/pipeline.py`, `memory/fixes-registry.md`  
**Résumé :** (1) **Images manquantes** : revert du filtre `src.length > 150_000` introduit par FIX-023. Ce seuil était trop agressif — les figures de contenu légitimes (captures d'écran, schémas haute résolution) dépassent facilement 200 000–500 000 chars base64. Le post-pass FIX-011 ne filtre maintenant QUE les micro-images < 10 000 chars (logos/icônes). Les rasters pleine-page restent supprimés par le backend PASS 2 et le skip frontend du premier enfant captionless dans `<div class="docling-page">`. (2) **TOC concaténée** : PASS 2 ajouté dans `_fix_toc_entries()` (pipeline.py). Détecte les `<p>` longs (> 100 chars) contenant ≥ 3 numéros de section `N.M` — signe d'une page sommaire que Docling a agrégée en un seul bloc. Insère `\n` avant chaque numéro de section collé au texte précédent, puis éclate le `<p>` en autant de `<p>` individuels. Ex : `"beams2.2Modeling"` → `"beams"` + `"2.2Modeling"`.  
**Fixes introduits :** FIX-023 revert (documenté), FIX-025 (TOC concaténée)  
**Points ouverts :** Documents en cache avant ce fix nécessitent `/reprocess` pour bénéficier du FIX-025 backend.

---

### 2026-05-23 — Fidélité visuelle Reader : pages A4, police document, VISION.md + PRD.md
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.css`, `memory/VISION.md` (créé), `memory/PRD.md` (créé), `memory/INDEX.md`, `CLAUDE.md`  
**Résumé :** (1) **Rendu document A4** : `reader-content` passe en fond gris neutre (#dfe0e2 clair, #111115 sombre) pour simuler un "bureau". `reader-cw` devient une carte blanche avec ombre portée (papier posé sur le bureau). `reader-doc` reçoit des marges document (52px 72px) simulant les marges A4. Mode compare : carte plein-panneau sans ombre, marges réduites. Adaptation des thèmes colorés (OLED, Forest, Tech, Vintage, CSTB). (2) **Police document** : nouvelle variable `--fd: 'Calibri', 'Segoe UI', 'Trebuchet MS', system-ui` — Calibri est la police la plus courante des PDFs Windows (Microsoft Office). Appliquée sur `p, li, td, th` en mode "sans" (défaut). L'utilisateur peut basculer en serif (Lora) si souhaité. (3) **Documents vision** : création de `memory/VISION.md` (boussole 2 min pour tous les agents) et `memory/PRD.md` (PRD complet avec features, personas, contraintes, roadmap). INDEX.md et CLAUDE.md mis à jour pour inclure VISION.md en première lecture de session.  
**Fixes introduits :** aucun (amélioration visuelle + documentation)  
**Points ouverts :** Images toujours `max-width: 100%` — positionnement exact impossible sans coordonnées PDF. Layout 2 colonnes dans hors-scope PRD.

---

### 2026-05-23 — Supprimer rasters pleine-page Reader, ajouter en-têtes/pieds de page PDF
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/App.css`  
**Résumé :** (1) **Espaces blancs supprimés** : `split_page_view=True` (Docling) génère une image raster pleine-page par page, parfois placée DANS le `<div class='page'>` (pas avant). Ajout de PASS 2 dans `_annotate_split_page_divs` (backend) + skip du premier enfant captionless data:image dans `processNode` (frontend). FIX-011 étendu : filtre post-pass élimine maintenant aussi les figures captionless > 150 000 chars (rasters non interceptés). (2) **En-têtes et pieds de page** : les marqueurs `pdf-page-sep` génèrent désormais une `pdf-page-footer-bar` (fin de la page précédente, numéro) + ligne de séparation + `pdf-page-header-bar` (nom du document en italique, "Page N" en accent couleur). `docFilename` passé en paramètre à `sectionizeHtml`. (3) **Mode compare** : `.app-compare-panel--reader .reader-cw` réduit son padding à 20px/24px et `max-width: 100%` pour utiliser toute la largeur disponible. Compilation TypeScript 0 erreur.  
**Fixes introduits :** FIX-022 (strip rasters + en-têtes/pieds), FIX-023 (FIX-011 étendu > 150 000 chars)  
**Points ouverts :** Documents en cache avant ce fix nécessitent `/reprocess` pour bénéficier du PASS 2 backend. Le filtre frontend (docling-page skip + post-pass 150 000) couvre les docs déjà en cache.

---

### 2026-05-23 — Impression propre du Reader seul et nom du fichier synchronisé avec le PDF
**Fichiers modifiés :** `frontend/src/App.tsx`, `frontend/src/index.css`  
**Résumé :** Implémentation du mode d'impression sémantique et de la suggestion de nom de fichier lors de la sauvegarde. (1) Synchronisation du titre : ajout d'un `useEffect` dans `App.tsx` pour mettre à jour `document.title` avec le nom réel du PDF dès le chargement du document. Ainsi, le navigateur propose automatiquement ce nom lors d'un enregistrement ou d'un export PDF. (2) CSS d'impression : ajout d'un bloc `@media print` dans `index.css` qui masque toutes les barres de menus, la barre latérale, l'overlay, les boutons d'affichage et le hamburger. Il force le scroll area et tous ses conteneurs parents à être visibles en hauteur automatique (`height: auto !important; overflow: visible !important`) pour imprimer l'intégralité du document HTML sans coupure et de façon papier-compatible.  
**Fixes introduits :** FIX-024 (Impression propre et titre synchronisé)  
**Points ouverts :** aucun  

---

### 2026-05-23 — Restructurer les listes hiérarchiques plates en listes imbriquées sémantiques
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`  
**Résumé :** Résolution du problème d'aplatissement des listes dans le Reader. Docling extrait les listes hiérarchiques sous la forme d'un unique bloc de `<li>` successifs plats. Ajout d'une passe de post-traitement DOM dans `sectionizeHtml()` qui détecte les listes (`<ul>` / `<ol>`) contenant un mélange de listes dotées d'un style inline (`list-style-type` de niveau 1) et de listes sans style (descriptions de niveau 2). Elle regroupe et imbrique les descriptions sous le parent précédent dans un nouveau `<ul>` et applique un style gras (`<strong>`) sur le titre parent, correspondant fidèlement à la mise en page et à l'organisation hiérarchique du PDF original.  
**Fixes introduits :** FIX-021 (Listes hiérarchiques plates imbriquées)  
**Points ouverts :** aucun  

---

### 2026-05-23 — Implémenter le thème global CSTB et la synchronisation globale du mode sombre
**Fichiers modifiés :** `frontend/src/App.tsx`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `frontend/src/index.css`, `frontend/src/components/Outline/Outline.css`, `frontend/src/components/Figure/FigureOverlay.css`  
**Résumé :** Implémentation du thème visuel CSTB / Le Reef demandé par l'utilisateur. (1) Thème CSTB global (`theme-cstb` clair et sombre) ajouté et défini comme thème par défaut de l'application. (2) Largeur par défaut de la sidebar augmentée à 340px. (3) Raccordement et synchronisation globale de l'état `isDark` : changer le mode sombre dans le Reader affecte instantanément le panneau latéral et l'application entière. (4) Styles CSS : éléments actifs du sommaire en orange solide et texte blanc (`Outline.css`), boîtes de notes (blockquote) vertes en continu avec libellé gras "NOTE" (`MarkdownReader.css`), et lightbox modal responsive claire/sombre (`FigureOverlay.css`). Compilation de validation réussie à 100%.  
**Fixes introduits :** FIX-020 (Thème global CSTB et synchronisation globale du mode sombre)  
**Points ouverts :** L'utilisateur rechargera le document test en cache en cliquant manuellement sur "Retraiter" pour appliquer la correction du sommaire (TOC).

---

### 2026-05-23 — Configurer le projet pour multi-agent (Claude + Antigravity + Gemini)
**Fichiers modifiés :** `CLAUDE.md`, `GEMINI.md` (créé)  
**Résumé :** Le projet est maintenant travaillé par 3 agents : Claude Code + Antigravity (lisent `CLAUDE.md`) et Gemini Code Assist (lit `GEMINI.md`). Création de `GEMINI.md` comme miroir de `CLAUDE.md` avec table FIX identique, protocoles lecture/écriture et tableau de contexte multi-agent. Mise à jour de `CLAUDE.md` : en-tête multi-agent, règle de synchronisation ajoutée au protocole écriture (étape 7 : mettre à jour les deux fichiers quand le tableau FIX change).  
**Fixes introduits :** aucun  
**Points ouverts :** La synchronisation CLAUDE.md ↔ GEMINI.md est manuelle — tout agent qui ajoute un FIX doit mettre à jour les deux fichiers.

---

### 2026-05-22 — Divider redimensionnable, thèmes unifiés, hamburger desktop, pages miniatures
**Fichiers modifiés :** `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Résumé :** (1) Séparateur compare non déplaçable → `compareRatio` state + `handleCompareDividerDown` drag handler (même pattern que resize sidebar), persisté localStorage (FIX-017). (2) Pages PDF apparaissant en miniatures → le strip des rasters dans `_annotate_split_page_divs` (FIX-016) couvre déjà cela ; vérification que le regex supprime bien `<img>` et `<figure><img></figure>` avant chaque `<div class='page'>`. (3) Thèmes Reader/App désynchronisés → prop `appTheme: AppTheme` sur MarkdownReader, `isDark` synchronisé sur appTheme (oled/forest → dark), classes CSS `.reader--app-${appTheme}` avec variables `--bg/--tx/--or` par thème (FIX-018). (4) Hamburger caché sur desktop → CSS `display: flex` sur toutes tailles, clic toggle `sidebarCollapsed` vs `sidebarOpen` selon la largeur d'écran (FIX-019). TypeScript compile propre (0 erreur).  
**Fixes introduits :** FIX-017 (divider compare draggable), FIX-018 (thèmes Reader = thèmes app), FIX-019 (hamburger desktop)  
**Points ouverts :** PDFs en cache nécessitent `/reprocess` pour bénéficier du strip rasters (FIX-016/split_page_view).

---

### 2026-05-22 — Ajouter logique de pages PDF dans le Reader (séparateurs + navigation)
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Résumé :** Le Reader ignore jusqu'ici les limites de pages PDF. Activation de `split_page_view=True` dans `export_to_html` Docling → `<div class='page'>` distinct par page PDF. Ajout de `_annotate_split_page_divs()` pour injecter `<div class="pdf-page-sep" data-page="N">` avant chaque page. Frontend : `sectionizeHtml` détecte les marqueurs → insère `.pdf-page-marker` visuels (séparateurs "─── Page N ───"). Nouveau contrôle toolbar : compteur "p.5/30" + flèches ‹/› + toggle mode page-à-page (scroll-snap). La page courante est détectée par scroll et mise à jour en temps réel. Clic sidebar → section → scroll vers la bonne page.  
**Fixes introduits :** FIX-016 (pages PDF dans le Reader)  
**Points ouverts :** PDFs en cache nécessitent `/reprocess` pour bénéficier des marqueurs (ancien HTML sans `pdf-page-sep`).

---

### 2026-05-22 — Corriger sections non cliquables et hiérarchie bullets Reader
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`  
**Résumé :** (1) Sections sidebar non cliquables : Docling supprime les préfixes numériques des headings HTML ("Quick list" vs "2. Quick list" dans l'outline). `sectionizeHtml` remplace le `Set<string>` de titres normalisés par un `Map<string, string>` indexant aussi la version sans préfixe — les sections sont créées avec le titre outline original pour que `scrollToSection` match exactement (FIX-015). (2) Hiérarchie bullets absente : ajout CSS disc→circle→square avec marqueurs colorés et tailles décroissantes par niveau d'imbrication (`ul > li::marker` orange, `ul ul > li` circle gris, `ul ul ul > li` square petit). Bold items en début de `<li>` mis en valeur visuellement.  
**Fixes introduits :** FIX-015 (sections non cliquables — préfixe numérique Docling)  
**Points ouverts :** Layout multi-colonnes (rouge boxed) non préservé — nécessite info layout backend, complexité élevée.

---

### 2026-05-22 — Corriger sommaire Reader : chapitres manquants et points de conduite
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`  
**Résumé :** (1) Le chapitre "1. Welcome to Advance Design 2026" n'apparaissait pas dans la sidebar car `_SECTION_PREFIX` exige le format `X.Y` (au moins un point). Ajout de `_TOP_CHAPTER_PREFIX` (`^\s*(\d{1,2})\.\s+[A-ZÀ-Ü]`) et branche correspondante dans `_est_titre_section` (FIX-013). (2) Les entrées de sommaire PDF avec points de conduite (`.....47`) s'affichaient telles quelles dans le Reader. Ajout de `_fix_toc_entries()` dans la chaîne de post-traitement backend + post-pass DOM frontend dans `sectionizeHtml` pour couvrir le cache existant (FIX-014).  
**Fixes introduits :** FIX-013 (chapitres top-level manquants), FIX-014 (points de conduite sommaire)  
**Points ouverts :** PDFs en cache ne bénéficient de `_fix_toc_entries` qu'après `/reprocess`. Le fix frontend couvre les docs déjà cachés. Multi-colonnes non traité (complexité layout ML).

---

### 2026-05-22 — Corriger images côte à côte et double puces dans le Reader
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `backend/pipeline.py`  
**Résumé :** Deux bugs visuels corrigés en mode Reader. (1) Images côte à côte non affichées : le filtre anti-logo supprimait toute figure sans légende de base64 < 30 kB, ce qui éliminait les barres d'icônes (toolbar strips) côté PDF. Seuil resserré à `wordCount === 0` + `< 10 000 chars`. (2) Puces dupliquées (`• · texte`, `• o texte`) : Docling préserve les caractères de puce PDF dans le texte des `<li>`, le CSS `li::marker` en ajoutait un second. Post-pass DOM dans `sectionizeHtml` + `_fix_bullet_lists()` backend pour supprimer les caractères redondants.  
**Fixes introduits :** FIX-011 (images côte à côte), FIX-012 (double puces)  
**Points ouverts :** PDFs déjà en cache nécessitent un `/reprocess` pour bénéficier du fix `_fix_bullet_lists` backend.

---

### 2026-05-21 — Finaliser l'implémentation du Lecteur de Livre Interactif Premium
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.tsx`, `frontend/src/components/Reader/MarkdownReader.css`, `memory/frontend-reader.md`  
**Résumé :** Vérification de l'implémentation des fonctionnalités interactives (surlignage multi-couleurs, notes adhésives persistées, Text-to-Speech français à vitesse réglable, export HTML premium autonome avec KaTeX). Vérification de la compilation TypeScript réussie à 100%. Lancement des serveurs de développement.  
**Fixes introduits :** aucun  
**Points ouverts :** aucun  

---

### 2026-05-21 — Créer système mémoire wiki (CLAUDE.md + memory/)
**Fichiers modifiés :** `CLAUDE.md`, `memory/INDEX.md`, `memory/LOG.md`, `memory/fixes-registry.md`, `memory/architecture.md`, `memory/backend-api.md`, `memory/backend-pipeline.md`, `memory/cache-schema.md`, `memory/frontend-app.md`, `memory/frontend-reader.md`, `memory/formulas.md`, `memory/phases.md`, `memory/decisions.md`, `memory/technical-debt.md`  
**Résumé :** Mise en place du système mémoire inspiré du LLM Wiki Pattern (Karpathy gist). Protocoles READ/WRITE définis dans CLAUDE.md. FIXES.md migré vers memory/fixes-registry.md. BACKLOG.md résumé dans memory/phases.md. 13 pages créées.  
**Fixes introduits :** aucun  
**Points ouverts :** Pages à enrichir progressivement au fil des sessions (backend-api.md, frontend-reader.md détails internes)

---

### 2026-05-21 — Correctifs ICC profiles, filtrage figures, retry batches
**Fichiers modifiés :** `backend/main.py`, `backend/pipeline.py`  
**Résumé :** `_has_jpeg2000()` remplacé par `_needs_rasterize()` pour détecter aussi les ICC profiles invalides (PyMuPDF exception "cms/icc/profile"). Filtre figures < 50×50px ajouté dans `_extraire_figures_doc()`. `BATCH_SIZE` 20→10, retry page-par-page si batch échoue.  
**Fixes introduits :** FIX-001 mis à jour (couvre désormais ICC profiles en plus de JPEG2000)  
**Points ouverts :** Surveiller usage mémoire sur gros PDFs (> 50 pages) à 144 DPI

---

### 2026-05-21 — Pipeline formules : CodeFormulaV2 + pix2tex fallback
**Fichiers modifiés :** `backend/pipeline.py`, `frontend/src/components/Reader/MarkdownReader.tsx`  
**Résumé :** Ajout `PIX2TEX_FALLBACK` (Passe 2) après `CodeFormulaV2` (Passe 1 via `FORMULA_ENRICHMENT=1`). `_fix_formula_html()` convertit class `formula-not-decoded` → `formula` quand pix2tex a décodé (item.text commence par `$`). `ignoredClasses` retiré du KaTeX auto-render.  
**Fixes introduits :** aucun (amélioration existante)  
**Points ouverts :** pix2tex non encore installé sur cette machine (`pip install pix2tex` requis)

---

### 2026-05-21 — Retrait boîte figures, images_scale 1.0 → 2.0
**Fichiers modifiés :** `frontend/src/components/Reader/MarkdownReader.css`, `backend/pipeline.py`  
**Résumé :** Suppression border/background/border-radius des `figure` dans Reader CSS (les images étaient encadrées). `images_scale` passe à 2.0 (144 DPI → figures plus nettes). `max-width: 100%` à la place de `max-width: none` pour éviter les débordements.  
**Fixes introduits :** aucun  
**Points ouverts :** Documents en cache extraits à 72 DPI → retraiter manuellement pour bénéficier des 144 DPI
