"""API FastAPI : pipeline PDF → DoclingDocument → outline + figures + bbox.

Endpoints :
- POST /process : upload PDF, lance Docling en arrière-plan, retourne un statut
- GET  /doc/{doc_id}/status   : avancement du traitement (ready/processing/failed)
- GET  /doc/{doc_id}/outline  : arbre des sections
- GET  /doc/{doc_id}/figure/{fig_id} : image d'une figure
- GET  /doc/{doc_id}/raw              : DoclingDocument JSON complet

Traitement asynchrone : /process lance le pipeline dans un thread de fond
(BackgroundTasks) et le client interroge /status. État partagé via active_tasks.
Cache : sur disque, clé = sha256 du PDF. Ne re-traite pas si déjà vu.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
import traceback
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

log = logging.getLogger(__name__)

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 Mo
DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")
_EMPTY_ANNOTATIONS: dict[str, Any] = {"version": 1, "highlights": [], "notes": {}, "saved_at": 0}
FIG_ID_RE = re.compile(r"^f_\d+$")

# État des traitements en cours, indexé par doc_id. Protégé par tasks_lock.
# Chaque entrée : {"status": "processing", "progress": int, "message": str}
active_tasks: dict[str, dict[str, Any]] = {}
tasks_lock = threading.Lock()

app = FastAPI(title="PDF Viewer API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _doc_dir(doc_id: str) -> Path:
    if not DOC_ID_RE.fullmatch(doc_id):
        raise HTTPException(400, "Identifiant document invalide")
    return CACHE_DIR / doc_id


def _validate_fig_id(fig_id: str) -> None:
    if not FIG_ID_RE.fullmatch(fig_id):
        raise HTTPException(400, "Identifiant figure invalide")


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    """Écrit un JSON de façon atomique (tmp + rename) pour éviter une lecture partielle."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _resolve_source(doc_id: str) -> Path | None:
    """Retourne le fichier source d'un document (source.pdf ou source.*)."""
    ddir = _doc_dir(doc_id)
    for pat in ("source.pdf", "source.*"):
        candidates = sorted(ddir.glob(pat))
        if candidates:
            return candidates[0]
    return None


def _clean_title(title: str | None) -> str:
    if not title:
        return ""
    return re.sub(
        r"^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)", "", title, flags=re.IGNORECASE
    ).strip()


def _library_item_from_result(doc_id: str, ddir: Path, result: dict[str, Any], mtime: float) -> dict[str, Any]:
    """Construit une entrée de catalogue à partir d'un result.json en cache."""
    source = ddir / "source.pdf"
    if not source.exists():
        source_files = sorted(ddir.glob("source.*"))
        source = source_files[0] if source_files else None
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
        "file_type": source.suffix.lstrip(".").lower() if source else "pdf",
        "extraction_mode": result.get("extraction_mode", "docling"),
        "n_pages": result.get("n_pages", 0),
        "n_figures": result.get("n_figures", len(figures)),
        "n_tables": result.get("n_tables", len(result.get("tables") or [])),
        "n_sections": len(result.get("outline") or []),
        "modified_at": mtime,
        "size_bytes": source.stat().st_size if source and source.exists() else None,
        "cover_figure_id": cover_figure_id,
        "needs_reprocess": False,  # versioning du cache hors scope de cette PR
    }


def update_task_progress(doc_id: str, progress: int, message: str) -> None:
    """Callback de progression invoqué par le pipeline en arrière-plan."""
    with tasks_lock:
        if doc_id in active_tasks:
            active_tasks[doc_id].update({"progress": progress, "message": message})


def run_pipeline_bg(doc_id: str, src_path: Path, ddir: Path, filename: str, is_pdf: bool, force_ocr: bool = False) -> None:
    """Exécute le pipeline en arrière-plan et écrit result.json ou error.json.

    PDF → Docling (convertir_pdf) ; autres formats → MarkItDown (convertir_generic).
    force_ocr force l'OCR sur les PDFs natifs (cas hybrides).
    """
    from pipeline import convertir_pdf, convertir_generic  # import différé

    cb = lambda p, m: update_task_progress(doc_id, p, m)
    try:
        if is_pdf:
            result = convertir_pdf(src_path, ddir, progress_callback=cb, force_ocr=force_ocr)
        else:
            result = convertir_generic(src_path, ddir, progress_callback=cb)
        result["doc_id"] = doc_id
        result["filename"] = filename
        _write_json_atomic(ddir / "result.json", result)
    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        log.error("Pipeline en arrière-plan échoué pour %s : %s", doc_id, error_msg)
        log.debug("%s", traceback.format_exc())
        try:
            _write_json_atomic(ddir / "error.json", {"error": error_msg})
        except OSError:
            log.exception("Impossible d'écrire error.json pour %s", doc_id)
    finally:
        with tasks_lock:
            active_tasks.pop(doc_id, None)


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "pdf-viewer-api"}


