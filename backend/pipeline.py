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

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

ProgressCallback = Callable[[int, str], None]

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

log = logging.getLogger(__name__)

_NUM_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)")
_CHAPTER_PREFIX = re.compile(r"^\s*chapter\s+(\d+)", re.IGNORECASE)
_MIN_TITLE_LEN = 3
_MAX_TITLE_LEN = 120
_TEXT_NATIVE_THRESHOLD = 50

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
    lengths = _page_text_lengths(pdf_path, sample_pages)
    return bool(lengths) and all(n > _TEXT_NATIVE_THRESHOLD for n in lengths)


def _needs_ocr(pdf_path: Path, sample_pages: int | None = None) -> bool:
    """Retourne True si au moins une page inspectée semble dépourvue de texte natif."""
    return _needs_ocr_from_lengths(_page_text_lengths(pdf_path, sample_pages))


def _needs_ocr_from_lengths(lengths: list[int]) -> bool:
    """Décision OCR depuis des longueurs de texte par page."""
    return not lengths or any(n <= _TEXT_NATIVE_THRESHOLD for n in lengths)


def _page_text_lengths(pdf_path: Path, sample_pages: int | None = None) -> list[int]:
    """Longueur du texte extractible par page, sans charger Docling."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        total = len(pdf)
        n = min(total, sample_pages) if sample_pages is not None else total
        lengths: list[int] = []
        for i in range(n):
            page = None
            tp = None
            try:
                page = pdf[i]
                tp = page.get_textpage()
                text = tp.get_text_range()
                lengths.append(len(text.strip()))
            finally:
                if tp is not None:
                    tp.close()
                if page is not None:
                    page.close()
        return lengths
    finally:
        pdf.close()


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
            log.exception("Echec export image figure %s", fig_id)
        figures.append({
            "id": fig_id,
            "page": page,
            "bbox": bbox,
            "caption": caption or "",
        })
    return figures


def _extraire_tables(
    doc, page_offset: int = 0, table_offset: int = 0,
) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for i, table in enumerate(doc.tables):
        table_id = f"t_{table_offset + i}"
        page, bbox = _provenance(table)
        if page is not None:
            page += page_offset
        caption = table.caption_text(doc) if hasattr(table, "caption_text") else ""
        html = ""
        try:
            html = table.export_to_html(doc) if hasattr(table, "export_to_html") else ""
        except Exception:
            log.exception("Echec export HTML table %s", table_id)
        tables.append({
            "id": table_id,
            "page": page,
            "bbox": bbox,
            "caption": caption or "",
            "html": html or "",
        })
    return tables


def _outline_dedup_key(
    title: str,
    page: int | None = None,
    bbox: list[float] | None = None,
) -> tuple[Any, ...]:
    key = title.lower().strip()
    if page is None:
        return (key,)
    rounded_bbox = tuple(round(v, 1) for v in bbox) if bbox else None
    return (key, page, rounded_bbox)


def _est_faux_positif(
    title: str,
    seen: set[tuple[Any, ...]],
    page: int | None = None,
    bbox: list[float] | None = None,
) -> bool:
    """Filtre les SectionHeader parasites détectés par Docling (TD-007)."""
    if len(title) < _MIN_TITLE_LEN:
        return True
    if len(title) > _MAX_TITLE_LEN:
        return True
    key = _outline_dedup_key(title, page, bbox)
    if key in seen:
        return True
    seen.add(key)
    return False


def _extraire_sections(
    doc, page_offset: int = 0, section_offset: int = 0,
    seen_titles: set[tuple[Any, ...]] | None = None,
) -> list[dict[str, Any]]:
    """Extrait les SectionHeader en liste plate (sans arbre)."""
    if seen_titles is None:
        seen_titles = set()
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
        if _est_faux_positif(title, seen_titles, page, bbox):
            continue
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


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT HTML (vue Lecteur pleine fidélité Docling)
# ══════════════════════════════════════════════════════════════════════════════

_HTML_BODY_RE = re.compile(r"<body[^>]*>(.*)</body>", re.DOTALL | re.IGNORECASE)


def _docling_html_body(doc) -> str:
    """Exporte le DoclingDocument en HTML (images base64 inline), retourne l'inner <body>.

    image_mode=EMBEDDED → HTML auto-suffisant (pas de fichiers image séparés).
    Retourne "" en cas d'échec (le Lecteur retombe alors sur le Markdown).
    """
    try:
        from docling_core.types.doc.base import ImageRefMode
        full = doc.export_to_html(image_mode=ImageRefMode.EMBEDDED)
    except Exception:
        log.exception("export_to_html a échoué")
        return ""
    m = _HTML_BODY_RE.search(full)
    return m.group(1).strip() if m else full


def _write_html_artifacts(out_dir: Path, parts: list[tuple[int, int, str]]) -> None:
    """Écrit html_part_<start>.html (+ marqueur de page), html_manifest.json et result.html.

    parts : (page_début, page_fin, html_body) par tranche. Consommé par le Reader
    via /html-manifest puis /html-part/<start>.
    """
    manifest: list[dict[str, Any]] = []
    for start, end, body in parts:
        if not body:
            continue
        marker = f'<div class="pdf-page-sep" data-page="{start}"></div>'
        fname = f"html_part_{start:04d}.html"
        (out_dir / fname).write_text(marker + body, encoding="utf-8")
        manifest.append({"start": start, "end": end, "file": fname})
    if not manifest:
        return
    (out_dir / "html_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    # result.html = première tranche (compat liens directs)
    (out_dir / "result.html").write_text(
        (out_dir / manifest[0]["file"]).read_text(encoding="utf-8"), encoding="utf-8"
    )


def convertir_pdf(
    pdf_path: Path,
    out_dir: Path,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Convertit un PDF avec Docling et exporte la structure + figures.

    progress_callback(percent, message) est appelé aux étapes clés si fourni.
    """
    if progress_callback:
        progress_callback(5, "Analyse préliminaire du PDF...")
    n_pages = _count_pages(pdf_path)
    if n_pages > BATCH_THRESHOLD:
        log.info("%s — %d pages, batch, OCR par tranche", pdf_path.name, n_pages)
        return _convertir_batch(pdf_path, out_dir, n_pages, progress_callback)

    do_ocr = _needs_ocr(pdf_path)
    log.info(
        "%s — %d pages, %s, OCR %s",
        pdf_path.name, n_pages,
        "natif" if not do_ocr else "scanne/mixte",
        "ON" if do_ocr else "OFF",
    )
    return _convertir_simple(pdf_path, out_dir, do_ocr, progress_callback)


