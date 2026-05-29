"""API FastAPI : pipeline PDF → outline + figures + tables + bbox.

Endpoints :
  POST /process                          → upload PDF, extraction complète
  GET  /doc/{id}/outline                 → arbre des sections
  GET  /doc/{id}/figure/{fig_id}         → PNG figure
  GET  /doc/{id}/raw                     → result.json complet
  GET  /doc/{id}/pdf                     → PDF source
  GET  /doc/{id}/markdown                → export .md
  GET  /doc/{id}/searchable-pdf          → PDF avec couche texte OCR (OCRmyPDF)
  POST /doc/{id}/latex-ocr               → (re)lance LaTeX-OCR (Texify/pix2tex) sur les figures
  POST /doc/{id}/caption-figures         → génère caption_ai Florence-2 sur les figures
  DELETE /doc/{id}                       → supprime le cache
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

# Route HuggingFace downloads through mirror if HF_ENDPOINT not already set.
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# Force UTF-8 sur stdout/stderr pour éviter les UnicodeEncodeError sur Windows (cp1252)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import threading
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)
_DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")

# TD-013 : version pipeline attendue. Doit rester synchronisée avec PIPELINE_VERSION dans pipeline.py.
_CURRENT_PIPELINE_VERSION = "2026-05-25"

active_tasks: dict[str, dict[str, Any]] = {}
tasks_lock = threading.Lock()

# Mode applicatif : "standard" | "ai" — modifiable à chaud depuis l'interface
_app_mode: str = os.environ.get("APP_MODE", "standard")

def update_task_progress(doc_id: str, progress: int, message: str):
    with tasks_lock:
        if doc_id in active_tasks:
            active_tasks[doc_id].update({"progress": progress, "message": message})

def run_pipeline_bg(doc_id: str, file_path: Path, ddir: Path, is_pdf: bool, original_filename: str, fast_mode: bool = False):
    from pipeline import convertir_pdf, convertir_generic
    try:
        cb = lambda p, m: update_task_progress(doc_id, p, m)
        if is_pdf:
            result = convertir_pdf(file_path, ddir, progress_callback=cb, fast_mode=fast_mode)
        else:
            result = convertir_generic(file_path, ddir, progress_callback=cb)

        result["doc_id"] = doc_id
        result["filename"] = original_filename

        with open(ddir / "result.json", "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        # Successfully finished, clean up task
        with tasks_lock:
            active_tasks.pop(doc_id, None)
    except Exception as e:
        import traceback
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[error] Pipeline running in background failed for {doc_id}: {error_msg}")
        traceback.print_exc()

        # Write error.json to cache folder so client can see details
        try:
            with open(ddir / "error.json", "w", encoding="utf-8") as f:
                json.dump({"error": error_msg}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        # Clean up task
        with tasks_lock:
            active_tasks.pop(doc_id, None)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 Mo


def _needs_rasterize(pdf_path: Path) -> bool:
    """Retourne True si le PDF contient des images que PDF.js ne peut pas afficher.

    Problèmes détectés :
      - JPEG2000 (JPXDecode) : non supporté par PDF.js
      - Profils ICC invalides / corrompus (cmsOpenProfileFromMem failed)
        → les images s'affichent en blanc dans PDF.js et PyMuPDF
      - Format inconnu (extract_image lève une exception MuPDF)
    """
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(pdf_path))
        found = False
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    img_dict = doc.extract_image(xref)
                    if img_dict.get("ext", "") in ("jpx", "jp2"):
                        found = True
                        break
                except Exception as e:
                    err = str(e).lower()
                    # Profil ICC invalide ou format inconnu → rastériser
                    if any(k in err for k in ("cms", "icc", "profile", "format error", "colorspace")):
                        found = True
                        break
            if found:
                break
        doc.close()
        if found:
            return True
    except ImportError:
        # PyMuPDF absent — fallback binaire pour JPEG2000 uniquement
        try:
            data = pdf_path.read_bytes()
            return b"JPXDecode" in data or b"/JPX" in data
        except Exception:
            return False
    except Exception:
        return False

    # Fallback binaire : marqueurs JPEG2000 ou ICC problématiques connus
    try:
        data = pdf_path.read_bytes()
        return b"JPXDecode" in data or b"/JPX" in data
    except Exception:
        return False


# Alias maintenu pour compatibilité interne
_has_jpeg2000 = _needs_rasterize


def _repair_icc_profiles(src: Path, dst: Path) -> None:
    """Génère un PDF compatible PDF.js en rendant chaque page via pypdfium2.

    PDF.js ne supporte pas JPEG2000 (JPXDecode) — les images apparaissent comme des
    boites vides. pypdfium2/libpdfium décode JPEG2000 nativement : on rend chaque page
    en image JPEG et on recombine en PDF multi-pages. Le résultat est un PDF image
    (sans couche texte sélectionnable) mais avec toutes les images visibles.

    Durée : ~0.05s/page, acceptable pour la mise en cache.
    """
    import pypdfium2 as pdfium  # type: ignore
    from PIL import Image  # type: ignore

    pdf_src = pdfium.PdfDocument(str(src))
    n = len(pdf_src)
    pages_pil = []

    for i in range(n):
        page = pdf_src[i]
        bitmap = page.render(scale=1.5)   # 108 DPI — bon compromis qualité/taille
        pages_pil.append(bitmap.to_pil().convert("RGB"))

    pdf_src.close()

    # PIL encode les images RGB en JPEG dans le PDF — compact et universellement supporté
    pages_pil[0].save(
        str(dst),
        format="PDF",
        save_all=True,
        append_images=pages_pil[1:],
        resolution=108,
    )

    size_kb = dst.stat().st_size // 1024
    print(f"[pdf] cleaned.pdf: {n} pages rendues via pypdfium2 -> {size_kb} KB ({dst.name})")

app = FastAPI(title="PDF Viewer API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5443",
        "http://127.0.0.1:5443",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "X-Html-Size"],  # FIX-034 : visible côté frontend pour guard taille HTML
)


@app.on_event("startup")
def startup_cleanup():
    """Lance un nettoyage automatique du cache au démarrage de l'application.

    Supprime les dossiers de cache dont les fichiers ont plus de 30 jours,
    dans un thread d'arrière-plan pour ne pas bloquer le démarrage.
    """
    def run_cleanup():
        try:
            import time
            time.sleep(5)  # Attendre que l'application soit complètement initialisée
            print("[cache] Lancement du nettoyage automatique du cache (seuil: 30 jours)...")
            now = time.time()
            cutoff = now - (30 * 86400)
            cleaned = 0
            for item in CACHE_DIR.iterdir():
                if not item.is_dir():
                    continue
                result_file = item / "result.json"
                source_file = item / "source.pdf"
                mtime = item.stat().st_mtime
                if result_file.exists():
                    mtime = result_file.stat().st_mtime
                elif source_file.exists():
                    mtime = source_file.stat().st_mtime
                if mtime < cutoff:
                    shutil.rmtree(item, ignore_errors=True)
                    cleaned += 1
            if cleaned > 0:
                print(f"[cache] Nettoyage automatique terminé : {cleaned} dossiers obsolètes supprimés du cache.")
            else:
                print("[cache] Aucun dossier obsolète trouvé dans le cache.")
        except Exception as e:
            print(f"[cache] Erreur lors du nettoyage automatique au démarrage : {e}")

    t = threading.Thread(target=run_cleanup, daemon=True)
    t.start()


def _doc_dir(doc_id: str) -> Path:
    if not _DOC_ID_RE.fullmatch(doc_id):
        raise HTTPException(400, "Identifiant document invalide")
    p = (CACHE_DIR / doc_id).resolve()
    try:
        p.relative_to(CACHE_DIR.resolve())
    except ValueError:
        raise HTTPException(400, "Identifiant document invalide")
    return p


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _load_result(doc_id: str) -> dict[str, Any]:
    p = _doc_dir(doc_id) / "result.json"
    if not p.exists():
        raise HTTPException(404, "Document inconnu")
    with open(p, encoding="utf-8") as f:
        result = json.load(f)
    # TD-013 : indique au frontend si le cache a été produit par une version obsolète du pipeline
    result["needs_reprocess"] = result.get("pipeline_version", "legacy") != _CURRENT_PIPELINE_VERSION
    return result


def _clean_title(title: str | None) -> str:
    if not title:
        return ""
    return re.sub(r"^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)", "", title, flags=re.IGNORECASE).strip()


def _library_item_from_result(doc_id: str, ddir: Path, result: dict[str, Any]) -> dict[str, Any]:
    source_files = sorted(ddir.glob("source.*"))
    source = source_files[0] if source_files else None
    result_file = ddir / "result.json"
    mtime = result_file.stat().st_mtime if result_file.exists() else ddir.stat().st_mtime
    filename = result.get("filename") or (source.name if source else doc_id)
    title = _clean_title(result.get("pdf_title")) or Path(filename).stem or doc_id
    figures = result.get("figures") or []
    cover_figure_id = None
    if figures:
        first_id = figures[0].get("id")
        if first_id and (ddir / "figures" / f"{first_id}.png").exists():
            cover_figure_id = first_id

    return {
        "doc_id": doc_id,
        "title": title,
        "filename": filename,
        "file_type": result.get("file_type") or (source.suffix.lstrip(".").lower() if source else "pdf"),
        "extraction_mode": result.get("extraction_mode", "unknown"),
        "n_pages": result.get("n_pages", 0),
        "n_figures": result.get("n_figures", len(figures)),
        "n_tables": result.get("n_tables", len(result.get("tables") or [])),
        "n_sections": len(result.get("outline") or []),
        "modified_at": mtime,
        "size_bytes": source.stat().st_size if source and source.exists() else None,
        "cover_figure_id": cover_figure_id,
        "needs_reprocess": result.get("pipeline_version", "legacy") != _CURRENT_PIPELINE_VERSION,
    }


# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "pdf-viewer-api", "version": "0.2.0"}


@app.get("/app-mode")
def get_app_mode() -> dict[str, str]:
    return {"mode": _app_mode}


@app.post("/app-mode")
def set_app_mode(body: dict) -> dict[str, str]:
    global _app_mode
    mode = body.get("mode", "standard")
    if mode not in ("standard", "ai"):
        raise HTTPException(400, "mode must be 'standard' or 'ai'")
    _app_mode = mode
    if mode == "ai":
        os.environ["FLORENCE2_CAPTION"] = "1"
        os.environ["FORMULA_ENGINE"] = "texify"
    else:
        os.environ.pop("FLORENCE2_CAPTION", None)
        os.environ.pop("FORMULA_ENGINE", None)
    return {"mode": _app_mode}


@app.get("/library")
def get_library() -> JSONResponse:
    """Retourne le catalogue local construit depuis le cache disque."""
    with tasks_lock:
        processing = {
            doc_id: {
                "doc_id": doc_id,
                "status": "processing",
                "progress": task.get("progress", 0),
                "message": task.get("message", ""),
            }
            for doc_id, task in active_tasks.items()
        }

    documents: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for item in CACHE_DIR.iterdir():
        if not item.is_dir() or not _DOC_ID_RE.fullmatch(item.name):
            continue
        result_path = item / "result.json"
        error_path = item / "error.json"
        if result_path.exists():
            try:
                with open(result_path, encoding="utf-8") as f:
                    result = json.load(f)
                documents.append(_library_item_from_result(item.name, item, result))
            except Exception as e:
                failed.append({"doc_id": item.name, "status": "failed", "error": f"Cache illisible: {e}"})
        elif error_path.exists():
            try:
                with open(error_path, encoding="utf-8") as f:
                    error = json.load(f).get("error", "Erreur d'extraction inconnue")
            except Exception:
                error = "Erreur d'extraction inconnue"
            failed.append({"doc_id": item.name, "status": "failed", "error": error})

    documents.sort(key=lambda d: d.get("modified_at") or 0, reverse=True)
    return JSONResponse({
        "documents": documents,
        "processing": list(processing.values()),
        "failed": failed,
        "total": len(documents),
    })


@app.post("/process")
async def process(background_tasks: BackgroundTasks, file: UploadFile = File(...), fast_mode: bool = False) -> JSONResponse:
    """Upload un document (PDF, Word, PowerPoint, Excel, HTML, image…) et extrait sa structure.

    Formats supportés :
      PDF  → pipeline Docling/pypdfium2 (figures, tables, outline)
      Autres → markitdown (Word, PPTX, Excel, HTML, images, Jupyter…)
    """
    from pipeline import MARKITDOWN_EXTENSIONS  # import différé

    if not file.filename:
        raise HTTPException(400, "Nom de fichier manquant")

    ext = Path(file.filename).suffix.lower()
    is_pdf = ext == ".pdf"
    supported = {".pdf"} | MARKITDOWN_EXTENSIONS

    if ext not in supported:
        raise HTTPException(
            400,
            f"Format '{ext}' non supporté. Formats acceptés : "
            + ", ".join(sorted(supported)),
        )

    data = await file.read()
    if not data:
        raise HTTPException(400, "Fichier vide")
    if len(data) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(413, f"Fichier trop volumineux (max {max_mb} Mo)")
    if is_pdf and not data.startswith(b"%PDF"):
        raise HTTPException(400, "Entête %PDF absent — fichier invalide")

    doc_id = _hash_bytes(data)
    ddir = _doc_dir(doc_id)

    # 1. Déjà traité et en cache ?
    if (ddir / "result.json").exists():
        with open(ddir / "result.json", encoding="utf-8") as f:
            cached = json.load(f)
        # Patch filename: always prefer the actual upload name over the cached
        # internal name (e.g. "source.pdf") which is a generic placeholder.
        _GENERIC_NAMES = {"source.pdf", "source", "document.pdf", "upload.pdf"}
        cached_fn = cached.get("filename", "")
        if file.filename and (not cached_fn or cached_fn.lower() in _GENERIC_NAMES):
            cached["filename"] = file.filename
            with open(ddir / "result.json", "w", encoding="utf-8") as f:
                json.dump(cached, f, ensure_ascii=False, indent=2)
        return JSONResponse(cached)

    # 2. Déjà en cours de traitement ?
    with tasks_lock:
        is_processing = doc_id in active_tasks

    if is_processing:
        return JSONResponse({
            "doc_id": doc_id,
            "status": "processing",
            "progress": active_tasks[doc_id]["progress"],
            "message": active_tasks[doc_id]["message"]
        })

    # 3. Supprimer d'anciennes erreurs de traitement s'il y en a
    (ddir / "error.json").unlink(missing_ok=True)
    ddir.mkdir(parents=True, exist_ok=True)

    # Conserver le nom de l'extension d'origine pour markitdown
    source_name = "source.pdf" if is_pdf else f"source{ext}"
    source_path = ddir / source_name
    source_path.write_bytes(data)

    # Enregistrer la tâche
    with tasks_lock:
        active_tasks[doc_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Fichier reçu, démarrage de l'analyse..."
        }

    # Lancer le pipeline en arrière-plan
    background_tasks.add_task(run_pipeline_bg, doc_id, source_path, ddir, is_pdf, file.filename, fast_mode)

    return JSONResponse({
        "doc_id": doc_id,
        "status": "processing",
        "progress": 0,
        "message": "Ajouté à la file d'attente..."
    })


# ─────────────────────────────────────────────────────────────────────────────
# P2 — Benchmark : compare les outils d'extraction de texte PDF
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/doc/{doc_id}/benchmark")
def get_benchmark(doc_id: str, force: bool = False) -> JSONResponse:
    """Lance le benchmark d'extraction PDF et retourne les résultats JSON.

    Mis en cache dans benchmark.json — invalide avec ?force=true.
    Outils : pypdfium2 · pymupdf · pdfplumber · pdfminer · pypdf · Docling (cache)
    """
    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"
    if not source.exists():
        raise HTTPException(404, "Document inconnu")

    cache_file = ddir / "benchmark.json"
    if cache_file.exists() and not force:
        with open(cache_file, encoding="utf-8") as f:
            return JSONResponse(json.load(f))

    from benchmark import run_benchmark as _run_bm

    result_json = _load_result(doc_id)
    results = _run_bm(source, result_json)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    return JSONResponse(results)


@app.get("/doc/{doc_id}/benchmark.html")
def get_benchmark_html(doc_id: str, force: bool = False):
    """Rapport HTML complet du benchmark (ouvrir directement dans le navigateur)."""
    from fastapi.responses import HTMLResponse
    from benchmark import run_benchmark as _run_bm, render_html

    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"
    if not source.exists():
        raise HTTPException(404, "Document inconnu")

    html_cache = ddir / "benchmark.html"
    if html_cache.exists() and not force:
        return HTMLResponse(html_cache.read_text(encoding="utf-8"))

    json_cache = ddir / "benchmark.json"
    if json_cache.exists() and not force:
        with open(json_cache, encoding="utf-8") as f:
            results = json.load(f)
    else:
        result_json = _load_result(doc_id)
        results = _run_bm(source, result_json)
        with open(json_cache, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    html = render_html(results, source.name)
    html_cache.write_text(html, encoding="utf-8")
    return HTMLResponse(html)


@app.get("/doc/{doc_id}/outline")
def get_outline(doc_id: str) -> Any:
    return _load_result(doc_id).get("outline", [])


@app.get("/doc/{doc_id}/figure/{fig_id}")
def get_figure(doc_id: str, fig_id: str) -> FileResponse:
    p = _doc_dir(doc_id) / "figures" / f"{fig_id}.png"
    if not p.exists():
        raise HTTPException(404, "Figure inconnue")
    return FileResponse(p, media_type="image/png")


@app.get("/doc/{doc_id}/thumbnail")
def get_thumbnail(doc_id: str) -> FileResponse:
    """Miniature de la première page du PDF (~200 px de large), mise en cache."""
    from pipeline import _PDFIUM_LOCK
    import pypdfium2 as pdfium

    ddir = _doc_dir(doc_id)
    thumb_path = ddir / "thumbnail.png"

    if not thumb_path.exists():
        sources = sorted(ddir.glob("source.pdf"))
        if not sources:
            raise HTTPException(404, "PDF source introuvable")
        pdf_path = sources[0]
        try:
            with _PDFIUM_LOCK:
                doc = pdfium.PdfDocument(str(pdf_path))
                try:
                    page = doc[0]
                    # scale 0.35 ≈ 200 px de large pour une page A4 (595 pt @ 72 DPI)
                    bitmap = page.render(scale=0.35)
                    img = bitmap.to_pil()
                finally:
                    doc.close()
            img.save(str(thumb_path), "PNG", optimize=True)
        except Exception as exc:
            raise HTTPException(500, f"Erreur rendu miniature : {exc}") from exc

    return FileResponse(thumb_path, media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@app.get("/doc/{doc_id}/html-image/{file_path:path}")
def get_html_image(doc_id: str, file_path: str) -> FileResponse:
    """FIX-035 : sert les images extraites du HTML Docling (de-embedded base64)."""
    images_root = _doc_dir(doc_id) / "html_images"
    p = images_root / file_path
    # Protection path traversal
    try:
        p.resolve().relative_to(images_root.resolve())
    except ValueError:
        raise HTTPException(404, "Image inconnue")
    if not p.exists():
        raise HTTPException(404, "Image inconnue")
    media_type = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return FileResponse(p, media_type=media_type)


@app.get("/doc/{doc_id}/raw")
def get_raw(doc_id: str) -> dict[str, Any]:
    return _load_result(doc_id)


@app.get("/doc/{doc_id}/pdf")
def get_pdf(doc_id: str) -> FileResponse:
    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"
    if not source.exists():
        raise HTTPException(404, "PDF source absent")

    # Stratégie PDF.js :
    # - PDFs scannés (non-native) : toujours rastériser (ICC/JPEG2000)
    # - PDFs natifs avec JPEG2000 : rastériser aussi (les images seraient vides sinon)
    # - PDFs natifs sans JPEG2000 : servir l'original (conserve la couche texte)
    try:
        result = _load_result(doc_id)
        is_native = result.get("extraction_mode") in ("fast", "native")
    except Exception:
        is_native = False

    cleaned = ddir / "cleaned.pdf"
    needs_clean = not is_native  # toujours pour scannés

    if is_native and not cleaned.exists():
        # Vérifier JPEG2000 + ICC profiles invalides (coûteux une seule fois, résultat mis en cache)
        if _needs_rasterize(source):
            needs_clean = True
            print(f"[pdf] Probleme rendu detecte (JPEG2000 / ICC invalide) - rasterisation necessaire")

    if needs_clean:
        if not cleaned.exists():
            try:
                _repair_icc_profiles(source, cleaned)
            except Exception as e:
                print(f"[pdf] ICC repair skipped: {e}")
        if cleaned.exists():
            return FileResponse(cleaned, media_type="application/pdf")

    return FileResponse(source, media_type="application/pdf")


@app.get("/doc/{doc_id}/html")
def get_html(doc_id: str):
    """Retourne le HTML riche (premier batch uniquement — backward compat).

    FIX-034 : FileResponse au lieu de read_text → streaming + Content-Length automatique.
    Pour les grands documents, utiliser /html-manifest + /html-part/{start_page}.
    """
    ddir = _doc_dir(doc_id)
    html_path = ddir / "result.html"
    if not html_path.exists():
        raise HTTPException(404, "HTML non disponible — relancez l'extraction ou utilisez le mode Reader Markdown")
    return FileResponse(html_path, media_type="text/html; charset=utf-8")


@app.get("/doc/{doc_id}/html-manifest")
def get_html_manifest(doc_id: str):
    """Retourne le manifeste JSON des batches HTML : [{start, end, file}, ...]."""
    ddir = _doc_dir(doc_id)
    p = ddir / "html_manifest.json"
    if not p.exists():
        raise HTTPException(404, "Manifeste HTML non disponible — document non retraité")
    return FileResponse(p, media_type="application/json")


@app.get("/doc/{doc_id}/html-part/{start_page}")
def get_html_part(doc_id: str, start_page: int):
    """Retourne un batch HTML individuel (pages start_page à start_page+N-1)."""
    ddir = _doc_dir(doc_id)
    filename = f"html_part_{start_page:04d}.html"
    p = ddir / filename
    if not p.exists():
        raise HTTPException(404, f"Batch HTML page {start_page} non disponible")
    return FileResponse(p, media_type="text/html; charset=utf-8")


@app.get("/doc/{doc_id}/markdown")
def get_markdown(doc_id: str) -> FileResponse:
    ddir = _doc_dir(doc_id)
    md_path = ddir / "result.md"
    if md_path.exists():
        return FileResponse(md_path, media_type="text/markdown", filename=f"{doc_id}.md")

    pdf_path = ddir / "source.pdf"
    if not pdf_path.exists():
        raise HTTPException(404, "Document inconnu")

    from pipeline import _converter, _clean_markdown
    try:
        doc = _converter().convert(str(pdf_path)).document
        md_path.write_text(_clean_markdown(doc.export_to_markdown()), encoding="utf-8")
    except Exception as e:
        raise HTTPException(422, f"Echec export markdown : {type(e).__name__}: {e}")

    return FileResponse(md_path, media_type="text/markdown", filename=f"{doc_id}.md")


# ─────────────────────────────────────────────────────────────────────────────
# P1.1 — OCRmyPDF : génère un PDF avec couche texte embarquée
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/doc/{doc_id}/searchable-pdf")
def get_searchable_pdf(doc_id: str) -> FileResponse:
    """Génère un PDF avec couche texte OCR embarquée via OCRmyPDF + Tesseract.

    - PDFs natifs  : skip_text=True (texte déjà présent, Tesseract complète les zones manquantes)
    - PDFs scannés : OCR complet eng+fra

    Retourne 503 si Tesseract ou OCRmyPDF est absent.
    """
    from pipeline import TESSERACT_CMD  # import différé pour éviter l'init au boot

    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"
    if not source.exists():
        raise HTTPException(404, "Document inconnu")

    if not TESSERACT_CMD:
        raise HTTPException(
            503,
            "Tesseract non trouvé. Installez-le avec : scoop install tesseract "
            "(voir README pour les données de langue).",
        )

    try:
        import ocrmypdf  # type: ignore
    except ImportError:
        raise HTTPException(503, "OCRmyPDF non installé : pip install ocrmypdf")

    searchable = ddir / "searchable.pdf"
    if searchable.exists():
        return FileResponse(
            searchable, media_type="application/pdf",
            filename=f"{doc_id}_searchable.pdf",
        )

    try:
        result = _load_result(doc_id)
        skip_text = result.get("extraction_mode") in ("fast", "native")
        ocrmypdf.ocr(
            source, searchable,
            language=["fra", "eng"],
            skip_text=skip_text,
            progress_bar=False,
            jobs=2,
        )
    except Exception as e:
        raise HTTPException(422, f"OCR échoué : {type(e).__name__}: {e}")

    return FileResponse(
        searchable, media_type="application/pdf",
        filename=f"{doc_id}_searchable.pdf",
    )


@app.post("/doc/{doc_id}/ocr-image/{fig_id}")
def ocr_figure_image(doc_id: str, fig_id: str) -> JSONResponse:
    """OCR direct sur une figure via pytesseract + Tesseract.

    Retourne le texte brut extrait de l'image PNG de la figure.
    Utile pour les figures contenant du texte dense (tableaux image, notes).
    """
    from pipeline import TESSERACT_CMD

    if not TESSERACT_CMD:
        raise HTTPException(503, "Tesseract non trouvé")

    try:
        import pytesseract  # type: ignore
        from PIL import Image
    except ImportError:
        raise HTTPException(503, "pytesseract / Pillow non installé")

    img_path = _doc_dir(doc_id) / "figures" / f"{fig_id}.png"
    if not img_path.exists():
        raise HTTPException(404, "Figure inconnue")

    try:
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang="fra+eng").strip()
    except Exception as e:
        raise HTTPException(422, f"OCR image échoué : {e}")

    return JSONResponse({"fig_id": fig_id, "text": text, "engine": "tesseract"})


@app.get("/tesseract/status")
def tesseract_status() -> JSONResponse:
    """Retourne l'état de Tesseract : chemin, langues disponibles, version."""
    from pipeline import TESSERACT_CMD, TESSDATA_DIR

    if not TESSERACT_CMD:
        return JSONResponse({"available": False, "cmd": None, "langs": [], "version": None})

    langs: list[str] = []
    version: str | None = None
    try:
        import pytesseract  # type: ignore
        langs = pytesseract.get_languages(config="")
        version = str(pytesseract.get_tesseract_version())
    except Exception:
        pass

    return JSONResponse({
        "available": True,
        "cmd": TESSERACT_CMD,
        "tessdata": TESSDATA_DIR,
        "langs": langs,
        "version": version,
    })


