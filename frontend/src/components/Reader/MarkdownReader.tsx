import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import katex from "katex";
import { API_BASE } from "../../api";
import type { OutlineNode } from "../../types";
import { FigureOverlay } from "../Figure/FigureOverlay";
import {
  matchSection,
  flattenOutline,
  removeAllHighlights,
  highlightTextInElement,
} from "./readerHtml";
import "./MarkdownReader.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";

// Hooks
import { useAppearance } from "./hooks/useAppearance";
import { useImageLightbox } from "./hooks/useImageLightbox";
import { usePdfPageSync } from "./hooks/usePdfPageSync";
import { useSearch } from "./hooks/useSearch";
import { useTts } from "./hooks/useTts";
import { useFocusMode } from "./hooks/useFocusMode";
import { useContentLoading } from "./hooks/useContentLoading";
import { useAnnotations } from "./hooks/useAnnotations";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReaderTheme = "reading" | "article" | "report" | "interactive" | "cstb";

export interface ReaderHandle {
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
  onPageChange?: (page: number) => void;
  compareMode?: boolean;
  searchQuery?: string;
}

export const MarkdownReader = forwardRef<ReaderHandle, Props>((
  props: Props,
  ref,
) => {
  const {
    docId,
    filename,
    pdfTitle,
    outline,
    theme,
    onThemeChange,
    focusSectionTitle,
    onFocusClear,
    appTheme,
    onPageChange,
    compareMode = false,
    searchQuery: propSearchQuery,
  } = props;

  const contentRef = useRef<HTMLDivElement>(null);

  // 1. Appearance Hook
  const {
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    fontFamily,
    setFontFamily,
    readerZoom,
    setReaderZoom,
    showZoomPop,
    setShowZoomPop,
    pageMode,
    setPageMode,
    showTypoPop,
    setShowTypoPop,
  } = useAppearance();

  // 2. Image Lightbox Hook
  const {
    readerImageIdx,
    setReaderImageIdx,
    readerImages,
  } = useImageLightbox(contentRef);

  // 3. PDF Page Sync Hook
  const {
    pdfPageNos,
    setPdfPageNos,
    currentPdfPage,
    progress,
    showJumpTop,
    breadcrumb,
    setBreadcrumb,
    activeSid,
    isProgrammaticScrollRef,
    scrollToPage,
    goPrevPage,
    goNextPage,
  } = usePdfPageSync({
    contentRef,
    renderMode: "html", // sync scrolling uses HTML mode markers
    compareMode,
    onPageChange,
    sections: [], // initialized dynamically
  });

  // 4. Content Loading Hook
  const {
    md,
    htmlContent,
    rawHtmlForDownload,
    sections,
    words,
    stats,
    htmlAvailable,
    htmlTooLarge,
    renderMode,
    setRenderMode,
    error,
    paperMeta,
  } = useContentLoading({
    docId,
    filename,
    pdfTitle,
    outline,
    setBreadcrumb,
    setPdfPageNos,
  });

  // 5. Focus Mode Hook
  const {
    focusSid,
    focusIdx,
    visibleHtml,
    goFocus,
    exitFocus,
  } = useFocusMode({
    focusSectionTitle,
    onFocusClear,
    sections,
    renderMode,
    htmlContent,
    outline,
    paperMeta,
    contentRef,
    setBreadcrumb,
  });

  // 6. Search Hook
  const {
    showSearch,
    setShowSearch,
    searchQuery,
    setSearchQuery,
    searchCount,
    setSearchCount,
    searchIdx,
    setSearchIdx,
    searchInputRef,
  } = useSearch(contentRef, propSearchQuery, visibleHtml);

  // 7. Text-To-Speech Hook
  const [showTtsPop, setShowTtsPop] = useState(false);
  const {
    ttsActive,
    ttsPaused,
    ttsRate,
    setTtsRate,
    handlePlayTTS,
    handlePauseTTS,
    handleStopTTS,
    getSpeakText,
  } = useTts(contentRef);

  // 8. Annotations Hook
  const {
    hlMode,
    setHlMode,
    hlColor,
    setHlColor,
    highlights,
    notes,
    activeNoteKey,
    setActiveNoteKey,
    noteText,
    setNoteText,
    showNotePanel,
    setShowNotePanel,
    showHlPop,
    setShowHlPop,
    handleMouseUp,
    handleContentClick,
    handleSaveNote,
    handleDeleteHighlight,
    clearAllAnnotations,
  } = useAnnotations({
    docId,
    visibleHtml,
    renderMode,
    contentRef,
    setShowTypoPop,
    setShowTtsPop,
    setShowZoomPop,
  });

  // Theme synchronization
  const darkThemes: AppTheme[] = ["oled", "forest"];
  const [localIsDark, setLocalIsDark] = useState(
    () => appTheme ? darkThemes.includes(appTheme)
                   : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark = props.isDark !== undefined ? props.isDark : localIsDark;
  const setIsDark = props.onDarkChange !== undefined ? props.onDarkChange : setLocalIsDark;

  useEffect(() => {
    if (appTheme) {
      const isDarkTheme = appTheme === "glassmorphism" || appTheme === "technical" || appTheme === "oled";
      setIsDark(isDarkTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appTheme]);

  // Keyboard Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as Element)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        if (readerImageIdx !== null) { setReaderImageIdx(null); return; }
        if (showSearch) { setShowSearch(false); setSearchQuery(""); setSearchCount(0); return; }
        if (focusSid) {
          exitFocus();
        }
        return;
      }

      if (e.key === "j" && focusSid && renderMode === "html") {
        goFocus(focusIdx + 1);
        e.preventDefault();
      }
      if (e.key === "k" && focusSid && renderMode === "html") {
        goFocus(focusIdx - 1);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerImageIdx, showSearch, focusSid, focusIdx, sections, renderMode, goFocus, exitFocus, setSearchCount, setSearchQuery, setShowSearch, setReaderImageIdx]);

  // Imperative handle for synchronized scroll in Compare Mode
  useImperativeHandle(ref, () => ({
    scrollToSection(title: string) {
      if (!contentRef.current) return;
      isProgrammaticScrollRef.current = true;
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 1000);

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
  }), [sections, isProgrammaticScrollRef]);

  // MathML/LaTeX rendering hook
  useEffect(() => {
    if (renderMode !== "html" || !contentRef.current) return;

    const mathElements = contentRef.current.querySelectorAll(
      ".formula, .equation, math, .formula-not-decoded",
    );
    mathElements.forEach((el) => {
      if (el.hasAttribute("data-katex-rendered")) return;

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

      if (!latex) {
        const text = el.textContent?.trim();
        if (text && (text.startsWith("$$") || text.startsWith("$") || text.startsWith("\\[") || text.startsWith("\\("))) {
          latex = text;
        }
      }

      if (!latex && el.classList.contains("formula-not-decoded")) {
        const rawText = (el.textContent ?? "").trim();
        if (rawText && rawText !== "Formula not decoded") {
          latex = rawText.replace(/\\\\/g, "\\");
          if (latex.startsWith("$$") && latex.endsWith("$$")) latex = latex.slice(2, -2).trim();
          else if (latex.startsWith("$") && latex.endsWith("$")) latex = latex.slice(1, -1).trim();
        }
      }

      if (latex && latex !== "Formula not decoded") {
        if (latex.startsWith("$$") && latex.endsWith("$$")) {
          latex = latex.slice(2, -2).trim();
        } else if (latex.startsWith("$") && latex.endsWith("$")) {
          latex = latex.slice(1, -1).trim();
        } else if (latex.startsWith("\\[") && latex.endsWith("\\]")) {
          latex = latex.slice(2, -2).trim();
        } else if (latex.startsWith("\\(") && latex.endsWith("\\)")) {
          latex = latex.slice(2, -2).trim();
        }

        latex = latex.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();

        const container = document.createElement("span");
        container.className = "katex-formula-rendered";
        try {
          const isDisplay = el.tagName === "DIV" || el.classList.contains("equation") || el.getAttribute("display") === "block";
          katex.render(latex, container, {
            displayMode: isDisplay,
            output: "html",
            throwOnError: false,
            strict: "ignore",
          });

          if (container.querySelector(".katex-error") && el.classList.contains("formula-not-decoded")) {
            el.setAttribute("data-katex-rendered", "true");
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

  // KaTeX Auto-Render on full HTML Docling
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
        });
      }).catch(() => {});
    }, 80);
    return () => clearTimeout(t);
  }, [htmlContent, focusSid]);

  // Download Standalone Annotated HTML
  const downloadName = filename ? filename.replace(/\.[^.]+$/, ".html") : "document.html";

  const handleDownloadHTML = () => {
    if (!htmlContent) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    removeAllHighlights(doc.body);
    highlights.forEach((hl) => {
      const hasNote = !!notes[hl.key];
      highlightTextInElement(doc.body, hl.text, hl.color, hl.key, hasNote);
    });

    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith("/doc/")) {
        img.setAttribute("src", `${API_BASE}${src}`);
      }
    });

    const title = paperMeta?.title || filename || "Document";

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

  const readingMinutes = Math.max(1, Math.round(words / 250));
  const currentSection = sections.find((s) => s.id === focusSid);
  const inFocus = focusSid !== null && renderMode === "html";

  const [showMiniToc, setShowMiniToc] = useState(false);

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

          {/* PDF Page navigation — compare mode only */}
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
                onClick={() => setPageMode(!pageMode)}
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
                  setShowHlPop(!showHlPop);
                  setShowTypoPop(false);
                  setShowTtsPop(false);
                  setShowZoomPop(false);
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
                        clearAllAnnotations();
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

          {/* TTS Controls */}
          {renderMode === "html" && (
            <div className="reader-tbtn-wrap">
              <button
                className={`reader-tbtn${ttsActive ? " is-on" : ""}`}
                onClick={() => {
                  setShowTtsPop(!showTtsPop);
                  setShowTypoPop(false);
                  setShowHlPop(false);
                  setShowZoomPop(false);
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
                setShowTypoPop(!showTypoPop);
                setShowHlPop(false);
                setShowTtsPop(false);
                setShowZoomPop(false);
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
                    onChange={(e) => setFontSize((["sm","md","lg","xl","xxl"] as any[])[parseInt(e.target.value)])}
                    style={{ flex: 1, accentColor: "var(--or)" }}
                  />
                  <span style={{ fontSize: "16px", color: "var(--tx2)" }}>A</span>
                </div>

                {/* Line height */}
                <div className="reader-pop-label" style={{ marginTop: "10px" }}>Interligne</div>
                <div className="reader-lh-row">
                  {([["compact","≡",1.6],["normal","≡",1.85],["relaxed","≡",2.2]] as any[]).map(([val, icon]) => (
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
                    onClick={() => setFontFamily("sans")}
                    title="Calibri / Segoe UI — proche des PDFs techniques"
                  >Document</button>
                  <button
                    className={`reader-ff-btn${fontFamily === "serif" ? " is-on" : ""}`}
                    onClick={() => setFontFamily("serif")}
                    title="Lora / Georgia — lecture longue"
                  >Serif</button>
                </div>

                {/* Reading theme */}
                <div className="reader-pop-label" style={{ marginTop: "10px" }}>Thème de lecture</div>
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
              onClick={() => setShowMiniToc(!showMiniToc)}
              title="Sommaire rapide"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>
              </svg>
            </button>
          )}

          {/* Zoom control */}
          <div className="reader-zoom-ctrl">
            <button
              className="reader-tbtn reader-zoom-btn"
              onClick={() => setReaderZoom(Math.max(50, readerZoom - 10))}
              disabled={readerZoom <= 50}
              title="Zoom arrière (−10%)"
            >−</button>
            <div className="reader-tbtn-wrap">
              <button
                className={`reader-tbtn reader-zoom-pct${showZoomPop ? " is-on" : ""}`}
                onClick={() => {
                  setShowZoomPop(!showZoomPop);
                  setShowTypoPop(false);
                  setShowHlPop(false);
                  setShowTtsPop(false);
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
              onClick={() => setReaderZoom(Math.min(200, readerZoom + 10))}
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

        {/* Focus header */}
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

          {/* Skeleton loader */}
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

      {/* Jump to top */}
      <button
        className={`reader-jump-top${showJumpTop ? " is-on" : ""}`}
        onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        title="Retour en haut"
      >↑</button>

      {/* Mini-TOC */}
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
                    isProgrammaticScrollRef.current = true;
                    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 600);
                    if (match) {
                      const el = contentRef.current?.querySelector<HTMLElement>(`section[data-sid="${match.id}"]`);
                      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
                    }
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
