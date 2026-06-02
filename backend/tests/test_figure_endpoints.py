"""Regression tests for the figure-processing POST endpoints.

`/doc/{doc_id}/latex-ocr` and `/doc/{doc_id}/caption-figures` previously guarded
the id with an undefined `_valid_doc_id(doc_id)`, which raised NameError on every
call. They must validate via `_doc_dir()` like the neighbouring routes:
a malformed id -> 400, a well-formed but unknown id -> 404.
"""
import pytest

ENDPOINTS = ["latex-ocr", "caption-figures"]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_figure_endpoint_rejects_malformed_doc_id(client, endpoint):
    res = client.post(f"/doc/invalid\\path/{endpoint}")
    assert res.status_code == 400


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_figure_endpoint_unknown_doc_returns_404(client, endpoint):
    # 16 hex chars -> passes _DOC_ID_RE, but no such doc is cached.
    res = client.post(f"/doc/ffffffffffffffff/{endpoint}")
    assert res.status_code == 404
