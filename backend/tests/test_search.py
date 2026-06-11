import json
import shutil
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

import main
import search

@pytest.fixture
def test_client():
    from main import app
    return TestClient(app)

@pytest.fixture
def mock_search_doc():
    doc_id = "testsearch123456"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    
    # 1. result.json
    result_data = {
        "doc_id": doc_id,
        "title": "Search Test Document",
        "filename": "search_test.pdf",
        "n_pages": 2,
    }
    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result_data, f)
        
    # 2. html_manifest.json
    manifest_data = [
        {"start": 1, "end": 1, "file": "html_part_0001.html"},
        {"start": 2, "end": 2, "file": "html_part_0002.html"}
    ]
    with open(ddir / "html_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest_data, f)
        
    # 3. html_part_0001.html
    (ddir / "html_part_0001.html").write_text(
        '<div class="docling-page" data-page-no="1">This page is about concrete beams and structures. Structural calculation is important.</div>',
        encoding="utf-8"
    )
    # 4. html_part_0002.html
    (ddir / "html_part_0002.html").write_text(
        '<div class="docling-page" data-page-no="2">We are talking about composite columns and reinforced steel.</div>',
        encoding="utf-8"
    )
    
    try:
        yield doc_id
    finally:
        shutil.rmtree(ddir, ignore_errors=True)

@pytest.fixture
def mock_generic_doc():
    doc_id = "genericsearch123"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    
    # 1. result.json
    result_data = {
        "doc_id": doc_id,
        "title": "Generic Search Document",
        "filename": "generic_search.docx",
        "n_pages": 1,
    }
    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result_data, f)
        
    # 2. result.md
    (ddir / "result.md").write_text("This is raw markdown containing timber beams design.", encoding="utf-8")
    
    try:
        yield doc_id
    finally:
        shutil.rmtree(ddir, ignore_errors=True)

def test_indexing_and_searching(mock_search_doc, mock_generic_doc):
    # Initialize DB
    search.init_db()
    
    # Index both
    search.index_document(mock_search_doc)
    search.index_document(mock_generic_doc)
    
    # Test search for "concrete"
    results = search.search_index("concrete")
    assert len(results) >= 1
    assert any(r["doc_id"] == mock_search_doc for r in results)
    concrete_hit = next(r for r in results if r["doc_id"] == mock_search_doc)
    assert concrete_hit["page_number"] == 1
    assert "concrete" in concrete_hit["snippet"].lower()
    
    # Test search for "steel"
    results = search.search_index("steel")
    assert len(results) >= 1
    steel_hit = next(r for r in results if r["doc_id"] == mock_search_doc)
    assert steel_hit["page_number"] == 2
    
    # Test search for "timber"
    results = search.search_index("timber")
    assert len(results) >= 1
    timber_hit = next(r for r in results if r["doc_id"] == mock_generic_doc)
    assert timber_hit["page_number"] == 1
    assert "timber" in timber_hit["snippet"].lower()

def test_search_api_endpoint(test_client, mock_search_doc):
    # Ensure indexed
    search.init_db()
    search.index_document(mock_search_doc)
    
    # Call GET /search
    response = test_client.get("/search?q=concrete")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    hit = data[0]
    assert hit["doc_id"] == mock_search_doc
    assert hit["page_number"] == 1
    assert "concrete" in hit["snippet"].lower()
    
    # Empty query
    response = test_client.get("/search?q=")
    assert response.status_code == 200
    assert response.json() == []

def test_remove_document(mock_search_doc):
    search.init_db()
    search.index_document(mock_search_doc)
    
    # Verify indexed
    results = search.search_index("concrete")
    assert len(results) >= 1
    
    # Remove
    search.remove_document(mock_search_doc)
    
    # Verify removed
    results = search.search_index("concrete")
    assert not any(r["doc_id"] == mock_search_doc for r in results)