# ─────────────────────────────────────────────────────────────────────────────
# P1.2 — LaTeX-OCR : (re)lance pix2tex sur toutes les figures du document
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/doc/{doc_id}/latex-ocr")
def run_latex_ocr(doc_id: str) -> JSONResponse:
    """Lance LaTeX-OCR (Texify ou pix2tex) sur les figures du document.

    Moteur actif : FORMULA_ENGINE env var (auto / texify / pix2tex).
    Met à jour figures[].latex dans result.json.
    """
    if not _valid_doc_id(doc_id):
        raise HTTPException(400, "doc_id invalide")
    ddir = _doc_dir(doc_id)
    if not (ddir / "result.json").exists():
        raise HTTPException(404, "Document inconnu")

    from pipeline import _latex_ocr_figure, _resolve_engine

    engine = _resolve_engine()
    if engine == "none":
        raise HTTPException(
            503,
            "Aucun moteur LaTeX-OCR disponible. "
            "Installez texify (pip install texify) ou pix2tex (pip install pix2tex).",
        )

    result = _load_result(doc_id)
    figures = result.get("figures", [])
    figures_dir = ddir / "figures"

    updated = 0
    for fig in figures:
        img_path = figures_dir / f"{fig['id']}.png"
        latex = _latex_ocr_figure(img_path)
        if latex:
            fig["latex"] = latex
            updated += 1

    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return JSONResponse({"status": "ok", "engine": engine, "figures_updated": updated})