@app.get("/library")
def get_library() -> JSONResponse:
    """Catalogue local construit depuis le cache disque + traitements en cours."""
    with tasks_lock:
        processing = [
            {
                "doc_id": doc_id,
                "status": "processing",
                "progress": task.get("progress", 0),
                "message": task.get("message", ""),
            }
            for doc_id, task in active_tasks.items()
        ]

    documents: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for item in CACHE_DIR.iterdir():
        if not item.is_dir() or not DOC_ID_RE.fullmatch(item.name):
            continue
        result_path = item / "result.json"
        error_path = item / "error.json"
        if result_path.exists():
            try:
                st = result_path.stat()
                with open(result_path, encoding="utf-8") as f:
                    result = json.load(f)
                documents.append(_library_item_from_result(item.name, item, result, st.st_mtime))
            except (OSError, json.JSONDecodeError) as e:
                failed.append({"doc_id": item.name, "status": "failed", "error": f"Cache illisible: {e}"})
        elif error_path.exists():
            try:
                with open(error_path, encoding="utf-8") as f:
                    error = json.load(f).get("error", "Erreur d'extraction inconnue")
            except (OSError, json.JSONDecodeError):
                error = "Erreur d'extraction inconnue"
            failed.append({"doc_id": item.name, "status": "failed", "error": error})

    documents.sort(key=lambda d: d.get("modified_at") or 0, reverse=True)
    return JSONResponse({
        "documents": documents,
        "processing": processing,
        "failed": failed,
        "total": len(documents),
    })


@app.post("/process")
async def process(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> JSONResponse:
    """Upload un document et lance l'extraction en arrière-plan.

    PDF → Docling ; autres formats (Word, PowerPoint, Excel, HTML, images,
    notebooks…) → MarkItDown. Retourne immédiatement :
      - le result.json complet si le document est déjà en cache (hit)
      - sinon {doc_id, status: "processing", progress, message} ; le client
        interroge ensuite GET /doc/{doc_id}/status jusqu'à status "ready"/"failed".
    """
    from pipeline import MARKITDOWN_EXTENSIONS  # import différé

    if not file.filename:
        raise HTTPException(400, "Nom de fichier manquant")
    ext = Path(file.filename).suffix.lower()
    is_pdf = ext == ".pdf"
    supported = {".pdf"} | MARKITDOWN_EXTENSIONS
    if ext not in supported:
        raise HTTPException(
            400, f"Format '{ext}' non supporté. Formats acceptés : " + ", ".join(sorted(supported))
        )

    data = await file.read()
    if not data:
        raise HTTPException(400, "Fichier vide")
    if len(data) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(413, f"Fichier trop volumineux (max {max_mb} Mo)")
    if is_pdf and not data.startswith(b"%PDF"):
        raise HTTPException(400, "Le fichier ne ressemble pas à un PDF (entête %PDF absent)")

    doc_id = _hash_bytes(data)
    ddir = _doc_dir(doc_id)

    # 1. Déjà traité ? Retour synchrone du cache.
    if (ddir / "result.json").exists():
        with open(ddir / "result.json", encoding="utf-8") as f:
            return JSONResponse(json.load(f))

    # 2. Déjà en cours ? Retour du statut courant.
    with tasks_lock:
        task = active_tasks.get(doc_id)
        if task:
            return JSONResponse({"doc_id": doc_id, **task})

    # 3. Nouveau traitement : on persiste la source et on lance le pipeline en tâche de fond.
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "error.json").unlink(missing_ok=True)  # purge une éventuelle erreur précédente
    src_path = ddir / ("source.pdf" if is_pdf else f"source{ext}")
    src_path.write_bytes(data)

    with tasks_lock:
        active_tasks[doc_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Fichier reçu, démarrage de l'analyse...",
        }

    background_tasks.add_task(run_pipeline_bg, doc_id, src_path, ddir, file.filename, is_pdf)

    return JSONResponse({
        "doc_id": doc_id,
        "status": "processing",
        "progress": 0,
        "message": "Ajouté à la file d'attente...",
    })


