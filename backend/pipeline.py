"""Wrapper Docling : PDF → outline + figures + bbox normalisées.

Sortie au format consommé par le frontend :
{
    "pages": [{"number": 1, "width": 595, "height": 842}, ...],
    "outline": [
        {"id": "s_0", "level": 1, "title": "Introduction",
         "page": 1, "bbox": [x0, y0, x1, y1], "children": [...]}
    ],
    "figures": [
        {"id": "f_0", "page": 3, "bbox": [...], "caption": "Figure 1: ..."}
    ]
}

Coordonnées bbox : telles que renvoyées par Docling (convention BOTTOMLEFT, points
PDF). Conversion vers TOPLEFT (PDF.js) au choix du frontend via `pages[i].height`.

Batch processing : les PDFs > BATCH_THRESHOLD pages sont découpés en tranches
de BATCH_SIZE pages via pypdfium2, traités indépendamment puis fusionnés.
Configurable via variables d'environnement PDF_BATCH_SIZE et PDF_BATCH_THRESHOLD.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

log = logging.getLogger(__name__)

_NUM_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)")

BATCH_SIZE = int(os.environ.get("PDF_BATCH_SIZE", "30"))
BATCH_THRESHOLD = int(os.environ.get("PDF_BATCH_THRESHOLD", "50"))

_converter_cache: dict[tuple[bool, bool], DocumentConverter] = {}


def _options(batch_mode: bool = False, do_ocr: bool = True) -> PdfPipelineOptions:
    opts = PdfPipelineOptions()
    opts.do_ocr = do_ocr
    opts.do_table_structure = True
    opts.generate_picture_images = True
    opts.images_scale = 1.0 if batch_mode else 2.0
    return opts


def _converter(batch_mode: bool = False, do_ocr: bool = True) -> DocumentConverter:
    key = (batch_mode, do_ocr)
    if key not in _converter_cache:
        log.info("Chargement converter (batch=%s, ocr=%s)", batch_mode, do_ocr)
        _converter_cache[key] = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_options=_options(batch_mode, do_ocr)
                )
            }
        )
    return _converter_cache[key]


def _is_native_pdf(pdf_path: Path, sample_pages: int = 3) -> bool:
    """Détecte si le PDF contient du texte extractible (natif) ou nécessite l'OCR."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(pdf_path))
    n = min(len(pdf), sample_pages)
    has_text = False
    for i in range(n):
        page = pdf[i]
        tp = page.get_textpage()
        text = tp.get_text_range()
        tp.close()
        page.close()
        if len(text.strip()) > 50:
            has_text = True
            break
    pdf.close()
    return has_text


def _bbox_to_list(bbox) -> list[float] | None:
    if bbox is None:
        return None
    try:
        return [float(bbox.l), float(bbox.t), float(bbox.r), float(bbox.b)]
    except AttributeError:
        return None


def _provenance(item) -> tuple[int | None, list[float] | None]:
    """Récupère page_no (1-indexé) et bbox du premier provenance d'un item."""
    prov = getattr(item, "prov", None) or []
    if not prov:
        return None, None
    p0 = prov[0]
    page = getattr(p0, "page_no", None)
    bbox = _bbox_to_list(getattr(p0, "bbox", None))
    return page, bbox


def _count_pages(pdf_path: Path) -> int:
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(pdf_path))
    n = len(pdf)
    pdf.close()
    return n


def _extract_pages_pdf(pdf_path: Path, start: int, end: int, out_path: Path) -> None:
    """Extrait les pages [start, end] (1-indexé) dans un nouveau PDF."""
    import pypdfium2 as pdfium
    src = pdfium.PdfDocument(str(pdf_path))
    dst = pdfium.PdfDocument.new()
    dst.import_pages(src, list(range(start - 1, end)))
    dst.save(str(out_path))
    dst.close()
    src.close()


def _extraire_pages(doc, page_offset: int = 0) -> list[dict[str, Any]]:
    pages = []
    for pno in sorted(doc.pages.keys()):
        page = doc.pages[pno]
        size = getattr(page, "size", None)
        pages.append({
            "number": pno + page_offset,
            "width": float(size.width) if size else None,
            "height": float(size.height) if size else None,
        })
    return pages


def _extraire_figures(
    doc, figures_dir: Path, page_offset: int = 0, fig_offset: int = 0,
) -> list[dict[str, Any]]:
    figures: list[dict[str, Any]] = []
    for i, pic in enumerate(doc.pictures):
        fig_id = f"f_{fig_offset + i}"
        page, bbox = _provenance(pic)
        if page is not None:
            page += page_offset
        caption = pic.caption_text(doc) if hasattr(pic, "caption_text") else ""
        try:
            img = pic.get_image(doc) if hasattr(pic, "get_image") else None
            if img is not None:
                img.save(figures_dir / f"{fig_id}.png")
        except Exception:
            pass
        figures.append({
            "id": fig_id,
            "page": page,
            "bbox": bbox,
            "caption": caption or "",
        })
    return figures