# ─────────────────────────────────────────────────────────────────────────────
# Florence-2 : captioning IA de toutes les figures du document
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/doc/{doc_id}/caption-figures")
def caption_figures(doc_id: str) -> JSONResponse:
    """Lance Florence-2 sur chaque figure et stocke caption_ai dans result.json.

    Requiert : pip install einops timm (transformers + torch déjà installés)
    Env : FLORENCE2_CAPTION=1 pour activer automatiquement pendant le pipeline.
    Temps : ~1–3 s/figure sur CPU, ~0.2 s/figure sur GPU.
    """
    if not _valid_doc_id(doc_id):
        raise HTTPException(400, "doc_id invalide")
    ddir = _doc_dir(doc_id)
    if not (ddir / "result.json").exists():
        raise HTTPException(404, "Document inconnu")

    try:
        from transformers import AutoModelForCausalLM, AutoProcessor  # noqa: F401
    except ImportError:
        raise HTTPException(
            503,
            "Dépendances manquantes. Exécutez : pip install einops timm",
        )

    from pipeline import _florence_caption, _init_florence

    if not _init_florence():
        raise HTTPException(
            503,
            "Florence-2 non disponible — vérifiez les logs backend pour le détail.",
        )

    result = _load_result(doc_id)
    figures = result.get("figures", [])
    figures_dir = ddir / "figures"

    from PIL import Image

    updated = 0
    for fig in figures:
        img_path = figures_dir / f"{fig['id']}.png"
        if not img_path.exists():
            continue
        try:
            pil_img = Image.open(img_path).convert("RGB")
            caption = _florence_caption(pil_img)
            if caption:
                fig["caption_ai"] = caption
                updated += 1
        except Exception as exc:
            print(f"[caption-figures] {fig['id']} : {exc}")

    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return JSONResponse({"status": "ok", "figures_updated": updated})


