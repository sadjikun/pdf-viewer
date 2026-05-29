"""PDF text-extraction benchmark.

Compare pypdfium2 · pymupdf · pdfplumber · pdfminer · pypdf · Docling
on a single PDF and produce a JSON + HTML report.

Usage (standalone):
    python benchmark.py <path/to/file.pdf> [--out report.html]

Usage (via API):
    GET /doc/{doc_id}/benchmark        → JSON results
    GET /doc/{doc_id}/benchmark.html   → HTML report
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any


# ══════════════════════════════════════════════════════════════════════════════
# INDIVIDUAL EXTRACTORS
# ══════════════════════════════════════════════════════════════════════════════

def _stats(text: str, elapsed: float, n_pages: int, tool: str, version: str,
           sections: int = 0, tables: int = 0, figures: int = 0) -> dict[str, Any]:
    """Build the standard result dict from raw extracted text."""
    words  = len(text.split())
    lines  = text.count("\n")
    chars  = len(text)
    return {
        "tool":             tool,
        "version":          version,
        "time_s":           round(elapsed, 3),
        "time_per_page_ms": round(elapsed / max(n_pages, 1) * 1000, 1),
        "n_chars":          chars,
        "n_words":          words,
        "n_lines":          lines,
        "n_pages":          n_pages,
        "n_sections":       sections,
        "n_tables":         tables,
        "n_figures":        figures,
        "text_sample":      text[:400].replace("\n", " ").strip(),
        "error":            None,
    }


def _error_result(tool: str, e: Exception) -> dict[str, Any]:
    return {
        "tool": tool, "version": "?", "time_s": 0, "time_per_page_ms": 0,
        "n_chars": 0, "n_words": 0, "n_lines": 0, "n_pages": 0,
        "n_sections": 0, "n_tables": 0, "n_figures": 0,
        "text_sample": "", "error": str(e),
    }


# ─── pypdfium2 ────────────────────────────────────────────────────────────────

def extract_pypdfium2(pdf_path: Path) -> dict[str, Any]:
    try:
        import pypdfium2 as pdfium
        version = getattr(pdfium, "__version__", "?")
        t0 = time.perf_counter()
        doc = pdfium.PdfDocument(str(pdf_path))
        parts = []
        for i in range(len(doc)):
            tp = doc[i].get_textpage()
            parts.append(tp.get_text_range())
            tp.close()
        doc.close()
        text = "\n".join(parts)
        elapsed = time.perf_counter() - t0
        sections = _count_sections_pypdfium(text)
        return _stats(text, elapsed, len(parts), "pypdfium2", version, sections=sections)
    except Exception as e:
        return _error_result("pypdfium2", e)


_SEC_RE = re.compile(r"^\s*\d+(?:\.\d+)+\.?\s+[A-Za-zÀ-ÿ]", re.MULTILINE)

def _count_sections_pypdfium(text: str) -> int:
    return len(_SEC_RE.findall(text))


# ─── PyMuPDF (fitz) ───────────────────────────────────────────────────────────

def extract_pymupdf(pdf_path: Path) -> dict[str, Any]:
    try:
        import fitz
        t0 = time.perf_counter()
        doc = fitz.open(str(pdf_path))
        parts = [page.get_text() for page in doc]
        n = len(parts)
        # Table of contents
        toc = doc.get_toc()
        sections = len(toc)
        doc.close()
        text = "\n".join(parts)
        elapsed = time.perf_counter() - t0
        return _stats(text, elapsed, n, "pymupdf", fitz.__version__, sections=sections)
    except Exception as e:
        return _error_result("pymupdf", e)


# ─── pdfplumber ───────────────────────────────────────────────────────────────

def extract_pdfplumber(pdf_path: Path) -> dict[str, Any]:
    try:
        import pdfplumber
        t0 = time.perf_counter()
        parts = []
        tables_total = 0
        with pdfplumber.open(str(pdf_path)) as pdf:
            n = len(pdf.pages)
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
                tables_total += len(page.find_tables())
        text = "\n".join(parts)
        elapsed = time.perf_counter() - t0
        return _stats(text, elapsed, n, "pdfplumber", pdfplumber.__version__,
                      tables=tables_total)
    except Exception as e:
        return _error_result("pdfplumber", e)


# ─── pdfminer ────────────────────────────────────────────────────────────────

def extract_pdfminer(pdf_path: Path) -> dict[str, Any]:
    try:
        from pdfminer.high_level import extract_text_to_fp, extract_pages
        from pdfminer.layout import LTPage
        import io, pdfminer

        t0 = time.perf_counter()
        buf = io.StringIO()
        with open(pdf_path, "rb") as f:
            from pdfminer.high_level import extract_text
            text = extract_text(str(pdf_path))
        n_pages = sum(1 for _ in extract_pages(str(pdf_path)))
        elapsed = time.perf_counter() - t0

        version = getattr(pdfminer, "__version__", "?")
        return _stats(text or "", elapsed, n_pages, "pdfminer", version)
    except Exception as e:
        return _error_result("pdfminer", e)


# ─── pypdf ───────────────────────────────────────────────────────────────────

def extract_pypdf(pdf_path: Path) -> dict[str, Any]:
    try:
        import pypdf
        t0 = time.perf_counter()
        reader = pypdf.PdfReader(str(pdf_path))
        n = len(reader.pages)
        parts = [p.extract_text() or "" for p in reader.pages]
        outline = reader.outline
        sections = _count_outline_items(outline)
        text = "\n".join(parts)
        elapsed = time.perf_counter() - t0
        return _stats(text, elapsed, n, "pypdf", pypdf.__version__, sections=sections)
    except Exception as e:
        return _error_result("pypdf", e)


def _count_outline_items(outline: list, depth: int = 0) -> int:
    count = 0
    for item in outline:
        if isinstance(item, list):
            count += _count_outline_items(item, depth + 1)
        else:
            count += 1
    return count


# ─── Docling (from cache) ────────────────────────────────────────────────────

def extract_docling_cached(result_json: dict) -> dict[str, Any]:
    """Uses the already-processed Docling result — no re-extraction needed."""
    try:
        # Read markdown if available (generated during pipeline)
        n_pages   = result_json.get("n_pages", 0)
        n_figs    = result_json.get("n_figures", 0)
        n_tables  = result_json.get("n_tables", 0)
        outline   = result_json.get("outline", [])
        mode      = result_json.get("extraction_mode", "?")

        def _count_nodes(nodes: list) -> int:
            total = len(nodes)
            for n in nodes:
                total += _count_nodes(n.get("children", []))
            return total

        n_sections = _count_nodes(outline)

        # Try to get char count from result.md if it exists
        text = ""
        return {
            "tool":             f"docling ({mode})",
            "version":          "2.92",
            "time_s":           None,           # already cached — not measured
            "time_per_page_ms": None,
            "n_chars":          None,           # md not read here, see run_benchmark
            "n_words":          None,
            "n_lines":          None,
            "n_pages":          n_pages,
            "n_sections":       n_sections,
            "n_tables":         n_tables,
            "n_figures":        n_figs,
            "text_sample":      "(from cache)",
            "error":            None,
        }
    except Exception as e:
        return _error_result("docling", e)


# ══════════════════════════════════════════════════════════════════════════════
# ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

def run_benchmark(pdf_path: Path, result_json: dict | None = None) -> list[dict[str, Any]]:
    """Run all extractors on pdf_path and return list of result dicts."""
    print(f"[benchmark] {pdf_path.name} ({pdf_path.stat().st_size // 1024} KB)")

    results = []

    for name, fn in [
        ("pypdfium2", extract_pypdfium2),
        ("pymupdf",   extract_pymupdf),
        ("pdfplumber",extract_pdfplumber),
        ("pdfminer",  extract_pdfminer),
        ("pypdf",     extract_pypdf),
    ]:
        print(f"  [{name}] ...", end=" ", flush=True)
        r = fn(pdf_path)
        err = f"ERROR: {r['error']}" if r["error"] else f"{r['n_chars']:,} chars in {r['time_s']}s"
        print(err)
        results.append(r)

    if result_json is not None:
        print(f"  [docling ] from cache")
        r = extract_docling_cached(result_json)
        # Enrich with markdown text stats if result.md exists alongside result.json
        md_path = pdf_path.parent / "result.md"
        if md_path.exists():
            md_text = md_path.read_text(encoding="utf-8", errors="replace")
            r["n_chars"] = len(md_text)
            r["n_words"] = len(md_text.split())
            r["n_lines"] = md_text.count("\n")
            r["text_sample"] = md_text[:400].replace("\n", " ").strip()
        results.append(r)

    return results


# ══════════════════════════════════════════════════════════════════════════════
# HTML REPORT
# ══════════════════════════════════════════════════════════════════════════════

def render_html(results: list[dict], pdf_name: str) -> str:
    """Generate a self-contained HTML benchmark report."""

    # Find best values for highlighting
    times   = [r["time_s"] for r in results if r["time_s"] is not None and not r["error"]]
    chars   = [r["n_chars"] for r in results if r["n_chars"] is not None and not r["error"]]
    best_time  = min(times) if times else None
    best_chars = max(chars) if chars else None

    def fmt_time(v):
        if v is None: return "<span class='na'>cached</span>"
        cls = "best" if v == best_time else ""
        return f"<span class='{cls}'>{v:.3f}s</span>"

    def fmt_chars(v):
        if v is None: return "<span class='na'>—</span>"
        cls = "best" if v == best_chars else ""
        pct = f" <small>({v/best_chars*100:.0f}%)</small>" if best_chars and v != best_chars else ""
        return f"<span class='{cls}'>{v:,}{pct}</span>"

    def fmt_num(v, best=None):
        if v is None: return "<span class='na'>—</span>"
        cls = "best" if best and v == best else ""
        return f"<span class='{cls}'>{v:,}</span>"

    def fmt_speed(r):
        if r["time_per_page_ms"] is None: return "<span class='na'>—</span>"
        return f"{r['time_per_page_ms']:.1f} ms/p"

    best_words = max((r["n_words"] for r in results if r["n_words"] is not None and not r["error"]), default=None)
    best_sec   = max((r["n_sections"] for r in results if not r["error"]), default=None)
    best_tbl   = max((r["n_tables"] for r in results if not r["error"]), default=None)

    rows = ""
    for r in results:
        if r["error"]:
            rows += f"""
            <tr class="err">
              <td><strong>{r['tool']}</strong></td>
              <td colspan="8"><span class="error">⚠ {r['error']}</span></td>
            </tr>"""
            continue
        rows += f"""
        <tr>
          <td><strong>{r['tool']}</strong><br><small class="ver">{r['version']}</small></td>
          <td>{fmt_time(r['time_s'])}<br><small>{fmt_speed(r)}</small></td>
          <td>{fmt_chars(r['n_chars'])}</td>
          <td>{fmt_num(r['n_words'], best_words)}</td>
          <td>{fmt_num(r['n_lines'])}</td>
          <td>{fmt_num(r['n_sections'], best_sec)}</td>
          <td>{fmt_num(r['n_tables'], best_tbl)}</td>
          <td>{fmt_num(r['n_figures'])}</td>
          <td><span class="sample">{r['text_sample'][:120]}</span></td>
        </tr>"""

    import datetime
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>PDF Benchmark — {pdf_name}</title>
<style>
  :root {{
    --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a;
    --text: #e2e4ec; --muted: #7a7f8e; --accent: #4f8ef7;
    --best: #34d399; --err: #f87171; --na: #4a4d5e;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; padding: 2rem; }}
  h1 {{ font-size: 1.5rem; margin-bottom: .25rem; }}
  .meta {{ color: var(--muted); font-size: .85rem; margin-bottom: 2rem; }}
  .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }}
  table {{ width: 100%; border-collapse: collapse; font-size: .85rem; }}
  th {{ background: #20232e; padding: .7rem 1rem; text-align: left; color: var(--muted); font-weight: 600;
        font-size: .75rem; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid var(--border); }}
  td {{ padding: .65rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  tr:hover td {{ background: #20232e; }}
  .best {{ color: var(--best); font-weight: 700; }}
  .na {{ color: var(--na); font-style: italic; }}
  .ver {{ color: var(--muted); }}
  .err td {{ opacity: .7; }}
  .error {{ color: var(--err); font-size: .8rem; }}
  .sample {{ color: var(--muted); font-size: .75rem; font-family: ui-monospace, monospace; display: block;
             max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .badge {{ display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: .7rem; font-weight: 600; }}
  .legend {{ margin-top: 1.5rem; font-size: .78rem; color: var(--muted); }}
  .legend span {{ color: var(--best); }}
</style>
</head>
<body>
<h1>📊 PDF Text Extraction Benchmark</h1>
<p class="meta">Document : <strong>{pdf_name}</strong> &nbsp;·&nbsp; Généré le {ts}</p>

<div class="card">
  <table>
    <thead>
      <tr>
        <th>Outil</th>
        <th>Vitesse</th>
        <th>Caractères</th>
        <th>Mots</th>
        <th>Lignes</th>
        <th>Sections</th>
        <th>Tables</th>
        <th>Figures</th>
        <th>Extrait</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</div>

<p class="legend"><span>Vert</span> = meilleur score dans cette colonne. "cached" = résultat Docling déjà calculé, temps non mesuré.</p>

<script>
// Raw JSON for programmatic use
window.benchmarkData = {json.dumps(results, ensure_ascii=False, indent=2)};
</script>
</body>
</html>"""


# ══════════════════════════════════════════════════════════════════════════════
# CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse, sys

    parser = argparse.ArgumentParser(description="PDF text extraction benchmark")
    parser.add_argument("pdf", help="Path to PDF file")
    parser.add_argument("--out", default=None, help="Output HTML file (default: <pdf>.benchmark.html)")
    parser.add_argument("--json", action="store_true", help="Also write JSON results")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        sys.exit(f"File not found: {pdf_path}")

    results = run_benchmark(pdf_path)

    out_html = Path(args.out) if args.out else pdf_path.with_suffix(".benchmark.html")
    out_html.write_text(render_html(results, pdf_path.name), encoding="utf-8")
    print(f"\n[benchmark] Report: {out_html}")

    if args.json:
        out_json = out_html.with_suffix(".json")
        out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[benchmark] JSON:   {out_json}")