@app.get("/doc/{doc_id}/status")
def get_status(doc_id: str) -> JSONResponse:
    """Statut du traitement : ready | processing | failed | not_found."""
    ddir = _doc_dir(doc_id)

    if (ddir / "result.json").exists():
        return JSONResponse({"status": "ready"})

    with tasks_lock:
        task = active_tasks.get(doc_id)
    if task:
        return JSONResponse({
            "status": "processing",
            "progress": task.get("progress", 0),
            "message": task.get("message", ""),
        })

    if (ddir / "error.json").exists():
        try:
            with open(ddir / "error.json", encoding="utf-8") as f:
                err = json.load(f)
            return JSONResponse({"status": "failed", "error": err.get("error", "Erreur inconnue")})
        except (OSError, json.JSONDecodeError):
            return JSONResponse({"status": "failed", "error": "Erreur d'extraction inconnue"})

    return JSONResponse({"status": "not_found"})


@app.get("/doc/{doc_id}/outline")
def get_outline(doc_id: str) -> dict[str, Any]:
    p = _doc_dir(doc_id) / "result.json"
    if not p.exists():
        raise HTTPException(404, "Document inconnu")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("outline", {})
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(422, f"Cache corrompu : {e}")


@app.get("/doc/{doc_id}/figure/{fig_id}")
def get_figure(doc_id: str, fig_id: str) -> FileResponse:
    _validate_fig_id(fig_id)
    p = _doc_dir(doc_id) / "figures" / f"{fig_id}.png"
    if not p.exists():
        raise HTTPException(404, "Figure inconnue")
    return FileResponse(p, media_type="image/png")


@app.get("/doc/{doc_id}/raw")
def get_raw(doc_id: str) -> dict[str, Any]:
    p = _doc_dir(doc_id) / "result.json"
    if not p.exists():
        raise HTTPException(404, "Document inconnu")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(422, f"Cache corrompu : {e}")


@app.get("/doc/{doc_id}/pdf")
def get_pdf(doc_id: str) -> FileResponse:
    p = _doc_dir(doc_id) / "source.pdf"
    if not p.exists():
        raise HTTPException(404, "PDF source absent")
    return FileResponse(p, media_type="application/pdf")