# ─────────────────────────────────────────────────────────────────────────────

@app.delete("/doc/{doc_id}")
def delete_doc(doc_id: str) -> dict[str, str]:
    p = _doc_dir(doc_id)
    if p.exists():
        shutil.rmtree(p)
    return {"status": "deleted", "doc_id": doc_id}


@app.post("/cache/cleanup")
def cleanup_cache(max_age_days: int = 30) -> JSONResponse:
    """Nettoie les documents en cache plus vieux que max_age_days jours.

    Vérifie la date de dernière modification de result.json ou de source.pdf,
    ou à défaut celle du dossier de cache lui-même.
    """
    import time
    now = time.time()
    cutoff = now - (max_age_days * 86400)
    cleaned = 0
    total_freed_bytes = 0

    with tasks_lock:
        active_ids = set(active_tasks.keys())

    for item in CACHE_DIR.iterdir():
        if not item.is_dir() or item.name in active_ids:
            continue

        result_file = item / "result.json"
        source_file = item / "source.pdf"

        mtime = item.stat().st_mtime
        if result_file.exists():
            mtime = result_file.stat().st_mtime
        elif source_file.exists():
            mtime = source_file.stat().st_mtime

        if mtime < cutoff:
            # Calculer la taille libérée en octets
            folder_size = sum(f.stat().st_size for f in item.rglob('*') if f.is_file())
            try:
                shutil.rmtree(item)
                cleaned += 1
                total_freed_bytes += folder_size
            except Exception as e:
                print(f"[cache] Échec suppression {item.name}: {e}")

    freed_mb = round(total_freed_bytes / (1024 * 1024), 2)
    return JSONResponse({
        "status": "ok",
        "cleaned_directories": cleaned,
        "freed_space_mb": freed_mb,
        "max_age_days": max_age_days
    })



