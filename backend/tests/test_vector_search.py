import pytest
import sqlite3
import array
from unittest.mock import patch, MagicMock
from pathlib import Path

import vector_search
import search

def test_serialization():
    vector = [0.1, -0.2, 0.35, 1.25, 0.0]
    blob = vector_search.serialize_vector(vector)
    assert isinstance(blob, bytes)
    
    # 4 bytes per float (32-bit single precision floats)
    assert len(blob) == len(vector) * 4
    
    deserialized = vector_search.deserialize_vector(blob)
    assert len(deserialized) == len(vector)
    # Check close float match
    for v, d in zip(vector, deserialized):
        assert abs(v - d) < 1e-6

def test_cosine_similarity():
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert abs(vector_search.cosine_similarity(v1, v2) - 1.0) < 1e-6
    
    v3 = [-1.0, 0.0, 0.0]
    assert abs(vector_search.cosine_similarity(v1, v3) - (-1.0)) < 1e-6
    
    v4 = [0.0, 1.0, 0.0]
    assert abs(vector_search.cosine_similarity(v1, v4) - 0.0) < 1e-6
    
    v5 = [1.0, 1.0, 0.0]
    # dot product = 1, magnitudes = 1 and sqrt(2). similarity = 1/sqrt(2) = 0.7071
    assert abs(vector_search.cosine_similarity(v1, v5) - 0.707106) < 1e-4

@patch("requests.post")
def test_get_embedding(mock_post):
    # Mock /api/embed response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"embeddings": [[0.1, 0.2, 0.3]]}
    mock_post.return_value = mock_response

    vector = vector_search.get_embedding("hello", preferred_model="mock-model")
    assert vector == [0.1, 0.2, 0.3]
    mock_post.assert_called_once()

@patch("vector_search.get_embedding")
def test_indexing_and_semantic_search(mock_get_embed):
    # Set up mocks for embeddings
    # Query: "beams" -> [0.8, 0.0, 0.0]
    # Page 1 text: -> [0.7, 0.1, 0.0]
    # Page 2 text: -> [0.0, 0.9, 0.0]
    def mock_embed_side_effect(text, preferred_model=None):
        if "beams" in text:
            return [1.0, 0.0, 0.0]
        elif "reinforced concrete" in text:
            return [0.9, 0.1, 0.0]
        elif "other topic" in text:
            return [0.0, 1.0, 0.0]
        return [0.5, 0.5, 0.0]
        
    mock_get_embed.side_effect = mock_embed_side_effect

    # Create dummy doc on FTS DB
    search.init_db()
    vector_search.init_vector_db()
    
    doc_id = "testvectors12345"
    
    # Write page text in FTS DB first
    with search.db_lock:
        with search.get_db_connection() as conn:
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.execute("DELETE FROM document_pages WHERE doc_id = ?", (doc_id,))
            conn.execute("DELETE FROM page_embeddings WHERE doc_id = ?", (doc_id,))
            
            conn.execute(
                "INSERT INTO documents (doc_id, title, filename, indexed_at) VALUES (?, ?, ?, ?)",
                (doc_id, "Test Vectors Doc", "vectors.pdf", 0.0)
            )
            conn.execute(
                "INSERT INTO document_pages (doc_id, page_number, text) VALUES (?, ?, ?)",
                (doc_id, 1, "reinforced concrete beams")
            )
            conn.execute(
                "INSERT INTO document_pages (doc_id, page_number, text) VALUES (?, ?, ?)",
                (doc_id, 2, "other topic and text")
            )
            conn.commit()
            
    try:
        # Index vectors
        vector_search.index_document_vectors(doc_id, model="mock-model")
        
        # Query semantically for "beams"
        results = vector_search.search_semantic("beams", preferred_model="mock-model")
        
        assert len(results) >= 1
        # Page 1 should be the top match because of "beams" vs "reinforced concrete beams" similarity
        assert results[0]["doc_id"] == doc_id
        assert results[0]["page_number"] == 1
        assert results[0]["score"] > 0.8
    finally:
        with search.db_lock:
            with search.get_db_connection() as conn:
                conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
                conn.execute("DELETE FROM document_pages WHERE doc_id = ?", (doc_id,))
                conn.execute("DELETE FROM page_embeddings WHERE doc_id = ?", (doc_id,))
                conn.commit()
