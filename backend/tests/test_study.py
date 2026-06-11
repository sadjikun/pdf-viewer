import json
import main

def test_get_study_empty(client, doc_id):
    res = client.get(f"/doc/{doc_id}/study")
    assert res.status_code == 200
    assert res.json() == {
        "subject": "",
        "tags": [],
        "folder": "",
        "status": "todo",
        "priority": "medium",
    }

def test_put_then_get_study_roundtrip(client, doc_id):
    payload = {
        "subject": "Mathématiques",
        "tags": ["Algèbre", "DM1"],
        "folder": "Cours/M1",
        "status": "in_progress",
        "priority": "high",
    }
    put = client.put(f"/doc/{doc_id}/study", json=payload)
    assert put.status_code == 200
    
    got = client.get(f"/doc/{doc_id}/study").json()
    assert got == payload

def test_put_study_validation_422(client, doc_id):
    # Invalid types
    res = client.put(f"/doc/{doc_id}/study", json={"subject": 123})
    assert res.status_code == 422
    
    # Invalid status
    res = client.put(f"/doc/{doc_id}/study", json={"status": "invalid_status"})
    assert res.status_code == 422
    
    # Invalid priority
    res = client.put(f"/doc/{doc_id}/study", json={"priority": "super_high"})
    assert res.status_code == 422

def test_library_merges_study_metadata(client, doc_id):
    payload = {
        "subject": "Physique",
        "tags": ["Mécanique"],
        "folder": "Cours/M2",
        "status": "done",
        "priority": "low",
    }
    client.put(f"/doc/{doc_id}/study", json=payload)
    
    res = client.get("/library")
    assert res.status_code == 200
    docs = res.json()["documents"]
    
    # Find our doc
    doc = next((d for d in docs if d["doc_id"] == doc_id), None)
    assert doc is not None
    assert doc["subject"] == "Physique"
    assert doc["tags"] == ["Mécanique"]
    assert doc["folder"] == "Cours/M2"
    assert doc["status"] == "done"
    assert doc["priority"] == "low"

def test_get_study_unknown_doc_404(client):
    res = client.get("/doc/ffffffffffffffff/study")
    assert res.status_code == 404

def test_study_and_annotations_preserved_on_reprocess(client, doc_id):
    ddir = main.CACHE_DIR / doc_id
    
    # Write source.pdf candidate so resolve_source is successful
    (ddir / "source.pdf").write_text("PDF content mock", encoding="utf-8")
    
    # Put study and annotations
    study_payload = {
        "subject": "Mathématiques",
        "tags": ["Algèbre"],
        "folder": "Cours/M1",
        "status": "in_progress",
        "priority": "high",
    }
    annotations_payload = {
        "version": 1,
        "highlights": [{"key": "hl1", "color": "yellow", "text": "high"}],
        "notes": {"hl1": "some note"},
    }
    client.put(f"/doc/{doc_id}/study", json=study_payload)
    client.put(f"/doc/{doc_id}/annotations", json=annotations_payload)
    
    # Verify files exist
    assert (ddir / "study.json").exists()
    assert (ddir / "annotations.json").exists()
    
    # Now simulate the unlinking portion of reprocess
    for p in list(ddir.iterdir()):
        if p.name in ("source.pdf", "annotations.json", "study.json") or p.name.startswith("source."):
            continue
        if p.is_dir():
            import shutil
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
            
    # Verify they are preserved
    assert (ddir / "study.json").exists()
    assert (ddir / "annotations.json").exists()
    
    # Check data is intact
    with open(ddir / "study.json", encoding="utf-8") as sf:
        assert json.load(sf) == study_payload
    with open(ddir / "annotations.json", encoding="utf-8") as af:
        got_ann = json.load(af)
        assert got_ann["highlights"] == annotations_payload["highlights"]
        assert got_ann["notes"] == annotations_payload["notes"]
