import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import katex from "katex";
import { htmlUrl, htmlManifestUrl, htmlPartUrl, markdownUrl, API_BASE, getAnnotations, saveAnnotations, ficheUrl } from "../../api";
import type { HtmlManifestEntry, OutlineNode, Figure, AnnotationStore } from "../../types";
import { FigureOverlay } from "../Figure/FigureOverlay";
import "./MarkdownReader.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  level: number;
}

export type ReaderTheme = "reading" | "article" | "report" | "interactive" | "cstb";

/** Imperative handle exposed via ref — used for synchronized compare mode */
export interface ReaderHandle {
  /** Scroll to the section matching `title` (no focus activation) */
  scrollToSection(title: string): void;
}

type AppTheme =
  | "glassmorphism"
  | "minimalist"
  | "technical"
  | "vintage"
  | "oled"
  | "forest"
  | "cstb"
  | "swiss"
  | "eink"
  | "hud";

interface Props {
  docId: string;
  filename?: string;
  pdfTitle?: string;
  outline?: OutlineNode[];
  theme: ReaderTheme;
  onThemeChange: (t: ReaderTheme) => void;
  focusSectionTitle?: string | null;
  onFocusClear?: () => void;
  appTheme?: AppTheme;
  isDark?: boolean;
  onDarkChange?: (d: boolean) => void;
  /** Appelé quand l'utilisateur fait défiler le Reader et qu'une nouvelle page PDF devient visible.
   *  Permet la synchronisation Reader → PDF Viewer (sens inverse de handlePageChange). */
  onPageChange?: (page: number) => void;
  /** Vrai uniquement en mode Compare — affiche les séparateurs de pages PDF et la barre de nav.
   *  En mode Reader seul le contenu coule librement sans structure de pagination PDF. */
  compareMode?: boolean;
  searchQuery?: string;
}

interface PaperMeta {
  title: string | null;
  authors: string[];
  abstract: string | null;
  keywords: string[];
}

type FontSize = "sm" | "md" | "lg" | "xl" | "xxl";
type LineHeight = "compact" | "normal" | "relaxed";
type FontFamily = "serif" | "sans";

const cleanPdfTitle = (title?: string) => {
  if (!title) return "";
  return title.replace(/^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)/i, "").trim();
};

