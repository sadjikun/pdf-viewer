import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getResult, markdownUrl, processPdf, pdfUrl } from "./api";
import { FigureOverlay } from "./components/Figure/FigureOverlay";
import { Gallery } from "./components/Gallery/Gallery";
import { LoadingDocling } from "./components/Loading/LoadingDocling";
import { Outline } from "./components/Outline/Outline";
import { SearchBar } from "./components/Search/SearchBar";
import { UploadZone } from "./components/Upload/UploadZone";
import { Viewer, type ViewerHandle } from "./components/Viewer/Viewer";
import { findActiveSection, flattenOutline } from "./outline";
import type { DocResult, OutlineNode } from "./types";
import "./App.css";

const LS_KEY = "pdf-viewer:lastDocId";
type Tab = "outline" | "gallery";

function App() {
  const [doc, setDoc] = useState<DocResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("outline");
  const [figureIdx, setFigureIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile only
  const [query, setQuery] = useState("");
  const viewerRef = useRef<ViewerHandle>(null);

  useEffect(() => {
    const lastId = localStorage.getItem(LS_KEY);
    if (!lastId) return;
    getResult(lastId)
      .then((res) => setDoc(res))
      .catch(() => localStorage.removeItem(LS_KEY));
  }, []);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setDoc(null);
    setActiveId(null);
    setFigureIdx(null);
    try {
      const res = await processPdf(file);
      setDoc(res);
      localStorage.setItem(LS_KEY, res.doc_id);
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur inconnue.");
    } finally {
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

  const reset = () => {
    setDoc(null);
    setError(null);
    setActiveId(null);
    setFigureIdx(null);
    localStorage.removeItem(LS_KEY);
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
        </header>
        {loading && <LoadingDocling />}
        {error && <div className="app-error">{error}</div>}
        {!loading && <UploadZone onFile={handleFile} disabled={loading} />}
      </div>
    );
  }

  const figures = doc.figures;
  const total = figures.length;
  const current = figureIdx != null ? figures[figureIdx] : null;

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
          <h2>{tab === "outline" ? "Sommaire" : "Galerie"}</h2>
          <div className="app-actions">
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
          {doc.n_figures > 1 ? "s" : ""}
        </div>
        <SearchBar value={query} onChange={setQuery} />
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
        </div>
        {tab === "outline" ? (
          <Outline nodes={doc.outline} onSelect={handleSelect} activeId={activeId} />
        ) : (
          <Gallery docId={doc.doc_id} figures={figures} onSelect={handleGallerySelect} />
        )}
      </aside>
      <main className="app-main">
        <Viewer
          ref={viewerRef}
          url={pdfUrl(doc.doc_id)}
          pages={doc.pages}
          figures={doc.figures}
          searchQuery={query}
          onPageChange={handlePageChange}
          onFigureClick={setFigureIdx}
        />
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