@app.post("/doc/{doc_id}/reprocess")
async def reprocess_doc(doc_id: str, background_tasks: BackgroundTasks, fast_mode: bool = False) -> JSONResponse:
    """Supprime le cache d'un document et le retraite depuis le PDF source.

    Utile quand le document a été extrait en mode 'fast' (sans figures/tables)
    et qu'on veut relancer le pipeline complet.
    """
    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"

    if not source.exists():
        raise HTTPException(404, "PDF source introuvable — impossible de retraiter")

    # Détecter si déjà en cours de traitement
    with tasks_lock:
        is_processing = doc_id in active_tasks

    if is_processing:
        return JSONResponse({
            "doc_id": doc_id,
            "status": "processing",
            "progress": active_tasks[doc_id]["progress"],
            "message": active_tasks[doc_id]["message"]
        })

    # Supprimer d'anciennes erreurs de traitement
    (ddir / "error.json").unlink(missing_ok=True)

    # Supprimer le cache (sauf le PDF source)
    for p in list(ddir.iterdir()):
        if p.name != "source.pdf":
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                p.unlink(missing_ok=True)

    # Enregistrer la tâche
    with tasks_lock:
        active_tasks[doc_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Début du retraitement du document..."
        }

    # Lancer le pipeline en arrière-plan
    background_tasks.add_task(run_pipeline_bg, doc_id, source, ddir, True, "source.pdf", fast_mode)

    return JSONResponse({
        "doc_id": doc_id,
        "status": "processing",
        "progress": 0,
        "message": "Retraitement ajouté à la file d'attente..."
    })