// ── HTML parsing ──────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components -- pure helper exported for unit tests, not a component
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
      if (name.startsWith("on") || value.startsWith("javascript:")) {
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
          // FIX-035: rasters are de-embedded to /html-image/ URLs → match both schemes.
          if (src.startsWith("data:image/") || src.includes("/html-image/")) startIdx++; // skip raster
        } else if (firstEl.tagName === "IMG") {
          const src = firstEl.getAttribute("src") ?? "";
          if (src.startsWith("data:image/") || src.includes("/html-image/")) startIdx++; // skip standalone raster
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
            // FIX-041: Include images from image-only side cells for the cover (page 1) ONLY
            // when the content cell has no extracted text. Otherwise the side image is just the
            // full-page PDF screenshot, which duplicates the extracted content (TD-014).
            if (currentPageNo === 1 && !hasText) {
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
      const isEmbedded = src.startsWith("data:");
      const isDeembedded = src.includes("/html-image/"); // FIX-035 de-embedded images
      if (!isEmbedded && !isDeembedded) return; // genuine external URLs: keep
      // FIX-011 : supprime uniquement les micro-images (logos, icônes).
      // NE PAS filtrer les vraies figures de contenu (captures, schémas, photos).
      // FIX-035 : les images de-embeddées portent leurs dimensions pixel dans data-w/data-h ;
      // les images base64 retombent sur la longueur (~10 000 chars ≈ une petite icône).
      const w = parseInt(img.getAttribute("data-w") ?? "", 10);
      const h = parseInt(img.getAttribute("data-h") ?? "", 10);
      const LOGO_MAX_PX = 120;
      const isLogo = (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
        ? (w <= LOGO_MAX_PX && h <= LOGO_MAX_PX)
        : (isEmbedded && src.length < 10_000);
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
  root.querySelectorAll("p, td, th").forEach((el) => {
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
      // FIX-025: \d+(?:\.\d+)+ matches 2-level (6.1) AND deeper (6.1.1) section numbers.
      /([A-Za-z\dÀ-ÿ])(\d+(?:\.\d+)+\s*[A-ZÀ-Ü])/g,
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

  // FIX-046b: remove TOC *tables*. A sommaire spilling onto a later page renders as a
  // bare <table> with no "Contents" heading, so Layer 1 (heading-based, stops at the
  // page marker) and Layer 2 (<p class="toc-entry"> only) both miss it. Detect a table
  // whose rows mostly start with a section number (1, 2.1, 6.1.1…) and drop it.
  const _SECTION_NO_RE = /^\s*\d+(?:\.\d+)*\.?(?:\s|$)/;
  root.querySelectorAll("table").forEach((table) => {
    const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
    if (rows.length < 4) return;
    const tocRows = rows.filter((r) => {
      const cell = r.querySelector(":scope > td, :scope > th");
      return !!cell && _SECTION_NO_RE.test((cell.textContent ?? "").trim());
    });
    if (tocRows.length < 4 || tocRows.length < rows.length * 0.7) return;
    const target = table.closest(".table-wrap, .tw") ?? table;
    // Keep a single sidebar note (Layer 1 may already have placed one for an earlier page).
    if (root.querySelector(".toc-sidebar-note")) target.remove();
    else target.replaceWith(_makeTocNote());
  });

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
    // FIX-035 : les images de-embeddées portent leur largeur naturelle dans data-w ;
    // les PNG base64 retombent sur le parsing de l'en-tête PNG.
    const dataW = parseInt(img.getAttribute("data-w") ?? "", 10);
    const pngW = (Number.isFinite(dataW) && dataW > 0) ? dataW : _getPngWidth(img.src);
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
    if (table.querySelector("img[src^='data:image/'], img[src*='/html-image/']")) {
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

function parseMdSections(md: string): Section[] {
  const sections: Section[] = [];
  let idx = 0;
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) sections.push({ id: `rs_${idx++}`, title: m[2].trim(), level: m[1].length });
  }
  return sections;
}

function matchSection(sections: Section[], title: string): Section | null {
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
function flattenOutline(
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

function extractPaperMeta(html: string): PaperMeta {
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
  section?: string;
  sectionTitle?: string;
  page?: number;
  prefix?: string;
  suffix?: string;
}

// Collect text nodes under `scope`, skipping already-highlighted spans,
// scripts, styles, and math (same exclusions as the original FIX).
function collectTextNodes(scope: Element): Text[] {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest(".reader-hl, script, style, .formula, .equation")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Text);
    n = walker.nextNode();
  }
  return nodes;
}

// Wrap a [start,end) char range inside a single text node with a hl span.
function wrapRange(
  node: Text, start: number, end: number,
  color: string, key: string, hasNote: boolean,
): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const span = document.createElement("span");
  span.className = `reader-hl${hasNote ? " reader-hl--has-note" : ""}`;
  span.style.backgroundColor = color;
  span.setAttribute("data-key", key);
  span.setAttribute("data-color", color);
  range.surroundContents(span);
}

// Restore one highlight: find its text within its section (or whole doc as
// fallback) using a concatenated-string offset map, then wrap every text-node
// segment the match spans.
function restoreHighlight(
  docEl: Element,
  hl: { text: string; color: string; key: string; section?: string;
        prefix?: string; suffix?: string },
  hasNote: boolean,
): boolean {
  if (!hl.text) return false;

  let scope: Element = docEl;
  if (hl.section) {
    const found = docEl.querySelector(`section[data-sid="${CSS.escape(hl.section)}"]`);
    if (found) scope = found;
  }

  const nodes = collectTextNodes(scope);
  if (nodes.length === 0) return false;

  // Build concatenated string + a map of which node each char came from.
  let full = "";
  const map: { node: Text; start: number }[] = [];
  for (const node of nodes) {
    map.push({ node, start: full.length });
    full += node.data;
  }

  // Prefer prefix+text+suffix (disambiguates repeated phrases), then text.
  let matchStart = -1;
  const matchLen = hl.text.length;
  if (hl.prefix || hl.suffix) {
    const probe = (hl.prefix ?? "") + hl.text + (hl.suffix ?? "");
    const at = full.indexOf(probe);
    if (at >= 0) {
      matchStart = at + (hl.prefix ?? "").length;
    }
  }
  if (matchStart < 0) matchStart = full.indexOf(hl.text);
  if (matchStart < 0) return false;
  const matchEnd = matchStart + matchLen;

  // Find node index for a given absolute offset.
  const nodeIndexAt = (offset: number): number => {
    let lo = 0, hi = map.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (map[mid].start <= offset) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  };

  // Wrap each segment, back-to-front so earlier offsets stay valid.
  const segments: { node: Text; start: number; end: number }[] = [];
  const firstIdx = nodeIndexAt(matchStart);
  const lastIdx = nodeIndexAt(matchEnd - 1);
  for (let i = firstIdx; i <= lastIdx; i++) {
    const nodeStartAbs = map[i].start;
    const nodeLen = map[i].node.data.length;
    const segStart = Math.max(0, matchStart - nodeStartAbs);
    const segEnd = Math.min(nodeLen, matchEnd - nodeStartAbs);
    if (segEnd > segStart) {
      segments.push({ node: map[i].node, start: segStart, end: segEnd });
    }
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    try {
      wrapRange(s.node, s.start, s.end, hl.color, hl.key, hasNote);
    } catch {
      // surroundContents throws if the range partially selects a non-text
      // node; skip that segment rather than abort the whole restore.
    }
  }
  return true;
}

function removeAllHighlights(container: HTMLElement) {
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


// djb2 → base36, deterministic short hash for stable keys.
function shortHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Normalize selected text for hashing (collapse whitespace, lowercase).
function normForKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Nearest enclosing section[data-sid] + its heading text.
function findSectionInfo(node: Node | null): { section: string; sectionTitle: string } {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  const sec = el?.closest("section[data-sid]") as HTMLElement | null;
  if (!sec) return { section: "", sectionTitle: "" };
  const heading = sec.querySelector("h1,h2,h3,h4");
  return {
    section: sec.getAttribute("data-sid") ?? "",
    sectionTitle: heading?.textContent?.trim() ?? "",
  };
}

// Page number from the nearest preceding .pdf-page-marker[data-page].
function findPageNo(docEl: Element, node: Node | null): number {
  if (!node) return 0;
  const markers = Array.from(docEl.querySelectorAll(".pdf-page-marker[data-page]"));
  let page = 0;
  for (const m of markers) {
    const pos = m.compareDocumentPosition(node);
    // marker is BEFORE node → node comes after this marker
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      page = parseInt(m.getAttribute("data-page") || "0", 10) || page;
    } else {
      break;
    }
  }
  return page;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const MarkdownReader = forwardRef<ReaderHandle, Props>((
  props: Props,
  ref,
) => {
  const { docId, filename, pdfTitle, outline, theme, onThemeChange, focusSectionTitle, onFocusClear, appTheme, onPageChange, compareMode = false, searchQuery: propSearchQuery } = props;
  // FIX-026 : ref pour éviter la boucle infinie Reader → PDF → Reader lors des scrolls programmatiques.
  // scrollToSection/scrollToPage positionne ce flag à true ; le scroll handler ne propagera pas
  // onPageChange pendant la durée de l'animation (≈ 600 ms).
  const isProgrammaticScrollRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [md, setMd] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [rawHtmlForDownload, setRawHtmlForDownload] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [words, setWords] = useState(0);
  const [stats, setStats] = useState({ nFigures: 0, nTables: 0, nFormulas: 0 });
  const [htmlAvailable, setHtmlAvailable] = useState(false);
  const [htmlTooLarge, setHtmlTooLarge] = useState(false);  // FIX-034 : HTML > seuil → markdown
  const [renderMode, setRenderMode] = useState<"html" | "md">("md");
  // isDark : synchronisé sur le prop global isDark, sinon local
  const darkThemes: AppTheme[] = ["oled", "forest"];
  const [localIsDark, setLocalIsDark] = useState(
    () => appTheme ? darkThemes.includes(appTheme)
                   : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark = props.isDark !== undefined ? props.isDark : localIsDark;
  const setIsDark = props.onDarkChange !== undefined ? props.onDarkChange : setLocalIsDark;

  // Mettre à jour isDark quand appTheme change
  useEffect(() => {
    if (appTheme) {
      const isDarkTheme = appTheme === "glassmorphism" || appTheme === "technical" || appTheme === "oled";
      setIsDark(isDarkTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appTheme]);
  const [fontSize, setFontSize] = useState<FontSize>("md");
  const [lineHeight, setLineHeight] = useState<LineHeight>("normal");
  const [fontFamily, setFontFamily] = useState<FontFamily>("sans");
  const [focusSid, setFocusSid] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [showTypoPop, setShowTypoPop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperMeta, setPaperMeta] = useState<PaperMeta | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string>(() =>
    cleanPdfTitle(pdfTitle) || (filename ? filename.replace(/\.[^.]+$/, "") : "Document")
  );
  const [readerImageIdx, setReaderImageIdx] = useState<number | null>(null);
  const [readerImages, setReaderImages] = useState<Figure[]>([]);
  const [showMiniToc, setShowMiniToc] = useState(false);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [readerZoom, setReaderZoom] = useState(100);
  const [showZoomPop, setShowZoomPop] = useState(false);

  // ── Search state ────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Synchronise la recherche globale de la sidebar avec le Reader
  useEffect(() => {
    if (propSearchQuery !== undefined) {
      setSearchQuery(propSearchQuery);
      if (propSearchQuery.trim()) {
        setShowSearch(true);
      } else {
        setShowSearch(false);
        setSearchCount(0);
      }
    }
  }, [propSearchQuery]);

  // ── PDF page navigation state (FIX-016) ─────────────────────────────────────
  const [pdfPageNos, setPdfPageNos] = useState<number[]>([]);
  const [currentPdfPage, setCurrentPdfPage] = useState<number>(1);

  // ── Highlights & notes ────────────────────────────────────────────────────
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hlMode, setHlMode] = useState(false);
  const [hlColor, setHlColor] = useState("#ffe066");
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [showNotesList, setShowNotesList] = useState(false);
  const [showFicheMenu, setShowFicheMenu] = useState(false);

  // ── TTS ───────────────────────────────────────────────────────────────────
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [showTtsPop, setShowTtsPop] = useState(false);

  // ── Highlight popover & page mode ─────────────────────────────────────────
  const [showHlPop, setShowHlPop] = useState(false);
  const [showThemePop, setShowThemePop] = useState(false);
  const [pageMode, setPageMode] = useState(false);
  const [noteText, setNoteText] = useState("");

  // ── Annotation persistence ────────────────────────────────────────────────
  const syncTimerRef = useRef<number | null>(null);

  const persistAll = useCallback(
    (hls: Highlight[], nts: Record<string, string>) => {
      // localStorage is the primary store — write immediately.
      try {
        localStorage.setItem(`reader-hl-${docId}`, JSON.stringify(hls));
        localStorage.setItem(`reader-notes-${docId}`, JSON.stringify(nts));
      } catch {
        /* quota — ignore, server sync is the durable copy */
      }
      // Debounced background server sync (Option B). I-B: a failed sync
      // never touches localStorage, so the local copy survives.
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
      syncTimerRef.current = window.setTimeout(() => {
        saveAnnotations(docId, { highlights: hls, notes: nts }).catch(() => {
          /* offline / server down — keep local copy, retry on next change */
        });
      }, 1000);
    },
    [docId],
  );

  // Temps de lecture estimé (200 mots/min)
  const readingMinutes = useMemo(() => Math.ceil(words / 200), [words]);

  // Annotations list grouped by section (T9)
  const notesListGroups = useMemo(() => {
    const bySection = new Map<string, { title: string; items: Highlight[]; minPage: number }>();
    for (const h of highlights) {
      const sec = h.section ?? "";
      const title = h.sectionTitle || "Sans section";
      const g = bySection.get(sec) ?? { title, items: [], minPage: Number.MAX_SAFE_INTEGER };
      g.items.push(h);
      g.minPage = Math.min(g.minPage, h.page ?? 0);
      bySection.set(sec, g);
    }
    const groups = Array.from(bySection.values());
    groups.forEach((g) => g.items.sort((a, b) => (a.page ?? 0) - (b.page ?? 0)));
    groups.sort((a, b) => a.minPage - b.minPage);
    return groups;
  }, [highlights]);

  // Focus mode: hide all sections except the active one AND its sub-sections (FIX-070)
  const visibleHtml = useMemo(() => {
    const styles: string[] = [];
    if (!htmlContent) return htmlContent;

    if (focusSid) {
      const visibleSids: string[] = [focusSid];
      let descendantTitles: Set<string> | null = null;

      const n = (s: string) => s.trim().toLowerCase();
      const normalizedFocusTitle = n(sections[focusIdx]?.title ?? "");

      if (outline && outline.length > 0) {
        const collectDescendantTitles = (node: OutlineNode, set: Set<string>) => {
          const stripped = n(node.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
          if (stripped) set.add(stripped);
          if (node.children) {
            for (const child of node.children) {
              collectDescendantTitles(child, set);
            }
          }
        };

        const searchOutline = (nodes: OutlineNode[]): Set<string> | null => {
          for (const node of nodes) {
            if (
              n(node.title) === normalizedFocusTitle ||
              n(node.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "")) === normalizedFocusTitle
            ) {
              const set = new Set<string>();
              collectDescendantTitles(node, set);
              return set;
            }
            if (node.children && node.children.length > 0) {
              const res = searchOutline(node.children);
              if (res) return res;
            }
          }
          return null;
        };

        descendantTitles = searchOutline(outline);
      }

      if (descendantTitles && descendantTitles.size > 0) {
        // Outline-based hierarchy: include any section whose title matches a descendant
        for (let i = focusIdx + 1; i < sections.length; i++) {
          const titleNorm = n(sections[i].title);
          const strippedTitle = n(sections[i].title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
          if (descendantTitles.has(titleNorm) || (strippedTitle && descendantTitles.has(strippedTitle))) {
            visibleSids.push(sections[i].id);
          }
        }
      } else {
        // Fallback: heading-level based boundary
        for (let i = focusIdx + 1; i < sections.length; i++) {
          if (sections[i].level <= (sections[focusIdx]?.level ?? 1)) break;
          visibleSids.push(sections[i].id);
        }
      }

      styles.push(`section[data-sid]{display:none!important}`);
      const showList = visibleSids.map((sid) => `section[data-sid="${sid}"]`).join(",");
      styles.push(`${showList}{display:block!important}`);
    }
    return styles.length
      ? htmlContent + `<style>${styles.join("")}</style>`
      : htmlContent;
  }, [htmlContent, focusSid, focusIdx, sections, paperMeta, outline]);

  // Load highlights & notes when docId changes (server-first + localStorage migration)
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    // Migrate legacy localStorage highlights: recompute deterministic keys
    // with empty section (whole-doc restore fallback), remap note keys.
    const migrateLegacy = (): { hls: Highlight[]; nts: Record<string, string> } => {
      let legacyHls: Highlight[] = [];
      let legacyNts: Record<string, string> = {};
      try {
        legacyHls = JSON.parse(localStorage.getItem(`reader-hl-${docId}`) || "[]");
        legacyNts = JSON.parse(localStorage.getItem(`reader-notes-${docId}`) || "{}");
      } catch {
        return { hls: [], nts: {} };
      }
      const remap: Record<string, string> = {};
      const hls = legacyHls.map((h) => {
        const newKey = h.section ? h.key : `::${shortHash(normForKey(h.text))}`;
        if (newKey !== h.key) remap[h.key] = newKey;
        return { ...h, key: newKey, section: h.section ?? "", page: h.page ?? 0 };
      });
      const nts: Record<string, string> = {};
      for (const [k, v] of Object.entries(legacyNts)) {
        nts[remap[k] ?? k] = v;
      }
      return { hls, nts };
    };

    (async () => {
      let store: AnnotationStore | null = null;
      try {
        store = await getAnnotations(docId);
      } catch {
        store = null; // offline — fall back to localStorage below
      }
      if (cancelled) return;

      if (store && (store.highlights?.length ?? 0) > 0) {
        setHighlights(store.highlights as Highlight[]);
        setNotes(store.notes ?? {});
      } else {
        const { hls, nts } = migrateLegacy();
        setHighlights(hls);
        setNotes(nts);
        if (hls.length > 0) persistAll(hls, nts); // push migrated data to server
      }
    })();

    setBreadcrumb(cleanPdfTitle(pdfTitle) || (filename ? filename.replace(/\.[^.]+$/, "") : "Document"));
    // Clean up TTS when changing document
    window.speechSynthesis.cancel();
    setTtsActive(false);
    setTtsPaused(false);

    return () => {
      cancelled = true;
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [docId, filename, pdfTitle, persistAll]);

  // Reapply highlights to the DOM when visibleHtml, highlights, notes, or renderMode change
  useEffect(() => {
    if (renderMode !== "html" || !contentRef.current) return;
    const docEl = contentRef.current.querySelector<HTMLElement>(".reader-doc");
    if (!docEl) return;

    const timer = setTimeout(() => {
      removeAllHighlights(docEl);
      highlights.forEach((hl) => {
        const hasNote = !!notes[hl.key];
        restoreHighlight(docEl, hl, hasNote);
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [visibleHtml, highlights, notes, renderMode]);

  // Clean up TTS on component unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // ── In-reader search: inject/remove <mark> elements ──────────────────────
  useEffect(() => {
    const doc = contentRef.current?.querySelector<HTMLElement>(".reader-doc");
    if (!doc) return;

    const timer = setTimeout(() => {
      // Remove existing marks (unwrap them to restore text nodes)
      doc.querySelectorAll("mark.reader-sm").forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
      });

      const query = searchQuery.trim().toLowerCase();
      if (!query) { setSearchCount(0); return; }

      const SKIP = new Set(["SCRIPT", "STYLE", "MARK", "NOSCRIPT"]);
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const p = node.parentElement;
          return p && SKIP.has(p.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node as Text).textContent?.toLowerCase().includes(query)) {
          textNodes.push(node as Text);
        }
      }

      let count = 0;
      textNodes.forEach((tn) => {
        const text = tn.textContent ?? "";
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let pos = 0;
        let idx = lower.indexOf(query, pos);
        while (idx !== -1) {
          if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
          const mark = document.createElement("mark");
          mark.className = "reader-sm";
          mark.dataset.mid = String(count++);
          mark.textContent = text.slice(idx, idx + query.length);
          frag.appendChild(mark);
          pos = idx + query.length;
          idx = lower.indexOf(query, pos);
        }
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        tn.parentNode?.replaceChild(frag, tn);
      });

      setSearchCount(count);
      setSearchIdx(0);
    }, 160);

    return () => clearTimeout(timer);
  }, [searchQuery, visibleHtml]);

  // Scroll to active search result
  useEffect(() => {
    if (!searchCount) return;
    const mark = contentRef.current?.querySelector<HTMLElement>(`.reader-sm[data-mid="${searchIdx}"]`);
    contentRef.current?.querySelectorAll(".reader-sm").forEach((m) => m.classList.remove("is-active"));
    if (mark) {
      mark.classList.add("is-active");
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchIdx, searchCount]);

  // Handle text selection highlighting
  const handleMouseUp = () => {
    if (!hlMode || renderMode !== "html") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    const docEl = contentRef.current?.querySelector(".reader-doc");
    if (!docEl) return;

    const range = selection.getRangeAt(0);
    if (!docEl.contains(range.commonAncestorContainer)) return;
    const { section, sectionTitle } = findSectionInfo(range.startContainer);
    const page = findPageNo(docEl, range.startContainer);

    // prefix/suffix for disambiguation (best-effort within start node).
    const startText = (range.startContainer.textContent ?? "");
    const prefix = startText.slice(Math.max(0, range.startOffset - 30), range.startOffset);
    const endText = (range.endContainer.textContent ?? "");
    const suffix = endText.slice(range.endOffset, range.endOffset + 30);

    const key = `${section}::${shortHash(normForKey(selectedText))}`;

    // Dedup by key.
    if (highlights.some((h) => h.key === key)) {
      selection.removeAllRanges();
      return;
    }

    const newHl: Highlight = {
      text: selectedText, color: hlColor, key,
      section, sectionTitle, page, prefix, suffix,
    };
    const nextHls = [...highlights, newHl];
    setHighlights(nextHls);
    persistAll(nextHls, notes);

    setActiveNoteKey(key);
    setShowNotePanel(true);
    setNoteText(notes[key] ?? "");
    selection.removeAllRanges();
  };

  // Event delegation to capture clicks on highlights
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Check if clicked a highlight span
    const hlSpan = target.closest(".reader-hl");
    if (hlSpan) {
      e.stopPropagation();
      const key = hlSpan.getAttribute("data-key");
      if (key) {
        setActiveNoteKey(key);
        setNoteText(notes[key] || "");
        setShowNotePanel(true);
      }
      return;
    }

    // Copy LaTeX when clicking a formula block
    const formulaEl = target.closest(".formula, .formula-not-decoded");
    if (formulaEl) {
      const annotation = formulaEl.querySelector("annotation[encoding='TeX']");
      const latex = annotation?.textContent?.trim();
      if (latex) {
        navigator.clipboard.writeText(latex).catch(() => {});
        const btn = formulaEl.querySelector<HTMLElement>(".formula-copy-toast");
        if (btn) { btn.classList.add("is-visible"); setTimeout(() => btn.classList.remove("is-visible"), 1200); }
      }
      return;
    }

    // Close popups if clicking elsewhere
    setShowTypoPop(false);
    setShowHlPop(false);
    setShowTtsPop(false);
    setShowZoomPop(false);
  };

  // Save the current note
  const handleSaveNote = () => {
    if (!activeNoteKey) return;
    const nextNotes = { ...notes };
    if (noteText.trim() === "") {
      delete nextNotes[activeNoteKey];
    } else {
      nextNotes[activeNoteKey] = noteText.trim();
    }
    setNotes(nextNotes);
    persistAll(highlights, nextNotes);
    setShowNotePanel(false);
    setActiveNoteKey(null);
    setNoteText("");
  };

  // Delete selection highlight and its note
  const handleDeleteHighlight = () => {
    if (!activeNoteKey) return;

    const nextNotes = { ...notes };
    delete nextNotes[activeNoteKey];
    setNotes(nextNotes);

    const nextHls = highlights.filter(h => h.key !== activeNoteKey);
    setHighlights(nextHls);
    persistAll(nextHls, nextNotes);

    setShowNotePanel(false);
    setActiveNoteKey(null);
    setNoteText("");
  };

  // Scroll to a highlight and open its note panel (T9)
  const scrollToHighlight = useCallback((key: string) => {
    const docEl = contentRef.current?.querySelector(".reader-doc");
    const el = docEl?.querySelector(`.reader-hl[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveNoteKey(key);
      setShowNotePanel(true);
      setNoteText(notes[key] ?? "");
    }
  }, [notes]);

  // Get text for Speech Synthesis
  const getSpeakText = (): string => {
    if (!contentRef.current) return "";
    const docEl = contentRef.current.querySelector(".reader-doc");
    if (!docEl) return "";

    const temp = docEl.cloneNode(true) as HTMLElement;
    temp.querySelectorAll("script, style, .katex, annotation, math, svg").forEach(el => el.remove());
    return temp.textContent || "";
  };

  // TTS Controls
  const handlePlayTTS = () => {
    if (ttsPaused) {
      window.speechSynthesis.resume();
      setTtsPaused(false);
      return;
    }

    window.speechSynthesis.cancel();
    const text = getSpeakText();
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = ttsRate;

    utterance.onend = () => {
      setTtsActive(false);
      setTtsPaused(false);
    };

    utterance.onerror = () => {
      setTtsActive(false);
      setTtsPaused(false);
    };

    utteranceRef.current = utterance;
    setTtsActive(true);
    setTtsPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const handlePauseTTS = () => {
    if (ttsActive && !ttsPaused) {
      window.speechSynthesis.pause();
      setTtsPaused(true);
    }
  };

  const handleStopTTS = () => {
    window.speechSynthesis.cancel();
    setTtsActive(false);
    setTtsPaused(false);
  };


  // ── Imperative handle (synchronized compare mode) ─────────────────────────
  useImperativeHandle(ref, () => ({
    scrollToSection(title: string) {
      if (!contentRef.current) return;
      // FIX-026 : marquer le scroll comme programmatique pour ne pas propager onPageChange
      // FIX-037 : 1 000 ms — gives smooth-scroll animation enough time to settle
      isProgrammaticScrollRef.current = true;
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 1000);

      // Try to find a matching section element (data-sid) first
      if (sections.length) {
        const match = matchSection(sections, title);
        if (match) {
          const el = contentRef.current.querySelector<HTMLElement>(
            `section[data-sid="${match.id}"]`,
          );
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
        }
      }

      // Fallback: scroll to matching heading text
      const norm = (s: string) => s.toLowerCase().replace(/\W+/g, "");
      const target = norm(title);
      const headings = contentRef.current.querySelectorAll<HTMLElement>("h1,h2,h3,h4");
      for (const h of headings) {
        const ht = norm(h.textContent ?? "");
        if (ht === target || ht.includes(target) || target.includes(ht)) {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        }
      }
    },
  }), [sections]);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const abortCtrl = new AbortController();

    setMd(null);
    setHtmlContent(null);
    setRawHtmlForDownload(null);
    setSections([]);
    setWords(0);
    setStats({ nFigures: 0, nTables: 0, nFormulas: 0 });
    setHtmlAvailable(false);
    setHtmlTooLarge(false);
    setRenderMode("md");
    setFocusSid(null);
    setError(null);
    setPaperMeta(null);
    setBreadcrumb("Document");

    fetch(markdownUrl(docId), { signal: abortCtrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((text) => {
        const cleanedText = text.replace(/\u200b/g, "");
        setMd(cleanedText);
        const secs = parseMdSections(cleanedText);
        const w = cleanedText.split(/\s+/).filter(Boolean).length;
        setSections((prev) => (prev.length ? prev : secs));
        setWords((prev) => prev || w);
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setError(String(e));
      });

    // Chunked HTML loading via manifest — each batch is ~10 pages, stays well under memory limits.
    // Large base64 images are stripped before DOMParser to keep each parse fast;
    // figures are already accessible via the Gallery sidebar.
    // Falls back to the old single-file approach for documents without a manifest (legacy cache).

    function stripLargeBase64Images(raw: string): string {
      // Remove embedded images whose base64 payload exceeds ~100 KB.
      // Formulas are stored as LaTeX text ($$...$$) and are unaffected.
      return raw.replace(
        /<img([^>]*?)src="data:image\/[^;]+;base64,[^"]{100000,}"([^>]*?)>/gi,
        "<img$1src=\"\"$2 data-stripped=\"1\">",
      );
    }

    function applyHtmlPart(
      raw: string,
      accHtml: string,
      accSections: Section[],
      accPdfPageNos: number[],
      accStats: { nFigures: number; nTables: number; nFormulas: number },
      idOffset: number,
    ) {
      const stripped = stripLargeBase64Images(raw);
      const { html, sections: secs, words: w, nFigures, nTables, nFormulas, pdfPageNos } =
        sectionizeHtml(stripped, outline ?? [], filename, idOffset, pdfTitle);
      const newHtml = accHtml + html;
      const newSections = [...accSections, ...secs];
      const newPdfPageNos = [...accPdfPageNos, ...pdfPageNos.filter(p => !accPdfPageNos.includes(p))];
      const newStats = {
        nFigures: accStats.nFigures + nFigures,
        nTables: accStats.nTables + nTables,
        nFormulas: accStats.nFormulas + nFormulas,
      };
      return { html: newHtml, sections: newSections, pdfPageNos: newPdfPageNos, stats: newStats, words: w };
    }

    fetch(htmlManifestUrl(docId), { signal: abortCtrl.signal })
      .then(r => r.ok ? (r.json() as Promise<HtmlManifestEntry[]>) : Promise.reject("no-manifest"))
      .then(async (manifest) => {
        if (!manifest.length) return Promise.reject("empty-manifest");

        let accHtml = "";
        let accSections: Section[] = [];
        let accPdfPageNos: number[] = [];
        let accStats = { nFigures: 0, nTables: 0, nFormulas: 0 };
        let totalWords = 0;
        // ID offset: space 500 section IDs per part to avoid collisions across batches
        let idOffset = 0;

        for (let i = 0; i < manifest.length; i++) {
          if (abortCtrl.signal.aborted) break;
          const entry = manifest[i];
          try {
            const partRes = await fetch(htmlPartUrl(docId, entry.start), { signal: abortCtrl.signal });
            if (!partRes.ok) continue;
            const raw = await partRes.text();
            const result = applyHtmlPart(raw, accHtml, accSections, accPdfPageNos, accStats, idOffset);
            accHtml = result.html;
            accSections = result.sections;
            accPdfPageNos = result.pdfPageNos;
            accStats = result.stats;
            if (i === 0) totalWords = result.words;
            idOffset += 500;

            // Show content as soon as first batch is ready; update silently for the rest
            if (i === 0) {
              if (!accHtml) { setHtmlTooLarge(true); break; }
              setHtmlContent(accHtml);
              setSections(accSections);
              setWords(totalWords);
              setStats(accStats);
              setPdfPageNos(accPdfPageNos);
              setHtmlAvailable(true);
              setRenderMode("html");
              setPaperMeta(extractPaperMeta(accHtml));
            } else {
              setHtmlContent(accHtml);
              setSections(accSections);
              setPdfPageNos(accPdfPageNos);
              setStats(accStats);
            }
          } catch (e: unknown) {
            if (e instanceof DOMException && e.name === "AbortError") break;
          }
        }
        setRawHtmlForDownload(accHtml);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Legacy fallback: no manifest → try single result.html (FIX-034 guard still applies)
        const HTML_SIZE_LIMIT = 20 * 1024 * 1024;
        fetch(htmlUrl(docId), { signal: abortCtrl.signal })
          .then((r) => {
            if (!r.ok) throw new Error("no html");
            const cl = parseInt(r.headers.get("content-length") ?? "0", 10);
            if (cl > HTML_SIZE_LIMIT) { setHtmlTooLarge(true); throw new Error("too_large"); }
            return r.text();
          })
          .then((raw) => {
            if (raw.length > HTML_SIZE_LIMIT) { setHtmlTooLarge(true); return; }
            setRawHtmlForDownload(raw);
            const { html, sections: secs, words: w, nFigures, nTables, nFormulas, pdfPageNos } =
              sectionizeHtml(raw, outline ?? [], filename, 0, pdfTitle);
            if (!html) { setHtmlTooLarge(true); return; }
            setHtmlContent(html);
            setSections(secs);
            setWords(w);
            setStats({ nFigures, nTables, nFormulas });
            setPdfPageNos(pdfPageNos);
            setHtmlAvailable(true);
            setRenderMode("html");
            setPaperMeta(extractPaperMeta(html));
          })
          .catch(() => {});
      });

    return () => abortCtrl.abort();
  }, [docId, filename, outline]);

  // ── Navigation depuis la sidebar ─────────────────────────────────────────
  // Mode HTML  : active le focus (section isolée) + scroll en haut
  // Mode Markdown : scroll vers le heading correspondant

  useEffect(() => {
    if (!focusSectionTitle) return;

    const t = setTimeout(() => {
      if (!contentRef.current) return;

      // ── Mode HTML avec sections indexées ──────────────────────────────
      if (renderMode === "html" && sections.length) {
        const match = matchSection(sections, focusSectionTitle);
        if (match) {
          const idx = sections.indexOf(match);
          setBreadcrumb(match.title);
          setFocusIdx(idx);
          setFocusSid(match.id);         // ← active le focus mode
          contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
          // onFocusClear appelé par l'utilisateur via "← Document complet"
          return;
        }
      }

      // ── Fallback : scroll vers heading par texte (Markdown ou HTML sans sections) ──
      const normalize = (s: string) => s.toLowerCase().replace(/\W+/g, "");
      const target = normalize(focusSectionTitle);
      const headings = contentRef.current.querySelectorAll<HTMLElement>("h1,h2,h3,h4");
      for (const h of headings) {
        const ht = normalize(h.textContent ?? "");
        if (ht === target || ht.includes(target) || target.includes(ht)) {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        }
      }
      onFocusClear?.();
    }, 80);

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSectionTitle]);

  // ── KaTeX auto-render sur le HTML Docling enrichi ────────────────────────
  // Déclenché après chaque mise à jour du HTML (htmlContent ou section focus).
  // Rend les formules $...$ et \(...\) générées par CodeFormulaV2.
  // Utilise un import dynamique pour éviter les erreurs de type sur le .mjs.

  useEffect(() => {
    if (!htmlContent || !contentRef.current) return;
    const t = setTimeout(() => {
      const docEl = contentRef.current?.querySelector<HTMLElement>(".reader-doc");
      if (!docEl) return;
      import(
        /* @vite-ignore */
        "katex/dist/contrib/auto-render.mjs"
      ).then((mod) => {
        const render = (mod.default ?? mod) as (
          el: HTMLElement,
          opts: Record<string, unknown>,
        ) => void;
        render(docEl, {
          delimiters: [
            { left: "$$",  right: "$$",  display: true  },
            { left: "$",   right: "$",   display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true  },
          ],
          output: "html",
          throwOnError: false,
          // Pas d'ignoredClasses : les éléments formula-not-decoded dont le contenu
          // a été converti en $$...$$ par pix2tex sont rendus par KaTeX.
          // Les éléments sans délimiteurs $ sont ignorés naturellement.
        });
      }).catch(() => {/* KaTeX auto-render absent — silencieux */});
    }, 80);
    return () => clearTimeout(t);
  }, [htmlContent, focusSid]);

  // ── Scroll events: progress + jump-to-top + breadcrumb ───────────────────

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const pct = scrollHeight <= clientHeight
        ? 100
        : (scrollTop / (scrollHeight - clientHeight)) * 100;
      setProgress(Math.min(100, Math.round(pct)));
      setShowJumpTop(scrollTop > 300);

      // Update breadcrumb based on visible section
      if (renderMode === "html") {
        const secs = el.querySelectorAll<HTMLElement>("section[data-sid]");
        for (let i = secs.length - 1; i >= 0; i--) {
          const rect = secs[i].getBoundingClientRect();
          if (rect.top <= 80) {
            const heading = secs[i].querySelector("h1,h2,h3,h4");
            if (heading?.textContent) {
              setBreadcrumb(heading.textContent.trim());
            }
            setActiveSid(secs[i].getAttribute("data-sid"));
            break;
          }
        }

        // Update current PDF page based on visible page markers (FIX-016)
        // FIX-026 : ne propagate onPageChange (→ PDF viewer) que si le scroll est utilisateur,
        // pas programmatique (scrollToSection / scrollToPage positionne isProgrammaticScrollRef).
        const markers = el.querySelectorAll<HTMLElement>(".pdf-page-marker[data-page]");
        for (let i = markers.length - 1; i >= 0; i--) {
          const rect = markers[i].getBoundingClientRect();
          if (rect.top <= 120) {
            const pg = parseInt(markers[i].getAttribute("data-page") ?? "0");
            if (pg > 0) {
              setCurrentPdfPage(pg);
              if (!isProgrammaticScrollRef.current && onPageChange) {
                onPageChange(pg);
              }
            }
            break;
          }
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [renderMode, onPageChange]);

  // Collect all images in the current reader view
  const getReaderImages = (): Figure[] => {
    const el = contentRef.current;
    if (!el) return [];
    const imgs = el.querySelectorAll("img");
    const list: Figure[] = [];
    imgs.forEach((img) => {
      const src = img.src || img.getAttribute("src") || "";
      if (!src) return;
      if (list.some((item) => item.id === src)) return;
      const pageNoAttr = img.closest(".docling-page")?.getAttribute("data-page-no");
      const page = pageNoAttr ? parseInt(pageNoAttr, 10) : null;
      const captionText = img.closest("figure")?.querySelector("figcaption")?.textContent || "";
      list.push({
        id: src,
        page,
        bbox: null,
        caption: captionText,
      });
    });
    return list;
  };

  // ── Image lightbox (click to zoom) ──────────────────────────────────────
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const img = (e.target as Element).closest("img") as HTMLImageElement | null;
      if (!img) return;
      const src = img.src || img.getAttribute("src");
      if (src) {
        const imgs = getReaderImages();
        setReaderImages(imgs);
        const idx = imgs.findIndex((item) => item.id === src);
        if (idx !== -1) {
          setReaderImageIdx(idx);
        } else {
          setReaderImages([{ id: src, page: null, bbox: null, caption: img.alt || "" }]);
          setReaderImageIdx(0);
        }
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (readerImageIdx === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReaderImageIdx(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerImageIdx]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  // J/K: navigate sections in focus mode | F: toggle focus | Esc: close panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as Element)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        if (readerImageIdx !== null) { setReaderImageIdx(null); return; }
        if (showSearch) { setShowSearch(false); setSearchQuery(""); setSearchCount(0); return; }
        if (focusSid) {
          const sid = sections[focusIdx]?.id;
          setFocusSid(null);
          onFocusClear?.();
          setTimeout(() => {
            contentRef.current?.querySelector(`[data-sid="${sid}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        }
        return;
      }

      if (e.key === "j" && focusSid && renderMode === "html") {
        const nIdx = focusIdx + 1;
        if (nIdx < sections.length) {
          setFocusSid(sections[nIdx].id);
          setFocusIdx(nIdx);
          setBreadcrumb(sections[nIdx].title);
          contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }
        e.preventDefault();
      }
      if (e.key === "k" && focusSid && renderMode === "html") {
        const nIdx = focusIdx - 1;
        if (nIdx >= 0) {
          setFocusSid(sections[nIdx].id);
          setFocusIdx(nIdx);
          setBreadcrumb(sections[nIdx].title);
          contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerImageIdx, showSearch, focusSid, focusIdx, sections, onFocusClear, renderMode]);

  // ── PDF page navigation (FIX-016) ────────────────────────────────────────

  const scrollToPage = (pageNo: number) => {
    const el = contentRef.current;
    if (!el) return;
    const marker = el.querySelector<HTMLElement>(`.pdf-page-marker[data-page="${pageNo}"]`);
    if (marker) {
      // FIX-026 / FIX-037 : marquer comme programmatique → pas de boucle Reader → PDF
      isProgrammaticScrollRef.current = true;
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 1000);
      marker.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentPdfPage(pageNo);
    }
  };

  const goPrevPage = () => {
    const idx = pdfPageNos.indexOf(currentPdfPage);
    if (idx > 0) scrollToPage(pdfPageNos[idx - 1]);
  };

  const goNextPage = () => {
    const idx = pdfPageNos.indexOf(currentPdfPage);
    if (idx < pdfPageNos.length - 1) scrollToPage(pdfPageNos[idx + 1]);
  };

  // ── Focus navigation ──────────────────────────────────────────────────────

  const goFocus = (idx: number) => {
    if (idx < 0 || idx >= sections.length) return;
    setFocusSid(sections[idx].id);
    setFocusIdx(idx);
    setBreadcrumb(sections[idx].title);
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exitFocus = () => {
    const sid = sections[focusIdx]?.id;
    setFocusSid(null);
    onFocusClear?.();
    setTimeout(() => {
      const el = contentRef.current?.querySelector(`[data-sid="${sid}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // (Derived HTML moved up to resolve Temporal Dead Zone/ReferenceError)

  // ── MathML/LaTeX rendering hook ──────────────────────────────────────────
  // Extract LaTeX from <annotation encoding="TeX"> tags inside MathML or formula
  // elements, and render them using KaTeX.
  useEffect(() => {
    if (renderMode !== "html" || !contentRef.current) return;

    const mathElements = contentRef.current.querySelectorAll(
      ".formula, .equation, math, .formula-not-decoded",
    );
    mathElements.forEach((el) => {
      if (el.hasAttribute("data-katex-rendered")) return;

      // Find the annotation tag (can be a child or a sibling due to HTML5 parser quirks)
      let annotation: Element | null = el.querySelector("annotation");
      let isSiblingAnnotation = false;
      if (!annotation) {
        let sib = el.nextSibling;
        while (sib) {
          if (sib.nodeType === Node.ELEMENT_NODE) {
            if ((sib as Element).tagName.toLowerCase() === "annotation") {
              annotation = sib as Element;
              isSiblingAnnotation = true;
            }
            break;
          }
          sib = sib.nextSibling;
        }
      }
      let latex = annotation?.textContent?.trim();
      if (isSiblingAnnotation && annotation) {
        annotation.remove();
      }

      // Fallback if no annotation but element contains inline/display LaTeX delimiters
      if (!latex) {
        const text = el.textContent?.trim();
        if (text && (text.startsWith("$$") || text.startsWith("$") || text.startsWith("\\[") || text.startsWith("\\("))) {
          latex = text;
        }
      }

      // formula-not-decoded: try using the raw textContent as LaTeX.
      // Docling sometimes stores valid LaTeX with double-escaped backslashes
      // (\\frac instead of \frac) — unescape before passing to KaTeX.
      if (!latex && el.classList.contains("formula-not-decoded")) {
        const rawText = (el.textContent ?? "").trim();
        if (rawText && rawText !== "Formula not decoded") {
          latex = rawText.replace(/\\\\/g, "\\");
          if (latex.startsWith("$$") && latex.endsWith("$$")) latex = latex.slice(2, -2).trim();
          else if (latex.startsWith("$") && latex.endsWith("$")) latex = latex.slice(1, -1).trim();
        }
      }

      if (latex && latex !== "Formula not decoded") {
        // Strip leading/trailing delimiters if present
        if (latex.startsWith("$$") && latex.endsWith("$$")) {
          latex = latex.slice(2, -2).trim();
        } else if (latex.startsWith("$") && latex.endsWith("$")) {
          latex = latex.slice(1, -1).trim();
        } else if (latex.startsWith("\\[") && latex.endsWith("\\]")) {
          latex = latex.slice(2, -2).trim();
        } else if (latex.startsWith("\\(") && latex.endsWith("\\)")) {
          latex = latex.slice(2, -2).trim();
        }

        // Sanitize LaTeX space characters to prevent KaTeX warnings/errors
        latex = latex.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();

        const container = document.createElement("span");
        container.className = "katex-formula-rendered";
        try {
          const isDisplay = el.tagName === "DIV" || el.classList.contains("equation") || el.getAttribute("display") === "block";
          katex.render(latex, container, {
            displayMode: isDisplay,
            output: "html",
            throwOnError: false,
            strict: "ignore", // Silences warning logs in the browser console
          });

          // Don't replace formula-not-decoded elements that failed to render —
          // a KaTeX error span is worse than the existing styled placeholder.
          if (container.querySelector(".katex-error") && el.classList.contains("formula-not-decoded")) {
            el.setAttribute("data-katex-rendered", "true"); // mark so we don't retry
            return;
          }

          if (el.tagName.toLowerCase() === "math") {
            container.setAttribute("data-katex-rendered", "true");
            el.replaceWith(container);
          } else {
            el.innerHTML = "";
            el.appendChild(container);
            el.setAttribute("data-katex-rendered", "true");
          }
        } catch (err) {
          console.error("KaTeX rendering error:", err);
        }
      }
    });
  }, [visibleHtml, renderMode]);

  // ── Download ──────────────────────────────────────────────────────────────

  const downloadName = filename ? filename.replace(/\.[^.]+$/, ".html") : "document.html";

  const handleDownloadHTML = () => {
    if (!htmlContent) return;

    // Use DOMParser to inject current highlights and notes
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Clean up existing highlights in the source if any, then re-apply
    removeAllHighlights(doc.body);
    highlights.forEach((hl) => {
      const hasNote = !!notes[hl.key];
      restoreHighlight(doc.body, hl, hasNote);
    });

    // Resolve relative image URLs to absolute backend URLs in the exported HTML
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith("/doc/")) {
        img.setAttribute("src", `${API_BASE}${src}`);
      }
    });

    const title = paperMeta?.title || filename || "Document";

    // Inline CSS for the interactive features & styling themes in the exported HTML
    const styles = `
      :root {
        --or: #ff8c00;
        --bg: #fafafa;
        --bg2: #ffffff;
        --bg3: #f3f4f6;
        --tx: #171717;
        --tx2: #404040;
        --tx3: #737373;
        --bd: #e5e7eb;
        --bd2: #d1d5db;
        --fu: 'Outfit', system-ui, sans-serif;
        --fb: 'Lora', 'Source Serif 4', Georgia, serif;
      }
      [data-theme="dark"] {
        --bg: #0a0b10;
        --bg2: #12131a;
        --bg3: #181a24;
        --tx: #f3f4f6;
        --tx2: #d1d5db;
        --tx3: #9ca3af;
        --bd: rgba(255, 255, 255, 0.08);
        --bd2: rgba(255, 255, 255, 0.16);
      }
      body {
        margin: 0;
        padding: 0;
        font-family: var(--fu);
        background: var(--bg);
        color: var(--tx);
        transition: background 0.3s, color 0.3s;
      }
      header {
        background: var(--bg2);
        border-bottom: 1px solid var(--bd);
        padding: 12px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: sticky;
        top: 0;
        z-index: 100;
      }
      .logo {
        font-weight: 700;
        color: var(--or);
        font-size: 18px;
      }
      .tbtn {
        background: var(--bg3);
        border: 1px solid var(--bd);
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        color: var(--tx);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
      }
      .tbtn:hover {
        border-color: var(--or);
        color: var(--or);
      }
      .container {
        max-width: 800px;
        margin: 40px auto;
        padding: 0 24px;
      }
      .reader-hl {
        cursor: pointer;
        border-radius: 2px;
        padding: 1px 0;
        transition: background-color 0.2s;
      }
      .reader-hl--has-note {
        border-bottom: 2.5px dashed var(--or);
      }
      .reader-doc {
        line-height: 1.85;
        font-size: 16px;
        font-family: var(--fb);
      }
      .reader-doc h1 {
        font-family: var(--fu);
        border-bottom: 2px solid var(--or);
        padding-bottom: 8px;
        margin-top: 32px;
      }
      .reader-doc h2 {
        font-family: var(--fu);
        border-bottom: 1px solid var(--bd);
        padding-bottom: 6px;
        margin-top: 28px;
      }
      .reader-doc p {
        text-align: justify;
        margin-bottom: 16px;
      }
      /* KaTeX formulas */
      annotation {
        display: none !important;
      }
      .formula, .equation {
        background: rgba(8, 145, 178, 0.05);
        border-left: 4px solid #0891b2;
        padding: 16px;
        margin: 20px 0;
        text-align: center;
        overflow-x: auto;
        border-radius: 8px;
      }
      /* Table styling */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 24px 0;
      }
      th {
        background: var(--or);
        color: white;
        padding: 10px;
        text-align: left;
      }
      td {
        border-bottom: 1px solid var(--bd);
        padding: 10px;
      }
      tr:nth-child(even) td {
        background: var(--bg3);
      }
      /* Note panel styling for offline */
      #note-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 320px;
        background: var(--bg2);
        border: 1px solid var(--bd2);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        display: none;
        z-index: 1000;
        box-sizing: border-box;
      }
      #note-panel h4 {
        margin: 0 0 8px 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--or);
        text-transform: uppercase;
        letter-spacing: .05em;
      }
      #note-context {
        margin: 0 0 10px 0;
        font-size: 11px;
        color: var(--tx3);
        font-style: italic;
        background: var(--bg3);
        padding: 6px 10px;
        border-radius: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #note-text {
        width: 100%;
        height: 90px;
        background: var(--bg3);
        color: var(--tx);
        border: 1px solid var(--bd);
        border-radius: 8px;
        padding: 8px;
        font-family: inherit;
        font-size: 13px;
        box-sizing: border-box;
        margin-bottom: 12px;
        outline: none;
        resize: none;
      }
      .panel-buttons {
        display: flex;
        justify-content: flex-end;
      }
      .panel-btn {
        background: var(--or);
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        cursor: pointer;
        font-weight: 600;
        font-family: inherit;
      }

      /* PDF Page markers */
      .pdf-page-marker {
        margin: 52px 0 0;
        user-select: none;
      }
      .pdf-page-footer-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 14px;
        background: var(--bg3);
        border: 1px solid var(--bd);
        border-bottom: none;
        font-family: var(--fu);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.04em;
        color: var(--tx3);
      }
      .pdf-page-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 14px;
        background: var(--bg3);
        border: 1px solid var(--bd);
        border-top: none;
        font-family: var(--fu);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.04em;
        color: var(--tx3);
      }
      .pdf-pbb-pg--current {
        font-weight: 700;
        color: var(--or);
      }
      .pdf-page-divider-line {
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--bd2) 20%, var(--bd2) 80%, transparent);
      }

      /* Print Media Styles */
      @media print {
        @page {
          size: A4 portrait;
          margin: 20mm;
        }
        body,
        .container,
        .reader-doc {
          background: #ffffff !important;
          background-color: #ffffff !important;
          color: #000000 !important;
        }
        header {
          display: none !important;
        }
        .container {
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .reader-doc p,
        .reader-doc li,
        .reader-doc h1,
        .reader-doc h2,
        .reader-doc h3,
        .reader-doc h4 {
          color: #000000 !important;
        }
        .pdf-page-marker {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
        }
        .pdf-page-footer-bar {
          display: flex !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
          margin-top: 10mm !important;
          border: none !important;
          background: transparent !important;
        }
        .pdf-page-header-bar {
          display: flex !important;
          page-break-before: always !important;
          break-before: page !important;
          margin-top: 10mm !important;
          border: none !important;
          background: transparent !important;
        }
        .pdf-page-divider-line {
          display: none !important;
        }
        table, tr, td, th {
          background: transparent !important;
          background-color: transparent !important;
          color: #000000 !important;
          border-color: #dddddd !important;
        }
        th {
          border-bottom: 2px solid #000000 !important;
        }
      }
    `;

    const notesJson = JSON.stringify(notes);
    const script = `
      const notes = ${notesJson};
      document.addEventListener('DOMContentLoaded', () => {
        const panel = document.getElementById('note-panel');
        const context = document.getElementById('note-context');
        const text = document.getElementById('note-text');
        
        document.querySelectorAll('.reader-hl').forEach(span => {
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = span.getAttribute('data-key');
            context.textContent = span.textContent.slice(0, 60) + '...';
            text.value = notes[key] || "Pas de note pour ce surlignage.";
            panel.style.display = 'block';
          });
        });
        
        document.getElementById('close-panel').addEventListener('click', () => {
          panel.style.display = 'none';
        });

        // Toggle theme
        const themeBtn = document.getElementById('theme-btn');
        let currentTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeBtn.textContent = currentTheme === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';

        themeBtn.addEventListener('click', () => {
          currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', currentTheme);
          localStorage.setItem('theme', currentTheme);
          themeBtn.textContent = currentTheme === 'dark' ? '☀️ Mode Clair' : '🌙 Mode Sombre';
        });
      });
    `;

    const exportedHtml = `
      <!DOCTYPE html>
      <html lang="fr" data-theme="light">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
        <style>${styles}</style>
      </head>
      <body>
        <header>
          <div class="logo">📚 ${title}</div>
          <div style="display:flex; gap:10px;">
            <button id="theme-btn" class="tbtn">🌙 Mode Sombre</button>
            <button class="tbtn" onclick="window.print()">🖨 Imprimer</button>
          </div>
        </header>

        <div class="container">
          <div class="reader-doc">
            ${doc.body.innerHTML}
          </div>
        </div>
        
        <div id="note-panel">
          <h4>Annotation</h4>
          <div id="note-context"></div>
          <textarea id="note-text" readonly></textarea>
          <div class="panel-buttons">
            <button id="close-panel" class="panel-btn">Fermer</button>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
        <script>
          document.addEventListener("DOMContentLoaded", function() {
            renderMathInElement(document.body, {
              delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false},
                {left: "\\\\(", right: "\\\\)", display: false},
                {left: "\\\\[", right: "\\\\]", display: true}
              ],
              throwOnError: false
            });
          });
        </script>
        <script>${script}</script>
      </body>
      </html>
    `;

    const blob = new Blob([exportedHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const currentSection = sections.find((s) => s.id === focusSid);
  const inFocus = focusSid !== null && renderMode === "html";

  const docClasses = [
    "reader",
    `t-${theme}`,
    isDark ? "reader--dark" : "",
    `reader--fs-${fontSize}`,
    `reader--lh-${lineHeight}`,
    `reader--${fontFamily}`,
    appTheme ? `reader--app-${appTheme}` : "",
    compareMode ? "reader--compare" : "",
  ].filter(Boolean).join(" ");

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={docClasses} data-theme={isDark ? "dark" : "light"} data-app-theme={appTheme ?? "glassmorphism"}>
      {/* Progress bar */}
      <div className="reader-progress" style={{ width: `${progress}%` }} />

      {/* Toolbar */}
      <header className="reader-toolbar">
        {/* Left: mode toggle */}
        <div className="reader-toolbar-group">
          {htmlAvailable && (
            <div className="reader-segmented">
              <button
                className={`reader-seg-btn${renderMode === "html" ? " is-on" : ""}`}
                onClick={() => setRenderMode("html")}
              >
                Structuré
              </button>
              <button
                className={`reader-seg-btn${renderMode === "md" ? " is-on" : ""}`}
                onClick={() => setRenderMode("md")}
              >
                Markdown
              </button>
            </div>
          )}
        </div>

        {/* Center: meta */}
        <div className="reader-toolbar-meta">
          {htmlTooLarge ? (
            <span className="reader-meta-pill" title="Le HTML Docling est trop volumineux pour être chargé dans le navigateur. Le mode Markdown est utilisé à la place.">
              ⚠️ HTML trop lourd — mode Markdown
            </span>
          ) : (
            <span className="reader-meta-pill">
              ⏱ {readingMinutes} min · {words.toLocaleString()} mots
            </span>
          )}
          {inFocus && (
            <span className="reader-meta-pill reader-meta-pill--focus">
              📖 Focus · {focusIdx + 1}/{sections.length}
            </span>
          )}
        </div>

        {/* Right: controls */}
        <div className="reader-toolbar-group reader-toolbar-group--right">

          {/* PDF Page navigation — compare mode only (FIX-016) */}
          {compareMode && renderMode === "html" && pdfPageNos.length > 0 && (
            <div className="reader-page-nav">
              <button
                className="reader-tbtn reader-page-btn"
                onClick={goPrevPage}
                disabled={pdfPageNos.indexOf(currentPdfPage) <= 0}
                title="Page précédente"
              >‹</button>
              <button
                className={`reader-tbtn reader-page-counter${pageMode ? " is-on" : ""}`}
                onClick={() => setPageMode(v => !v)}
                title={pageMode ? "Quitter le mode page" : "Mode page à page"}
              >
                <span>p.{currentPdfPage}</span>
                <span className="reader-page-total">/{pdfPageNos[pdfPageNos.length - 1]}</span>
              </button>
              <button
                className="reader-tbtn reader-page-btn"
                onClick={goNextPage}
                disabled={pdfPageNos.indexOf(currentPdfPage) >= pdfPageNos.length - 1}
                title="Page suivante"
              >›</button>
            </div>
          )}

          {/* Surlignage Controls */}
          {renderMode === "html" && (
            <div className="reader-tbtn-wrap">
              <button
                className={`reader-tbtn${hlMode ? " is-on" : ""}`}
                style={hlMode ? { borderColor: hlColor, backgroundColor: `color-mix(in srgb, ${hlColor} 20%, transparent)` } : undefined}
                onClick={() => {
                  setHlMode(!hlMode);
                  setShowHlPop(v => !v);
                  setShowTypoPop(false);
                  setShowTtsPop(false);
                  setShowZoomPop(false);
                  setShowThemePop(false);
                }}
                title="Surlignage"
              >
                <span className="reader-hl-dot" style={{ backgroundColor: hlColor }} />
                <span>Surligner</span>
              </button>

              {showHlPop && (
                <div className="reader-tool-pop">
                  <div className="reader-pop-label">Couleur de surlignage</div>
                  <div className="reader-hlc-grid">
                    {[
                      { hex: "#ffe066", name: "Jaune" },
                      { hex: "#a8e6cf", name: "Vert" },
                      { hex: "#dcedc1", name: "Lime" },
                      { hex: "#ffd3b6", name: "Orange" },
                      { hex: "#ffaaa5", name: "Rose" },
                      { hex: "#d8b4fe", name: "Violet" }
                    ].map((col) => (
                      <button
                        key={col.hex}
                        className={`reader-hlc-btn${hlColor === col.hex ? " is-active" : ""}`}
                        style={{ backgroundColor: col.hex }}
                        onClick={() => {
                          setHlColor(col.hex);
                          setHlMode(true);
                        }}
                        title={col.name}
                      />
                    ))}
                  </div>
                  <div className="reader-pop-divider" />
                  <button
                    className="reader-pop-action-btn"
                    onClick={() => {
                      if (window.confirm("Voulez-vous supprimer tous les surlignages de ce document ?")) {
                        if (contentRef.current) {
                          const docEl = contentRef.current.querySelector(".reader-doc");
                          if (docEl) removeAllHighlights(docEl as HTMLElement);
                        }
                        setHighlights([]);
                        setNotes({});
                        persistAll([], {});
                        setShowHlPop(false);
                      }
                    }}
                  >
                    Effacer tout
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Notes list toggle (T9) */}
          {renderMode === "html" && (
            <div className="reader-tbtn-wrap">
              <button
                type="button"
                className={`reader-tbtn${showNotesList ? " is-on" : ""}`}
                title="Liste des annotations"
                onClick={() => setShowNotesList((v) => !v)}
              >
                <span>📋</span>
                <span>Notes</span>
                {highlights.length > 0 && (
                  <span className="reader-notes-count">{highlights.length}</span>
                )}
              </button>
            </div>
          )}

          {/* Fiche export (T10) */}
          {renderMode === "html" && (
            <div className="reader-tbtn-wrap reader-fiche-wrap">
              <button
                type="button"
                className={`reader-tbtn${showFicheMenu ? " is-on" : ""}`}
                title="Exporter une fiche de révision"
                onClick={() => setShowFicheMenu((v) => !v)}
              >
                <span>⬇</span>
                <span>Fiche</span>
              </button>
              {showFicheMenu && (
                <div className="reader-fiche-menu">
                  <a href={ficheUrl(docId, "html")} download onClick={() => setShowFicheMenu(false)}>
                    HTML
                  </a>
                  <a href={ficheUrl(docId, "md")} download onClick={() => setShowFicheMenu(false)}>
                    Markdown
                  </a>
                </div>
              )}
            </div>
          )}

          {/* TTS Controls */}
          {renderMode === "html" && (
            <div className="reader-tbtn-wrap">
              <button
                className={`reader-tbtn${ttsActive ? " is-on" : ""}`}
                onClick={() => {
                  setShowTtsPop(v => !v);
                  setShowTypoPop(false);
                  setShowHlPop(false);
                  setShowZoomPop(false);
                  setShowThemePop(false);
                }}
                title="Lecture audio (Text-to-Speech)"
              >
                <span>🔊</span>
                <span>Audio</span>
              </button>

              {showTtsPop && (
                <div className="reader-tool-pop reader-tool-pop--tts">
                  <div className="reader-pop-label">Lecture à voix haute</div>
                  
                  <div className="reader-tts-controls">
                    {!ttsActive && (
                      <button className="reader-tts-btn reader-tts-btn--play" onClick={handlePlayTTS}>
                        ▶ Lire
                      </button>
                    )}
                    {ttsActive && !ttsPaused && (
                      <button className="reader-tts-btn reader-tts-btn--pause" onClick={handlePauseTTS}>
                        ⏸ Pause
                      </button>
                    )}
                    {ttsActive && ttsPaused && (
                      <button className="reader-tts-btn reader-tts-btn--play" onClick={handlePlayTTS}>
                        ▶ Reprendre
                      </button>
                    )}
                    
                    <button 
                      className="reader-tts-btn reader-tts-btn--stop" 
                      onClick={handleStopTTS}
                      disabled={!ttsActive}
                    >
                      ■ Arrêter
                    </button>
                  </div>

                  <div className="reader-pop-divider" />
                  
                  <div className="reader-pop-label">Vitesse : {ttsRate.toFixed(1)}x</div>
                  <div className="reader-fs-row">
                    <span style={{ fontSize: "11px", color: "var(--tx3)" }}>0.5x</span>
                    <input
                      type="range" min="0.5" max="2.0" step="0.1"
                      value={ttsRate}
                      onChange={(e) => {
                        const newRate = parseFloat(e.target.value);
                        setTtsRate(newRate);
                        if (ttsActive && !ttsPaused) {
                          handleStopTTS();
                          setTimeout(() => {
                            const text = getSpeakText();
                            if (!text) return;
                            const utterance = new SpeechSynthesisUtterance(text);
                            utterance.lang = "fr-FR";
                            utterance.rate = newRate;
                            utterance.onend = () => {
                              setTtsActive(false);
                              setTtsPaused(false);
                            };
                            utterance.onerror = () => {
                              setTtsActive(false);
                              setTtsPaused(false);
                            };
                            utteranceRef.current = utterance;
                            setTtsActive(true);
                            setTtsPaused(false);
                            window.speechSynthesis.speak(utterance);
                          }, 50);
                        }
                      }}
                      style={{ flex: 1, accentColor: "var(--or)" }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--tx3)" }}>2.0x</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Typography popup */}
          <div className="reader-tbtn-wrap">
            <button
              className={`reader-tbtn${showTypoPop ? " is-on" : ""}`}
              onClick={() => {
                setShowTypoPop((v) => !v);
                setShowHlPop(false);
                setShowTtsPop(false);
                setShowZoomPop(false);
                setShowThemePop(false);
              }}
              title="Typographie"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
              </svg>
            </button>

            {showTypoPop && (
              <div className="reader-tool-pop">
                {/* Font size */}
                <div className="reader-pop-label">Taille du texte</div>
                <div className="reader-fs-row">
                  <span style={{ fontSize: "11px", color: "var(--tx3)" }}>A</span>
                  <input
                    type="range" min="0" max="4" step="1"
                    value={["sm","md","lg","xl","xxl"].indexOf(fontSize)}
                    onChange={(e) => setFontSize((["sm","md","lg","xl","xxl"] as FontSize[])[parseInt(e.target.value)])}
                    style={{ flex: 1, accentColor: "var(--or)" }}
                  />
                  <span style={{ fontSize: "16px", color: "var(--tx2)" }}>A</span>
                </div>

                {/* Line height */}
                <div className="reader-pop-label" style={{ marginTop: "10px" }}>Interligne</div>
                <div className="reader-lh-row">
                  {([["compact","≡",1.6],["normal","≡",1.85],["relaxed","≡",2.2]] as [LineHeight,string,number][]).map(([val, icon]) => (
                    <button
                      key={val}
                      className={`reader-lh-btn${lineHeight === val ? " is-on" : ""}`}
                      style={{ letterSpacing: val === "compact" ? "1px" : val === "relaxed" ? "4px" : "2px" }}
                      onClick={() => setLineHeight(val)}
                      title={val}
                    >{icon}</button>
                  ))}
                </div>

                {/* Font family */}
                <div className="reader-pop-label" style={{ marginTop: "10px" }}>Police</div>
                <div className="reader-ff-row">
                  <button
                    className={`reader-ff-btn${fontFamily === "sans" ? " is-on" : ""}`}
                    data-ff="sans"
                    onClick={() => setFontFamily("sans")}
                    title="Calibri / Segoe UI — proche des PDFs techniques"
                  >Document</button>
                  <button
                    className={`reader-ff-btn${fontFamily === "serif" ? " is-on" : ""}`}
                    data-ff="serif"
                    onClick={() => setFontFamily("serif")}
                    title="Lora / Georgia — lecture longue"
                  >Serif</button>
                </div>
              </div>
            )}
          </div>

          {/* Reading theme popup (TD-016: own toolbar control, split out of Typography) */}
          <div className="reader-tbtn-wrap">
            <button
              className={`reader-tbtn${showThemePop ? " is-on" : ""}`}
              onClick={() => {
                setShowThemePop((v) => !v);
                setShowTypoPop(false);
                setShowHlPop(false);
                setShowTtsPop(false);
                setShowZoomPop(false);
              }}
              title="Thème de lecture"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>

            {showThemePop && (
              <div className="reader-tool-pop">
                <div className="reader-pop-label">Thème de lecture</div>
                <div className="reader-theme-grid">
                  {(["cstb", "reading", "article", "report", "interactive"] as ReaderTheme[]).map((tName) => (
                    <button
                      key={tName}
                      className={`reader-theme-btn${theme === tName ? " is-on" : ""}`}
                      onClick={() => onThemeChange(tName)}
                    >
                      {tName === "cstb" ? "CSTB" :
                       tName === "reading" ? "Minimalist" :
                       tName === "article" ? "Tufte" :
                       tName === "report" ? "Report" : "Interactive"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mini-TOC toggle */}
          {renderMode === "html" && sections.length > 0 && (
            <button
              className={`reader-tbtn${showMiniToc ? " is-on" : ""}`}
              onClick={() => setShowMiniToc(v => !v)}
              title="Sommaire rapide"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>
              </svg>
            </button>
          )}

          {/* Zoom control — style Word (− / 100% ▾ / +) */}
          <div className="reader-zoom-ctrl">
            <button
              className="reader-tbtn reader-zoom-btn"
              onClick={() => setReaderZoom(z => Math.max(50, z - 10))}
              disabled={readerZoom <= 50}
              title="Zoom arrière (−10%)"
            >−</button>
            <div className="reader-tbtn-wrap">
              <button
                className={`reader-tbtn reader-zoom-pct${showZoomPop ? " is-on" : ""}`}
                onClick={() => {
                  setShowZoomPop(v => !v);
                  setShowTypoPop(false);
                  setShowHlPop(false);
                  setShowTtsPop(false);
                  setShowThemePop(false);
                }}
                title="Zoom — cliquer pour les préréglages"
              >
                {readerZoom}%
              </button>
              {showZoomPop && (
                <div className="reader-tool-pop reader-zoom-pop">
                  <div className="reader-pop-label">Zoom</div>
                  {[50, 75, 100, 125, 150, 200].map((z) => (
                    <button
                      key={z}
                      className={`reader-zoom-preset${readerZoom === z ? " is-active" : ""}`}
                      onClick={() => { setReaderZoom(z); setShowZoomPop(false); }}
                    >
                      {z}%
                    </button>
                  ))}
                  <div className="reader-pop-divider" />
                  <button
                    className={`reader-zoom-preset${readerZoom === 100 ? " is-active" : ""}`}
                    onClick={() => { setReaderZoom(100); setShowZoomPop(false); }}
                  >
                    Largeur de la page
                  </button>
                  <button
                    className={`reader-zoom-preset${readerZoom === 65 ? " is-active" : ""}`}
                    onClick={() => { setReaderZoom(65); setShowZoomPop(false); }}
                  >
                    Plusieurs pages
                  </button>
                </div>
              )}
            </div>
            <button
              className="reader-tbtn reader-zoom-btn"
              onClick={() => setReaderZoom(z => Math.min(200, z + 10))}
              disabled={readerZoom >= 200}
              title="Zoom avant (+10%)"
            >+</button>
          </div>

          {/* Search */}
          <button
            className={`reader-tbtn${showSearch ? " is-on" : ""}`}
            onClick={() => {
              const next = !showSearch;
              setShowSearch(next);
              if (next) setTimeout(() => searchInputRef.current?.focus(), 60);
              else { setSearchQuery(""); setSearchCount(0); }
            }}
            title="Rechercher dans le document"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </button>

          {/* Dark/light */}
          <button
            className="reader-tbtn"
            onClick={() => setIsDark(!isDark)}
            title={isDark ? "Mode clair" : "Mode sombre"}
          >
            {isDark ? "☀" : "🌙"}
          </button>

          {/* Download HTML */}
          {rawHtmlForDownload && (
            <button className="reader-tbtn" onClick={handleDownloadHTML} title="Télécharger HTML">
              💾
            </button>
          )}
        </div>
      </header>

      {/* Search bar */}
      {showSearch && (
        <div className="reader-searchbar">
          <svg className="reader-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            className="reader-search-input"
            placeholder="Rechercher dans le document…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearchIdx((i) => searchCount > 0 ? (i + 1) % searchCount : 0);
              if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); setSearchCount(0); }
            }}
          />
          {searchQuery && (
            <span className={`reader-search-count${searchCount === 0 ? " is-none" : ""}`}>
              {searchCount === 0 ? "Aucun résultat" : `${searchIdx + 1} / ${searchCount}`}
            </span>
          )}
          <button className="reader-search-nav" onClick={() => setSearchIdx((i) => Math.max(0, i - 1))} disabled={searchCount === 0 || searchIdx === 0} title="Précédent (↑)">↑</button>
          <button className="reader-search-nav" onClick={() => setSearchIdx((i) => searchCount > 0 ? (i + 1) % searchCount : 0)} disabled={searchCount === 0} title="Suivant (↓ ou Entrée)">↓</button>
          <button className="reader-search-close" onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchCount(0); }} title="Fermer (Échap)">✕</button>
        </div>
      )}

      {/* Stats bar */}
      <div className="reader-stats">
        <span className="reader-stat">⏱ {readingMinutes} min de lecture</span>
        <span className="reader-stat">📝 {words.toLocaleString()} mots</span>
        {sections.length > 0 && (
          <span className="reader-stat">📑 {sections.length} section{sections.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Content */}
      <div
        className={`reader-content${pageMode ? " reader-content--page-mode" : ""}`}
        ref={contentRef}
        onClick={handleContentClick}
        onMouseUp={handleMouseUp}
      >

        {/* Breadcrumb */}
        <div className="reader-bc">
          <span className="reader-bc-sep">›</span>
          <span className="reader-bc-cur">{inFocus ? currentSection?.title : breadcrumb}</span>
        </div>

        {/* Focus header — sticky bar with back button, title and inline prev/next nav */}
        {inFocus && currentSection && (
          <div className="reader-focus-header">
            <button className="reader-back-btn" onClick={exitFocus}>
              ← Tout
            </button>
            <span className="reader-focus-label" title={currentSection.title}>
              {currentSection.title}
            </span>
            <div className="reader-focus-nav reader-focus-nav--inline">
              <button
                className="reader-nav-btn"
                onClick={() => goFocus(focusIdx - 1)}
                disabled={focusIdx === 0}
                title="Section précédente"
              >←</button>
              <span className="reader-focus-counter">
                {focusIdx + 1} / {sections.length}
              </span>
              <button
                className="reader-nav-btn"
                onClick={() => goFocus(focusIdx + 1)}
                disabled={focusIdx >= sections.length - 1}
                title="Section suivante"
              >→</button>
            </div>
          </div>
        )}

        <div className="reader-cw">
          {/* Paper header card */}
          {renderMode === "html" && paperMeta?.title && !inFocus && (
            <div className="reader-paper-card">
              <h1 className="reader-paper-title">{paperMeta.title}</h1>
              {paperMeta.authors.length > 0 && (
                <p className="reader-paper-authors">
                  {paperMeta.authors.map((a, i) => (
                    <span key={i} className="reader-paper-author">
                      {a}{i < paperMeta.authors.length - 1 && <span className="reader-paper-sep"> · </span>}
                    </span>
                  ))}
                </p>
              )}
              <div className="reader-paper-stats">
                <span className="reader-bstat">⏱ {readingMinutes} min de lecture</span>
                <span className="reader-bstat">📝 {words.toLocaleString()} mots</span>
                {sections.length > 0 && <span className="reader-bstat">📑 {sections.length} sections</span>}
                {stats.nFormulas > 0 && (
                  <span className="reader-bstat">∑ {stats.nFormulas} formule{stats.nFormulas > 1 ? "s" : ""}</span>
                )}
                {stats.nTables > 0 && (
                  <span className="reader-bstat">📊 {stats.nTables} tableau{stats.nTables > 1 ? "x" : ""}</span>
                )}
                {stats.nFigures > 0 && (
                  <span className="reader-bstat">🖼️ {stats.nFigures} figure{stats.nFigures > 1 ? "s" : ""}</span>
                )}
              </div>
              {paperMeta.abstract && (
                <div className="reader-paper-abstract">
                  <span className="reader-paper-abstract-label">Abstract</span>
                  <p>{paperMeta.abstract}</p>
                </div>
              )}
              {paperMeta.keywords.length > 0 && (
                <div className="reader-paper-keywords">
                  {paperMeta.keywords.map((k, i) => (
                    <span key={i} className="reader-paper-keyword">{k}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Skeleton loader while HTML chunks load */}
          {renderMode === "html" && !visibleHtml && !error && (
            <div className="reader-skeleton">
              {[["60%","28px"],["40%","18px"],["100%","15px"],["100%","15px"],["80%","15px"],["100%","56px",true],["100%","15px"],["72%","15px"],["100%","15px"],["55%","15px"]].map(([w, h, tall], i) => (
                <div key={i} className="reader-sk-block" style={{ width: w as string, height: h as string, marginTop: tall ? "20px" : undefined }} />
              ))}
            </div>
          )}

          {/* HTML mode */}
          {renderMode === "html" && visibleHtml && (
            <>
              <div
                className="reader-doc"
                style={{ zoom: `${readerZoom}%` }}
                dangerouslySetInnerHTML={{ __html: visibleHtml }}
              />
              {inFocus && (
                <nav className="reader-focus-nav">
                  <button
                    className="reader-nav-btn"
                    onClick={() => goFocus(focusIdx - 1)}
                    disabled={focusIdx === 0}
                  >← Précédent</button>
                  <button className="reader-nav-btn reader-nav-btn--exit" onClick={exitFocus}>
                    Vue complète
                  </button>
                  <button
                    className="reader-nav-btn"
                    onClick={() => goFocus(focusIdx + 1)}
                    disabled={focusIdx >= sections.length - 1}
                  >Suivant →</button>
                </nav>
              )}
              {/* Bottom exit shortcut */}
              {inFocus && (
                <div style={{ textAlign: "center", paddingBottom: "32px" }}>
                  <button
                    className="reader-nav-btn reader-nav-btn--exit"
                    onClick={exitFocus}
                    style={{ marginTop: "8px" }}
                  >
                    ↑ Vue complète
                  </button>
                </div>
              )}
            </>
          )}

          {/* Markdown mode */}
          {renderMode === "md" && (
            <div className="reader-doc reader-doc--md" style={{ zoom: `${readerZoom}%` }}>
              {error && <p className="reader-state reader-state--error">Erreur : {error}</p>}
              {!md && !error && (
                <div className="reader-loader"><span /><span /><span /></div>
              )}
              {md && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex, rehypeHighlight]}
                >
                  {md}
                </ReactMarkdown>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Notes / Annotation Panel */}
      {showNotePanel && activeNoteKey && (
        <div className="reader-note-panel" onClick={(e) => e.stopPropagation()}>
          <div className="reader-note-panel-header">
            <h4>Note Adhésive</h4>
            <button className="reader-note-panel-close" onClick={() => {
              setShowNotePanel(false);
              setActiveNoteKey(null);
              setNoteText("");
            }}>×</button>
          </div>
          
          <div className="reader-note-panel-context">
            "{highlights.find(h => h.key === activeNoteKey)?.text.slice(0, 60)}..."
          </div>

          <textarea
            className="reader-note-panel-input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Saisissez votre note ici..."
          />

          <div className="reader-note-panel-actions">
            <button className="reader-note-btn reader-note-btn--delete" onClick={handleDeleteHighlight} title="Supprimer le surlignage">
              Supprimer
            </button>
            <button className="reader-note-btn reader-note-btn--save" onClick={handleSaveNote}>
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Notes/Annotations list panel (T9) */}
      {showNotesList && (
        <div className="reader-notes-list">
          <div className="reader-notes-list__head">
            <strong>Annotations</strong>
            <button type="button" onClick={() => setShowNotesList(false)}>✕</button>
          </div>
          {highlights.length === 0 ? (
            <p className="reader-notes-list__empty">Aucune annotation pour ce document.</p>
          ) : (
            notesListGroups.map((g) => (
              <div key={g.title} className="reader-notes-list__section">
                <h4>{g.title}</h4>
                {g.items.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    className="reader-notes-list__item"
                    onClick={() => scrollToHighlight(h.key)}
                  >
                    <span
                      className="reader-notes-list__swatch"
                      style={{ backgroundColor: h.color }}
                    />
                    <span className="reader-notes-list__text">
                      {h.text.length > 80 ? h.text.slice(0, 80) + "…" : h.text}
                      {notes[h.key] && <em className="reader-notes-list__note"> — {notes[h.key]}</em>}
                    </span>
                    {h.page ? <span className="reader-notes-list__page">p.{h.page}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Jump to top */}
      <button
        className={`reader-jump-top${showJumpTop ? " is-on" : ""}`}
        onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        title="Retour en haut"
      >↑</button>

      {/* Mini-TOC floating panel — utilise l'outline backend (même source que la sidebar) */}
      {showMiniToc && renderMode === "html" && (outline ?? []).length > 0 && (
        <nav className="reader-minitoc" aria-label="Sommaire rapide">
          <div className="reader-minitoc-hd">
            <span>Sommaire</span>
            <button className="reader-minitoc-close" onClick={() => setShowMiniToc(false)} title="Fermer">✕</button>
          </div>
          <ul className="reader-minitoc-list">
            {flattenOutline(outline ?? []).map(({ node, depth }) => {
              const match = matchSection(sections, node.title);
              const isActive = match ? match.id === activeSid : false;
              return (
                <li
                  key={node.id}
                  className={`reader-minitoc-item rmt-l${Math.min(depth + 1, 4)}${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    // Navigation via section DOM (même logique que scrollToSection)
                    isProgrammaticScrollRef.current = true;
                    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 600);
                    if (match) {
                      const el = contentRef.current?.querySelector<HTMLElement>(`section[data-sid="${match.id}"]`);
                      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveSid(match.id); return; }
                    }
                    // Fallback : chercher le heading par texte
                    const norm = (s: string) => s.toLowerCase().replace(/\W+/g, "");
                    const target = norm(node.title);
                    const headings = contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4");
                    if (headings) {
                      for (const h of headings) {
                        const ht = norm(h.textContent ?? "");
                        if (ht === target || ht.includes(target) || target.includes(ht)) {
                          h.scrollIntoView({ behavior: "smooth", block: "start" }); break;
                        }
                      }
                    }
                  }}
                  title={node.title}
                >
                  {node.title}
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* Image lightbox */}
      {readerImageIdx !== null && readerImages[readerImageIdx] && (
        <FigureOverlay
          docId={docId}
          figure={readerImages[readerImageIdx]}
          index={readerImageIdx}
          total={readerImages.length}
          onClose={() => setReaderImageIdx(null)}
          onPrev={readerImageIdx > 0 ? () => setReaderImageIdx(readerImageIdx - 1) : undefined}
          onNext={readerImageIdx < readerImages.length - 1 ? () => setReaderImageIdx(readerImageIdx + 1) : undefined}
          onGotoPage={(page) => {
            setReaderImageIdx(null);
            scrollToPage(page);
          }}
        />
      )}
    </div>
  );
});
