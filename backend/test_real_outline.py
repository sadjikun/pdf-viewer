import os
from pathlib import Path

import pypdfium2 as pdfium
import re
import pytest
from pipeline import _outline_depuis_texte, _est_titre_section

pdf_path = "cache/99cb355a11d94406/source.pdf"
if not Path(pdf_path).exists():
    pytest.skip(f"Fixture PDF absente: {pdf_path}", allow_module_level=True)

src = pdfium.PdfDocument(pdf_path)
page_texts = []
for pno in range(len(src)):
    tp = src[pno].get_textpage()
    page_texts.append(tp.get_text_range())
    tp.close()
src.close()

outline = _outline_depuis_texte(page_texts)

def print_nodes(nodes, indent=0):
    for n in nodes:
        print("  " * indent + f"- p.{n.get('page')} (lvl {n.get('level')}): {repr(n.get('title'))}")
        if n.get("children"):
            print_nodes(n["children"], indent + 1)

print_nodes(outline)
