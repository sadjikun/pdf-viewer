// Helpers purs du Reader (parsing/sectionisation HTML, métadonnées, surlignage).
// Extraits de MarkdownReader.tsx pour réduire le monolithe — aucune logique React ici.
import { API_BASE } from "../../api";
import type { OutlineNode } from "../../types";

export interface Section {
  id: string;
  title: string;
  level: number;
}

export interface PaperMeta {
  title: string | null;
  authors: string[];
  abstract: string | null;
  keywords: string[];
}

export const cleanPdfTitle = (title?: string) => {
  if (!title) return "";
  return title.replace(/^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)/i, "").trim();
};

// ── HTML parsing ──────────────────────────────────────────────────────────────

export function sectionizeHtml(
  raw: string,
  outline: OutlineNode[] = [],
  docFilename?: string,
  idOffset: number = 0,
  pdfTitle?: string,
): {
  html: string;
  sections: Section[];
  words: number;
  nFigures: number;
  nTables: number;
  nFormulas: number;
  pdfPageNos: number[];   // PDF page numbers found in the HTML (FIX-016)
} {
  // Replace zero-width spaces to avoid KaTeX unrecognized symbol warnings
  raw = raw.replace(/\u200b/g, "");

  const parsed = new DOMParser().parseFromString(raw, "text/html");
  parsed.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((el) => el.remove());
  parsed.body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      // Strip aussi style= (vecteur XSS via url(javascript:…)/expression) — aligné sur Tables.tsx
      if (name.startsWith("on") || name === "style" || value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });

  const body = parsed.body;

  // Layout tables are processed transparently during recursive node traversal (FIX-036)

  const sections: Section[] = [];
  const root = parsed.createElement("div");
  let cur: Element | null = null;
  let idx = 0;

  // Build a normalised lookup from the backend outline so that only headings
  // that correspond to real TOC entries create section boundaries.
  //
  // FIX-015: Docling strips leading numeric prefixes from headings.
  // e.g. outline has "2. Quick list" but Docling emits <h2>Quick list</h2>.
  // Solution: index BOTH the full title ("2quicklist") AND the stripped version
  // ("quicklist") → the map value is always the original outline title so that
  // sections.title matches what the sidebar passes to scrollToSection().
  const norm = (s: string) => s.toLowerCase().replace(/\W+/g, "");
  // Maps normalised heading variant → original outline title
  const outlineTitleMap = new Map<string, string>();
  function collectTitles(nodes: OutlineNode[]) {
    for (const n of nodes) {
      const full = norm(n.title);
      outlineTitleMap.set(full, n.title);
      // Also register without the leading "N." / "N.M." numeric prefix
      const stripped = norm(n.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
      if (stripped && stripped !== full) outlineTitleMap.set(stripped, n.title);
      if (n.children?.length) collectTitles(n.children);
    }
  }
  collectTitles(outline);
  // If the outline is empty (no data yet) → fall back: every heading creates a section
  const hasOutline = outlineTitleMap.size > 0;



  // ── PDF page tracking (FIX-016) ─────────────────────────────────────────────
  // Backend injects <div class="pdf-page-sep" data-page="N"> before each page.
  // We collect page numbers and insert visual markers into the section content.
  const pdfPageNos: number[] = [];
  let currentPageNo = 1;

  // Classes that mark a <div> as a content leaf — do NOT recurse into these,
  // they must be kept intact so their CSS class is preserved for styling.
  const LEAF_DIV_CLASSES = [
    "formula-not-decoded", "formula", "equation",
    "table-wrap", "tw", "fig-wrap", "caption",
  ];

  // Heuristic: detect page-header / page-footer elements to skip from rendering.
  // Docling doesn't mark these with distinct classes; we detect them by content shape.
  const PAGE_NUM_RE = /^\s*\d+[-–]\d+\s*$|^\s*[ivxlcdmIVXLCDM]{1,5}\s*$/;
  const isPageHeaderFooter = (el: HTMLElement): boolean => {
    const tag = el.tagName ?? "";
    const text = (el.textContent ?? "").trim();
    // 1. Standalone page number paragraph: "1-1", "A-3", "iv"
    if ((tag === "P" || tag === "SPAN") && PAGE_NUM_RE.test(text)) return true;
    // 2. Short italic-only paragraph (≤10 words) → running document header
    if (tag === "P") {
      const children = Array.from(el.childNodes);
      const allItalic = children.length > 0 && children.every(
        (c) => (c as HTMLElement).tagName === "EM" || (c as HTMLElement).tagName === "I" ||
               c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim() === "",
      );
      if (allItalic && text.split(/\s+/).length <= 12) return true;
    }
    return false;
  };

  // FIX-036: Docling sometimes renders multi-column page layouts as <table>.
  // Detect these "layout tables" (cells contain headings or docling-page divs)
  // and treat them transparently — recurse into cell content instead of cloning.
  const isLayoutTable = (table: Element): boolean => {
    // If THIS table (not nested ones) has a caption or th → data table, not layout.
    // Must check with closest("table") === table to avoid false-positives from
    // inner data tables that happen to have captions or header cells.
    const hasOwnCaption = Array.from(table.querySelectorAll("caption")).some(
      (el) => el.closest("table") === table,
    );
    const hasOwnTh = Array.from(table.querySelectorAll("th")).some(
      (el) => el.closest("table") === table,
    );
    if (hasOwnCaption || hasOwnTh) return false;

    const cells = table.querySelectorAll("td");
    for (const cell of Array.from(cells)) {
      if (cell.querySelector("h1,h2,h3,h4,div.docling-page,div.pdf-page-sep")) return true;
      if (cell.querySelectorAll("p").length > 1) return true;
      if ((cell.textContent ?? "").trim().length > 150) return true;
    }

    // A single row with two cells (classic two-column text layout) is a layout table
    const rows = table.querySelectorAll("tr");
    if (rows.length === 1 && cells.length === 2) return true;

    return false;
  };

  // Recursive: transparent <div>/<article>/<main> containers are unwrapped so that
  // headings inside <div class='page'> (Docling output) are properly detected.
  function processNode(child: ChildNode) {
    const el = child as HTMLElement;
    const tag = el.tagName ?? "";
    const isHTag = /^H[1-4]$/.test(tag);
    const headingText = isHTag ? (el.textContent?.trim() ?? "") : "";

    // ── PDF page separator injected by backend (FIX-016) ──────────────────────
    // <div class="pdf-page-sep" data-page="N"> marks a page boundary.
    // Insert a visual marker and record the page number. Do NOT create a section.
    if (tag === "DIV" && el.classList?.contains("pdf-page-sep")) {
      const pageNo = parseInt(el.getAttribute("data-page") ?? "0");
      if (pageNo > 0) {
        currentPageNo = pageNo;
        if (!pdfPageNos.includes(pageNo)) pdfPageNos.push(pageNo);
        const marker = parsed.createElement("div");
        marker.className = "pdf-page-marker";
        marker.setAttribute("data-page", String(pageNo));
        // Nom court du document pour l'en-tête/pied de page
        // Skip generic/placeholder filenames like "source.pdf", "document.pdf", "upload.pdf"
        const GENERIC_NAME_RE = /^(source|document|upload|untitled|file|temp|tmp|pdf)$/i;
        const cleanName = cleanPdfTitle(pdfTitle) || (docFilename ? docFilename.replace(/\.[^.]+$/, "") : "");
        const docName = (cleanName && !GENERIC_NAME_RE.test(cleanName))
          ? cleanName.slice(0, 50)
          : "";
        const prevPage = pageNo - 1;
        // Génère : pied de page N-1 (si applicable) + ligne de séparation + en-tête page N
        const docSpan = docName ? `<span class="pdf-pbb-doc" title="${docName}">${docName}</span>` : "";
        marker.innerHTML = `
          ${prevPage > 0 ? `
          <div class="pdf-page-footer-bar">
            ${docSpan}
            <span class="pdf-pbb-pg">${prevPage}</span>
          </div>
          ` : ""}
          <div class="pdf-page-divider-line"></div>
          <div class="pdf-page-header-bar">
            ${docSpan}
            <span class="pdf-pbb-pg pdf-pbb-pg--current">Page&nbsp;${pageNo}</span>
          </div>
        `;
        if (!cur) {
          cur = parsed.createElement("section");
          cur.setAttribute("data-sid", "rs_pre");
          root.appendChild(cur);
        }
        cur.appendChild(marker);
      }
      return;
    }
    // Docling page wrapper <div class="docling-page"> → transparent, recurse into it
    // FIX-021: strip the first captionless embedded figure (full-page raster from
    // split_page_view=True that appears INSIDE the page-div instead of before it)
    if (tag === "DIV" && el.classList?.contains("docling-page")) {
      const allChildren = Array.from(el.childNodes);
      let startIdx = 0;
      // Skip leading whitespace text nodes
      while (startIdx < allChildren.length) {
        const c = allChildren[startIdx];
        if (c.nodeType === Node.TEXT_NODE && !(c.textContent ?? "").trim()) {
          startIdx++;
          continue;
        }
        break;
      }
      // Check if first non-whitespace child is a captionless embedded image (raster)
      if (startIdx < allChildren.length) {
        const firstEl = allChildren[startIdx] as HTMLElement;
        if (firstEl.tagName === "FIGURE" && !firstEl.querySelector("figcaption")) {
          const img = firstEl.querySelector("img");
          const src = img?.getAttribute("src") ?? "";
          if (src.startsWith("data:image/")) startIdx++; // skip raster
        } else if (firstEl.tagName === "IMG") {
          const src = firstEl.getAttribute("src") ?? "";
          if (src.startsWith("data:image/")) startIdx++; // skip standalone raster
        }
      }
      for (let j = startIdx; j < allChildren.length; j++) processNode(allChildren[j] as ChildNode);
      return;
    }
    // FIX-036: layout table → transparent container, recurse into content cell(s) only
    if (tag === "TABLE" && isLayoutTable(el)) {
      const rows = el.querySelectorAll("tr");
      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll("td");
        let contentCell: Element | null = null;
        for (const cell of Array.from(cells)) {
          if (cell.querySelector(".docling-page, .pdf-page-sep")) {
            contentCell = cell;
            break;
          }
        }
        if (contentCell) {
          for (const sub of Array.from(contentCell.childNodes)) processNode(sub as ChildNode);
          // FIX-039: If the content cell is empty (appendix raster pages — Docling puts the
          // full-page screenshot in the left column while docling-page is blank), fall through
          // and also process the other cells so the image is visible in the Reader.
          const hasText = !!(contentCell.textContent ?? "").trim();
          const hasImg  = !!contentCell.querySelector("img");
          if (!hasText && !hasImg) {
            for (const cell of Array.from(cells)) {
              if (cell === contentCell) continue;
              for (const sub of Array.from(cell.childNodes)) processNode(sub as ChildNode);
            }
          } else {
            // FIX-041: Include images from image-only side cells for cover page (page 1) only.
            // For other pages, the side cell image is just the full-page PDF screenshot,
            // which we do NOT want to show in the Reader.
            if (currentPageNo === 1) {
              for (const cell of Array.from(cells)) {
                if (cell === contentCell) continue;
                if ((cell.textContent ?? "").trim()) continue; // has text → skip
                for (const fig of Array.from(cell.querySelectorAll(":scope > figure, :scope > img"))) {
                  processNode(fig as ChildNode);
                }
              }
            }
          }
        } else {
          // Fallback if no page marker found
          for (const cell of Array.from(cells)) {
            for (const sub of Array.from(cell.childNodes)) processNode(sub as ChildNode);
          }
        }
      }
      return;
    }

    // A heading creates a NEW section only if:
    //   - outline is empty (fallback mode), OR
    //   - its normalised text (full OR stripped of numeric prefix) matches an outline entry
    const headingNorm = norm(headingText);
    // Lookup: try full match first, then substring inclusion for robustness
    const matchedOutlineTitle =
      outlineTitleMap.get(headingNorm) ??
      // e.g. Docling emits "2.1 Composite beams" vs outline "2.1 Composite beams" — same
      // Or Docling emits "Composite beams" vs outline "2.1 Composite beams" — stripped match
      (hasOutline
        ? [...outlineTitleMap.entries()].find(
            ([k]) => k === headingNorm || headingNorm.includes(k) || k.includes(headingNorm),
          )?.[1]
        : undefined) ??
      null;
    const isRealSection = isHTag && (!hasOutline || matchedOutlineTitle !== null);

    // Leaf divs (formula-not-decoded, table-wrap, etc.) must stay intact
    const isLeafDiv =
      tag === "DIV" &&
      LEAF_DIV_CLASSES.some((cls) => el.classList?.contains(cls));

    // Skip page headers/footers (page numbers, short running headers)
    if (isPageHeaderFooter(el)) return;

    if (isRealSection) {
      const sid = `rs_${idOffset + idx++}`;
      cur = parsed.createElement("section");
      cur.setAttribute("data-sid", sid);
      root.appendChild(cur);
      sections.push({
        id: sid,
        // Use the outline title (not raw heading text) so scrollToSection matches exactly
        title: matchedOutlineTitle ?? headingText,
        level: parseInt(tag[1]),
      });
      cur.appendChild(child.cloneNode(true));
    } else if (!isLeafDiv && (tag === "DIV" || tag === "ARTICLE" || tag === "MAIN")) {
      // Transparent wrapper — recurse without adding the wrapper itself
      for (const sub of Array.from(child.childNodes)) processNode(sub);
    } else {
      // Non-outline headings (e.g. "See Attachment A:") and all other content
      // flow into the CURRENT section so it isn't left empty.
      if (!cur) {
        cur = parsed.createElement("section");
        cur.setAttribute("data-sid", "rs_pre");
        root.appendChild(cur);
      }
      cur.appendChild(child.cloneNode(true));
    }
  }

  for (const child of Array.from(body.childNodes)) processNode(child);

  // Post-pass: remove <figure> elements that look like page logos or full-page rasters.
  // FIX-011: only figures with NO caption (wordCount === 0) are candidates.
  //   - Tiny images (< 10 000 chars): logos/letterheads → remove
  //   - Very large images (> 150 000 chars ≈ 112 KB): full-page rasters from
  //     split_page_view=True that slipped past the backend/docling-page filters → remove
  //   - Medium images (10 000 – 150 000): legitimate content figures → keep
  root.querySelectorAll("figure").forEach((fig) => {
    const img = fig.querySelector("img");
    if (!img) return;
    const captionText = (fig.querySelector("figcaption, .caption")?.textContent ?? "").trim();
    const wordCount = captionText.split(/\s+/).filter(Boolean).length;
    if (wordCount === 0) {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith("data:")) return; // external URLs: keep
      // FIX-011 : supprime uniquement les micro-images (logos, icônes < 10 000 chars).
      // NE PAS filtrer sur les grandes tailles : les vraies figures de contenu
      // (captures d'écran, schémas, photos) peuvent dépasser 200 000 chars.
      // Les rasters pleine-page sont déjà retirés en amont :
      //   – backend  : _annotate_split_page_divs() PASS 2
      //   – frontend : firstEl sans figcaption dans chaque docling-page
      const isLogo = src.length < 10_000;
      if (isLogo) fig.remove();
    }
  });

  // Strip Docling's inline width/height on images so CSS controls the display size
  // and resolve relative image URLs to the backend API base.
  root.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("width");
    img.removeAttribute("height");
    img.style.removeProperty("width");
    img.style.removeProperty("height");
    img.style.removeProperty("max-width");

    // Resolve relative /doc/... URLs to the backend API base
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("/doc/")) {
      img.setAttribute("src", `${API_BASE}${src}`);
    }
  });

  // ── Strip embedded PDF bullet characters from list items ───────────────────
  // Docling preserves raw PDF bullet chars (· U+00B7, • U+2022, ○ U+25E6, etc.)
  // and the "o" sub-bullet (Word/PDF convention) as the first character of <li> text.
  // The CSS rule `li::marker` already renders a coloured bullet → this creates a
  // double-bullet artefact like "• · text" or "• o text".
  // Fix: strip those leading chars from <li> text nodes so only the CSS marker shows.
  //
  // Also strip from <p> elements used as fake list items when Docling couldn't
  // detect the list structure (shows as "· text" instead of a proper bullet).
  const LEAD_BULLET_RE = /^[·•‣◦▪●■]\s*/;
  // "o " sub-bullet: only strip when "o" is followed by an uppercase letter
  // (avoids stripping words like "or", "on", "other" that legitimately start with "o").
  const LEAD_O_RE = /^o\s+(?=[A-ZÀ-Ü])/;

  const cleanBulletText = (node: ChildNode | null) => {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const raw = node.textContent ?? "";
    const cleaned = raw.replace(LEAD_BULLET_RE, "").replace(LEAD_O_RE, "");
    if (cleaned !== raw) node.textContent = cleaned;
  };

  // Clean <li> elements — CSS li::marker handles the visual bullet
  root.querySelectorAll("li").forEach((li) => {
    cleanBulletText(li.firstChild);
    // Docling sometimes wraps li text in a <p>: <li><p>· text</p></li>
    const firstP = li.querySelector(":scope > p:first-child");
    if (firstP) cleanBulletText(firstP.firstChild);
  });

  // Clean <p> elements used as fake list items (only Unicode bullet chars, not "o")
  // Safe to strip because "o" inside a plain <p> could be a real word start.
  root.querySelectorAll("p").forEach((p) => {
    if (p.closest("li, ul, ol")) return; // skip if already inside a proper list
    if (!p.firstChild || p.firstChild.nodeType !== Node.TEXT_NODE) return;
    const raw = p.firstChild.textContent ?? "";
    const cleaned = raw.replace(LEAD_BULLET_RE, "");
    if (cleaned !== raw) p.firstChild.textContent = cleaned;
  });

  // FIX-014 : strip TOC dot-leaders from <p> and <td> elements (covers cached docs and tables)
  // Docling embeds raw PDF TOC text: "7. Results and reports .....47"
  // Strip the trailing dots+page-number so only the clean title remains.
  const TOC_LEADER_RE = /[\s.·\u00B7\u2022]{3,}\s*\d*\s*(?=\||$|\n)|[\s.·\u00B7\u2022]{5,}\s*\d*\s*/g;
  root.querySelectorAll("p, td").forEach((el) => {
    const raw = el.textContent ?? "";
    if (/[.·\u00B7\u2022]{3,}/.test(raw)) {
      // Has dot-leaders → strip them (and trailing page number)
      const cleaned = raw.replace(TOC_LEADER_RE, "").trim();
      if (cleaned !== raw) el.textContent = cleaned;
      if (!el.textContent.trim() && el.tagName === "P") {
        el.remove();
      }
    }
  });

  // FIX-025 (frontend mirror) : éclater les paragraphes TOC concaténés sans séparateur.
  // Docling peut agréger une page entière de sommaire en un seul <p> sans retour à la ligne.
  // Ex : "1. Welcome to Advance Design 20262.1Composite beams2.2Modeling..."
  // Détection : <p> long (> 100 chars) contenant ≥ 3 numéros de section N.M.
  // Division : insérer un saut avant chaque N.M collé directement au texte précédent.
  root.querySelectorAll("p").forEach((p) => {
    const text = p.textContent ?? "";
    if (text.length < 100) return;
    const sectionNos = text.match(/\d+\.\d/g) ?? [];
    if (sectionNos.length < 3) return;
    const split = text.replace(
      /([A-Za-z\dÀ-ÿ])(\d+\.\d+\s*[A-ZÀ-Ü])/g,
      (_m: string, a: string, b: string) => a + "\n" + b,
    );
    if (split === text) return;
    const lines = split.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const parent = p.parentNode;
    if (!parent) return;
    const ownerDoc = p.ownerDocument;
    lines.forEach((line) => {
      const np = ownerDoc.createElement("p");
      np.textContent = line;
      parent.insertBefore(np, p);
    });
    parent.removeChild(p);
  });

  // FIX-038 + FIX-046: Two-layer TOC detection.
  //
  // Layer 1 (FIX-038, heading-based): find headings whose text matches known TOC
  // title patterns in any language → remove content + heading, insert note.
  // Covers docs where the TOC page starts with an explicit "Contents" heading.
  //
  // Layer 2 (FIX-046, structural): detect TOC pages by content pattern.
  // The backend tags stripped dot-leader paragraphs with class="toc-entry".
  // A page chunk (between pdf-page-marker elements) where ≥4 .toc-entry paragraphs
  // represent ≥60% of all paragraphs is treated as a TOC page → entries removed + note.
  // Covers docs where the TOC has no "Contents" heading (language-independent).

  const _makeTocNote = () => {
    const note = parsed.createElement("p");
    note.className = "toc-sidebar-note";
    note.textContent = "↑ Table of contents available in sidebar";
    return note;
  };

  // ── Layer 1: heading-based (FIX-038) ───────────────────────────────────────
  const TOC_TITLE_RE =
    /^(table\s+of\s+)?contents?$|^sommaire$|^table\s+des\s+mati[eè]res?$|^inhoudsopgave$|^inhoud$|^inhaltsverzeichnis$|^indice$|^index$|^contenido$|^содержание$/i;
  root.querySelectorAll("h1,h2,h3,h4").forEach((heading) => {
    const ht = (heading.textContent ?? "").trim();
    if (!TOC_TITLE_RE.test(ht)) return;

    const parent = heading.parentElement;
    if (!parent) return;

    // Collect siblings to remove: everything after the heading until the next
    // heading or a pdf-page-marker (marks real page boundary).
    const toRemove: ChildNode[] = [];
    let node: ChildNode | null = heading.nextSibling;
    while (node) {
      const el = node as HTMLElement;
      if (el.tagName && /^H[1-4]$/.test(el.tagName)) break;
      if (el.classList?.contains("pdf-page-marker")) break;
      toRemove.push(node);
      node = node.nextSibling;
    }
    for (const n of toRemove) parent.removeChild(n);

    // Replace the heading ITSELF with a single sidebar note (cleaner than keeping it).
    parent.replaceChild(_makeTocNote(), heading);
  });

  // ── Layer 2: structural, page-boundary based (FIX-046) ─────────────────────
  const pageMarkers = Array.from(root.querySelectorAll(".pdf-page-marker"));
  if (pageMarkers.length >= 2) {
    pageMarkers.forEach((marker) => {
      const parent = marker.parentElement;
      if (!parent) return;

      // Collect element siblings that belong to this page (until next marker).
      const pageElems: Element[] = [];
      let cur: ChildNode | null = marker.nextSibling;
      while (cur) {
        if ((cur as Element).classList?.contains("pdf-page-marker")) break;
        if (cur.nodeType === Node.ELEMENT_NODE) pageElems.push(cur as Element);
        cur = cur.nextSibling;
      }

      const paras = pageElems.filter((e) => e.tagName === "P");
      const tocPs = paras.filter((p) => p.classList.contains("toc-entry"));

      // Guard: skip if a note was already placed here by Layer 1.
      const alreadyHandled = pageElems.some((e) => e.classList?.contains("toc-sidebar-note"));
      if (alreadyHandled) return;

      if (tocPs.length >= 4 && tocPs.length >= paras.length * 0.6) {
        // TOC page detected — remove all tagged entries.
        for (const e of tocPs) parent.removeChild(e);
        // Insert note right after the page marker.
        const note = _makeTocNote();
        if (marker.nextSibling) {
          parent.insertBefore(note, marker.nextSibling);
        } else {
          parent.appendChild(note);
        }
      }
    });
  }

  // FIX-040: Strip Docling MathML dollar-sign artifacts.
  // Docling embeds $...$ as <mi>$</mi>...<mi>$</mi> in the MathML body, which renders
  // as visible "$$" in the browser before KaTeX replaces the element.
  // Strip any <mi> or <mo> whose text content is exactly "$".
  root.querySelectorAll("math").forEach((mathEl) => {
    mathEl.querySelectorAll("mi, mo").forEach((el) => {
      if ((el.textContent ?? "").trim() === "$") el.remove();
    });
  });

  // ── Restructure flat lists into nested lists (FIX-021) ─────────────────────
  // Docling outputs hierarchical lists in a flat structure, e.g.:
  //   <li style="list-style-type: '...';">Title (Parent)</li>
  //   <li>Description (Child)</li>
  // We restructure them to nest the unstyled description items under their preceding parent.
  root.querySelectorAll("ul, ol").forEach((listEl) => {
    const list = listEl as HTMLElement;
    const lis = Array.from(list.querySelectorAll(":scope > li")) as HTMLElement[];
    if (lis.length === 0) return;

    // Check if this list contains a mix of styled and unstyled items
    const hasStyled = lis.some((li) => {
      const style = li.getAttribute("style") ?? "";
      return style.includes("list-style-type");
    });
    const hasUnstyled = lis.some((li) => {
      const style = li.getAttribute("style") ?? "";
      return !style.includes("list-style-type");
    });

    if (hasStyled && hasUnstyled) {
      let lastParentLi: HTMLElement | null = null;
      let currentSubList: HTMLUListElement | null = null;

      lis.forEach((li) => {
        const style = li.getAttribute("style") ?? "";
        const isParent = style.includes("list-style-type");

        if (isParent) {
          lastParentLi = li;
          currentSubList = null; // reset sub-list for new parent

          // Make the parent text bold
          const inlineNodes = Array.from(li.childNodes).filter((node) => {
            return node.nodeName !== "UL" && node.nodeName !== "OL";
          });
          if (inlineNodes.length > 0) {
            const isAlreadyStrong = inlineNodes.length === 1 && inlineNodes[0].nodeName === "STRONG";
            if (!isAlreadyStrong) {
              const strong = root.ownerDocument.createElement("strong");
              inlineNodes.forEach((node) => {
                strong.appendChild(node);
              });
              li.insertBefore(strong, li.firstChild);
            }
          }
        } else {
          // Unstyled item -> nest under the last parent
          if (lastParentLi) {
            if (!currentSubList) {
              currentSubList = root.ownerDocument.createElement("ul");
              lastParentLi.appendChild(currentSubList);
            }
            currentSubList.appendChild(li);
          }
        }
      });
    }
  });

  // ── F6.7 : Images à taille proportionnelle ────────────────────────────────
  // Docling peut poser des attributs width/height sur les <img> qui forcent
  // les images à pleine largeur ou à une taille arbitraire.
  // On retire ces attributs pour laisser le CSS (max-width: 100%; width: auto)
  // contrôler l'affichage, puis on fixe un max-width basé sur les dimensions
  // réelles du PNG encodé en base64.
  //
  // Lecture des dimensions PNG : le header IHDR est aux bytes 16-23 (big-endian).
  // En base64, 24 bytes = 32 chars. On n'en décode que les 32 premiers.
  const _getPngWidth = (src: string): number | null => {
    const PREFIX = "data:image/png;base64,";
    if (!src.startsWith(PREFIX)) return null;
    try {
      const bin = atob(src.slice(PREFIX.length, PREFIX.length + 32));
      if (bin.length < 20) return null;
      // bytes 16-19 : largeur PNG (big-endian uint32)
      return ((bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) |
              (bin.charCodeAt(18) << 8)  |  bin.charCodeAt(19)) >>> 0;
    } catch { return null; }
  };

  // Référence : largeur physique d'une page A4 à 150 DPI ≈ 1240 px
  // (Docling extrait à 144 DPI → ~1190 px ; on utilise 1240 comme plafond conservatif)
  const PAGE_FULL_WIDTH = 1240;

  root.querySelectorAll("img").forEach((el) => {
    const img = el as HTMLImageElement;
    // Retirer les attributs statiques qui bloquent le CSS
    img.removeAttribute("width");
    img.removeAttribute("height");
    img.style.removeProperty("width");
    img.style.removeProperty("height");
    // Pour les PNG base64 : fixer max-width à la largeur naturelle de l'image
    // → les petites images (logos, schémas) ne s'étirent plus à pleine largeur
    const pngW = _getPngWidth(img.src);
    if (pngW && pngW < PAGE_FULL_WIDTH * 0.85) {
      // L'image occupe moins de 85 % de la largeur page → cap à sa taille naturelle
      img.style.maxWidth = `min(${pngW}px, 100%)`;
    }
    // > 85 % : pleine largeur autorisée (diagramme, graphe pleine colonne)
  });

  // ── TD-011 : Tables dans le Reader ────────────────────────────────────────
  // Docling enveloppe parfois des rasters pleine-page dans <table><tbody><tr><td><figure>
  // Ces « image-tables » ne contiennent aucun texte et doivent être supprimées.
  // Les vraies tables (texte ≥ 20 chars) sont enveloppées dans un .table-wrap scrollable.

  // PASS A — supprimer les tables qui ne contiennent que des images base64
  root.querySelectorAll("table").forEach((table) => {
    const textLen = (table.textContent ?? "").trim().length;
    if (textLen > 20) return; // a du texte → vraie table, on garde
    if (table.querySelector("img[src^='data:image/']")) {
      // Raster pur — retirer la table (et son éventuel wrapper)
      const wrapper = table.closest(".table-wrap, .tw");
      (wrapper ?? table).remove();
    }
  });

  // PASS B — envelopper les tables restantes dans .table-wrap (scroll horizontal + style)
  root.querySelectorAll("table").forEach((table) => {
    if (isLayoutTable(table)) return; // Skip layout tables from wrapping & promotions
    if (table.closest(".table-wrap, .tw")) return; // déjà enveloppée
    const wrapper = table.ownerDocument.createElement("div");
    wrapper.className = "table-wrap";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    // Promouvoir la 1ère ligne en en-tête si aucun <thead> présent
    if (!table.querySelector("thead")) {
      const firstRow = table.querySelector("tr");
      if (firstRow) {
        const thead = table.ownerDocument.createElement("thead");
        firstRow.parentNode?.insertBefore(thead, firstRow);
        thead.appendChild(firstRow);
        // Transformer les <td> de la 1ère ligne en <th>
        firstRow.querySelectorAll("td").forEach((td) => {
          const th = table.ownerDocument.createElement("th");
          th.innerHTML = td.innerHTML;
          Array.from(td.attributes).forEach((a) => th.setAttribute(a.name, a.value));
          td.replaceWith(th);
        });
      }
    }
  });

  // PASS C — tables vides (caption sans données) : Docling n'a pas extrait les lignes
  root.querySelectorAll(".table-wrap").forEach((wrapper) => {
    const table = wrapper.querySelector("table");
    if (!table) return;
    if (table.querySelector("tr")) return; // contient des lignes → vraie table, on garde
    const captionText = (table.querySelector("caption")?.textContent ?? "").trim();
    const notice = parsed.createElement("div");
    notice.className = "table-unavailable";
    if (captionText) {
      const cap = parsed.createElement("p");
      cap.className = "table-unavailable-caption";
      cap.textContent = captionText;
      notice.appendChild(cap);
    }
    const msg = parsed.createElement("p");
    msg.className = "table-unavailable-msg";
    msg.textContent = "Tableau non extrait — consulter le PDF";
    notice.appendChild(msg);
    wrapper.replaceWith(notice);
  });

  // Count figures, tables, formulas (avoiding double-counting)
  const figures = new Set<Element>();
  root.querySelectorAll("figure, .fig-wrap").forEach(el => {
    let parent = el.parentElement;
    let hasAncestorInSet = false;
    while (parent) {
      if (parent.tagName === "FIGURE" || parent.classList.contains("fig-wrap")) {
        hasAncestorInSet = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!hasAncestorInSet) {
      figures.add(el);
    }
  });
  const nFigures = figures.size;

  const tables = new Set<Element>();
  root.querySelectorAll("table, .table-wrap, .tw").forEach(el => {
    let parent = el.parentElement;
    let hasAncestorInSet = false;
    while (parent) {
      if (parent.tagName === "TABLE" || parent.classList.contains("table-wrap") || parent.classList.contains("tw")) {
        hasAncestorInSet = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!hasAncestorInSet) {
      tables.add(el);
    }
  });
  const nTables = tables.size;

  const formulas = new Set<Element>();
  root.querySelectorAll(".formula, .equation, .formula-not-decoded, math").forEach(el => {
    let parent = el.parentElement;
    let hasAncestorInSet = false;
    while (parent) {
      if (parent.classList.contains("formula") || parent.classList.contains("equation") || parent.classList.contains("formula-not-decoded") || parent.tagName === "MATH") {
        hasAncestorInSet = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!hasAncestorInSet) {
      formulas.add(el);
    }
  });
  const nFormulas = formulas.size;

  // Merge label paragraph ending with colon with next sibling paragraph
  root.querySelectorAll("p").forEach((p) => {
    const text = (p.textContent ?? "").trim();
    if (p.parentNode && text.endsWith(":") && text.length < 50) {
      const next = p.nextElementSibling;
      if (next && next.tagName === "P") {
        const nextText = (next.textContent ?? "").trim();
        if (!nextText.endsWith(":")) {
          p.innerHTML = `<strong>${p.innerHTML}</strong> ${next.innerHTML}`;
          next.remove();
        }
      }
    }
  });

  // Split cells with space-separated short codes or numbers using <br>
  root.querySelectorAll("td").forEach((td) => {
    const text = (td.textContent ?? "").trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const allMatch = tokens.every((tok) => {
        return /^\d+(?:[.,]\d+)?$/.test(tok) || /^[a-zA-Z]\d+$/.test(tok);
      });
      if (allMatch) {
        td.innerHTML = tokens.join("<br>");
      }
    }
  });

  const words = body.textContent?.split(/\s+/).filter(Boolean).length ?? 0;
  return { html: root.innerHTML, sections, words, nFigures, nTables, nFormulas, pdfPageNos };
}

export function parseMdSections(md: string): Section[] {
  const sections: Section[] = [];
  let idx = 0;
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) sections.push({ id: `rs_${idx++}`, title: m[2].trim(), level: m[1].length });
  }
  return sections;
}

