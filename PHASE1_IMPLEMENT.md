# PHASE 1 — Implementation reelle

> Etat reel a la cloture de la Phase 1. Ce qui a ete code (pas la spec).

**Statut Phase 1** : TERMINEE (2026-05-04)
**Spec de reference** : [`SPEC.md`](./SPEC.md) — sections 4 (backend) et 7 (indicateurs POC)

---

## Periodes

- 2026-05-04 (init projet) : 1.1 (squelette FastAPI), 1.2 (wrapper pipeline.py), 1.3 (smoke test arxiv)
- 2026-05-04 (cloture)     : 1.4 (hierarchie outline), 1.5 (robustesse /process), 1.6 (PDFs varies)

---

## Ce qui a ete livre

### 1.1 Squelette FastAPI — `backend/main.py`

Endpoints exposes :
- `GET /` → healthcheck
- `POST /process` → upload PDF + appel `pipeline.convertir_pdf` + cache disque
- `GET /doc/{id}/outline` → arbre outline
- `GET /doc/{id}/figure/{fig_id}` → image PNG
- `GET /doc/{id}/raw` → result.json complet
- `GET /doc/{id}/pdf` → PDF source
- `DELETE /doc/{id}` → purge cache

CORS : `localhost:5173` et `127.0.0.1:5173` (Vite).

### 1.2 Wrapper Docling — `backend/pipeline.py`

`convertir_pdf(pdf_path, out_dir)` :
- Charge `DocumentConverter` avec `PdfPipelineOptions` (`do_ocr=True`, `do_table_structure=True`, `generate_picture_images=True`, `images_scale=2.0`).
- Sortie JSON-serialisable : `{pages, outline, figures, n_pages, n_figures}`.
- Figures sauvegardees en PNG dans `<out_dir>/figures/<fig_id>.png`.
- Bbox renvoyees telles que Docling (BOTTOMLEFT) — voir TD-002 pour la decision Phase 2.

### 1.3 Smoke test (manuel)

`samples/2510.04871v1.pdf` (paper arxiv 12 pages) traite avec succes :
- 33 sections detectees, 2 figures PNG extraites.
- Modeles RapidOCR telecharges au premier run (~40 Mo, voir TD-003).

### 1.4 Hierarchie outline depuis numerotation

Fonction `_level_depuis_titre(title)` dans `pipeline.py` :
- Regex `^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)` capture le prefixe numerique.
- Niveau = nombre de segments (`2.` → 1, `2.1.` → 2, `2.1.3` → 3).
- Fallback sur `level` brut Docling si pas de numerotation (ex: "Abstract", "References").

Resultat sur arxiv 2510 : `2.1.` est bien enfant de `2.` (verifie via end-to-end run).
**TD-001 RESOLU.**

### 1.5 Robustesse `/process`

Garde-fous ajoutes a `main.py` :
- `MAX_UPLOAD_BYTES = 100 Mo` → HTTP 413 si depasse.
- Fichier vide → HTTP 400.
- Entete `%PDF` absent → HTTP 400 avec message clair.
- `try/except` autour de `convertir_pdf` → HTTP 422 avec `{type}: {message}` + `shutil.rmtree(ddir)` pour autoriser une retry propre.

Pas de logging structure complet (POC) — exception remontee dans le detail HTTP.
**TD-004 RESOLU. TD-005 RESOLU.**

### 1.6 Test sur PDFs varies

5 PDFs traites au total (voir `TESTS.md` T1.7..T1.11) :

| PDF | Pages | Figures | Sections | Hierarchie | Temps |
|---|---|---|---|---|---|
| arxiv 2510.04871v1 (EN, paper) | 12 | 2 | 33 | OK (2.1→2.) | ~25s |
| DA_0003_HSE_REV (FR, doc) | 1 | 1 | 0 | n/a | ~25s |
| CV WALY (FR, 1 col) | 1 | 1 | 8 (flat) | flat OK | ~30s |
| DMT demission (FR, courrier) | 2 | 2 | 10 (flat, +faux positifs) | flat | ~5s |
| arxiv 2509.25140 (EN, paper) | 26 | 14 | 57 (max depth 2) | OK | ~80s |

Observations remontees a TECHNICAL_DEBT (voir TD-007).

---

## Ecarts par rapport a la SPEC

- **Bbox** : SPEC §4.2 confirme l'expose en BOTTOMLEFT pour la v1. Conforme.
- **Cache** : SPEC §4.3 cle = sha256 tronque 16 hex. Conforme (`hashlib.sha256(data).hexdigest()[:16]`).
- **OCR** : SPEC §4.4 RapidOCR auto. Conforme (modeles telecharges au premier run).
- **Indicateurs POC** §7 : "12 pages < 60s" → atteint (~25s). "Pas de crash sur 5 PDFs" → atteint (5/5 OK, dont 1 a 0 sections, gere proprement).

---

## Ce qui n'a PAS ete fait en Phase 1

- Pas de pytest (TD-006 toujours OUVERT, prevu Phase 4.6).
- Pas de logging structure (uniquement message HTTP).
- Pas d'override OCR manuel (SPEC §4.4 confirme : pas dans la v1).

---

## Bilan

Phase 1 close avec 3 dettes resolues (TD-001, TD-004, TD-005), 1 nouvelle ouverte (TD-007 sur-detection SectionHeader Docling sur docs admin), et 3 dettes anterieures inchangees (TD-002 bbox decision Phase 2, TD-003 modeles RapidOCR, TD-006 pas de pytest).

Backend extraction stable et robuste. **Pret pour Phase 2** (POC frontend).
