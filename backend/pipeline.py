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
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


_NUM_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)")


def _options() -> PdfPipelineOptions:
    opts = PdfPipelineOptions()
    opts.do_ocr = True
    opts.do_table_structure = True
    opts.generate_picture_images = True
    opts.images_scale = 2.0
    return opts


def _converter() -> DocumentConverter:
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=_options())}
    )


def _bbox_to_list(bbox) -> list[float] | None:
    if bbox is None:
        return None
    # Docling BoundingBox : l, t, r, b (peut être en convention BOTTOMLEFT ou TOPLEFT)
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


def convertir_pdf(pdf_path: Path, out_dir: Path) -> dict[str, Any]:
    """Convertit un PDF avec Docling et exporte la structure + figures."""
    converter = _converter()
    result = converter.convert(str(pdf_path))
    doc = result.document

    pages = []
    for pno in sorted(doc.pages.keys()):
        page = doc.pages[pno]
        size = getattr(page, "size", None)
        pages.append({
            "number": pno,
            "width": float(size.width) if size else None,
            "height": float(size.height) if size else None,
        })

    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)
    figures: list[dict[str, Any]] = []
    for i, pic in enumerate(doc.pictures):
        fig_id = f"f_{i}"
        page, bbox = _provenance(pic)
        caption = pic.caption_text(doc) if hasattr(pic, "caption_text") else ""
        # Sauvegarde l'image extraite si disponible
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

    outline = _extraire_outline(doc)

    # Export markdown (Docling natif) — pour le bouton "Exporter MD" cote front
    try:
        md = doc.export_to_markdown()
        (out_dir / "result.md").write_text(md, encoding="utf-8")
    except Exception:
        # L'export markdown ne doit pas faire echouer le pipeline principal
        pass

    return {
        "pages": pages,
        "outline": outline,
        "figures": figures,
        "n_pages": len(pages),
        "n_figures": len(figures),
    }


def _level_depuis_titre(title: str) -> int | None:
    """Niveau déduit de la numérotation ('2.' → 1, '2.1.' → 2, '2.1.3' → 3).

    Renvoie None si le titre n'a pas de préfixe numérique exploitable.
    """
    m = _NUM_PREFIX.match(title)
    if not m:
        return None
    return m.group(1).count(".") + 1


def _extraire_outline(doc) -> list[dict[str, Any]]:
    """Reconstitue un arbre hiérarchique à partir des SectionHeader items.

    Stratégie : Docling sort souvent tous les SectionHeader avec level=1 (TD-001).
    On déduit le niveau réel de la numérotation du titre quand elle existe
    (`2.1.` → niveau 2). Fallback sur le `level` brut Docling sinon.
    """
    sections: list[dict[str, Any]] = []
    for i, item in enumerate(doc.texts):
        label = getattr(item, "label", None)
        if label is None or str(label) not in ("section_header", "DocItemLabel.SECTION_HEADER"):
            if "section_header" not in str(label).lower():
                continue
        page, bbox = _provenance(item)
        title = (item.text or "").strip()
        inferred = _level_depuis_titre(title)
        if inferred is not None:
            level = inferred
        else:
            level = int(getattr(item, "level", 1) or 1)
        sections.append({
            "id": f"s_{i}",
            "level": level,
            "title": title,
            "page": page,
            "bbox": bbox,
            "children": [],
        })

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
