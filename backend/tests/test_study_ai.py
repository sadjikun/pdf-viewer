import json
import pytest
import shutil
from fastapi.testclient import TestClient

import main
import search
import study_ai

@pytest.fixture
def test_client():
    from main import app
    return TestClient(app)

@pytest.fixture
def mock_study_doc():
    doc_id = "1234567890abcdef"
    ddir = main.CACHE_DIR / doc_id
    ddir.mkdir(parents=True, exist_ok=True)
    
    # 1. result.json
    result_data = {
        "doc_id": doc_id,
        "title": "Study Test Document",
        "filename": "study_test.pdf",
        "n_pages": 1,
    }
    with open(ddir / "result.json", "w", encoding="utf-8") as f:
        json.dump(result_data, f)
        
    try:
        doc_id_val = doc_id
        yield doc_id_val
    finally:
        shutil.rmtree(ddir, ignore_errors=True)

class MockResponse:
    def __init__(self, json_data, status_code):
        self.json_data = json_data
        self.status_code = status_code
        self.text = json.dumps(json_data)

    def json(self):
        return self.json_data

def test_generate_ai_study_sheet_no_annotations(mock_study_doc):
    # Missing annotations.json
    with pytest.raises(ValueError, match="Aucun surlignage disponible"):
        study_ai.generate_ai_study_sheet(mock_study_doc)

def test_generate_ai_study_sheet_empty_highlights(mock_study_doc):
    ddir = main.CACHE_DIR / mock_study_doc
    with open(ddir / "annotations.json", "w", encoding="utf-8") as f:
        json.dump({"highlights": [], "notes": {}}, f)
        
    with pytest.raises(ValueError, match="Aucun surlignage disponible"):
        study_ai.generate_ai_study_sheet(mock_study_doc)

def test_generate_ai_study_sheet_success(mock_study_doc, monkeypatch):
    ddir = main.CACHE_DIR / mock_study_doc
    annotations = {
        "highlights": [
            {
                "key": "h1",
                "color": "yellow",
                "text": "Le béton armé résiste très bien à la compression.",
                "sectionTitle": "Introduction",
                "page": 1
            }
        ],
        "notes": {"h1": "Note importante"}
    }
    with open(ddir / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(annotations, f)

    # Mock Ollama POST request (use **kwargs to avoid shadowing global json module)
    def mock_post(url, **kwargs):
        payload = kwargs.get("json", {})
        assert payload["format"] == "json"
        assert "Le béton armé" in payload["prompt"]
        
        response_json = {
            "summary": "Résumé en Markdown du béton armé.",
            "flashcards": [
                {
                    "question": "A quoi résiste le béton armé ?",
                    "answer": "A la compression."
                }
            ]
        }
        return MockResponse({
            "response": json.dumps(response_json)
        }, 200)
        
    monkeypatch.setattr(study_ai.requests, "post", mock_post)

    # Generate
    res = study_ai.generate_ai_study_sheet(mock_study_doc)
    assert res["summary"] == "Résumé en Markdown du béton armé."
    assert len(res["flashcards"]) == 1
    assert res["flashcards"][0]["question"] == "A quoi résiste le béton armé ?"

    # Verify cached on disk
    cached_path = ddir / "fiche_ai.json"
    assert cached_path.exists()
    cached_data = json.loads(cached_path.read_text(encoding="utf-8"))
    assert cached_data == res

def test_generate_ai_study_sheet_robust_json(mock_study_doc, monkeypatch):
    ddir = main.CACHE_DIR / mock_study_doc
    annotations = {
        "highlights": [
            {"key": "h1", "color": "yellow", "text": "Le béton armé résiste très bien.", "sectionTitle": "Intro", "page": 1}
        ],
        "notes": {}
    }
    with open(ddir / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(annotations, f)

    # Mock Ollama POST returning JSON wrapped in markdown code blocks
    def mock_post(url, **kwargs):
        response_json = {
            "summary": "Résumé robuste.",
            "flashcards": [{"question": "Q ?", "answer": "A."}]
        }
        wrapped_response = f"Sure, here is the result:\n```json\n{json.dumps(response_json)}\n```\nHope it helps!"
        return MockResponse({
            "response": wrapped_response
        }, 200)
        
    monkeypatch.setattr(study_ai.requests, "post", mock_post)

    res = study_ai.generate_ai_study_sheet(mock_study_doc)
    assert res["summary"] == "Résumé robuste."
    assert len(res["flashcards"]) == 1

def test_study_ai_endpoints(test_client, mock_study_doc, monkeypatch):
    # 1. GET /doc/{doc_id}/fiche-ai when not generated yet
    res = test_client.get(f"/doc/{mock_study_doc}/fiche-ai")
    assert res.status_code == 200
    assert res.json() == {"status": "not_generated"}

    # 2. Write annotations
    ddir = main.CACHE_DIR / mock_study_doc
    annotations = {
        "highlights": [
            {"key": "h1", "color": "yellow", "text": "Passage surligné", "sectionTitle": "Sec", "page": 1}
        ],
        "notes": {}
    }
    with open(ddir / "annotations.json", "w", encoding="utf-8") as f:
        json.dump(annotations, f)

    # Mock Ollama post request
    def mock_post(url, **kwargs):
        response_json = {
            "summary": "Résumé de test.",
            "flashcards": [{"question": "Q ?", "answer": "A."}]
        }
        return MockResponse({"response": json.dumps(response_json)}, 200)
    
    monkeypatch.setattr(study_ai.requests, "post", mock_post)

    # 3. POST /doc/{doc_id}/fiche-ai to generate
    res = test_client.post(f"/doc/{mock_study_doc}/fiche-ai", json={"model": "qwen3.5:9b"})
    assert res.status_code == 200
    data = res.json()
    assert data["summary"] == "Résumé de test."
    assert len(data["flashcards"]) == 1

    # 4. GET /doc/{doc_id}/fiche-ai again to verify cached load
    res = test_client.get(f"/doc/{mock_study_doc}/fiche-ai")
    assert res.status_code == 200
    assert res.json()["summary"] == "Résumé de test."