@app.get("/doc/{doc_id}/status")
def get_status(doc_id: str) -> JSONResponse:
    """Retourne le statut actuel du traitement d'un document.

    Statuts possibles :
      - 'ready'      : traitement fini, result.json existe
      - 'processing' : en cours de traitement (retourne progress et message)
      - 'failed'     : erreur détectée, error.json existe (retourne l'erreur)
      - 'not_found'  : document inconnu
    """
    ddir = _doc_dir(doc_id)

    # 1. Prêt ?
    if (ddir / "result.json").exists():
        return JSONResponse({"status": "ready"})

    # 2. En cours ?
    with tasks_lock:
        task = active_tasks.get(doc_id)
    if task:
        return JSONResponse({
            "status": "processing",
            "progress": task.get("progress", 0),
            "message": task.get("message", "")
        })

    # 3. Échoué ?
    if (ddir / "error.json").exists():
        try:
            with open(ddir / "error.json", encoding="utf-8") as f:
                err_data = json.load(f)
            return JSONResponse({
                "status": "failed",
                "error": err_data.get("error", "Erreur d'extraction inconnue")
            })
        except Exception:
            return JSONResponse({
                "status": "failed",
                "error": "L'extraction a échoué"
            })

    # 4. Inconnu
    return JSONResponse({"status": "not_found"})