def _convertir_simple(
    pdf_path: Path,
    out_dir: Path,
    do_ocr: bool = True,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Conversion single-pass pour les PDFs courts."""
    if progress_callback:
        progress_callback(15, "Analyse layout & OCR Docling...")
    converter = _converter(do_ocr=do_ocr)
    doc = converter.convert(str(pdf_path)).document

    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)

    if progress_callback:
        progress_callback(80, "Extraction pages, figures, tables...")
    pages = _extraire_pages(doc)
    figures = _extraire_figures(doc, figures_dir)
    tables = _extraire_tables(doc)
    sections = _extraire_sections(doc)
    outline = _construire_arbre(sections)

    if progress_callback:
        progress_callback(95, "Export Markdown & HTML...")
    try:
        md = doc.export_to_markdown()
        (out_dir / "result.md").write_text(md, encoding="utf-8")
    except Exception:
        log.exception("Echec export markdown single-pass pour %s", pdf_path.name)

    try:
        body = _docling_html_body(doc)
        if body:
            _write_html_artifacts(out_dir, [(1, len(pages), body)])
    except Exception:
        log.exception("Echec export HTML single-pass pour %s", pdf_path.name)

    if progress_callback:
        progress_callback(100, "Traitement terminé.")
    return {
        "pages": pages,
        "outline": outline,
        "figures": figures,
        "tables": tables,
        "n_pages": len(pages),
        "n_figures": len(figures),
        "n_tables": len(tables),
    }


def _convertir_batch(
    pdf_path: Path, out_dir: Path, n_pages: int,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Conversion par tranches pour les gros PDFs (évite la saturation RAM)."""
    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)

    all_pages: list[dict[str, Any]] = []
    all_figures: list[dict[str, Any]] = []
    all_tables: list[dict[str, Any]] = []
    all_sections: list[dict[str, Any]] = []
    md_parts: list[str] = []
    html_parts: list[tuple[int, int, str]] = []
    seen_titles: set[tuple[Any, ...]] = set()

    fig_counter = 0
    table_counter = 0
    section_counter = 0

    for batch_start in range(1, n_pages + 1, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE - 1, n_pages)
        page_offset = batch_start - 1

        if progress_callback:
            pct = 15 + int((batch_start - 1) / n_pages * 75)  # 15 → 90 sur l'ensemble des tranches
            progress_callback(pct, f"Traitement pages {batch_start}–{batch_end} / {n_pages}...")

        tmp_pdf = out_dir / f"_batch_{batch_start}_{batch_end}.pdf"
        try:
            _extract_pages_pdf(pdf_path, batch_start, batch_end, tmp_pdf)
            batch_do_ocr = _needs_ocr(tmp_pdf)
            converter = _converter(batch_mode=True, do_ocr=batch_do_ocr)
            doc = converter.convert(str(tmp_pdf)).document

            all_pages.extend(_extraire_pages(doc, page_offset))
            all_figures.extend(
                _extraire_figures(doc, figures_dir, page_offset, fig_counter)
            )
            all_tables.extend(
                _extraire_tables(doc, page_offset, table_counter)
            )
            batch_sections = _extraire_sections(
                doc, page_offset, section_counter, seen_titles,
            )
            all_sections.extend(batch_sections)

            fig_counter += len(doc.pictures)
            table_counter += len(doc.tables)
            section_counter += sum(
                1 for item in doc.texts
                if "section_header" in str(getattr(item, "label", "")).lower()
            )

            try:
                md_parts.append(doc.export_to_markdown())
            except Exception:
                log.exception(
                    "Echec export markdown batch pages %s-%s",
                    batch_start,
                    batch_end,
                )

            try:
                body = _docling_html_body(doc)
                if body:
                    html_parts.append((batch_start, batch_end, body))
            except Exception:
                log.exception(
                    "Echec export HTML batch pages %s-%s", batch_start, batch_end
                )
        finally:
            tmp_pdf.unlink(missing_ok=True)

    if progress_callback:
        progress_callback(95, "Reconstruction du sommaire & export Markdown...")
    outline = _construire_arbre(all_sections)

    try:
        md = "\n\n".join(md_parts)
        (out_dir / "result.md").write_text(md, encoding="utf-8")
    except Exception:
        log.exception("Echec ecriture markdown batch pour %s", pdf_path.name)

    try:
        _write_html_artifacts(out_dir, html_parts)
    except Exception:
        log.exception("Echec ecriture HTML batch pour %s", pdf_path.name)

    if progress_callback:
        progress_callback(100, "Traitement terminé.")

    return {
        "pages": all_pages,
        "outline": outline,
        "figures": all_figures,
        "tables": all_tables,
        "n_pages": len(all_pages),
        "n_figures": len(all_figures),
        "n_tables": len(all_tables),
    }


