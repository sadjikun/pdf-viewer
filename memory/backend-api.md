# BACKEND API — Endpoints main.py

Dernière mise à jour : 2026-05-21  
Base URL : `http://localhost:8000`  
CORS autorisé : `localhost:5173`, `localhost:5174`

---

## Endpoints

### `GET /`
**Rôle :** Health check  
**Réponse :** `{"status": "ok", "service": "pdf-viewer-api", "version": "0.2.0"}`

---

### `POST /process`
**Rôle :** Upload et extraction d'un document  
**Body :** `multipart/form-data` — champ `file`  
**Formats :** `.pdf` + markitdown (`.docx`, `.pptx`, `.xlsx`, `.html`, images, `.ipynb`)  
**Limite :** 100 MB

**Réponse immédiate (cache hit) :** `result.json` complet  
**Réponse si traitement :** `{"doc_id": "…", "status": "processing", "progress": 0, "message": "…"}`  
**Erreurs :** 400 (format/taille/entête), 413 (trop grand)

**Comportement :**
- Hash SHA256[:16] → `doc_id` (idempotent)
- Si `result.json` existe → retour cache immédiat
- Sinon → écrit `source.pdf`, lance pipeline en background

---

### `GET /doc/{doc_id}/status`
**Rôle :** Poll état traitement  
**Réponses :**
- `{"status": "ready"}` — result.json présent
- `{"status": "processing", "progress": 45, "message": "Extraction Docling…"}`
- `{"status": "failed", "error": "…"}` — error.json présent
- `{"status": "not_found"}`

---

### `GET /doc/{doc_id}/outline`
**Rôle :** Arbre des sections  
**Réponse :** `OutlineNode[]` (voir `cache-schema.md`)  
**Erreur :** 404 si document inconnu

---

### `GET /doc/{doc_id}/figure/{fig_id}`
**Rôle :** Image PNG d'une figure  
**Réponse :** `image/png` FileResponse  
**Erreur :** 404 si figure inconnue

---

### `GET /doc/{doc_id}/raw`
**Rôle :** `result.json` complet  
**Réponse :** JSON avec outline + figures + tables + pages + metadata

---

### `GET /doc/{doc_id}/pdf`
**Rôle :** Sert le PDF au viewer  
**Logique :**
- PDFs scannés → `cleaned.pdf` (rastérisé pypdfium2)
- PDFs natifs sans problème → `source.pdf` (couche texte préservée)
- PDFs natifs avec JPEG2000 ou ICC invalide → `cleaned.pdf` (FIX-001)
- `cleaned.pdf` généré par `_repair_icc_profiles()` si absent

---

### `GET /doc/{doc_id}/html`
**Rôle :** HTML riche Docling (Reader view)  
**Réponse :** `text/html` — contenu `result.html` (images base64 embedded)  
**Erreur :** 404 si `result.html` absent (document non retraité ou markitdown)

---

### `GET /doc/{doc_id}/markdown`
**Rôle :** Export `.md`  
**Réponse :** `text/markdown` FileResponse, nom `{doc_id}.md`  
**Lazy :** Si `result.md` absent → regénère via Docling

---

### `GET /doc/{doc_id}/searchable-pdf`
**Rôle :** PDF avec couche texte OCR (OCRmyPDF + Tesseract)  
**Réponse :** `application/pdf` FileResponse  
**Erreurs :** 503 si Tesseract absent, 503 si OCRmyPDF absent, 422 si OCR échoue  
**Cache :** `searchable.pdf` — regénère si absent

---

### `POST /doc/{doc_id}/ocr-image/{fig_id}`
**Rôle :** OCR direct sur image de figure (pytesseract)  
**Réponse :** `{"fig_id": "f_0", "text": "…", "engine": "tesseract"}`  
**Erreurs :** 503 si Tesseract absent, 404 si figure inconnue, 422 si OCR échoue

---

### `POST /doc/{doc_id}/latex-ocr`
**Rôle :** (Re)lance pix2tex sur les figures du document  
**Réponse :** `{"status": "ok", "figures_updated": 3}`  
**Erreur :** 503 si pix2tex non installé  
**Note :** Met à jour `result.json` avec le champ `latex` des figures

---

### `GET /doc/{doc_id}/benchmark`
**Rôle :** Benchmark des outils d'extraction (pypdfium2, pymupdf, pdfplumber…)  
**Params :** `?force=true` pour invalider le cache  
**Réponse :** JSON résultats  
**Cache :** `benchmark.json`

---

### `GET /doc/{doc_id}/benchmark.html`
**Rôle :** Rapport HTML du benchmark (ouvrir directement dans navigateur)  
**Cache :** `benchmark.html`

---

### `POST /doc/{doc_id}/reprocess`
**Rôle :** Supprime le cache (sauf `source.pdf`) et relance le pipeline  
**Réponse :** `{"status": "processing", …}` ou info déjà en cours  
**Erreur :** 404 si `source.pdf` absent

---

### `DELETE /doc/{doc_id}`
**Rôle :** Supprime tout le répertoire cache  
**Réponse :** `{"status": "deleted", "doc_id": "…"}`

---

### `GET /tesseract/status`
**Rôle :** État Tesseract (disponibilité, langues, version)  
**Réponse :**
```json
{ "available": true, "cmd": "/path/tesseract", "tessdata": "/path/tessdata", "langs": ["eng","fra"], "version": "5.3.0" }
```

---

## Helpers internes

| Fonction | Rôle |
|----------|------|
| `_needs_rasterize(pdf_path)` | Détecte JPEG2000 + ICC invalide via PyMuPDF |
| `_repair_icc_profiles(src, dst)` | Rastérise PDF → images JPEG 108 DPI via pypdfium2 |
| `_doc_dir(doc_id)` | `cache/{doc_id}` Path |
| `_hash_bytes(data)` | SHA256[:16] |
| `_load_result(doc_id)` | Lit result.json ou lève 404 |
| `run_pipeline_bg(…)` | Thread background (écrit result.json ou error.json) |
| `update_task_progress(…)` | Met à jour `active_tasks` dict (thread-safe via lock) |
