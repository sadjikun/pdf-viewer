import os
import sys
from pathlib import Path
import tempfile
import pypdfium2 as pdfium

# Add backend directory to Python path
sys.path.append(str(Path(__file__).parent))

from pipeline import convertir_pdf

def test_pipeline_on_chunk():
    source_pdf = Path("cache/cc55c31432886c32/source.pdf")
    if not source_pdf.exists():
        print(f"Error: {source_pdf} does not exist.")
        return

    print("Extracting pages 12-14 from source PDF...")
    src = pdfium.PdfDocument(str(source_pdf))
    dst = pdfium.PdfDocument.new()
    # 0-indexed: pages 11, 12, 13 (which is page 12, 13, 14)
    dst.import_pages(src, [11, 12, 13])
    
    with tempfile.TemporaryDirectory() as tmp_dir:
        chunk_pdf = Path(tmp_dir) / "chunk.pdf"
        dst.save(str(chunk_pdf))
        src.close()
        dst.close()
        
        output_dir = Path(tmp_dir) / "output"
        output_dir.mkdir()
        
        print("Running pipeline on chunk...")
        res = convertir_pdf(chunk_pdf, output_dir)
        print("Pipeline finished. Results:")
        print(res)
        
        html_file = output_dir / "result.html"
        if html_file.exists():
            html_content = html_file.read_text(encoding="utf-8")
            print("\nResult HTML length:", len(html_content))
            
            # Check for math or annotation tags
            import re
            math_tags = re.findall(r"<math[^>]*>.*?</math>", html_content, re.DOTALL)
            print(f"Found {len(math_tags)} <math> tags.")
            
            for i, tag in enumerate(math_tags[:5]):
                print(f"\nMath tag {i+1}:")
                # print first 300 chars of tag
                print(tag[:300] + "...")
                # Search for annotation encoding="TeX"
                tex = re.search(r'<annotation encoding="TeX">(.*?)</annotation>', tag, re.DOTALL)
                if tex:
                    print("TeX Annotation:", tex.group(1))
                else:
                    print("No TeX Annotation found in this tag.")
        else:
            print("Error: result.html was not generated.")

if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    test_pipeline_on_chunk()