def _level_depuis_titre(title: str) -> int | None:
    """Niveau déduit de la numérotation ('2.' → 1, '2.1.' → 2, 'Chapter 3' → 1)."""
    if _CHAPTER_PREFIX.match(title):
        return 1
    m = _NUM_PREFIX.match(title)
    if not m:
        return None
    return m.group(1).count(".") + 1


# ══════════════════════════════════════════════════════════════════════════════
# MULTI-FORMAT (MarkItDown) — Word, PowerPoint, Excel, HTML, images, notebooks…
# ══════════════════════════════════════════════════════════════════════════════

# Formats pris en charge par MarkItDown (hors PDF, traité par Docling).
MARKITDOWN_EXTENSIONS: set[str] = {
    ".docx", ".pptx", ".xlsx", ".xls",
    ".html", ".htm", ".md", ".txt",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
    ".ipynb", ".csv",
}

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+)", re.MULTILINE)


def _outline_from_markdown(text: str) -> list[dict[str, Any]]:
    """Construit un outline depuis les titres Markdown (# → niveau 1, ## → 2…)."""
    flat: list[dict[str, Any]] = []
    for i, m in enumerate(_MD_HEADING.finditer(text)):
        flat.append({
            "id": f"s_{i}",
            "level": len(m.group(1)),
            "title": m.group(2).strip(),
            "page": None,
            "bbox": None,
            "children": [],
        })
    return _construire_arbre(flat)


def convertir_generic(
    file_path: Path,
    out_dir: Path,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Convertit un fichier non-PDF en Markdown via MarkItDown.

    Extrait le texte et un outline depuis les titres Markdown, écrit result.md.
    Pas de figures/tables (extraction réservée au pipeline PDF Docling).
    """
    from markitdown import MarkItDown  # import différé : dépendance optionnelle

    if progress_callback:
        progress_callback(10, "Initialisation de MarkItDown...")
    ext = file_path.suffix.lower()
    log.info("MarkItDown : %s (%s)", file_path.name, ext)

    if progress_callback:
        progress_callback(40, "Conversion en cours via MarkItDown...")
    converter = MarkItDown()
    try:
        result = converter.convert(str(file_path))
        markdown_text = result.text_content or ""
    except Exception as e:
        raise RuntimeError(f"MarkItDown a échoué sur {file_path.name} : {e}") from e

    if progress_callback:
        progress_callback(85, "Sauvegarde du Markdown...")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "result.md").write_text(markdown_text, encoding="utf-8")
    (out_dir / "figures").mkdir(exist_ok=True)

    if progress_callback:
        progress_callback(90, "Extraction du sommaire...")
    outline = _outline_from_markdown(markdown_text)
    est_pages = max(1, round(len(markdown_text.split()) / 500))  # ~500 mots/page

    if progress_callback:
        progress_callback(100, "Traitement terminé.")

    return {
        "pages": [],
        "outline": outline,
        "figures": [],
        "tables": [],
        "n_pages": est_pages,
        "n_figures": 0,
        "n_tables": 0,
        "extraction_mode": "markitdown",
        "file_type": ext.lstrip("."),
    }
