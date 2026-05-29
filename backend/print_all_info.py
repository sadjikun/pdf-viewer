import os
import pypdfium2 as pdfium
import json

cache_dir = "cache"
for d in os.listdir(cache_dir):
    source_pdf = os.path.join(cache_dir, d, "source.pdf")
    if os.path.exists(source_pdf):
        try:
            doc = pdfium.PdfDocument(source_pdf)
            n_pages = len(doc)
            doc.close()
        except Exception as e:
            n_pages = f"Error: {e}"
        
        result_json_path = os.path.join(cache_dir, d, "result.json")
        has_result = os.path.exists(result_json_path)
        filename = ""
        first_item = ""
        
        if has_result:
            try:
                with open(result_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    filename = data.get("filename", "")
                    outline = data.get("outline", [])
                    if outline:
                        first_item = f"{outline[0].get('page')}: {outline[0].get('title')}"
            except Exception as e:
                filename = f"Error: {e}"
        
        print(f"Dir: {d} | Pages: {n_pages} | HasResult: {has_result} | Filename: {filename} | FirstItem: {first_item}")
