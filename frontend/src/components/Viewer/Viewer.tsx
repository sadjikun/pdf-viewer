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
import { bboxToPct } from "../../bbox";
import type { Figure, PageInfo } from "../../types";
import "./Viewer.css";

// Use unpkg CDN worker — the ?url Vite import fails in some environments
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MAX_PAGE_WIDTH = 900;
const PAGE_PADDING  = 32;  // padding horizontal du container (doit matcher .viewer padding × 2)
const PAGE_MARGIN   = 24;  // marge basse entre pages (1.5rem — baked into slotHeights)
const RENDER_BUFFER = 5;   // pages montées avant/après la page visible (TD-008)

// Saut instantané si delta > 5 000 px (évite un scroll smooth de 50 000px)
const SMOOTH_THRESHOLD_PX = 5_000;

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

  const [numPages, setNumPages]   = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);
  const [activePage, setActivePage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Largeur de page adaptative ────────────────────────────────────────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let isFirst = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? root.clientWidth;
      const targetWidth = Math.max(200, Math.min(MAX_PAGE_WIDTH, w - PAGE_PADDING));
      if (isFirst) {
        isFirst = false;
        setPageWidth(targetWidth);
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setPageWidth(targetWidth);
        }, 150);
      }
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // ── Hauteurs de chaque slot (page rendue + marge basse) ──────────────────
  // TD-008 : calculées depuis les métadonnées (pas besoin de monter les <Page>)
  const slotHeights = useMemo(() => {
    if (!numPages) return [];
    return Array.from({ length: numPages }, (_, i) => {
      const info = pages?.find((p) => p.number === i + 1);
      const aspect = info?.width && info?.height
        ? info.width / info.height
        : 595 / 842; // A4 par défaut
      return Math.round(pageWidth / aspect) + PAGE_MARGIN;
    });
  }, [numPages, pages, pageWidth]);

  // ── Sommes préfixes : cumulativeHeights[i] = Σ slotHeights[0..i] ─────────
  const cumulativeHeights = useMemo(() => {
    const cum: number[] = [];
    let sum = 0;
    for (const h of slotHeights) {
      sum += h;
      cum.push(sum);
    }
    return cum;
  }, [slotHeights]);

  // Hauteur totale du contenu positionné (sans le padding du container)
  const totalHeight = cumulativeHeights.at(-1) ?? 0;

  // Top absolu de la page p (1-indexé) dans le div positionné
  const pageTop = useCallback(
    (p: number) => cumulativeHeights[p - 2] ?? 0,
    [cumulativeHeights],
  );

  // ── Détection de la page visible depuis scrollTop ─────────────────────────
  // Recherche dichotomique : première entrée cumulative > scrollTop
  const pageFromScrollTop = useCallback(
    (scrollTop: number): number => {
      if (cumulativeHeights.length === 0) return 1;
      let lo = 0;
      let hi = cumulativeHeights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulativeHeights[mid] <= scrollTop) lo = mid + 1;
        else hi = mid;
      }
      return lo + 1; // 1-indexé
    },
    [cumulativeHeights],
  );

  // ── Écouteur scroll (remplace IntersectionObserver de TD-008) ────────────
  // FIX-037 : debounce onPageChange (150 ms) so rapid scrolling doesn't flood
  // the compare-mode sync and cause Reader jitter.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastScrollTime = 0;

    const onScroll = () => {
      const now = Date.now();
      const scrollTop = el.scrollTop;

      const update = () => {
        const p = pageFromScrollTop(scrollTop);
        setActivePage(p);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { onPageChange?.(p); }, 150);
      };

      if (now - lastScrollTime > 100) {
        lastScrollTime = now;
        update();
      } else {
        if (throttleTimeout) clearTimeout(throttleTimeout);
        throttleTimeout = setTimeout(() => {
          lastScrollTime = Date.now();
          update();
        }, 100);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (throttleTimeout) clearTimeout(throttleTimeout);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [pageFromScrollTop, onPageChange]);

  // ── scrollToPage via scrollTop calculé (pas de pageRefs) ─────────────────
  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      const el = containerRef.current;
      if (!el || cumulativeHeights.length === 0) return;
      const top = pageTop(page);
      const delta = Math.abs(top - el.scrollTop);
      el.scrollTo({ top, behavior: delta > SMOOTH_THRESHOLD_PX ? "instant" : "smooth" });
    },
  }));

  const file = useMemo(() => ({ url }), [url]);

  // ── Fenêtre virtuelle ─────────────────────────────────────────────────────
  // Seules les pages dans [firstRender, lastRender] sont montées dans le DOM.
  const firstRender = Math.max(1, activePage - RENDER_BUFFER);
  const lastRender  = Math.min(numPages ?? 0, activePage + RENDER_BUFFER);

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
        {numPages != null && totalHeight > 0 && (
          // Div positionné : height fixe = totalHeight → scrollbar correcte
          // Les pages sont en position:absolute → aucun re-layout lors du montage/démontage
          <div className="viewer-stage" style={{ height: totalHeight }}>
            {Array.from(
              { length: lastRender - firstRender + 1 },
              (_, i) => firstRender + i,
            ).map((p) => {
              const pageInfo = pages?.find((pp) => pp.number === p);
              const pageFigures = figures
                ? figures
                    .map((f, idx) => ({ f, idx }))
                    .filter(({ f }) => f.page === p && f.bbox)
                : [];

              return (
                <div
                  key={p}
                  className="viewer-page"
                  data-page={p}
                  style={{ top: pageTop(p) }}
                >
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
                              left:   `${pct.left}%`,
                              top:    `${pct.top}%`,
                              width:  `${pct.width}%`,
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
          </div>
        )}
      </Document>
    </div>
  );
});