@app.get("/doc/{doc_id}/thumbnail")
def get_thumbnail(doc_id: str) -> FileResponse:
    """Miniature de la 1re page du PDF (~200 px de large), mise en cache."""
    from pipeline import _PDFIUM_LOCK
    import pypdfium2 as pdfium

    ddir = _doc_dir(doc_id)
    thumb_path = ddir / "thumbnail.png"

    if not thumb_path.exists():
        pdf_path = _resolve_source(doc_id)
        if not pdf_path or not pdf_path.exists():
            raise HTTPException(404, "PDF source introuvable")
        try:
            with _PDFIUM_LOCK:
                doc = pdfium.PdfDocument(str(pdf_path))
                try:
                    img = doc[0].render(scale=0.35).to_pil()
                finally:
                    doc.close()
            img.save(str(thumb_path), "PNG", optimize=True)
        except Exception as exc:
            raise HTTPException(500, f"Erreur rendu miniature : {exc}") from exc

    return FileResponse(thumb_path, media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@app.get("/doc/{doc_id}/markdown")
def get_markdown(doc_id: str) -> FileResponse:
    """Export markdown. 404 si non généré (re-uploader le doc pour regénérer)."""
    md_path = _doc_dir(doc_id) / "result.md"
    if not md_path.exists():
        raise HTTPException(404, "Markdown non disponible (re-uploader le document)")
    return FileResponse(md_path, media_type="text/markdown", filename=f"{doc_id}.md")


@app.get("/doc/{doc_id}/html")
def get_html(doc_id: str) -> FileResponse:
    """HTML Docling complet (1re tranche). 404 si non généré → le Lecteur passe en Markdown."""
    p = _doc_dir(doc_id) / "result.html"
    if not p.exists():
        raise HTTPException(404, "HTML indisponible")
    return FileResponse(p, media_type="text/html")


@app.get("/doc/{doc_id}/html-manifest")
def get_html_manifest(doc_id: str) -> FileResponse:
    """Manifest des tranches HTML : [{start, end, file}]."""
    p = _doc_dir(doc_id) / "html_manifest.json"
    if not p.exists():
        raise HTTPException(404, "Manifest HTML indisponible")
    return FileResponse(p, media_type="application/json")


@app.get("/doc/{doc_id}/html-part/{start_page}")
def get_html_part(doc_id: str, start_page: int) -> FileResponse:
    """Tranche HTML débutant à la page start_page (start_page typé int → pas de traversal)."""
    p = _doc_dir(doc_id) / f"html_part_{start_page:04d}.html"
    if not p.exists():
        raise HTTPException(404, "Partie HTML inconnue")
    return FileResponse(p, media_type="text/html")


@app.delete("/doc/{doc_id}")
def delete_doc(doc_id: str) -> dict[str, str]:
    with tasks_lock:
        if doc_id in active_tasks:
            raise HTTPException(409, "Document en cours de traitement, réessayez plus tard")
    p = _doc_dir(doc_id)
    if p.exists():
        shutil.rmtree(p)
    return {"status": "deleted", "doc_id": doc_id}


@app.post("/cache/cleanup")
def cleanup_cache(max_age_days: int = 30) -> JSONResponse:
    """Supprime les documents en cache plus vieux que max_age_days jours.

    Se base sur le mtime de result.json (ou source.pdf, ou le dossier). Saute
    les documents en cours de traitement.
    """
    cutoff = time.time() - (max_age_days * 86400)
    cleaned = 0
    total_freed = 0

    with tasks_lock:
        active_ids = set(active_tasks.keys())

    for item in CACHE_DIR.iterdir():
        if not item.is_dir() or not DOC_ID_RE.fullmatch(item.name) or item.name in active_ids:
            continue
        result_file = item / "result.json"
        source_file = item / "source.pdf"
        mtime = item.stat().st_mtime
        if result_file.exists():
            mtime = result_file.stat().st_mtime
        elif source_file.exists():
            mtime = source_file.stat().st_mtime
        if mtime < cutoff:
            folder_size = sum(f.stat().st_size for f in item.rglob("*") if f.is_file())
            try:
                shutil.rmtree(item)
                cleaned += 1
                total_freed += folder_size
            except OSError as e:
                log.warning("Échec suppression cache %s : %s", item.name, e)

    return JSONResponse({
        "status": "ok",
        "cleaned_directories": cleaned,
        "freed_space_mb": round(total_freed / (1024 * 1024), 2),
        "max_age_days": max_age_days,
    })


@app.post("/doc/{doc_id}/reprocess")
async def reprocess_doc(
    doc_id: str, background_tasks: BackgroundTasks, force_ocr: bool = False
) -> JSONResponse:
    """Retraite un document depuis sa source. force_ocr force l'OCR (PDFs hybrides)."""
    ddir = _doc_dir(doc_id)
    source = _resolve_source(doc_id)
    if not source or not source.exists():
        raise HTTPException(404, "Fichier source introuvable — impossible de retraiter")
    is_pdf = source.suffix.lower() == ".pdf"

    with tasks_lock:
        task = active_tasks.get(doc_id)
        if task:
            return JSONResponse({"doc_id": doc_id, **task})

    # Purge le cache dérivé en conservant la source
    for p in list(ddir.iterdir()):
        if p.name == source.name:
            continue
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)

    with tasks_lock:
        active_tasks[doc_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Retraitement OCR en file..." if force_ocr else "Retraitement en file...",
        }

    background_tasks.add_task(run_pipeline_bg, doc_id, source, ddir, source.name, is_pdf, force_ocr)
    return JSONResponse({
        "doc_id": doc_id,
        "status": "processing",
        "progress": 0,
        "message": "Retraitement OCR ajouté à la file..." if force_ocr else "Retraitement ajouté à la file...",
    })


