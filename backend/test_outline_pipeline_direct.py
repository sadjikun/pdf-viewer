import sys
from pathlib import Path

import pypdfium2 as pdfium
import pytest

sys.path.append(r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend")
import pipeline

pdf_path = Path(r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend\cache\99cb355a11d94406\source.pdf")
if not pdf_path.exists():
    pytest.skip(f"Fixture PDF absente: {pdf_path}", allow_module_level=True)

src = pdfium.PdfDocument(str(pdf_path))
page_texts = []
for pno in range(len(src)):
    tp = src[pno].get_textpage()
    page_texts.append(tp.get_text_range())
    tp.close()
src.close()

print("Running pipeline._outline_depuis_texte...")
outline = pipeline._outline_depuis_texte(page_texts)

print(f"Total top-level sections in outline: {len(outline)}")
for item in outline:
    print(f"Page {item.get('page')} (Level {item.get('level')}): {item.get('title')}")
    for child in item.get('children', []):
        print(f"  Page {child.get('page')} (Level {child.get('level')}): {child.get('title')}")
        for gchild in child.get('children', []):
            print(f"    Page {gchild.get('page')} (Level {gchild.get('level')}): {gchild.get('title')}")
