# pdf-viewer — Dette technique

> Registre des ecarts spec/implementation, placeholders a remplacer, workarounds, limitations.

**Derniere MAJ** : 2026-06-04 (Phase 6 develop : TD-030 launcher ; TD-022 etendu register UI ; audit #30 corrige 5 bugs sans creer de dette)

---

## Legende

- **Statut** : `OUVERT` | `EN COURS` | `RESOLU`
- **Gravite** : `BLOQUANT` | `ELEVEE` | `MOYENNE` | `FAIBLE`

---

## Dettes ouvertes

| ID | Date | Description | Gravite | Statut | Action |
|----|------|-------------|---------|--------|--------|
| TD-009 | 2026-05-19 | **Batch processing non teste sur vrai gros PDF** : teste uniquement avec seuil abaisse a 5 sur PDF 12 pages. Pas de test reel sur un PDF > 50 pages (saturation RAM non reproduite sur macOS). | FAIBLE | OUVERT | Tester sur un PDF 100+ pages reel. Le rapport Windows a valide 135 pages avec succes. |
| TD-021 | 2026-05-30 | **Features ML non testees end-to-end** : Florence-2 (~450 Mo), Texify (~500 Mo), pix2tex et OCRmyPDF/Tesseract pas en cache ni installes localement. Tests structurels uniquement (`/caption-figures`/`/latex-ocr`/`/searchable-pdf`/`/ocr-image` retournent 503 propre + helpers callables + imports OK). Le chemin reel d'inference n'a pas pu etre execute. | MOYENNE | OUVERT | Installer Tesseract (`brew install tesseract tesseract-lang`) + `pip install einops timm pix2tex texify` puis valider les 4 endpoints sur un doc reel. |
| TD-022 | 2026-05-30 | **Rendu navigateur non verifie** : Compare view (drag du diviseur, sync scroll Reader→PDF, clic sommaire), 10 themes (lisibilite/contraste sur tous les composants), Reader (KaTeX, coloration, GFM, fallback markdown), Library (cartes/vignettes/recherche), bouton « Legender (IA) ». **+ (Phase 6 develop)** : barre « Referencer » + badge « Refere » + bouton « Analyser », split-button « Retraiter\|OCR », vignettes thumbnail Library. Builds `tsc`/`eslint`/`vite` verts mais le visuel reste a valider en local. | MOYENNE | OUVERT | Lancer `npm run dev` + navigateur, valider le test plan manuel de chaque sous-PR (#9/#10/#12/#14/#16/#28/#29). |
| TD-030 | 2026-06-04 | **Launcher pywebview non testable hors Windows** : `launcher_core.py` (GUI-free) a 12 tests unitaires, mais l'execution reelle (fenetre native pywebview, runtime WebView2, compilation EXE via `build_installer.py`/PyInstaller) n'a pas pu etre validee dans l'environnement de dev (macOS, pas de WebView2). Branche `develop` uniquement. | MOYENNE | OUVERT | Valider sur une machine Windows (MHDINGBI) : `setup_dev.bat` → `launcher.bat` (dev) puis `build.bat` (EXE). |
| TD-023 | 2026-05-30 | **5 `backend/test_*.py` de la v2 exclus de PR #18** : `test_outline_pipeline_direct`, `test_outline_regex_only`, `test_pipeline_math`, `test_pipeline_unit`, `test_real_outline`. Ecrits pour l'API du pipeline v2 (importent `_outline_depuis_texte`, `_est_titre_section` qui n'existent pas sur main). Casseraient `pytest --collect-only`. | FAIBLE | OUVERT | Reecrire les imports/assertions contre l'API actuelle (`_extraire_sections`, `_construire_arbre`, `_level_depuis_titre`) puis reintegrer. |
| TD-024 | 2026-05-30 | **Scripts debug v2 portes mais probablement obsoletes** : `backend/{benchmark,debug_outline,print_all_info,print_all_outline,print_outline,print_toc}.py` portes en #18 pour conserver le tooling MHDINGBI. Inertes (non collectes par pytest, non importes) donc sans risque, mais probablement dead-when-run (referencent l'API du pipeline v2). | FAIBLE | OUVERT | Adapter ou supprimer si MHDINGBI ne les utilise plus. |
| TD-029 | 2026-06-01 | **Endpoints ML async mais sans feedback progression** : `/searchable-pdf`, `/latex-ocr`, `/caption-figures` sont async (`asyncio.to_thread`, PR #23) et ne bloquent plus Uvicorn, mais restent des requetes longues (1-5 min) sans indicateur d'avancement pour le client (pas de polling `/status`-like). Le client attend la reponse HTTP. | FAIBLE | OUVERT | Convertir en background tasks avec polling (comme `/process` + `/status`), ou ajouter un SSE/websocket pour le feedback. |
| TD-026 | 2026-05-30 | **Sync Compare bidirectionnelle incomplete** : Reader→PDF cable (`onPageChange` → `viewerRef.scrollToPage`) ; PDF→Reader non cable (necessiterait d'exposer `scrollToPage` dans `ReaderHandle`, modification du composant verbatim avec garde anti-boucle). Le clic sommaire synchronise deja les deux. | FAIBLE | OUVERT | Etendre `ReaderHandle` + garde `isProgrammaticScrollRef` cote Viewer pour eviter les boucles. |
| TD-027 | 2026-05-30 | **Marqueurs de page HTML Docling grossiers (par tranche, pas par page)** : `_write_html_artifacts` injecte un seul `<div class="pdf-page-sep" data-page="batch_start">` par tranche. `split_page_view=True` non utilise au moment du port (structure de sortie non observable a l'aveugle). Resultat : sync page approximative en Compare view. | FAIBLE | OUVERT | Activer `split_page_view=True`, observer la structure produite, ecrire un annotateur per-page (`_annotate_split_page_divs` style v2). |
| TD-028 | 2026-05-30 | **`frontend/src/components/Reader/MarkdownReader.css.search.py` mal place** : script Python d'analyse CSS dans `frontend/src/`, chemin Windows hardcode (`c:\Users\MHDINGBI\…`). Outil MHDINGBI conserve sur decision projet. | FAIBLE | OUVERT | Deplacer dans `backend/scripts/` ou ajouter au `.gitignore` (a discuter avec MHDINGBI). |

---

## Dettes resolues

| ID | Date resolution | Description courte | Resolution |
|----|-----------------|--------------------|------------|
| TD-001 | 2026-05-04 | Hierarchie outline plate (level=1 partout) | Parser `_level_depuis_titre` dans `pipeline.py` deduit le niveau du nombre de segments de la numerotation (`2.1.` → 2). Fallback `level` brut si pas de numerotation. Verifie sur arxiv 2510 et 2509.25140 (depth 2 atteinte). |
| TD-004 | 2026-05-04 | Pas de gestion d'erreur claire si Docling crash | `try/except` autour de `convertir_pdf` dans `main.py` → `HTTPException(422, "Echec extraction Docling : {type}: {msg}")` + `shutil.rmtree(ddir)` pour autoriser une retry. Verifie sur PDF corrompu. |
| TD-005 | 2026-05-04 | Pas de limite de taille upload | Constante `MAX_UPLOAD_BYTES = 100 * 1024 * 1024` dans `main.py` → HTTP 413 si depasse. + checks 400 (fichier vide, entete `%PDF` absent, extension non `.pdf`). Verifie avec faux PDF de 101 Mo. |
| TD-002 | 2026-05-05 | Convention bbox a documenter et eventuellement centraliser | Verification empirique sur le cache : Docling renvoie systematiquement `t > b` → BOTTOMLEFT confirme. Conversion centralisee **cote frontend** dans `frontend/src/bbox.ts` (helper `bboxToPct`). SPEC §4.2 conservee (API expose les bbox brutes). Backend non modifie. Markers figures dans `Viewer.tsx` consomment le helper. |
| TD-003 | 2026-05-05 | Modeles RapidOCR telecharges au premier run (~40 Mo) | `README.md` cree (section Installation backend) qui mentionne explicitement le telechargement automatique au 1er traitement de PDF. Pas de script de pre-fetch (overkill POC). Si packaging futur necessaire, voir options dans la doc Docling. |
| TD-007 | 2026-05-19 | Sur-detection SectionHeader Docling sur docs admin | Filtres implementes dans `pipeline.py` : `_est_faux_positif()` (min 3 / max 120 chars, dedup titre normalise) + `_CHAPTER_PREFIX` → niveau 1. Teste sur 6 docs : -34 parasites livre 190p, -6 doublons paper 26p, 0 faux negatif paper 12p. Residu : Docling continue de sur-detecter sur CV/DMT mais ces cas sont moins courants. |
| TD-006 | 2026-05-20 | Smoke test manuel uniquement | 35 tests pytest dans `backend/tests/test_pipeline.py` : 7 unitaires `_level_depuis_titre`, 6 `_est_faux_positif`, 5 helpers pypdfium2, 14 snapshot arxiv 12p (pages, figures, outline, tables, markdown, PNGs), 3 snapshot HSE 1p. Skip auto si samples absents. |
| TD-008 | 2026-05-20 | Bundle JS frontend > 500 kB | Code-splitting via `React.lazy()` sur Viewer. Chunk principal 627→206 kB. Viewer (423 kB) charge uniquement au 1er document. Plus de warning Vite. |
| TD-010 | 2026-05-20 | `dangerouslySetInnerHTML` dans `<Tables>` sans sanitize | Ajout d'une sanitization frontend avant injection HTML : retrait `script/style/iframe/object/embed/link/meta`, attributs `on*`, `style`, et URLs `javascript:`. DOMPurify reste une option si le produit devient expose. |
| TD-011 | 2026-05-20 | `except: pass` silencieux dans `pipeline.py` | Remplacement des `pass` par `log.exception()` sur export image figure, HTML table, markdown single-pass, markdown batch et ecriture markdown batch. |
| TD-012 | 2026-05-20 | Recherche frontend fragile (`_matchCounter` global + timer DOM fixe) | `_matchCounter` remplace par un compteur local `useRef`; les matches sont renumerotes depuis le DOM stabilise via `MutationObserver` + `onRenderTextLayerSuccess`, avec highlight actif resynchronise. |
| TD-013 | 2026-05-20 | Endpoint `/doc/{id}/page/{n}` declare mais absent | Ligne retiree de la docstring de `backend/main.py`. |
| TD-014 | 2026-05-20 | Detection OCR trop globale | Decision OCR basee sur les longueurs de texte par page inspectee. Un document mixte declenche OCR ON; en batch, chaque tranche choisit son propre converter OCR ON/OFF. Tests unitaires ajoutes pour natif/scanne/mixte. |
| TD-015 | 2026-05-20 | IDs API non validates avant acces disque | Validation stricte `doc_id` (`^[a-f0-9]{16}$`) et `fig_id` (`^f_\d+$`) dans `backend/main.py` avant acces cache/figures/delete. |
| TD-016 | 2026-05-20 | Viewer sans virtualisation | Rendu fenetre autour de la page visible (`PAGE_WINDOW=3`) avec placeholders dimensionnes. Pendant une recherche, toutes les pages sont rendues pour conserver le comptage global. |
| TD-017 | 2026-05-20 | Dedup outline trop agressif | Dedup remplace par cle titre normalise + page + bbox arrondie. Les titres legitimes repetes sur des pages differentes sont conserves. Test unitaire ajoute. |
| TD-018 | 2026-05-20 | Recherche dependante du DOM et d'un timer fixe | Corrige avec `MutationObserver` debounce + callback de rendu TextLayer. Aucune dependance a un `setTimeout(100)` unique. |
| TD-019 | 2026-05-20 | Docs desynchronisees | `SPEC.md` mis a jour pour recherche/export Markdown/tables. `README.md` mis a jour pour tables, raccourcis recherche et limitations actuelles. |
| TD-020 | 2026-05-20 | Titre sidebar incorrect sur l'onglet Tables | Ternaire remplace par mapping `TAB_TITLES` dans `App.tsx`. |
| TD-025 | 2026-06-11 | Câblage des hooks du Reader | Câblage des 8 hooks (useAppearance, useImageLightbox, usePdfPageSync, useSearch, useTts, useFocusMode, useContentLoading, useAnnotations) et résolution des lints/types. |

---

## Bonus securite (correctifs preemptifs Phase 5)

Lors du portage de la PR #5, plusieurs failles signalees en revue ont ete corrigees AVANT merge dans main (pas tracees comme dettes pre-existantes mais valent la mention) :

- **XSS Reader** : `sectionizeHtml` strippe desormais `style=` en plus de `on*`/`javascript:` (vecteur `url(javascript:…)` / `expression`). Aligne sur `Tables.tsx`. — PR #10.
- **Path traversal `/ocr-image`** : `fig_id` valide via le regex existant `^f_\d+$` (la version v2 avait perdu cette validation). — PR #6.
- **Race condition sur `result.json`** : helper `_write_json_atomic` (`tmp` + `os.replace`) utilise par `run_pipeline_bg`, `/latex-ocr`, `/caption-figures`. — PRs #7/#12/#6/#16.
- **Exceptions silencieuses `print()`** : remplacees par `logging` dans tous les modules portes (`ocr.py`, `captioning.py`, `main.py` async). — toutes les PRs Phase 5.
