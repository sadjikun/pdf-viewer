import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, deleteDoc, getDocStatus, getLibrary, getResult, markdownUrl, processPdf, pdfUrl } from "./api";
import { FigureOverlay } from "./components/Figure/FigureOverlay";
import { Gallery } from "./components/Gallery/Gallery";
import { Library } from "./components/Library/Library";
import { LoadingDocling } from "./components/Loading/LoadingDocling";
import { Outline } from "./components/Outline/Outline";
import { SearchBar } from "./components/Search/SearchBar";
import { Tables } from "./components/Tables/Tables";
import type { ViewerHandle } from "./components/Viewer/Viewer";

const Viewer = lazy(() =>
  import("./components/Viewer/Viewer").then((m) => ({ default: m.Viewer }))
);
const MarkdownReader = lazy(() =>
  import("./components/Reader/MarkdownReader").then((m) => ({ default: m.MarkdownReader }))
);
import { findActiveSection, flattenOutline } from "./outline";
import type { ReaderTheme, ReaderHandle } from "./components/Reader/MarkdownReader";
import type { DocResult, LibraryResponse, OutlineNode } from "./types";
import "./App.css";

const LS_KEY = "pdf-viewer:lastDocId";
const THEME_KEY = "pdf-viewer:theme";
type Tab = "outline" | "gallery" | "tables";
const TAB_TITLES: Record<Tab, string> = {
  outline: "Sommaire",
  gallery: "Galerie",
  tables: "Tables",
};

const THEMES = [
  { id: "glassmorphism", label: "Glassmorphism" },
  { id: "minimalist", label: "Minimalist Paper" },
  { id: "technical", label: "Technical Grid" },
  { id: "vintage", label: "ArXiv Vintage" },
  { id: "oled", label: "OLED Deep Space" },
  { id: "forest", label: "Forest Lab" },
  { id: "cstb", label: "CSTB" },
  { id: "swiss", label: "Swiss Grid" },
  { id: "eink", label: "E-Ink Paper" },
  { id: "hud", label: "Engineering HUD" },
] as const;
type AppTheme = (typeof THEMES)[number]["id"];
const DEFAULT_THEME: AppTheme = "glassmorphism";

