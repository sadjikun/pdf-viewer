# Specification: Offline LaTeX Math Equation Rendering

> **EXPÉRIMENTAL — Référence pour pix2tex/LatexOCR.**  
> État actuel de l'implémentation : [`memory/formulas.md`](memory/formulas.md). Lecture seule.

This document describes the changes to implement offline LaTeX math equation rendering. The pipeline extracts mathematical formulas from PDF documents, decodes them using `pix2tex` (LatexOCR), embeds them in the exported HTML, and renders them on the frontend using KaTeX.

---

## 1. Backend Changes (LatexOCR Integration)

### Why
When Docling parses PDF files, it identifies formula blocks but cannot decode them by default without an online model. In an offline sandbox, it outputs `<div class="formula-not-decoded">Formula not decoded</div>`. We run `pix2tex` (LatexOCR) locally on the cropped formula images, update the document elements, and export the decoded math directly.

### A. Changes in `backend/pipeline.py`

1. **Enable Page Image Generation**:
   We update `_converter` to set `opts.generate_page_images = True`. This allows us to crop and extract formula images from pages using `item.get_image(doc)`:
   ```python
   def _converter(do_ocr: bool = False) -> DocumentConverter:
       opts = PdfPipelineOptions()
       opts.do_ocr = do_ocr
       opts.do_table_structure = True
       opts.generate_picture_images = True
       opts.generate_page_images = True  # Enable page rendering for crops
       opts.images_scale = 1.0
       return DocumentConverter(
           format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
       )
   ```

2. **Lazy Initialization of `LatexOCR`**:
   To avoid importing heavy ML libraries unless formulas are detected, we lazily load `LatexOCR` and cache the instance:
   ```python
   _latex_ocr_model = None
   _latex_ocr_loaded = False

   def _init_latex_ocr():
       global _latex_ocr_model, _latex_ocr_loaded
       if not _latex_ocr_loaded:
           _latex_ocr_loaded = True
           try:
               from pix2tex.cli import LatexOCR
               _latex_ocr_model = LatexOCR()
               print("[pipeline] Loaded pix2tex model successfully")
           except Exception as e:
               print(f"[pipeline] Failed to load pix2tex model: {e}")
   ```

3. **Interception and Decoding Loop**:
   Inside the batch loop in `convertir_pdf`, after converting a chunk, we check for formula items, crop them, run the OCR model, and assign the LaTeX back to `item.text`:
   ```python
   doc = converter.convert(str(chunk_path)).document

   # Offline LaTeX OCR on formula items
   for item, level in doc.iterate_items():
       label = getattr(item, "label", None)
       label_str = str(label).lower() if label else ""
       if "formula" in label_str or "equation" in label_str:
           try:
               img = item.get_image(doc)
               if img:
                   _init_latex_ocr()
                   if _latex_ocr_model:
                       latex = _latex_ocr_model(img)
                       if latex:
                           item.text = latex.strip()
           except Exception as e:
               print(f"[pipeline] Failed to decode formula item: {e}")
   ```

---

## 2. Frontend Changes (KaTeX Rendering)

### Why
MathML elements are embedded in the exported HTML inside `<annotation encoding="TeX">` tags. We extract this LaTeX source and render it beautifully using KaTeX in the browser.

### A. Changes in `frontend/src/components/Reader/MarkdownReader.tsx`

1. **Import KaTeX**:
   At the top of the file, we import the `katex` package:
   ```typescript
   import katex from "katex";
   ```

2. **Hook to Process and Render Math Elements**:
   We add a `useEffect` hook to target formula/equation elements and render them:
   ```typescript
   useEffect(() => {
     if (renderMode !== "html" || !contentRef.current) return;

     // Select all formula and math elements
     const mathElements = contentRef.current.querySelectorAll(".formula, .equation, math");
     mathElements.forEach((el) => {
       if (el.hasAttribute("data-katex-rendered")) return;

       const annotation = el.querySelector('annotation[encoding="TeX"]');
       const latex = annotation?.textContent?.trim();
       if (latex) {
         const container = document.createElement("span");
         container.className = "katex-formula-rendered";
         try {
           const isDisplay = el.tagName === "DIV" || el.classList.contains("equation");
           katex.render(latex, container, {
             displayMode: isDisplay,
             throwOnError: false,
           });
           el.innerHTML = "";
           el.appendChild(container);
           el.setAttribute("data-katex-rendered", "true");
         } catch (err) {
           console.error("KaTeX rendering error:", err);
         }
       }
     });
   }, [visibleHtml, renderMode]);
   ```
