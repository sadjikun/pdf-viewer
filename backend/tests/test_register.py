import pytest
from unittest.mock import MagicMock, patch
import json
import shutil
from pathlib import Path
import main

@pytest.fixture
def mock_pdfium():
    # Setup mock PdfDocument and pages
    mock_doc = MagicMock()
    mock_doc.__len__.return_value = 2
    mock_doc.get_metadata_value.return_value = "Mock PDF Title"
    
    mock_page = MagicMock()
    mock_page.get_size.return_value = (595.0, 842.0)
    
    mock_bitmap = MagicMock()
    mock_pil = MagicMock()
    def mock_save(path, *args, **kwargs):
        Path(path).write_bytes(b"mock png data")
    mock_pil.save.side_effect = mock_save
    mock_bitmap.to_pil.return_value = mock_pil
    mock_page.render.return_value = mock_bitmap
    
    mock_doc.__getitem__.return_value = mock_page
    
    with patch("pypdfium2.PdfDocument", return_value=mock_doc) as p_mock:
        yield p_mock

def test_register_single_file(client, tmp_path, mock_pdfium):
    dummy_pdf = tmp_path / "test_doc.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4 mock content")

    res = client.post("/register", json={"path": str(dummy_pdf)})
    assert res.status_code == 200
    data = res.json()
    
    assert "test_doc" in data["registered"]
    assert len(data["skipped"]) == 0
    assert len(data["errors"]) == 0

    doc_id = data["registered"][0]
    ddir = main.CACHE_DIR / doc_id
    try:
        assert ddir.exists()
        assert (ddir / "result.json").exists()
        assert (ddir / "thumbnail.png").exists()

        # Check result json
        with open(ddir / "result.json", encoding="utf-8") as f:
            result = json.load(f)
        assert result["doc_id"] == doc_id
        assert result["filename"] == "test_doc.pdf"
        assert result["source_path"] == str(dummy_pdf.resolve())
        assert result["extraction_mode"] == "registered"
        assert result["n_pages"] == 2
        assert result["pdf_title"] == "Mock PDF Title"
        assert len(result["pages"]) == 2
        assert result["pages"][0]["width"] == 595.0
    finally:
        shutil.rmtree(ddir, ignore_errors=True)

def test_register_directory(client, tmp_path, mock_pdfium):
    dir_path = tmp_path / "docs"
    dir_path.mkdir()
    pdf1 = dir_path / "doc1.pdf"
    pdf2 = dir_path / "doc2.pdf"
    pdf1.write_bytes(b"%PDF-1.4 mock 1")
    pdf2.write_bytes(b"%PDF-1.4 mock 2")
    # A non-pdf file that should be ignored
    txt = dir_path / "readme.txt"
    txt.write_text("hello")

    res = client.post("/register", json={"path": str(dir_path)})
    assert res.status_code == 200
    data = res.json()

    assert "doc1" in data["registered"]
    assert "doc2" in data["registered"]
    assert len(data["registered"]) == 2
    assert len(data["errors"]) == 0

    for doc_id in data["registered"]:
        shutil.rmtree(main.CACHE_DIR / doc_id, ignore_errors=True)

def test_register_preview(client, tmp_path):
    # Preview file
    pdf_file = tmp_path / "doc.pdf"
    pdf_file.write_bytes(b"%PDF-1.4")
    res = client.get(f"/register/preview?path={pdf_file}")
    assert res.status_code == 200
    assert res.json() == {"pdf_count": 1, "pdfs": ["doc.pdf"]}

    # Preview folder
    folder = tmp_path / "folder"
    folder.mkdir()
    (folder / "file1.pdf").write_bytes(b"%PDF-1.4")
    (folder / "file2.pdf").write_bytes(b"%PDF-1.4")
    (folder / "readme.md").write_text("hello")
    res = client.get(f"/register/preview?path={folder}")
    assert res.status_code == 200
    assert res.json()["pdf_count"] == 2
    assert set(res.json()["pdfs"]) == {"file1.pdf", "file2.pdf"}

def test_process_registered_doc(client, tmp_path, mock_pdfium):
    dummy_pdf = tmp_path / "process_test.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4 process")

    # Register first
    res = client.post("/register", json={"path": str(dummy_pdf)})
    doc_id = res.json()["registered"][0]
    ddir = main.CACHE_DIR / doc_id

    try:
        # Patch the background task runner
        with patch("main.run_pipeline_bg") as mock_bg:
            process_res = client.post(f"/doc/{doc_id}/process")
            assert process_res.status_code == 200
            assert process_res.json()["status"] == "processing"
            
            # Check source file was copied locally
            local_source = ddir / "source.pdf"
            assert local_source.exists()
            assert local_source.stat().st_size == dummy_pdf.stat().st_size

            # Check background task was triggered
            mock_bg.assert_called_once()
            args = mock_bg.call_args[0]
            assert args[0] == doc_id
            assert args[1] == local_source
            assert args[2] == ddir
    finally:
        shutil.rmtree(ddir, ignore_errors=True)
