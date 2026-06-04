"""Tests du référencement de PDF par chemin (bibliothèque)."""
from __future__ import annotations

import shutil
from pathlib import Path

import main


def _make_pdf(path: Path) -> None:
    """Crée un PDF 1 page minimal lisible par pypdfium2."""
    import pypdfium2 as pdfium
    src = pdfium.PdfDocument.new()
    src.new_page(595, 842)
    src.save(str(path))
    src.close()


def test_path_doc_id_is_valid_hex():
    did = main._path_doc_id(Path("/tmp/x/rapport.pdf"))
    assert main.DOC_ID_RE.fullmatch(did), "doc_id doit respecter ^[a-f0-9]{16}$"


def test_path_doc_id_stable_and_distinct():
    a = main._path_doc_id(Path("/tmp/a.pdf"))
    a2 = main._path_doc_id(Path("/tmp/a.pdf"))
    b = main._path_doc_id(Path("/tmp/b.pdf"))
    assert a == a2 and a != b


def test_register_file(client, tmp_path):
    pdf = tmp_path / "doc.pdf"
    _make_pdf(pdf)
    r = client.post("/register", json={"path": str(pdf)}).json()
    assert len(r["registered"]) == 1 and not r["errors"]
    doc_id = r["registered"][0]
    try:
        # mode registered, source non copiée
        raw = client.get(f"/doc/{doc_id}/raw").json()
        assert raw["extraction_mode"] == "registered"
        assert raw["source_path"] == str(pdf.resolve())
        assert not (main.CACHE_DIR / doc_id / "source.pdf").exists()
        # /pdf sert depuis source_path
        assert client.get(f"/doc/{doc_id}/pdf").status_code == 200
        # re-register → skipped
        r2 = client.post("/register", json={"path": str(pdf)}).json()
        assert len(r2["skipped"]) == 1
    finally:
        shutil.rmtree(main.CACHE_DIR / doc_id, ignore_errors=True)


def test_register_folder(client, tmp_path):
    for name in ("a.pdf", "b.pdf"):
        _make_pdf(tmp_path / name)
    (tmp_path / "note.txt").write_text("x")
    r = client.post("/register", json={"path": str(tmp_path)}).json()
    try:
        assert len(r["registered"]) == 2  # le .txt est ignoré
    finally:
        for did in r["registered"]:
            shutil.rmtree(main.CACHE_DIR / did, ignore_errors=True)


def test_register_missing_path(client):
    r = client.post("/register", json={"path": "/no/such/path/x.pdf"}).json()
    assert r["errors"] and r["errors"][0]["reason"] == "not_found"


def test_register_empty_path_400(client):
    assert client.post("/register", json={"path": ""}).status_code == 400


def test_register_non_pdf_file(client, tmp_path):
    f = tmp_path / "doc.txt"
    f.write_text("x")
    r = client.post("/register", json={"path": str(f)}).json()
    assert r["errors"] and r["errors"][0]["reason"] == "invalid_extension"


def test_preview_file_and_folder(client, tmp_path):
    _make_pdf(tmp_path / "a.pdf")
    pv_file = client.get(f"/register/preview?path={tmp_path / 'a.pdf'}").json()
    assert pv_file["pdf_count"] == 1 and pv_file["exists"]
    pv_dir = client.get(f"/register/preview?path={tmp_path}").json()
    assert pv_dir["pdf_count"] == 1
    pv_none = client.get("/register/preview?path=/no/such/dir").json()
    assert pv_none["exists"] is False
