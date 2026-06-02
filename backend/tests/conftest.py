from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402

TEST_DOC_ID = "aaaaaaaaaaaaaaaa"


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def doc_id():
    """Crée un doc minimal en cache, yield son id, nettoie après."""
    ddir = main.CACHE_DIR / TEST_DOC_ID
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "figures").mkdir(exist_ok=True)
    result = {
        "doc_id": TEST_DOC_ID,
        "title": "Test Document",
        "filename": "test.pdf",
        "pages": [],
        "outline": [],
        "figures": [],
        "tables": [],
        "n_pages": 3,
        "n_figures": 0,
        "n_tables": 0,
    }
    (ddir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    try:
        yield TEST_DOC_ID
    finally:
        shutil.rmtree(ddir, ignore_errors=True)