# ─────────────────────────────────────────────────────────────────────────────
# Annotations + fiche export
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/doc/{doc_id}/annotations")
def get_annotations(doc_id: str) -> JSONResponse:
    """Retourne les annotations (highlights + notes) du document."""
    ddir = _doc_dir(doc_id)
    if not ddir.exists():
        raise HTTPException(404, "Document inconnu")
    path = ddir / "annotations.json"
    if not path.exists():
        return JSONResponse(dict(_EMPTY_ANNOTATIONS))
    try:
        return JSONResponse(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError):
        return JSONResponse(dict(_EMPTY_ANNOTATIONS))


@app.put("/doc/{doc_id}/annotations")
def put_annotations(doc_id: str, body: dict) -> dict[str, Any]:
    """Sauvegarde les annotations (highlights + notes). Écriture atomique."""
    ddir = _doc_dir(doc_id)
    if not ddir.exists():
        raise HTTPException(404, "Document inconnu")
    raw_size = len(json.dumps(body, ensure_ascii=False))
    if raw_size > 1_000_000:
        raise HTTPException(413, "Annotations trop volumineuses (max 1 Mo)")
    highlights = body.get("highlights", [])
    notes = body.get("notes", {})
    if not isinstance(highlights, list) or not isinstance(notes, dict):
        raise HTTPException(422, "Format annotations invalide")
    valid_keys = {h.get("key") for h in highlights if isinstance(h, dict)}
    notes = {k: v for k, v in notes.items() if k in valid_keys}
    store = {
        "version": 1,
        "highlights": highlights,
        "notes": notes,
        "saved_at": int(time.time() * 1000),
    }
    path = ddir / "annotations.json"
    _write_json_atomic(path, store)
    return {"ok": True, "saved_at": store["saved_at"]}


@app.get("/doc/{doc_id}/fiche")
def get_fiche(doc_id: str, format: str = "html") -> Response:
    """Exporte une fiche de révision (HTML ou Markdown) depuis les annotations."""
    ddir = _doc_dir(doc_id)
    if not ddir.exists():
        raise HTTPException(404, "Document inconnu")
    if format not in ("html", "md"):
        raise HTTPException(400, "format doit être html ou md")
    try:
        result_path = ddir / "result.json"
        if result_path.exists():
            with open(result_path, encoding="utf-8") as f:
                result = json.load(f)
            title = _clean_title(result.get("title") or result.get("filename") or doc_id)
        else:
            title = doc_id
    except (OSError, json.JSONDecodeError):
        title = doc_id
    path = ddir / "annotations.json"
    if path.exists():
        try:
            store = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            store = dict(_EMPTY_ANNOTATIONS)
    else:
        store = dict(_EMPTY_ANNOTATIONS)
    from fiche import render_html, render_markdown
    safe = re.sub(r"[^\w\-]+", "_", title).strip("_") or "fiche"
    if format == "md":
        content = render_markdown(title, store)
        media = "text/markdown; charset=utf-8"
        fname = f"{safe}.md"
    else:
        content = render_html(title, store)
        media = "text/html; charset=utf-8"
        fname = f"{safe}.html"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# OCR — Tesseract (searchable PDF, image OCR) + pix2tex (LaTeX). Tout optionnel.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/tesseract/status")
def tesseract_status() -> JSONResponse:
    """État de Tesseract : chemin, langues disponibles, version."""
    import ocr

    if not ocr.TESSERACT_CMD:
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
        "cmd": ocr.TESSERACT_CMD,
        "tessdata": ocr.TESSDATA_DIR,
        "langs": langs,
        "version": version,
    })


