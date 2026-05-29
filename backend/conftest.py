from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make `import main` work no matter where pytest is invoked from.
sys.path.insert(0, os.path.dirname(__file__))

import main  # noqa: E402

TEST_DOC_ID = "aaaaaaaaaaaaaaaa"  # 16 hex chars — passes _DOC_ID_RE


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def doc_id():
    """Create a minimal cached doc, yield its id, clean up afterwards."""
    ddir = main.CACHE_DIR / TEST_DOC_ID
    ddir.mkdir(parents=True, exist_ok=True)
    result = {
        "doc_id": TEST_DOC_ID,
        "title": "Eurocode Test",
        "filename": "eurocode-test.pdf",
        "num_pages": 3,
    }
    (ddir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    try:
        yield TEST_DOC_ID
    finally:
        import shutil
        shutil.rmtree(ddir, ignore_errors=True)
