"""API FastAPI : pipeline PDF → DoclingDocument → outline + figures + bbox.

Endpoints :
- POST /process : upload PDF, lance Docling, retourne {doc_id, outline, pages, figures}
- GET  /doc/{doc_id}/outline   : arbre des sections
- GET  /doc/{doc_id}/figure/{fig_id} : image d'une figure
- GET  /doc/{doc_id}/raw              : DoclingDocument JSON complet

Cache : sur disque, clé = sha256 du PDF. Ne re-traite pas si déjà vu.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 Mo
DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")
FIG_ID_RE = re.compile(r"^f_\d+$")

app = FastAPI(title="PDF Viewer API", version="0.1.0")

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


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "pdf-viewer-api"}


@app.post("/process")
async def process(file: UploadFile = File(...)) -> JSONResponse:
    """Upload un PDF, le passe à Docling, retourne la structure."""
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

    if (ddir / "result.json").exists():
        with open(ddir / "result.json", encoding="utf-8") as f:
            return JSONResponse(json.load(f))

    ddir.mkdir(parents=True, exist_ok=True)
    pdf_path = ddir / "source.pdf"
    pdf_path.write_bytes(data)

    # Import différé : Docling met du temps à charger
    from pipeline import convertir_pdf

    try:
        result = convertir_pdf(pdf_path, ddir)
    except Exception as e:
        # Nettoie le cache partiel pour autoriser une retry propre
        shutil.rmtree(ddir, ignore_errors=True)
        raise HTTPException(422, f"Echec extraction Docling : {type(e).__name__}: {e}")

    result["doc_id"] = doc_id

    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return JSONResponse(result)


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
