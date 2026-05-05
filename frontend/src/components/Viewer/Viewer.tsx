import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { bboxToPct } from "../../bbox";
import type { Figure, PageInfo } from "../../types";
import "./Viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PAGE_WIDTH = 900;
const PAGE_PADDING = 32; // doit matcher le padding CSS .viewer (1rem * 2)

export interface ViewerHandle {
  scrollToPage: (page: number) => void;
}

interface Props {
  url: string;
  pages?: PageInfo[];
  figures?: Figure[];
  searchQuery?: string;
  onPageChange?: (page: number) => void;
  onFigureClick?: (index: number) => void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    return "&quot;";
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTextRenderer(query: string) {
  if (!query.trim()) return undefined;
  const re = new RegExp(escapeRe(query.trim()), "gi");
  return ({ str }: { str: string }) =>
    escapeHtml(str).replace(re, (m) => `<mark class="search-hit">${escapeHtml(m)}</mark>`);
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(
  { url, pages, figures, searchQuery, onPageChange, onFigureClick },
  ref,
) {
  const textRenderer = useMemo(
    () => makeTextRenderer(searchQuery ?? ""),
    [searchQuery],
  );
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const visiblePages = useRef<Set<number>>(new Set());

  // Largeur de page = largeur dispo du container, plafonnée à MAX_PAGE_WIDTH
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? root.clientWidth;
      const target = Math.max(200, Math.min(MAX_PAGE_WIDTH, w - PAGE_PADDING));
      setPageWidth(target);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const setPageRef = useCallback((page: number) => (el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(page, el);
    else pageRefs.current.delete(page);
  }, []);

  // IntersectionObserver : détecter la page la plus haute actuellement visible
  useEffect(() => {
    if (numPages == null || !containerRef.current || !onPageChange) return;
    const root = containerRef.current;
    const visible = visiblePages.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page);
          if (!Number.isFinite(p)) continue;
          if (e.isIntersecting && e.intersectionRatio > 0.25) {
            visible.add(p);
          } else {
            visible.delete(p);
          }
        }
        if (visible.size > 0) {
          const top = Math.min(...visible);
          onPageChange(top);
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    pageRefs.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      visible.clear();
    };
  }, [numPages, onPageChange]);

  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      const el = pageRefs.current.get(page);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }));

  const file = useMemo(() => ({ url }), [url]);

  return (
    <div className="viewer" ref={containerRef}>
      <Document
        file={file}
        onLoadSuccess={({ numPages: n }) => {
          setNumPages(n);
          setLoadError(null);
        }}
        onLoadError={(e) => setLoadError(e.message ?? String(e))}
        loading={<p className="viewer-msg">Chargement du PDF…</p>}
        error={
          <div className="viewer-msg viewer-msg-error">
            <p>Échec de chargement du PDF.</p>
            {loadError && <p className="viewer-msg-detail">{loadError}</p>}
          </div>
        }
      >
        {numPages != null &&
          Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
            const pageInfo = pages?.find((pp) => pp.number === p);
            const pageFigures = figures
              ? figures
                  .map((f, idx) => ({ f, idx }))
                  .filter(({ f }) => f.page === p && f.bbox)
              : [];
            return (
              <div key={p} className="viewer-page" ref={setPageRef(p)} data-page={p}>
                <Page
                  pageNumber={p}
                  width={pageWidth}
                  renderAnnotationLayer
                  renderTextLayer
                  customTextRenderer={textRenderer}
                />
                {pageInfo && pageFigures.length > 0 && (
                  <div className="viewer-figmarkers">
                    {pageFigures.map(({ f, idx }) => {
                      const pct = bboxToPct(f.bbox!, pageInfo);
                      if (!pct) return null;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="viewer-figmark"
                          style={{
                            left: `${pct.left}%`,
                            top: `${pct.top}%`,
                            width: `${pct.width}%`,
                            height: `${pct.height}%`,
                          }}
                          onClick={() => onFigureClick?.(idx)}
                          aria-label={f.caption || `Figure ${idx + 1}`}
                          title={f.caption || `Figure ${idx + 1}`}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="viewer-page-label">page {p}</div>
              </div>
            );
          })}
      </Document>
    </div>
  );
});