@app.get("/doc/{doc_id}/searchable-pdf")
async def get_searchable_pdf(doc_id: str) -> FileResponse:
    """Génère un PDF avec couche texte OCR embarquée via OCRmyPDF + Tesseract.

    - PDF natif  : skip_text=True (texte déjà présent, Tesseract complète les vides)
    - PDF scanné : OCR complet fra+eng
    Retourne 503 si Tesseract ou OCRmyPDF est absent. Résultat mis en cache.
    """
    import ocr

    ddir = _doc_dir(doc_id)
    source = ddir / "source.pdf"
    if not source.exists():
        raise HTTPException(404, "Document inconnu")

    if not ocr.TESSERACT_CMD:
        raise HTTPException(
            503,
            "Tesseract non trouvé. Installez-le (scoop install tesseract / "
            "brew install tesseract / apt install tesseract-ocr).",
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

    from pipeline import _is_native_pdf  # import différé

    def _run_ocr():
        skip_text = _is_native_pdf(source)
        ocrmypdf.ocr(
            source, searchable,
            language=["fra", "eng"],
            skip_text=skip_text,
            progress_bar=False,
            jobs=2,
        )

    try:
        await asyncio.to_thread(_run_ocr)
    except Exception as e:
        raise HTTPException(422, f"OCR échoué : {type(e).__name__}: {e}")

    return FileResponse(
        searchable, media_type="application/pdf",
        filename=f"{doc_id}_searchable.pdf",
    )


@app.post("/doc/{doc_id}/ocr-image/{fig_id}")
def ocr_figure_image(doc_id: str, fig_id: str) -> JSONResponse:
    """OCR direct sur une figure (texte dense : tableaux image, notes) via pytesseract."""
    import ocr

    _validate_fig_id(fig_id)

    if not ocr.TESSERACT_CMD:
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
        with Image.open(img_path) as img:
            text = pytesseract.image_to_string(img, lang="fra+eng").strip()
    except Exception as e:
        raise HTTPException(422, f"OCR image échoué : {e}")

    return JSONResponse({"fig_id": fig_id, "text": text, "engine": "tesseract"})


@app.post("/doc/{doc_id}/latex-ocr")
async def run_latex_ocr(doc_id: str) -> JSONResponse:
    """Lance pix2tex sur les figures du document et met à jour result.json.

    Requiert pix2tex (pip install pix2tex). Retourne 503 si absent.
    """
    import ocr

    ddir = _doc_dir(doc_id)
    result_path = ddir / "result.json"
    if not result_path.exists():
        raise HTTPException(404, "Document inconnu")

    if not ocr.latex_engine_available():
        raise HTTPException(503, "Aucun moteur LaTeX-OCR. Installez : pip install texify (ou pix2tex)")

    with open(result_path, encoding="utf-8") as f:
        result = json.load(f)

    figures = result.get("figures", [])
    figures_dir = ddir / "figures"

    def _run():
        nonlocal result
        count = 0
        for fig in figures:
            fid = fig.get("id", "")
            if not FIG_ID_RE.fullmatch(fid):
                continue
            img_path = figures_dir / f"{fid}.png"
            if not img_path.exists():
                continue
            latex = ocr.latex_ocr_figure(img_path)
            if latex:
                fig["latex"] = latex
                count += 1
        _write_json_atomic(result_path, result)
        return count

    updated = await asyncio.to_thread(_run)
    return JSONResponse({"status": "ok", "figures_updated": updated})


@app.post("/doc/{doc_id}/caption-figures")
async def caption_figures(doc_id: str) -> JSONResponse:
    """Légende chaque figure via Florence-2 et stocke caption_ai dans result.json.

    Opt-in : modèle microsoft/Florence-2-base (~450 Mo) téléchargé au 1er usage.
    Requiert transformers + torch (déjà présents) + einops + timm. 503 si indisponible.
    """
    import captioning

    ddir = _doc_dir(doc_id)
    result_path = ddir / "result.json"
    if not result_path.exists():
        raise HTTPException(404, "Document inconnu")

    if not captioning.init_florence():
        raise HTTPException(503, "Florence-2 non disponible (pip install einops timm).")

    with open(result_path, encoding="utf-8") as f:
        result = json.load(f)
    figures = result.get("figures", [])
    figures_dir = ddir / "figures"

    def _run():
        from PIL import Image
        count = 0
        for fig in figures:
            fid = fig.get("id", "")
            if not FIG_ID_RE.fullmatch(fid):
                continue
            img_path = figures_dir / f"{fid}.png"
            if not img_path.exists():
                continue
            try:
                with Image.open(img_path) as img:
                    caption = captioning.caption_figure(img.convert("RGB"))
            except Exception:
                log.exception("Florence-2 échec sur %s", fid)
                continue
            if caption:
                fig["caption_ai"] = caption
                count += 1
        _write_json_atomic(result_path, result)
        return count

    updated = await asyncio.to_thread(_run)
    return JSONResponse({"status": "ok", "figures_updated": updated})
