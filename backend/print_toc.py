import pypdfium2 as pdfium
from pathlib import Path

pdf_path = Path(r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend\cache\99cb355a11d94406\source.pdf")
src = pdfium.PdfDocument(str(pdf_path))
toc = list(src.get_toc())
print("TOC length:", len(toc))
for item in toc[:30]:
    print(f"Level {item.level}: {item.title} -> page {item.page_index}")
src.close()