def _extraire_sections(
    doc, page_offset: int = 0, section_offset: int = 0,
) -> list[dict[str, Any]]:
    """Extrait les SectionHeader en liste plate (sans arbre)."""
    sections: list[dict[str, Any]] = []
    for i, item in enumerate(doc.texts):
        label = getattr(item, "label", None)
        if label is None or str(label) not in ("section_header", "DocItemLabel.SECTION_HEADER"):
            if "section_header" not in str(label).lower():
                continue
        page, bbox = _provenance(item)
        if page is not None:
            page += page_offset
        title = (item.text or "").strip()
        inferred = _level_depuis_titre(title)
        level = inferred if inferred is not None else int(getattr(item, "level", 1) or 1)
        sections.append({
            "id": f"s_{section_offset + i}",
            "level": level,
            "title": title,
            "page": page,
            "bbox": bbox,
            "children": [],
        })
    return sections


def _construire_arbre(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Construit l'arbre hiérarchique depuis une liste plate de sections."""
    racine: list[dict[str, Any]] = []
    pile: list[dict[str, Any]] = []
    for s in sections:
        while pile and pile[-1]["level"] >= s["level"]:
            pile.pop()
        if pile:
            pile[-1]["children"].append(s)
        else:
            racine.append(s)
        pile.append(s)
    return racine


def convertir_pdf(pdf_path: Path, out_dir: Path) -> dict[str, Any]:
    """Convertit un PDF avec Docling et exporte la structure + figures."""
    n_pages = _count_pages(pdf_path)
    native = _is_native_pdf(pdf_path)
    do_ocr = not native
    log.info(
        "%s — %d pages, %s, OCR %s",
        pdf_path.name, n_pages,
        "natif" if native else "scanne",
        "OFF" if native else "ON",
    )

    if n_pages > BATCH_THRESHOLD:
        return _convertir_batch(pdf_path, out_dir, n_pages, do_ocr)
    return _convertir_simple(pdf_path, out_dir, do_ocr)


def _convertir_simple(pdf_path: Path, out_dir: Path, do_ocr: bool = True) -> dict[str, Any]:
    """Conversion single-pass pour les PDFs courts."""
    converter = _converter(do_ocr=do_ocr)
    doc = converter.convert(str(pdf_path)).document

    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)

    pages = _extraire_pages(doc)
    figures = _extraire_figures(doc, figures_dir)
    sections = _extraire_sections(doc)
    outline = _construire_arbre(sections)

    try:
        md = doc.export_to_markdown()
        (out_dir / "result.md").write_text(md, encoding="utf-8")
    except Exception:
        pass

    return {
        "pages": pages,
        "outline": outline,
        "figures": figures,
        "n_pages": len(pages),
        "n_figures": len(figures),
    }


def _convertir_batch(
    pdf_path: Path, out_dir: Path, n_pages: int, do_ocr: bool = True,
) -> dict[str, Any]:
    """Conversion par tranches pour les gros PDFs (évite la saturation RAM)."""
    converter = _converter(batch_mode=True, do_ocr=do_ocr)
    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)

    all_pages: list[dict[str, Any]] = []
    all_figures: list[dict[str, Any]] = []
    all_sections: list[dict[str, Any]] = []
    md_parts: list[str] = []

    fig_counter = 0
    section_counter = 0

    for batch_start in range(1, n_pages + 1, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE - 1, n_pages)
        page_offset = batch_start - 1

        tmp_pdf = out_dir / f"_batch_{batch_start}_{batch_end}.pdf"
        try:
            _extract_pages_pdf(pdf_path, batch_start, batch_end, tmp_pdf)
            doc = converter.convert(str(tmp_pdf)).document

            all_pages.extend(_extraire_pages(doc, page_offset))
            all_figures.extend(
                _extraire_figures(doc, figures_dir, page_offset, fig_counter)
            )
            batch_sections = _extraire_sections(doc, page_offset, section_counter)
            all_sections.extend(batch_sections)

            fig_counter += len(doc.pictures)
            section_counter += sum(
                1 for item in doc.texts
                if "section_header" in str(getattr(item, "label", "")).lower()
            )

            try:
                md_parts.append(doc.export_to_markdown())
            except Exception:
                pass
        finally:
            tmp_pdf.unlink(missing_ok=True)

    outline = _construire_arbre(all_sections)

    try:
        md = "\n\n".join(md_parts)
        (out_dir / "result.md").write_text(md, encoding="utf-8")
    except Exception:
        pass

    return {
        "pages": all_pages,
        "outline": outline,
        "figures": all_figures,
        "n_pages": len(all_pages),
        "n_figures": len(all_figures),
    }


def _level_depuis_titre(title: str) -> int | None:
    """Niveau déduit de la numérotation ('2.' → 1, '2.1.' → 2, '2.1.3' → 3)."""
    m = _NUM_PREFIX.match(title)
    if not m:
        return None
    return m.group(1).count(".") + 1
