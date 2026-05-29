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


def run_pipeline_bg(doc_id: str, pdf_path: Path, ddir: Path, filename: str) -> None:
    """Exécute le pipeline Docling en arrière-plan et écrit result.json ou error.json."""
    from pipeline import convertir_pdf  # import différé : Docling est lent à charger

    try:
        result = convertir_pdf(
            pdf_path, ddir,
            progress_callback=lambda p, m: update_task_progress(doc_id, p, m),
        )
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
    """Upload un PDF et lance Docling en arrière-plan.

    Retourne immédiatement :
      - le result.json complet si le document est déjà en cache (hit)
      - sinon {doc_id, status: "processing", progress, message} ; le client
        interroge ensuite GET /doc/{doc_id}/status jusqu'à status "ready"/"failed".
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Fichier PDF requis (extension .pdf)")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Fichier vide")
    if len(data) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(413, f"Fichier trop volumineux (max {max_mb} Mo)")
    if not data.startswith(b"%PDF"):
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
    pdf_path = ddir / "source.pdf"
    pdf_path.write_bytes(data)

    with tasks_lock:
        active_tasks[doc_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Fichier reçu, démarrage de l'analyse...",
        }

    background_tasks.add_task(run_pipeline_bg, doc_id, pdf_path, ddir, file.filename)

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
