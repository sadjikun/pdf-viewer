"""Tests pipeline.py — snapshots de référence sur PDFs samples.

Les assertions vérifient la stabilité des résultats après refactoring.
Si Docling change de version ou de comportement, adapter les valeurs attendues.
"""
import tempfile
from pathlib import Path

import pytest

SAMPLES = Path(__file__).resolve().parent.parent.parent / "samples"
ARXIV_PDF = SAMPLES / "2510.04871v1.pdf"
HSE_PDF = SAMPLES / "DA_0003_HSE_REV.pdf"

pytestmark = pytest.mark.skipif(
    not ARXIV_PDF.exists(), reason="samples/2510.04871v1.pdf absent"
)


# ── Helpers unitaires (pas de Docling, instantanés) ──────────────────────


class TestLevelDepuisTitre:
    def setup_method(self):
        from pipeline import _level_depuis_titre
        self.fn = _level_depuis_titre

    def test_simple_number(self):
        assert self.fn("1. Introduction") == 1

    def test_two_levels(self):
        assert self.fn("2.1. Background") == 2

    def test_three_levels(self):
        assert self.fn("2.1.3 Details") == 3

    def test_no_number(self):
        assert self.fn("Abstract") is None

    def test_appendix(self):
        assert self.fn("A.1 Setup") is None

    def test_chapter(self):
        assert self.fn("Chapter 3") == 1

    def test_chapter_case_insensitive(self):
        assert self.fn("CHAPTER 12 Results") == 1


class TestEstFauxPositif:
    def setup_method(self):
        from pipeline import _est_faux_positif
        self.fn = _est_faux_positif

    def test_too_short(self):
        assert self.fn("AB", set()) is True

    def test_too_long(self):
        assert self.fn("x" * 121, set()) is True

    def test_valid(self):
        assert self.fn("Introduction", set()) is False

    def test_duplicate(self):
        seen = set()
        assert self.fn("Summary", seen) is False
        assert self.fn("Summary", seen) is True

    def test_duplicate_case_insensitive(self):
        seen = set()
        assert self.fn("References", seen) is False
        assert self.fn("references", seen) is True

    def test_duplicate_same_title_different_page_allowed(self):
        seen = set()
        assert self.fn("Introduction", seen, page=1, bbox=[1, 2, 3, 4]) is False
        assert self.fn("Introduction", seen, page=2, bbox=[1, 2, 3, 4]) is False

    def test_single_char(self):
        assert self.fn("A", set()) is True


class TestCountPages:
    def test_arxiv(self):
        from pipeline import _count_pages
        assert _count_pages(ARXIV_PDF) == 12

    def test_hse(self):
        from pipeline import _count_pages
        if not HSE_PDF.exists():
            pytest.skip("HSE PDF absent")
        assert _count_pages(HSE_PDF) == 1


class TestIsNativePdf:
    def test_arxiv_is_native(self):
        from pipeline import _is_native_pdf
        assert _is_native_pdf(ARXIV_PDF) is True

    def test_hse_is_native(self):
        from pipeline import _is_native_pdf
        if not HSE_PDF.exists():
            pytest.skip("HSE PDF absent")
        assert _is_native_pdf(HSE_PDF) is True


class TestNeedsOcr:
    def setup_method(self):
        from pipeline import _needs_ocr_from_lengths
        self.fn = _needs_ocr_from_lengths

    def test_all_native_pages_skip_ocr(self):
        assert self.fn([120, 300, 80]) is False

    def test_all_scanned_pages_need_ocr(self):
        assert self.fn([0, 3, 10]) is True

    def test_mixed_pages_need_ocr(self):
        assert self.fn([180, 0, 220]) is True


class TestExtractPagesPdf:
    def test_extract_subset(self):
        from pipeline import _extract_pages_pdf, _count_pages
        tmp = Path(tempfile.mktemp(suffix=".pdf"))
        try:
            _extract_pages_pdf(ARXIV_PDF, 1, 5, tmp)
            assert tmp.exists()
            assert _count_pages(tmp) == 5
        finally:
            tmp.unlink(missing_ok=True)


# ── Snapshots end-to-end (chargent Docling, ~15-20s chacun) ─────────────


class TestConvertirArxiv:
    """Snapshot du paper arxiv 2510.04871v1.pdf (12 pages, natif)."""

    @pytest.fixture(autouse=True, scope="class")
    def result(self, tmp_path_factory):
        from pipeline import convertir_pdf
        out = tmp_path_factory.mktemp("arxiv")
        r = convertir_pdf(ARXIV_PDF, out)
        type(self)._result = r
        type(self)._out = out

    @property
    def r(self):
        return type(self)._result

    @property
    def out(self):
        return type(self)._out

    def test_n_pages(self):
        assert self.r["n_pages"] == 12

    def test_n_figures(self):
        assert self.r["n_figures"] == 2

    def test_outline_root_count(self):
        assert len(self.r["outline"]) == 15

    def test_outline_total(self):
        def flat(nodes):
            count = 0
            for n in nodes:
                count += 1
                count += flat(n.get("children", []))
            return count
        assert flat(self.r["outline"]) == 33

    def test_first_title(self):
        assert self.r["outline"][0]["title"] == "Less is More: Recursive Reasoning with Tiny Networks"

    def test_pages_range(self):
        pages = self.r["pages"]
        assert pages[0]["number"] == 1
        assert pages[-1]["number"] == 12

    def test_pages_have_dimensions(self):
        for p in self.r["pages"]:
            assert p["width"] is not None and p["width"] > 0
            assert p["height"] is not None and p["height"] > 0

    def test_figures_have_page(self):
        for f in self.r["figures"]:
            assert f["page"] is not None
            assert 1 <= f["page"] <= 12

    def test_figures_have_bbox(self):
        for f in self.r["figures"]:
            assert f["bbox"] is not None
            assert len(f["bbox"]) == 4

    def test_markdown_generated(self):
        assert (self.out / "result.md").exists()
        md = (self.out / "result.md").read_text(encoding="utf-8")
        assert len(md) > 100

    def test_figure_pngs_saved(self):
        figs_dir = self.out / "figures"
        assert figs_dir.exists()
        pngs = list(figs_dir.glob("*.png"))
        assert len(pngs) == 2

    def test_n_tables(self):
        assert self.r["n_tables"] == 5

    def test_tables_have_html(self):
        for t in self.r["tables"]:
            assert t["html"], f"Table {t['id']} has no HTML"

    def test_tables_have_page(self):
        for t in self.r["tables"]:
            assert t["page"] is not None
            assert 1 <= t["page"] <= 12


@pytest.mark.skipif(not HSE_PDF.exists(), reason="HSE PDF absent")
class TestConvertirHSE:
    """Snapshot du doc HSE DA_0003 (1 page, natif)."""

    @pytest.fixture(autouse=True, scope="class")
    def result(self, tmp_path_factory):
        from pipeline import convertir_pdf
        out = tmp_path_factory.mktemp("hse")
        r = convertir_pdf(HSE_PDF, out)
        type(self)._result = r

    @property
    def r(self):
        return type(self)._result

    def test_n_pages(self):
        assert self.r["n_pages"] == 1

    def test_n_figures(self):
        assert self.r["n_figures"] == 1

    def test_no_outline(self):
        assert len(self.r["outline"]) == 0
