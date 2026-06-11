import json
import shutil
import time
from pathlib import Path
import pytest
import main

@pytest.fixture
def mock_doc():
    doc_id = "bbbbbbbbbbbbbbbb"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    
    # 1. result.json
    result_data = {
        "doc_id": doc_id,
        "title": "Test Smoke Document",
        "filename": "smoke_test.pdf",
        "pages": [{"number": 1, "width": 600, "height": 800}],
        "outline": [{"title": "Introduction", "page": 1, "level": 1}],
        "figures": [{"id": "f_0", "page": 1, "bbox": [10, 20, 100, 200]}],
        "tables": [{"id": "t_0", "page": 1, "html": "<table><tr><td>cell</td></tr></table>"}],
        "n_pages": 1,
        "n_figures": 1,
        "n_tables": 1,
    }
    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result_data, f)
        
    # 2. result.html
    (ddir / "result.html").write_text("<html><body>Mock HTML</body></html>", encoding="utf-8")
    
    # 3. result.md
    (ddir / "result.md").write_text("# Mock Markdown", encoding="utf-8")
    
    # 4. html_manifest.json
    manifest_data = [{"start": 1, "end": 1, "file": "html_part_0001.html"}]
    with open(ddir / "html_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest_data, f)
        
    # 5. html_part_0001.html
    (ddir / "html_part_0001.html").write_text("<p>Page 1 part</p>", encoding="utf-8")
    
    # 6. source.pdf
    (ddir / "source.pdf").write_text("Mock PDF source file data", encoding="utf-8")
    
    # 7. thumbnail.png
    (ddir / "thumbnail.png").write_bytes(b"mock thumbnail png data")
    
    # 8. figures/f_0.png
    (ddir / "figures").mkdir(exist_ok=True)
    (ddir / "figures" / "f_0.png").write_bytes(b"mock figure png data")
    
    # 9. study.json
    study_data = {
        "subject": "Chimie",
        "tags": ["Atomistique"],
        "folder": "Cours/M3",
        "status": "todo",
        "priority": "medium"
    }
    with open(ddir / "study.json", "w", encoding="utf-8") as f:
        json.dump(study_data, f)
        
    # 10. annotations.json
    annotations_data = {
        "version": 1,
        "highlights": [{"key": "k1", "color": "yellow", "text": "x", "section": "s", "sectionTitle": "S", "page": 1}],
        "notes": {"k1": "kept"},
        "saved_at": int(time.time() * 1000)
    }
    with open(ddir / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(annotations_data, f)

    try:
        yield doc_id
    finally:
        shutil.rmtree(ddir, ignore_errors=True)


def test_root_endpoint(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_library_endpoint(client, mock_doc):
    res = client.get("/library")
    assert res.status_code == 200
    data = res.json()
    assert "documents" in data
    assert any(d["doc_id"] == mock_doc for d in data["documents"])
    
    # Verify merged study metadata
    doc = next(d for d in data["documents"] if d["doc_id"] == mock_doc)
    assert doc["subject"] == "Chimie"
    assert doc["tags"] == ["Atomistique"]
    assert doc["folder"] == "Cours/M3"
    assert doc["status"] == "todo"
    assert doc["priority"] == "medium"


def test_preview_and_register_error_handling(client):
    # Preview missing path
    res = client.get("/register/preview?path=")
    assert res.status_code == 400
    
    # Preview non-existent path
    res = client.get("/register/preview?path=/nonexistent/path/here")
    assert res.status_code == 200
    assert res.json()["exists"] is False
    
    # Register empty path
    res = client.post("/register", json={"path": ""})
    assert res.status_code == 400


def test_doc_status_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/status")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_doc_outline_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/outline")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_doc_raw_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/raw")
    assert res.status_code == 200
    assert res.json()["doc_id"] == mock_doc


def test_doc_pdf_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/pdf")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"


def test_doc_thumbnail_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/thumbnail")
    assert res.status_code == 200
    assert "image" in res.headers["content-type"]


def test_doc_markdown_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/markdown")
    assert res.status_code == 200
    assert "markdown" in res.headers["content-type"]


def test_doc_html_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/html")
    assert res.status_code == 200
    assert "html" in res.headers["content-type"]


def test_doc_html_manifest_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/html-manifest")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_doc_html_part_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/html-part/1")
    assert res.status_code == 200
    assert "html" in res.headers["content-type"]


def test_doc_figure_endpoint(client, mock_doc):
    res = client.get(f"/doc/{mock_doc}/figure/f_0")
    assert res.status_code == 200
    assert "image" in res.headers["content-type"]


def test_doc_study_crud(client, mock_doc):
    # GET study
    res = client.get(f"/doc/{mock_doc}/study")
    assert res.status_code == 200
    assert res.json()["subject"] == "Chimie"
    
    # PUT study (valid)
    payload = {
        "subject": "Biologie",
        "tags": ["Génétique", "ADN"],
        "folder": "Cours/M4",
        "status": "in_progress",
        "priority": "high"
    }
    res = client.put(f"/doc/{mock_doc}/study", json=payload)
    assert res.status_code == 200
    
    # Verify GET updated
    res = client.get(f"/doc/{mock_doc}/study")
    assert res.json() == payload


def test_doc_annotations_crud(client, mock_doc):
    # GET annotations
    res = client.get(f"/doc/{mock_doc}/annotations")
    assert res.status_code == 200
    assert len(res.json()["highlights"]) == 1
    
    # PUT annotations
    payload = {
        "highlights": [
            {"key": "k2", "color": "green", "text": "y", "section": "s", "sectionTitle": "S", "page": 1}
        ],
        "notes": {"k2": "updated note"}
    }
    res = client.put(f"/doc/{mock_doc}/annotations", json=payload)
    assert res.status_code == 200
    
    # Verify GET updated
    res = client.get(f"/doc/{mock_doc}/annotations")
    data = res.json()
    assert data["highlights"] == payload["highlights"]
    assert data["notes"] == payload["notes"]


def test_doc_fiche_endpoint(client, mock_doc):
    # HTML format
    res = client.get(f"/doc/{mock_doc}/fiche?format=html")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    
    # Markdown format
    res = client.get(f"/doc/{mock_doc}/fiche?format=md")
    assert res.status_code == 200
    assert "markdown" in res.headers["content-type"]


def test_doc_delete_endpoint(client):
    doc_id = "cccccccccccccccc"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "result.json").write_text("{}", encoding="utf-8")
    
    res = client.delete(f"/doc/{doc_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "deleted"
    assert not ddir.exists()


def test_tesseract_status_endpoint(client):
    res = client.get("/tesseract/status")
    assert res.status_code == 200
    data = res.json()
    assert "available" in data
    assert "langs" in data


def test_cache_cleanup_endpoint(client):
    res = client.post("/cache/cleanup?max_age_days=10")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_doc_reprocess_endpoint(client, mock_doc):
    # Calling reprocess should fail with 500 or succeed and place task in BG.
    # Since our source.pdf is mock text, run_pipeline_bg will run and eventually fail.
    # But the endpoint itself should return 200 immediately indicating task is queued.
    res = client.post(f"/doc/{mock_doc}/reprocess")
    assert res.status_code == 200
    assert res.json()["status"] == "processing"


def test_clean_title_regression():
    assert main._clean_title("Microsoft Word - Doc1.pdf") == "Doc1.pdf"
    assert main._clean_title("Microsoft PowerPoint - Presentation.pptx") == "Presentation.pptx"
    assert main._clean_title("Microsoft Excel - Spreadsheet.xlsx") == "Spreadsheet.xlsx"
    assert main._clean_title("normal_title.pdf") == "normal_title.pdf"
    assert main._clean_title("") == ""
    assert main._clean_title(None) == ""
