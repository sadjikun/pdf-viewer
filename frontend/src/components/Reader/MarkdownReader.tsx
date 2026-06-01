import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import katex from "katex";
import { htmlUrl, htmlManifestUrl, htmlPartUrl, markdownUrl, API_BASE } from "../../api";
import type { HtmlManifestEntry, OutlineNode, Figure } from "../../types";
import { FigureOverlay } from "../Figure/FigureOverlay";
import {
  sectionizeHtml,
  parseMdSections,
  matchSection,
  flattenOutline,
  extractPaperMeta,
  highlightTextInElement,
  removeAllHighlights,
  cleanPdfTitle,
} from "./readerHtml";
import type { Section, PaperMeta, Highlight } from "./readerHtml";
import "./MarkdownReader.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";

// ── Types ─────────────────────────────────────────────────────────────────────


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


type FontSize = "sm" | "md" | "lg" | "xl" | "xxl";
type LineHeight = "compact" | "normal" | "relaxed";
type FontFamily = "serif" | "sans";



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
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [pageMode, setPageMode] = useState(false); // one-page-at-a-time toggle

  // ── Surlignage & Notes & TTS State ──────────────────────────────────────────
  const [hlMode, setHlMode] = useState(false);
  const [hlColor, setHlColor] = useState("#ffe066");
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [showHlPop, setShowHlPop] = useState(false);
  const [showTtsPop, setShowTtsPop] = useState(false);

  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const readingMinutes = Math.max(1, Math.round(words / 250));

  // ── Derived HTML ─────────────────────────────────────────────────────────
  // En mode focus : masquer tout sauf la section active
  const visibleHtml = useMemo(() => {
    if (!htmlContent) return null;
    const styles: string[] = [];
    // Hide rs_pre if paper card is shown (avoids duplicate title/abstract)
    if (paperMeta?.title) {
      styles.push(`section[data-sid="rs_pre"]{display:none!important}`);
    }
    // Focus mode: hide all sections except the active one AND its sub-sections
    if (focusSid) {
      const n = (s: string) => s.toLowerCase().replace(/\W+/g, "");
      const visibleSids: string[] = [focusSid];
      const focusedTitle = sections[focusIdx]?.title ?? "";

      // Try to find the node and all its descendants in the outline tree
      let descendantTitles: Set<string> | null = null;
      if (outline && outline.length > 0) {
        // Helper to normalize and collect descendant titles
        const collectDescendantTitles = (node: OutlineNode, set: Set<string>) => {
          set.add(n(node.title));
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
            const nodeNorm = n(node.title);
            const focusNorm = n(focusedTitle);
            const strippedNode = n(node.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
            const strippedFocus = n(focusedTitle.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
            if (
              nodeNorm === focusNorm || 
              (strippedNode && strippedNode === focusNorm) ||
              (strippedFocus && nodeNorm === strippedFocus)
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

  // Load highlights & notes when docId changes
  useEffect(() => {
    if (!docId) return;
    try {
      const storedHls = localStorage.getItem(`reader-hl-${docId}`);
      setHighlights(storedHls ? JSON.parse(storedHls) : []);

      const storedNotes = localStorage.getItem(`reader-notes-${docId}`);
      setNotes(storedNotes ? JSON.parse(storedNotes) : {});
    } catch (e) {
      console.error("Error reading highlights/notes from localStorage", e);
    }
    setBreadcrumb(cleanPdfTitle(pdfTitle) || (filename ? filename.replace(/\.[^.]+$/, "") : "Document"));
    // Clean up TTS when changing document
    window.speechSynthesis.cancel();
    setTtsActive(false);
    setTtsPaused(false);
  }, [docId, filename, pdfTitle]);

  // Reapply highlights to the DOM when visibleHtml, highlights, notes, or renderMode change
  useEffect(() => {
    if (renderMode !== "html" || !contentRef.current) return;
    const docEl = contentRef.current.querySelector<HTMLElement>(".reader-doc");
    if (!docEl) return;

    const timer = setTimeout(() => {
      removeAllHighlights(docEl);
      highlights.forEach((hl) => {
        const hasNote = !!notes[hl.key];
        highlightTextInElement(docEl, hl.text, hl.color, hl.key, hasNote);
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
    if (selectedText.length < 3) return;

    // Check if selection is within the reader document
    if (selection.rangeCount === 0) return;
    let range;
    try {
      range = selection.getRangeAt(0);
    } catch {
      return;
    }

    const container = contentRef.current?.querySelector(".reader-doc");
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const key = selectedText.slice(0, 50).toLowerCase().replace(/\s+/g, " ");

    // Check if already highlighted
    if (highlights.some(h => h.key === key)) {
      selection.removeAllRanges();
      return;
    }

    const newHl: Highlight = {
      text: selectedText,
      color: hlColor,
      key: key
    };

    const nextHls = [...highlights, newHl];
    setHighlights(nextHls);
    localStorage.setItem(`reader-hl-${docId}`, JSON.stringify(nextHls));

    // Clear selection
    selection.removeAllRanges();

    // Automatically open the note panel for the new highlight
    setActiveNoteKey(key);
    setNoteText("");
    setShowNotePanel(true);
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
    localStorage.setItem(`reader-notes-${docId}`, JSON.stringify(nextNotes));
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
    localStorage.setItem(`reader-notes-${docId}`, JSON.stringify(nextNotes));

    const nextHls = highlights.filter(h => h.key !== activeNoteKey);
    setHighlights(nextHls);
    localStorage.setItem(`reader-hl-${docId}`, JSON.stringify(nextHls));

    setShowNotePanel(false);
    setActiveNoteKey(null);
    setNoteText("");
  };

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
    let rafId = 0;

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const { scrollTop, scrollHeight, clientHeight } = el;
        const pct = scrollHeight <= clientHeight
          ? 100
          : (scrollTop / (scrollHeight - clientHeight)) * 100;
        setProgress(Math.min(100, Math.round(pct)));
        setShowJumpTop(scrollTop > 300);

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
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId);
    };
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
      highlightTextInElement(doc.body, hl.text, hl.color, hl.key, hasNote);
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
                        localStorage.removeItem(`reader-hl-${docId}`);
                        localStorage.removeItem(`reader-notes-${docId}`);
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
                  setShowTtsPop(v => !v);
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