function useAppTheme() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === saved) ? (saved as AppTheme) : DEFAULT_THEME;
  });
  useEffect(() => {
    const el = document.documentElement;
    THEMES.forEach((t) => el.classList.remove(`theme-${t.id}`));
    el.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return { theme, setTheme };
}

function ThemeSelect({ theme, setTheme }: { theme: AppTheme; setTheme: (t: AppTheme) => void }) {
  return (
    <select
      className="app-theme-select"
      value={theme}
      onChange={(e) => setTheme(e.target.value as AppTheme)}
      aria-label="Choisir le thème"
      title="Thème"
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function App() {
  const { theme, setTheme } = useAppTheme();
  const [doc, setDoc] = useState<DocResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("outline");
  const [figureIdx, setFigureIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile only
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [viewMode, setViewMode] = useState<"pdf" | "reader" | "compare">("pdf");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("reading");
  const [readerDark, setReaderDark] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.5); // largeur du panneau PDF en mode compare (0–1)
  const [library, setLibrary] = useState<LibraryResponse>({
    documents: [],
    processing: [],
    failed: [],
    total: 0,
  });
  const [lastDocId, setLastDocId] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const viewerRef = useRef<ViewerHandle>(null);
  const readerRef = useRef<ReaderHandle>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await getLibrary());
    } catch {
      // La bibliothèque n'est pas critique : on ignore silencieusement un échec de rafraîchissement.
    }
  }, []);

  // Arrête le polling si le composant est démonté
  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (docId: string) => {
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const st = await getDocStatus(docId);
          if (st.status === "ready") {
            stopPolling();
            const result = await getResult(docId);
            setDoc(result);
            setLastDocId(docId);
            localStorage.setItem(LS_KEY, docId);
            setLoading(false);
            setProgressPercent(null);
            refreshLibrary();
          } else if (st.status === "processing") {
            setProgressPercent(st.progress ?? 0);
            setProgressMessage(st.message ?? "");
          } else if (st.status === "failed") {
            stopPolling();
            setError(st.error ?? "Échec du traitement.");
            setLoading(false);
            setProgressPercent(null);
            refreshLibrary();
          }
          // "not_found" : transitoire juste après le lancement → on continue à poller
        } catch (e) {
          stopPolling();
          setError(e instanceof Error ? e.message : "Erreur de suivi du traitement.");
          setLoading(false);
          setProgressPercent(null);
        }
      }, 1500);
    },
    [stopPolling, refreshLibrary],
  );

  // Charge la bibliothèque au montage (vue d'accueil = catalogue local).
  useEffect(() => {
    getLibrary().then(setLibrary).catch(() => {});
  }, []);

  const openDocument = useCallback(async (docId: string) => {
    setError(null);
    setLoading(true);
    try {
      const result = await getResult(docId);
      setDoc(result);
      setLastDocId(docId);
      localStorage.setItem(LS_KEY, docId);
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else setError("Impossible d'ouvrir le document.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteDocument = useCallback(
    async (docId: string) => {
      try {
        await deleteDoc(docId);
        if (docId === localStorage.getItem(LS_KEY)) {
          localStorage.removeItem(LS_KEY);
          setLastDocId(null);
        }
        refreshLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Suppression impossible.");
      }
    },
    [refreshLibrary],
  );

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setDoc(null);
    setActiveId(null);
    setFigureIdx(null);
    setProgressPercent(null);
    setProgressMessage("");
    try {
      const res = await processPdf(file);
      if ("status" in res && res.status === "processing") {
        // Traitement lancé en arrière-plan → suivi par polling
        setProgressPercent(res.progress ?? 0);
        setProgressMessage(res.message ?? "");
        startPolling(res.doc_id);
      } else {
        // Cache hit → résultat complet immédiat
        setDoc(res as DocResult);
        setLastDocId(res.doc_id);
        localStorage.setItem(LS_KEY, res.doc_id);
        setLoading(false);
      }
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur inconnue.");
      setLoading(false);
    }
  };

  const flatOutline = useMemo(
    () => (doc ? flattenOutline(doc.outline) : []),
    [doc],
  );

  const handleSelect = (node: OutlineNode) => {
    setActiveId(node.id);
    if (node.page != null) viewerRef.current?.scrollToPage(node.page);
    // En mode Lecteur/Compare, on aligne aussi le Lecteur sur la section cliquée.
    if (viewMode !== "pdf") readerRef.current?.scrollToSection(node.title);
    setSidebarOpen(false); // ferme le drawer après navigation sur mobile
  };

  const handleGallerySelect = (idx: number) => {
    setFigureIdx(idx);
    setSidebarOpen(false);
  };

  const handlePageChange = (page: number) => {
    const active = findActiveSection(flatOutline, page);
    if (active && active.id !== activeId) setActiveId(active.id);
  };

  // Reader → PDF : quand l'utilisateur fait défiler le Lecteur en mode Compare,
  // le Viewer suit (scroll programmatique, ne reboucle pas).
  const handleReaderPageChange = (page: number) => {
    handlePageChange(page);
    if (viewMode === "compare") viewerRef.current?.scrollToPage(page);
  };

  // Diviseur draggable du mode Compare : ajuste la largeur relative des deux panneaux.
  const startDividerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const reset = () => {
    stopPolling();
    setDoc(null);
    setError(null);
    setActiveId(null);
    setFigureIdx(null);
    setLoading(false);
    setProgressPercent(null);
    refreshLibrary(); // revient au catalogue, rafraîchi
  };

  const gotoPage = (page: number) => {
    setFigureIdx(null);
    viewerRef.current?.scrollToPage(page);
  };

  if (!doc) {
    return (
      <div className="app-empty">
        <header className="app-header">
          <h1>pdf-viewer</h1>
          <ThemeSelect theme={theme} setTheme={setTheme} />
        </header>
        {loading && <LoadingDocling progress={progressPercent} message={progressMessage} />}
        <Library
          documents={library.documents}
          processing={library.processing}
          failed={library.failed}
          lastDocId={lastDocId}
          loading={loading}
          error={error}
          onOpen={openDocument}
          onDelete={handleDeleteDocument}
          onUpload={handleFile}
          onRefresh={refreshLibrary}
        />
      </div>
    );
  }

  const figures = doc.figures;
  const total = figures.length;
  const current = figureIdx != null ? figures[figureIdx] : null;
  // Document non-PDF (MarkItDown) : pas de PDF à afficher → vue Lecteur forcée.
  const isMarkitdown = doc.extraction_mode === "markitdown" || (doc.pages?.length ?? 0) === 0;
  const effectiveViewMode = isMarkitdown ? "reader" : viewMode;

  return (
    <div className={`app${sidebarOpen ? " sidebar-open" : ""}`}>
      <button
        type="button"
        className="app-hamburger"
        aria-label="Ouvrir/fermer le menu"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        ☰
      </button>
      <div
        className="app-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <h2>{TAB_TITLES[tab]}</h2>
          <div className="app-actions">
            {!isMarkitdown && (
            <div className="app-view-toggle" role="group" aria-label="Mode d'affichage">
              <button
                type="button"
                className={viewMode === "pdf" ? "is-active" : ""}
                aria-pressed={viewMode === "pdf"}
                onClick={() => setViewMode("pdf")}
              >
                PDF
              </button>
              <button
                type="button"
                className={viewMode === "reader" ? "is-active" : ""}
                aria-pressed={viewMode === "reader"}
                onClick={() => setViewMode("reader")}
              >
                Lecteur
              </button>
              <button
                type="button"
                className={viewMode === "compare" ? "is-active" : ""}
                aria-pressed={viewMode === "compare"}
                onClick={() => setViewMode("compare")}
              >
                Compare
              </button>
            </div>
            )}
            <ThemeSelect theme={theme} setTheme={setTheme} />
            <a
              className="app-action"
              href={markdownUrl(doc.doc_id)}
              download={`${doc.doc_id}.md`}
              title="Télécharger en Markdown"
            >
              .md
            </a>
            <button type="button" className="app-reset" onClick={reset}>
              Nouveau doc
            </button>
          </div>
        </div>
        <div className="app-sidebar-meta">
          {doc.n_pages} page{doc.n_pages > 1 ? "s" : ""} · {doc.n_figures} figure
          {doc.n_figures > 1 ? "s" : ""} · {doc.n_tables ?? 0} table
          {(doc.n_tables ?? 0) > 1 ? "s" : ""}
        </div>
        <SearchBar
          value={query}
          onChange={(v) => {
            setQuery(v);
            setMatchIndex(0);
            setMatchTotal(0);
          }}
          matchIndex={matchIndex}
          matchTotal={matchTotal}
          onPrev={() => {
            const prev = matchTotal > 0 ? (matchIndex - 1 + matchTotal) % matchTotal : 0;
            setMatchIndex(prev);
            viewerRef.current?.scrollToMatch(prev);
          }}
          onNext={() => {
            const next = matchTotal > 0 ? (matchIndex + 1) % matchTotal : 0;
            setMatchIndex(next);
            viewerRef.current?.scrollToMatch(next);
          }}
        />
        <div className="app-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "outline"}
            className={`app-tab${tab === "outline" ? " is-active" : ""}`}
            onClick={() => setTab("outline")}
          >
            Sommaire
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "gallery"}
            className={`app-tab${tab === "gallery" ? " is-active" : ""}`}
            onClick={() => setTab("gallery")}
          >
            Galerie
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tables"}
            className={`app-tab${tab === "tables" ? " is-active" : ""}`}
            onClick={() => setTab("tables")}
          >
            Tables
          </button>
        </div>
        {tab === "outline" ? (
          <Outline nodes={doc.outline} onSelect={handleSelect} activeId={activeId} />
        ) : tab === "gallery" ? (
          <Gallery docId={doc.doc_id} figures={figures} onSelect={handleGallerySelect} />
        ) : (
          <Tables tables={doc.tables ?? []} onGotoPage={gotoPage} />
        )}
      </aside>
      <main className="app-main">
        <Suspense fallback={<p className="viewer-msg">Chargement…</p>}>
          {effectiveViewMode === "compare" ? (
            <div className="app-compare">
              <div className="app-compare-pane" style={{ width: `${splitRatio * 100}%` }}>
                <Viewer
                  ref={viewerRef}
                  url={pdfUrl(doc.doc_id)}
                  pages={doc.pages}
                  figures={doc.figures}
                  searchQuery={query}
                  activeMatchIndex={matchIndex}
                  onPageChange={handlePageChange}
                  onFigureClick={setFigureIdx}
                  onMatchCountChange={setMatchTotal}
                />
              </div>
              <div
                className="app-compare-divider"
                onPointerDown={startDividerDrag}
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionner les panneaux"
              />
              <div className="app-compare-pane" style={{ width: `${(1 - splitRatio) * 100}%` }}>
                <MarkdownReader
                  ref={readerRef}
                  docId={doc.doc_id}
                  outline={doc.outline}
                  theme={readerTheme}
                  onThemeChange={setReaderTheme}
                  appTheme={theme}
                  isDark={readerDark}
                  onDarkChange={setReaderDark}
                  onPageChange={handleReaderPageChange}
                  compareMode
                  searchQuery={query}
                />
              </div>
            </div>
          ) : effectiveViewMode === "reader" ? (
            <MarkdownReader
              ref={readerRef}
              docId={doc.doc_id}
              outline={doc.outline}
              theme={readerTheme}
              onThemeChange={setReaderTheme}
              appTheme={theme}
              isDark={readerDark}
              onDarkChange={setReaderDark}
              onPageChange={handleReaderPageChange}
              searchQuery={query}
            />
          ) : (
            <Viewer
              ref={viewerRef}
              url={pdfUrl(doc.doc_id)}
              pages={doc.pages}
              figures={doc.figures}
              searchQuery={query}
              activeMatchIndex={matchIndex}
              onPageChange={handlePageChange}
              onFigureClick={setFigureIdx}
              onMatchCountChange={setMatchTotal}
            />
          )}
        </Suspense>
      </main>
      {current && (
        <FigureOverlay
          docId={doc.doc_id}
          figure={current}
          index={figureIdx!}
          total={total}
          onClose={() => setFigureIdx(null)}
          onPrev={figureIdx! > 0 ? () => setFigureIdx(figureIdx! - 1) : undefined}
          onNext={
            figureIdx! < total - 1 ? () => setFigureIdx(figureIdx! + 1) : undefined
          }
          onGotoPage={gotoPage}
        />
      )}
    </div>
  );
}

export default App;
