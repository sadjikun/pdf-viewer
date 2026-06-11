import { useState, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Highlight } from "../readerHtml";
import { highlightTextInElement, removeAllHighlights } from "../readerHtml";
import { getAnnotations, saveAnnotations } from "../../../api";

interface UseAnnotationsParams {
  docId: string;
  visibleHtml: string | null;
  renderMode: "html" | "md";
  contentRef: RefObject<HTMLDivElement | null>;
  setShowTypoPop: (show: boolean) => void;
  setShowTtsPop: (show: boolean) => void;
  setShowZoomPop: (show: boolean) => void;
}

export function useAnnotations(params: UseAnnotationsParams) {
  const {
    docId,
    visibleHtml,
    renderMode,
    contentRef,
    setShowTypoPop,
    setShowTtsPop,
    setShowZoomPop,
  } = params;

  const [hlMode, setHlMode] = useState(false);
  const [hlColor, setHlColor] = useState("#ffe066");
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [showHlPop, setShowHlPop] = useState(false);

  const syncTimerRef = useRef<number | null>(null);

  // Load annotations when docId changes
  useEffect(() => {
    if (!docId) return;

    // Fetch from server first
    getAnnotations(docId)
      .then((data) => {
        if (data && data.highlights && data.highlights.length > 0) {
          // Loaded from server
          // Map StoredHighlight format to local Highlight format
          const mappedHls: Highlight[] = data.highlights.map((h) => ({
            key: h.key,
            color: h.color,
            text: h.text,
          }));
          setHighlights(mappedHls);
          setNotes(data.notes || {});
        } else {
          // Empty or absent on server -> try auto-migration from localStorage
          try {
            const storedHls = localStorage.getItem(`reader-hl-${docId}`);
            const storedNotes = localStorage.getItem(`reader-notes-${docId}`);
            
            const localHls = storedHls ? JSON.parse(storedHls) : [];
            const localNotes = storedNotes ? JSON.parse(storedNotes) : {};

            setHighlights(localHls);
            setNotes(localNotes);

            if (localHls.length > 0 || Object.keys(localNotes).length > 0) {
              // Push migrated localStorage data to server
              saveAnnotations(docId, {
                version: 1,
                highlights: localHls.map((h: any) => ({
                  key: h.key,
                  color: h.color,
                  text: h.text,
                  section: "",
                  sectionTitle: "",
                  page: 1,
                })),
                notes: localNotes,
                saved_at: Date.now(),
              }).catch(() => {});
            }
          } catch (e) {
            console.error("Error migrating highlights/notes from localStorage", e);
          }
        }
      })
      .catch((err) => {
        console.error("Error loading annotations from server, falling back to localStorage", err);
        // Fallback to localStorage on error
        try {
          const storedHls = localStorage.getItem(`reader-hl-${docId}`);
          setHighlights(storedHls ? JSON.parse(storedHls) : []);

          const storedNotes = localStorage.getItem(`reader-notes-${docId}`);
          setNotes(storedNotes ? JSON.parse(storedNotes) : {});
        } catch (e) {
          console.error("Error reading highlights/notes from localStorage", e);
        }
      });

    // Reset local UI states
    setActiveNoteKey(null);
    setNoteText("");
    setShowNotePanel(false);
  }, [docId]);

  // Persist highlights & notes: Option B (localStorage primary + debounced server sync)
  const persistAll = (newHls: Highlight[], newNotes: Record<string, string>) => {
    // 1. Write to localStorage immediately (primary copy)
    try {
      localStorage.setItem(`reader-hl-${docId}`, JSON.stringify(newHls));
      localStorage.setItem(`reader-notes-${docId}`, JSON.stringify(newNotes));
    } catch (e) {
      console.error("Failed to save to localStorage", e);
    }

    // 2. Debounce push to server (1000 ms)
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = window.setTimeout(() => {
      // Map local highlights to StoredHighlights structure required by the API
      const storedHls = newHls.map((h) => ({
        key: h.key,
        color: h.color,
        text: h.text,
        section: "",
        sectionTitle: "",
        page: 1,
      }));

      saveAnnotations(docId, {
        version: 1,
        highlights: storedHls,
        notes: newNotes,
        saved_at: Date.now(),
      }).catch((err) => {
        console.warn("Failed to sync annotations to server (offline-first)", err);
      });
    }, 1000);
  };

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
  }, [visibleHtml, highlights, notes, renderMode, contentRef]);

  // Clean up sync timer on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  // Handle text selection highlighting
  const handleMouseUp = () => {
    if (!hlMode || renderMode !== "html") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return;

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
    if (highlights.some((h) => h.key === key)) {
      selection.removeAllRanges();
      return;
    }

    const newHl: Highlight = {
      text: selectedText,
      color: hlColor,
      key: key,
    };

    const nextHls = [...highlights, newHl];
    setHighlights(nextHls);
    persistAll(nextHls, notes);

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
        if (btn) {
          btn.classList.add("is-visible");
          setTimeout(() => btn.classList.remove("is-visible"), 1200);
        }
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

    const nextHls = highlights.filter((h) => h.key !== activeNoteKey);
    setHighlights(nextHls);
    persistAll(nextHls, nextNotes);

    setShowNotePanel(false);
    setActiveNoteKey(null);
    setNoteText("");
  };

  const clearAllAnnotations = () => {
    if (contentRef.current) {
      const docEl = contentRef.current.querySelector(".reader-doc");
      if (docEl) removeAllHighlights(docEl as HTMLElement);
    }
    setHighlights([]);
    setNotes({});
    persistAll([], {});
  };

  return {
    hlMode,
    setHlMode,
    hlColor,
    setHlColor,
    highlights,
    setHighlights,
    notes,
    setNotes,
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
  };
}
