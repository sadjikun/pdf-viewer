import { useState, useRef, useEffect, type RefObject } from "react";
import type { Section } from "../readerHtml";

interface UsePdfPageSyncParams {
  contentRef: RefObject<HTMLDivElement | null>;
  renderMode: "html" | "md";
  compareMode: boolean;
  onPageChange?: (page: number) => void;
  sections: Section[];
}

/**
 * Hook for PDF page synchronization in the Reader.
 * Manages the scroll handler (progress, breadcrumb, active section, PDF page tracking),
 * page navigation buttons, and the anti-loop guard (FIX-026, FIX-037).
 */
export function usePdfPageSync(params: UsePdfPageSyncParams) {
  const { contentRef, renderMode, compareMode, onPageChange } = params;

  const [pdfPageNos, setPdfPageNos] = useState<number[]>([]);
  const [currentPdfPage, setCurrentPdfPage] = useState<number>(1);
  const [progress, setProgress] = useState(0);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string>("Document");
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  // Scroll events: progress + jump-to-top + breadcrumb
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
        // FIX-026 : only propagate onPageChange (→ PDF viewer) on user scroll,
        // not programmatic (scrollToSection / scrollToPage sets isProgrammaticScrollRef).
        if (compareMode) {
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
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [renderMode, onPageChange, compareMode, contentRef]);

  const scrollToPage = (pageNo: number) => {
    const el = contentRef.current;
    if (!el) return;
    const marker = el.querySelector<HTMLElement>(`.pdf-page-marker[data-page="${pageNo}"]`);
    if (marker) {
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

  return {
    pdfPageNos,
    setPdfPageNos,
    currentPdfPage,
    progress,
    showJumpTop,
    setShowJumpTop,
    breadcrumb,
    setBreadcrumb,
    activeSid,
    setActiveSid,
    isProgrammaticScrollRef,
    scrollToPage,
    goPrevPage,
    goNextPage,
  };
}