export function matchSection(sections: Section[], title: string): Section | null {
  const n = (s: string) => s.toLowerCase().replace(/\W+/g, "");
  const t = n(title);
  return (
    sections.find((s) => n(s.title) === t) ??
    sections.find((s) => n(s.title).includes(t) || t.includes(n(s.title))) ??
    null
  );
}

/** Aplatit un arbre OutlineNode en liste ordonnée avec profondeur.
 *  Utilisé par la mini-TOC pour afficher le même sommaire que la sidebar.
 *  maxDepth limite la profondeur (0 = racine seulement, 1 = racine + enfants directs, …). */
export function flattenOutline(
  nodes: OutlineNode[],
  depth = 0,
  maxDepth = Infinity,
): Array<{ node: OutlineNode; depth: number }> {
  const result: Array<{ node: OutlineNode; depth: number }> = [];
  for (const n of nodes) {
    result.push({ node: n, depth });
    if (n.children?.length && depth < maxDepth)
      result.push(...flattenOutline(n.children, depth + 1, maxDepth));
  }
  return result;
}

// ── Paper metadata extraction ─────────────────────────────────────────────────

export function extractPaperMeta(html: string): PaperMeta {
  const tmp = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const pre = tmp.querySelector('[data-sid="rs_pre"], section[data-sid]:first-child');
  if (!pre) return { title: null, authors: [], abstract: null, keywords: [] };

  const h1 = tmp.querySelector("h1");
  const title = h1?.textContent?.trim() ?? null;

  const paras = Array.from(pre.querySelectorAll("p")).map((p) => p.textContent?.trim() ?? "");

  const authorsRaw: string[] = [];
  let abstractIdx = -1;
  for (let i = 0; i < paras.length; i++) {
    const lo = paras[i].toLowerCase();
    if (lo === "abstract" || lo.startsWith("abstract\n") || lo.startsWith("abstract —") || lo.startsWith("abstract—")) {
      abstractIdx = i;
      break;
    }
    if (paras[i].length < 200 && (paras[i].includes(",") || paras[i].includes("·") || paras[i].includes("•"))) {
      authorsRaw.push(paras[i]);
    }
  }

  const authors: string[] = [];
  authorsRaw.join(" ").split(/[,·•;]/).forEach((a) => {
    const s = a.trim().replace(/^\d+\s*/, "");
    if (s.length > 2 && s.length < 60) authors.push(s);
  });

  let abstract: string | null;
  if (abstractIdx >= 0 && paras[abstractIdx + 1]) {
    abstract = paras[abstractIdx + 1];
  } else {
    abstract = paras.find((p) => p.length > 100) ?? null;
  }

  const keywords: string[] = [];
  for (let i = Math.max(0, abstractIdx); i < paras.length; i++) {
    const lo = paras[i].toLowerCase();
    if (lo.includes("keyword") || lo.includes("index term")) {
      paras[i].replace(/^keywords?[:\s—–-]*/i, "").replace(/^index terms?[:\s—–-]*/i, "")
        .split(/[,;·•]/).forEach((k) => {
          const s = k.trim();
          if (s.length > 1 && s.length < 50) keywords.push(s);
        });
      break;
    }
  }

  return { title, authors, abstract, keywords };
}

export interface Highlight {
  text: string;
  color: string;
  key: string;
}

export function highlightTextInElement(container: HTMLElement, textToHighlight: string, color: string, key: string, hasNote: boolean) {
  if (!textToHighlight || textToHighlight.length < 3) return;

  const walk = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".reader-hl, script, style, .formula, .equation")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes: Text[] = [];
  let currentNode = walk.nextNode() as Text | null;
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walk.nextNode() as Text | null;
  }

  for (const node of textNodes) {
    const val = node.nodeValue ?? "";
    const index = val.indexOf(textToHighlight);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + textToHighlight.length);

      const span = document.createElement("span");
      span.className = `reader-hl${hasNote ? " reader-hl--has-note" : ""}`;
      span.style.backgroundColor = color;
      span.setAttribute("data-key", key);
      span.setAttribute("data-color", color);

      try {
        range.surroundContents(span);
      } catch (err) {
        console.warn("Restore highlight surround error:", err);
      }
    }
  }
}

export function removeAllHighlights(container: HTMLElement) {
  const spans = container.querySelectorAll(".reader-hl");
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    }
  });
  container.normalize();
}
