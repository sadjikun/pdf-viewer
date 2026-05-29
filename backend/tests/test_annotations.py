def test_get_annotations_empty(client, doc_id):
    res = client.get(f"/doc/{doc_id}/annotations")
    assert res.status_code == 200
    assert res.json() == {
        "version": 1,
        "highlights": [],
        "notes": {},
        "saved_at": 0,
    }


def test_put_then_get_roundtrip(client, doc_id):
    payload = {
        "version": 1,
        "highlights": [
            {"key": "rs_1_3::a1b2c3d4", "color": "yellow",
             "text": "coefficient partiel", "section": "rs_1_3",
             "sectionTitle": "1.3 Bases", "page": 12}
        ],
        "notes": {"rs_1_3::a1b2c3d4": "Revoir le coefficient partiel."},
    }
    put = client.put(f"/doc/{doc_id}/annotations", json=payload)
    assert put.status_code == 200
    got = client.get(f"/doc/{doc_id}/annotations").json()
    assert got["highlights"] == payload["highlights"]
    assert got["notes"] == payload["notes"]
    assert got["saved_at"] > 0


def test_put_drops_orphan_notes(client, doc_id):
    payload = {
        "highlights": [{"key": "k1", "color": "yellow", "text": "x"}],
        "notes": {"k1": "kept", "ghost": "dropped"},
    }
    client.put(f"/doc/{doc_id}/annotations", json=payload)
    got = client.get(f"/doc/{doc_id}/annotations").json()
    assert got["notes"] == {"k1": "kept"}


def test_put_bad_shape_422(client, doc_id):
    res = client.put(f"/doc/{doc_id}/annotations", json={"highlights": "nope"})
    assert res.status_code == 422


def test_get_unknown_doc_404(client):
    res = client.get("/doc/ffffffffffffffff/annotations")
    assert res.status_code == 404
