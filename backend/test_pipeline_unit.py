"""Unit tests for backend/pipeline.py — functions that don't require a PDF file.

Run with:
    cd backend && .venv\\Scripts\\activate
    pytest test_pipeline_unit.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import pipeline


# ── Module-level attributes ────────────────────────────────────────────────────

def test_pipeline_has_required_attrs():
    assert hasattr(pipeline, "convertir_pdf")
    assert hasattr(pipeline, "PIPELINE_VERSION")
    assert hasattr(pipeline, "DOCLING_WORKERS")
    assert pipeline.DOCLING_WORKERS >= 1


def test_module_level_patterns():
    import re
    assert isinstance(pipeline._RE_FIG_FIGURE, type(re.compile("")))
    assert isinstance(pipeline._RE_FIG_B64,    type(re.compile("")))
    assert isinstance(pipeline._RE_LATEX_START, type(re.compile("")))
    assert isinstance(pipeline._RE_COMBINED,    type(re.compile("")))


# ── _est_titre_section ─────────────────────────────────────────────────────────

def test_est_titre_section_numbered():
    ok, level = pipeline._est_titre_section("1.1 Introduction")
    assert ok and level == 2


def test_est_titre_section_top_chapter():
    ok, level = pipeline._est_titre_section("1. Introduction")
    assert ok and level == 1


def test_est_titre_section_not_heading():
    ok, _ = pipeline._est_titre_section("This is a regular paragraph.")
    assert not ok


def test_est_titre_section_deep():
    # Text after number must be ≥10 chars — "Details" is too short
    ok, level = pipeline._est_titre_section("2.3.4 Implementation Details")
    assert ok and level == 3


# ── _apply_combined_passes (Piste D) ──────────────────────────────────────────

def test_combined_passes_dblspace():
    result = pipeline._apply_combined_passes("Hello  world")
    assert "  " not in result
    assert "Hello world" in result


def test_combined_passes_pgnum_removed():
    result = pipeline._apply_combined_passes("<p>1-3</p>")
    assert result.strip() == ""


def test_combined_passes_pgnum_with_spans():
    result = pipeline._apply_combined_passes("<p><span>2-5</span></p>")
    assert result.strip() == ""


def test_combined_passes_short_italic_removed():
    result = pipeline._apply_combined_passes("<p><em>Short header text</em></p>")
    assert result.strip() == ""


def test_combined_passes_long_italic_kept():
    long_text = " ".join(["word"] * 15)
    html = f"<p><em>{long_text}</em></p>"
    result = pipeline._apply_combined_passes(html)
    assert result.strip() != ""


def test_combined_passes_preserves_normal_content():
    html = "<p>Normal paragraph content here.</p>"
    result = pipeline._apply_combined_passes(html)
    assert result == html


# ── _apply_combined_passes : formula-not-decoded ──────────────────────────────

def test_combined_passes_formula_decoded():
    html = '<div class="formula-not-decoded">$$x^2 + y^2 = r^2$$</div>'
    result = pipeline._apply_combined_passes(html)
    assert "formula-not-decoded" not in result
    assert 'class="formula"' in result


def test_combined_passes_formula_not_latex_kept():
    html = '<div class="formula-not-decoded">formula not decoded</div>'
    result = pipeline._apply_combined_passes(html)
    assert "formula-not-decoded" in result


# ── PIPELINE_VERSION format ────────────────────────────────────────────────────

def test_pipeline_version_format():
    v = pipeline.PIPELINE_VERSION
    assert isinstance(v, str)
    parts = v.split("-")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)


# ── Fallback tests ─────────────────────────────────────────────────────────────

def test_convertir_pdf_fallback_on_docling_error(tmp_path):
    from unittest.mock import patch, MagicMock
    import pipeline
    
    mock_pdf = tmp_path / "mock.pdf"
    mock_pdf.write_bytes(b"%PDF-1.4\n%mock pdf content\n%%EOF")
    
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    
    with patch("pipeline._converter") as mock_converter_func, \
         patch("pypdfium2.PdfDocument") as mock_pdf_doc_cls, \
         patch("markitdown.MarkItDown") as mock_mid_cls:
        
        # Setup mock_converter_func to throw error
        mock_converter = MagicMock()
        mock_converter.convert.side_effect = Exception("Simulated Docling failure")
        mock_converter_func.return_value = mock_converter
        
        # Setup mock pypdfium2 to simulate 1 page of native text
        mock_doc = MagicMock()
        mock_doc.__len__.return_value = 1
        mock_page = MagicMock()
        mock_page.get_size.return_value = (595, 842)
        mock_textpage = MagicMock()
        mock_textpage.get_text_range.return_value = "This is some mock native text in the PDF.\n1.1 Section One\nMore details."
        mock_page.get_textpage.return_value = mock_textpage
        mock_doc.__getitem__.return_value = mock_page
        mock_doc.get_toc.return_value = []
        mock_pdf_doc_cls.return_value = mock_doc
        
        # Setup MarkItDown mock
        mock_mid = MagicMock()
        mock_mid_result = MagicMock()
        mock_mid_result.text_content = "Converted Markdown content from MarkItDown.\n# 1. Title\nSome details."
        mock_mid.convert.return_value = mock_mid_result
        mock_mid_cls.return_value = mock_mid
        
        # Call convertir_pdf
        result = pipeline.convertir_pdf(mock_pdf, out_dir)
        
        # Verify the fallback worked
        assert result["extraction_mode"] == "markitdown_fallback"
        assert (out_dir / "result.md").exists()
        assert (out_dir / "result.html").exists()
        assert (out_dir / "html_manifest.json").exists()


def test_convertir_pdf_fast_mode(tmp_path):
    from unittest.mock import patch, MagicMock
    import pipeline
    
    mock_pdf = tmp_path / "mock_fast.pdf"
    mock_pdf.write_bytes(b"%PDF-1.4\n%mock pdf content\n%%EOF")
    
    out_dir = tmp_path / "out_fast"
    out_dir.mkdir()
    
    with patch("pypdfium2.PdfDocument") as mock_pdf_doc_cls:
        # Setup mock pypdfium2 to simulate 2 pages of native text
        mock_doc = MagicMock()
        mock_doc.__len__.return_value = 2
        
        mock_page1 = MagicMock()
        mock_page1.get_size.return_value = (595, 842)
        mock_textpage1 = MagicMock()
        mock_textpage1.get_text_range.return_value = "Page 1 content\n1.1 Intro\nWelcome."
        mock_page1.get_textpage.return_value = mock_textpage1
        
        mock_page2 = MagicMock()
        mock_page2.get_size.return_value = (595, 842)
        mock_textpage2 = MagicMock()
        mock_textpage2.get_text_range.return_value = "Page 2 content\n1.2 Summary\nDone."
        mock_page2.get_textpage.return_value = mock_textpage2
        
        mock_doc.__getitem__.side_effect = lambda idx: mock_page1 if idx == 0 else mock_page2
        mock_doc.get_toc.return_value = []
        mock_pdf_doc_cls.return_value = mock_doc
        
        # Call convertir_pdf with fast_mode=True
        result = pipeline.convertir_pdf(mock_pdf, out_dir, fast_mode=True)
        
        # Verify fast mode results
        assert result["extraction_mode"] == "fast"
        assert len(result["figures"]) == 0
        assert len(result["tables"]) == 0
        assert result["n_pages"] == 2
        assert (out_dir / "result.md").exists()
        assert (out_dir / "result.html").exists()
        assert (out_dir / "html_part_0001.html").exists()
        assert (out_dir / "html_manifest.json").exists()
        
        html_content = (out_dir / "result.html").read_text(encoding="utf-8")
        assert "pdf-page-sep" in html_content
        assert "docling-page" in html_content

