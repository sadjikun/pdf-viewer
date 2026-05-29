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

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import traceback
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

log = logging.getLogger(__name__)

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 Mo
DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")
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


def _clean_title(title: str | None) -> str:
    if not title:
        return ""
    return re.sub(
        r"^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)", "", title, flags=re.IGNORECASE
    ).strip()


def _library_item_from_result(doc_id: str, ddir: Path, result: dict[str, Any]) -> dict[str, Any]:
    """Construit une entrée de catalogue à partir d'un result.json en cache."""
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


def run_pipeline_bg(doc_id: str, src_path: Path, ddir: Path, filename: str, is_pdf: bool) -> None:
    """Exécute le pipeline en arrière-plan et écrit result.json ou error.json.

    PDF → Docling (convertir_pdf) ; autres formats → MarkItDown (convertir_generic).
    """
    from pipeline import convertir_pdf, convertir_generic  # import différé

    cb = lambda p, m: update_task_progress(doc_id, p, m)
    try:
        if is_pdf:
            result = convertir_pdf(src_path, ddir, progress_callback=cb)
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
                with open(result_path, encoding="utf-8") as f:
                    result = json.load(f)
                documents.append(_library_item_from_result(item.name, item, result))
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
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("outline", {})


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
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@app.get("/doc/{doc_id}/pdf")
def get_pdf(doc_id: str) -> FileResponse:
    p = _doc_dir(doc_id) / "source.pdf"
    if not p.exists():
        raise HTTPException(404, "PDF source absent")
    return FileResponse(p, media_type="application/pdf")


@app.get("/doc/{doc_id}/markdown")
def get_markdown(doc_id: str) -> FileResponse:
    """Export markdown Docling. Genere a la demande si absent (cas legacy)."""
    ddir = _doc_dir(doc_id)
    md_path = ddir / "result.md"
    if md_path.exists():
        return FileResponse(md_path, media_type="text/markdown", filename=f"{doc_id}.md")

    # Fallback : regenerer depuis source.pdf si dispo
    pdf_path = ddir / "source.pdf"
    if not pdf_path.exists():
        raise HTTPException(404, "Document inconnu")

    from pipeline import _converter  # import differe

    try:
        doc = _converter().convert(str(pdf_path)).document
        md = doc.export_to_markdown()
        md_path.write_text(md, encoding="utf-8")
    except Exception as e:
        raise HTTPException(422, f"Echec export markdown : {type(e).__name__}: {e}")

    return FileResponse(md_path, media_type="text/markdown", filename=f"{doc_id}.md")


@app.delete("/doc/{doc_id}")
def delete_doc(doc_id: str) -> dict[str, str]:
    p = _doc_dir(doc_id)
    if p.exists():
        shutil.rmtree(p)
    return {"status": "deleted", "doc_id": doc_id}


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
def get_searchable_pdf(doc_id: str) -> FileResponse:
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

    try:
        skip_text = _is_native_pdf(source)
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
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang="fra+eng").strip()
    except Exception as e:
        raise HTTPException(422, f"OCR image échoué : {e}")

    return JSONResponse({"fig_id": fig_id, "text": text, "engine": "tesseract"})


@app.post("/doc/{doc_id}/latex-ocr")
def run_latex_ocr(doc_id: str) -> JSONResponse:
    """Lance pix2tex sur les figures du document et met à jour result.json.

    Requiert pix2tex (pip install pix2tex). Retourne 503 si absent.
    """
    import ocr

    ddir = _doc_dir(doc_id)
    result_path = ddir / "result.json"
    if not result_path.exists():
        raise HTTPException(404, "Document inconnu")

    if ocr.init_latex_ocr() is None:
        raise HTTPException(503, "pix2tex non installé. Exécutez : pip install pix2tex")

    with open(result_path, encoding="utf-8") as f:
        result = json.load(f)

    figures = result.get("figures", [])
    figures_dir = ddir / "figures"

    updated = 0
    for fig in figures:
        fig_id = fig.get("id", "")
        if not FIG_ID_RE.fullmatch(fig_id):
            continue
        img_path = figures_dir / f"{fig_id}.png"
        if not img_path.exists():
            continue
        latex = ocr.latex_ocr_figure(img_path)
        if latex:
            fig["latex"] = latex
            updated += 1

    # Écriture atomique pour éviter un result.json corrompu en cas de lecture concurrente
    tmp_path = result_path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, result_path)

    return JSONResponse({"status": "ok", "figures_updated": updated})
