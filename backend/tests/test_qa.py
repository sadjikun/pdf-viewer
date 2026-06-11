import json
import pytest
from fastapi.testclient import TestClient

import main
import search
import qa

@pytest.fixture
def test_client():
    from main import app
    return TestClient(app)

@pytest.fixture
def mock_qa_doc():
    import shutil
    doc_id = "qadoc12345678901"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    
    # 1. result.json
    result_data = {
        "doc_id": doc_id,
        "title": "QA Test Document",
        "pdf_title": "QA Test Document",
        "filename": "qa_test.pdf",
        "n_pages": 1,
    }
    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result_data, f)
        
    # 2. html_manifest.json
    manifest_data = [{"start": 1, "end": 1, "file": "html_part_0001.html"}]
    with open(ddir / "html_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest_data, f)
        
    # 3. html_part_0001.html
    (ddir / "html_part_0001.html").write_text(
        '<div class="docling-page" data-page-no="1">The yield strength of high-strength structural steel is 460 MPa.</div>',
        encoding="utf-8"
    )
    
    try:
        yield doc_id
    finally:
        shutil.rmtree(ddir, ignore_errors=True)

class MockResponse:
    def __init__(self, json_data, status_code):
        self.json_data = json_data
        self.status_code = status_code
        self.text = json.dumps(json_data)

    def json(self):
        return self.json_data

def test_check_ollama_status_success(monkeypatch):
    def mock_get(url, **kwargs):
        return MockResponse({
            "models": [
                {"name": "qwen3.5:9b", "size": 6594474711},
                {"name": "llama3.2:1b", "size": 1200000000}
            ]
        }, 200)
    monkeypatch.setattr(qa.requests, "get", mock_get)

    status = qa.check_ollama_status()
    assert status["available"] is True
    assert len(status["models"]) == 2
    assert status["models"][0]["name"] == "qwen3.5:9b"

def test_check_ollama_status_failure(monkeypatch):
    def mock_get(url, **kwargs):
        raise Exception("Connection refused")
    monkeypatch.setattr(qa.requests, "get", mock_get)

    status = qa.check_ollama_status()
    assert status["available"] is False
    assert status["models"] == []

def test_query_rag_with_ollama(mock_qa_doc, monkeypatch):
    # Index document
    search.init_db()
    search.index_document(mock_qa_doc)

    # Mock Ollama post request
    def mock_post(url, json, **kwargs):
        prompt = json["prompt"]
        # Verify prompt has our retrieved page context and user query
        assert "yield strength" in prompt
        assert "460 MPa" in prompt
        assert "QA Test Document" in prompt
        assert "page: 1" in prompt.lower()
        
        return MockResponse({
            "response": "La limite d'élasticité de l'acier de structure à haute résistance est de 460 MPa [QA Test Document, page 1]."
        }, 200)
    
    monkeypatch.setattr(qa.requests, "post", mock_post)

    # Call RAG query
    res = qa.query_rag("yield strength steel", doc_id=mock_qa_doc)
    assert "460 MPa" in res["answer"]
    assert len(res["sources"]) == 1
    assert res["sources"][0]["doc_id"] == mock_qa_doc
    assert res["sources"][0]["page_number"] == 1

def test_endpoints_qa_and_status(test_client, mock_qa_doc, monkeypatch):
    # Index document
    search.init_db()
    search.index_document(mock_qa_doc)

    # Mock Ollama status (GET /ollama/status)
    def mock_get(url, **kwargs):
        return MockResponse({"models": [{"name": "qwen3.5:9b", "size": 6594474711}]}, 200)
    monkeypatch.setattr(qa.requests, "get", mock_get)

    res = test_client.get("/ollama/status")
    assert res.status_code == 200
    assert res.json()["available"] is True

    # Mock Ollama generate (POST /qa)
    def mock_post(url, json, **kwargs):
        return MockResponse({"response": "Acier 460 MPa [QA Test Document, page 1]."}, 200)
    monkeypatch.setattr(qa.requests, "post", mock_post)

    payload = {
        "query": "yield strength",
        "doc_id": mock_qa_doc,
        "model": "qwen3.5:9b"
    }
    res = test_client.post("/qa", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "460 MPa" in data["answer"]
    assert len(data["sources"]) == 1
