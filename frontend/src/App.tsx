import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, benchmarkHtmlUrl, deleteDoc, getLibrary, getResult, getTesseractStatus, getDocStatus, getAppMode, setAppMode, markdownUrl, processPdf, pdfUrl, reprocessDoc, searchablePdfUrl, processRegisteredDoc, type TesseractStatus } from "./api";
import { FigureOverlay } from "./components/Figure/FigureOverlay";
import { ModeChooser } from "./components/ModeChooser/ModeChooser";
import { Gallery } from "./components/Gallery/Gallery";
import { Library } from "./components/Library/Library";
import { LoadingDocling } from "./components/Loading/LoadingDocling";
import { Outline } from "./components/Outline/Outline";
import { MarkdownReader, type ReaderHandle, type ReaderTheme } from "./components/Reader/MarkdownReader";
import { SearchBar } from "./components/Search/SearchBar";
import { TablesPanel } from "./components/Tables/TablesPanel";
import { Viewer, type ViewerHandle } from "./components/Viewer/Viewer";
import { findActiveSection, flattenOutline } from "./outline";
import type { DocResult, LibraryResponse, OutlineNode } from "./types";
import "./App.css";

const LS_KEY           = "pdf-viewer:lastDocId";
const LS_THEME_KEY     = "pdf-viewer:readerTheme";
const LS_SIDEBAR_W     = "pdf-viewer:sidebarWidth";
const LS_COMPARE_RATIO = "pdf-viewer:compareRatio";
const SIDEBAR_MIN      = 180;
const SIDEBAR_MAX      = 560;
const SIDEBAR_DEFAULT = 340;
type Tab = "outline" | "gallery" | "tables";
type ViewMode = "pdf" | "reader" | "compare";
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

const APP_THEMES: AppTheme[] = [
  "glassmorphism",
  "minimalist",
  "technical",
  "vintage",
  "oled",
  "forest",
  "cstb",
  "swiss",
  "eink",
  "hud",
];
const isAppTheme = (value: string | null): value is AppTheme =>
  value != null && APP_THEMES.includes(value as AppTheme);
const isDarkTheme = (value: AppTheme) =>
  value === "glassmorphism" || value === "technical" || value === "oled" || value === "hud";

const cleanPdfTitle = (title?: string) => {
  if (!title) return "";
  return title.replace(/^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)/i, "").trim();
};

function App() {
  const [doc, setDoc] = useState<DocResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("outline");
  const [figureIdx, setFigureIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    () => parseInt(localStorage.getItem(LS_SIDEBAR_W) ?? String(SIDEBAR_DEFAULT)),
  );
  const [query, setQuery] = useState("");
  const [tesseract, setTesseract] = useState<TesseractStatus | null>(null);
  // Reader est la vue par défaut pour tous les documents
  const [viewMode, setViewMode] = useState<ViewMode>("reader");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(
    () => (localStorage.getItem(LS_THEME_KEY) as ReaderTheme | null) ?? "cstb",
  );
  const [reprocessing, setReprocessing] = useState(false);
  const [readerFocusTitle, setReaderFocusTitle] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [library, setLibrary] = useState<LibraryResponse>({
    documents: [],
    processing: [],
    failed: [],
    total: 0,
  });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [lastDocId, setLastDocId] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const [appMode, setAppModeState] = useState<"standard" | "ai">(
    () => (localStorage.getItem("app-mode-last") as "standard" | "ai") || "standard",
  );
  const [showModeChooser, setShowModeChooser] = useState(true);

  const [theme, setTheme] = useState<AppTheme>(
    () => {
      const stored = localStorage.getItem("theme");
      return isAppTheme(stored) ? stored : "cstb";
    }
  );

  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("pdf-viewer:isDark");
    if (saved !== null) return saved === "true";
    const activeTheme = localStorage.getItem("theme");
    return isAppTheme(activeTheme) ? isDarkTheme(activeTheme) : false;
  });

  const handleThemeChange = (t: AppTheme) => {
    setTheme(t);
    localStorage.setItem("theme", t);
    const nextDark = isDarkTheme(t);
    setIsDark(nextDark);
    localStorage.setItem("pdf-viewer:isDark", String(nextDark));
  };

  const handleDarkChange = (nextDark: boolean) => {
    setIsDark(nextDark);
    localStorage.setItem("pdf-viewer:isDark", String(nextDark));
  };

  const viewerRef = useRef<ViewerHandle>(null);
  const readerRef = useRef<ReaderHandle>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  // FIX-037 : sync smoothness — track active section synchronously to avoid
  // stale-closure duplicate scrollToSection calls during rapid scrolling.
  const activeIdRef = useRef<string | null>(null);
  // FIX-037 : prevent Reader → PDF bouncing the same page twice.
  const lastSyncedReaderPageRef = useRef<number>(0);

  // Compare panel ratio (0.2 – 0.8), persisted
  const [compareRatio, setCompareRatio] = useState<number>(
    () => parseFloat(localStorage.getItem(LS_COMPARE_RATIO) ?? "0.5"),
  );
  const compareRatioRef = useRef(compareRatio);
  useEffect(() => { compareRatioRef.current = compareRatio; }, [compareRatio]);
  const compareContainerRef = useRef<HTMLDivElement>(null);

  const handleCompareDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = compareRatioRef.current;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const container = compareContainerRef.current;
      if (!container) return;
      const totalW = container.getBoundingClientRect().width;
      const dx = ev.clientX - startX;
      const r = Math.max(0.2, Math.min(0.8, startRatio + dx / totalW));
      setCompareRatio(r);
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(LS_COMPARE_RATIO, String(compareRatioRef.current));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Resize sidebar au drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(LS_SIDEBAR_W, String(sidebarWidthRef.current));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
  };

  const handleReaderTheme = (t: ReaderTheme) => {
    setReaderTheme(t);
    localStorage.setItem(LS_THEME_KEY, t);
  };

  useEffect(() => {
    getAppMode().then((r) => setAppModeState(r.mode as "standard" | "ai")).catch(() => {});
  }, []);

  const handleAppModeToggle = async (mode: "standard" | "ai") => {
    try {
      await setAppMode(mode);
      setAppModeState(mode);
    } catch {}
  };

  const handleChooseMode = async (mode: "standard" | "ai") => {
    await handleAppModeToggle(mode);
    localStorage.setItem("app-mode-last", mode);
    setShowModeChooser(false);
  };

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await getLibrary();
      setLibrary(res);
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur de chargement de la bibliothèque.");
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const startPolling = useCallback((docId: string) => {
    setLoading(true);
    setProgressPercent(0);
    setProgressMessage("Ajouté à la file d'attente...");
    setError(null);

    const intervalId = setInterval(async () => {
      try {
        const statusRes = await getDocStatus(docId);
        if (statusRes.status === "ready") {
          clearInterval(intervalId);
          const result = await getResult(docId);
          setDoc(result);
          localStorage.setItem(LS_KEY, docId);
          setLastDocId(docId);
          setLoading(false);
          setProgressPercent(null);
          setProgressMessage("");
          refreshLibrary();
        } else if (statusRes.status === "processing") {
          if (statusRes.progress !== undefined) setProgressPercent(statusRes.progress);
          if (statusRes.message !== undefined) setProgressMessage(statusRes.message);
        } else if (statusRes.status === "failed") {
          clearInterval(intervalId);
          setError(statusRes.error || "L'extraction a échoué.");
          setLoading(false);
          setProgressPercent(null);
          setProgressMessage("");
        } else {
          // not_found
          clearInterval(intervalId);
          setError("Document introuvable.");
          setLoading(false);
          setProgressPercent(null);
          setProgressMessage("");
        }
      } catch (err) {
        console.error("Erreur de suivi du traitement:", err);
      }
    }, 1500);

    return () => clearInterval(intervalId);
  }, [refreshLibrary]);

  useEffect(() => {
    getLibrary()
      .then(setLibrary)
      .catch((e) => {
        if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
        else if (e instanceof Error) setError(e.message);
        else setError("Erreur de chargement de la bibliothèque.");
      });
    getTesseractStatus().then(setTesseract).catch(() => {});
  }, []);

  useEffect(() => {
    if (library.processing.length === 0 || doc) return;
    const intervalId = window.setInterval(() => {
      refreshLibrary();
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [doc, library.processing.length, refreshLibrary]);

  useEffect(() => {
    if (doc) {
      // Item 9 : préférer le titre PDF (métadonnées) au nom de fichier
      const label = cleanPdfTitle(doc.pdf_title) || doc.filename || doc.doc_id.slice(0, 8);
      document.title = `${label} — INTERACTIVE HTML READER`;
    } else {
      document.title = "INTERACTIVE HTML READER";
    }
  }, [doc]);

  const handleFile = async (file: File, fastMode: boolean) => {
    setLoading(true);
    setError(null);
    setDoc(null);
    setActiveId(null);
    setFigureIdx(null);
    setProgressPercent(0);
    setProgressMessage("Televersement du fichier...");
    try {
      const res = await processPdf(file, fastMode);
      if ("status" in res && res.status === "processing") {
        startPolling(res.doc_id);
      } else {
        const readyResult = res as DocResult;
        setDoc(readyResult);
        localStorage.setItem(LS_KEY, readyResult.doc_id);
        setLastDocId(readyResult.doc_id);
        refreshLibrary();
        setLoading(false);
      }
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur inconnue.");
      setLoading(false);
      setProgressPercent(null);
    }
  };

  const openDocument = async (docId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getResult(docId);
      setDoc(result);
      setActiveId(null);
      activeIdRef.current = null;
      setFigureIdx(null);
      if (result.extraction_mode === "registered") {
        setViewMode("pdf");
      } else {
        setViewMode(result.extraction_mode === "markitdown" ? "reader" : "reader");
      }
      localStorage.setItem(LS_KEY, docId);
      setLastDocId(docId);
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur d'ouverture du document.");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRegistered = async (docId: string) => {
    setLoading(true);
    setProgressPercent(0);
    setProgressMessage("Démarrage du traitement IA...");
    setError(null);
    try {
      const fastMode = appMode === "standard";
      await processRegisteredDoc(docId, fastMode);
      startPolling(docId);
    } catch (err: any) {
      setError(err.message || "Erreur lors du traitement");
      setLoading(false);
      setProgressPercent(null);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const target = library.documents.find((item) => item.doc_id === docId);
    const label = target?.title ?? docId;
    if (!window.confirm(`Supprimer "${label}" du cache local ?`)) return;
    try {
      await deleteDoc(docId);
      if (doc?.doc_id === docId) setDoc(null);
      if (lastDocId === docId) {
        localStorage.removeItem(LS_KEY);
        setLastDocId(null);
      }
      refreshLibrary();
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur pendant la suppression.");
    }
  };

  const flatOutline = useMemo(
    () => (doc ? flattenOutline(doc.outline) : []),
    [doc],
  );

  const handleSelect = (node: OutlineNode) => {
    setActiveId(node.id);
    if (viewMode === "compare") {
      if (node.page != null) viewerRef.current?.scrollToPage(node.page);
      readerRef.current?.scrollToSection(node.title);
    } else if (viewMode === "reader") {
      setReaderFocusTitle(node.title);
    } else {
      if (node.page != null) {
        viewerRef.current?.scrollToPage(node.page);
      }
    }
    setSidebarOpen(false);
  };

  const handleGallerySelect = (idx: number) => {
    setFigureIdx(idx);
    setSidebarOpen(false);
  };

  const handlePageChange = (page: number) => {
    const active = findActiveSection(flatOutline, page);
    // FIX-037 : use ref for sync comparison — prevents stale-closure duplicate calls
    if (active && active.id !== activeIdRef.current) {
      activeIdRef.current = active.id;
      setActiveId(active.id);
      if (viewMode === "compare") {
        readerRef.current?.scrollToSection(active.title);
      }
    }
  };

  // FIX-026 : synchronisation Reader → PDF Viewer (sens inverse).
  // Quand l'utilisateur fait défiler le Reader en mode compare, le PDF se synchronise.
  // Le flag isProgrammaticScrollRef dans MarkdownReader empêche la boucle retour.
  // FIX-037 : deduplicate same-page syncs via lastSyncedReaderPageRef.
  const handleReaderPageChange = (page: number) => {
    if (viewMode !== "compare") return;
    if (page === lastSyncedReaderPageRef.current) return;
    lastSyncedReaderPageRef.current = page;
    viewerRef.current?.scrollToPage(page);
    const active = findActiveSection(flatOutline, page);
    if (active && active.id !== activeIdRef.current) {
      activeIdRef.current = active.id;
      setActiveId(active.id);
    }
  };

  const goHome = () => {
    setDoc(null);
    setError(null);
    setActiveId(null);
    activeIdRef.current = null;
    lastSyncedReaderPageRef.current = 0;
    setFigureIdx(null);
    setReaderFocusTitle(null);
    setSidebarOpen(false);
    setSidebarCollapsed(false);
    refreshLibrary();
  };

  const handleReprocess = async (forceOcr = false) => {
    if (!doc) return;
    const fastMode = !forceOcr && appMode === "standard";
    setReprocessing(true);
    setError(null);
    try {
      const res = await reprocessDoc(doc.doc_id, fastMode, forceOcr);
      if ("status" in res && res.status === "processing") {
        setDoc(null);
        startPolling(res.doc_id);
      } else {
        const readyResult = res as DocResult;
        setDoc(readyResult);
        setFigureIdx(null);
        refreshLibrary();
      }
    } catch (e) {
      if (e instanceof ApiError) setError(`[${e.status}] ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Erreur inconnue.");
    } finally {
      setReprocessing(false);
    }
  };

  const gotoPage = (page: number) => {
    setFigureIdx(null);
    handleViewMode("pdf");
    viewerRef.current?.scrollToPage(page);
  };

  if (!doc) {
    return (
      <div className={`app-empty theme-${theme}`}>
        <header className="app-header">
          <h1>INTERACTIVE HTML READER</h1>
          <div className="app-theme-selector">
            <span>Thème :</span>
            <button
              type="button"
              className={`theme-btn${theme === "cstb" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("cstb")}
              title="Concept CSTB - Style Le Reef avec accent orange"
            >
              CSTB / Le Reef
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "glassmorphism" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("glassmorphism")}
              title="Concept A - Effets de verre translucide"
            >
              Glassmorphism
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "minimalist" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("minimalist")}
              title="Concept B - Liseuse claire minimaliste"
            >
              Minimaliste (Clair)
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "technical" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("technical")}
              title="Concept C - Tableau de bord technique"
            >
              Tech Dashboard
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "vintage" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("vintage")}
              title="ArXiv Vintage - Style papier sépia rétro"
            >
              ArXiv Vintage
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "oled" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("oled")}
              title="OLED Deep Space - Fond noir pur anti-éblouissement"
            >
              OLED Space
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "forest" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("forest")}
              title="Forest Lab - Vert sauge apaisant"
            >
              Forest Lab
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "swiss" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("swiss")}
              title="Swiss Grid - Interface documentaire dense et claire"
            >
              Swiss Grid
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "eink" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("eink")}
              title="E-Ink Paper - Lecture longue durée"
            >
              E-Ink
            </button>
            <button
              type="button"
              className={`theme-btn${theme === "hud" ? " is-active" : ""}`}
              onClick={() => handleThemeChange("hud")}
              title="Engineering HUD - Contraste technique sombre"
            >
              HUD
            </button>
          </div>
        </header>
        {loading && <LoadingDocling progress={progressPercent} message={progressMessage} />}
        <Library
          documents={library.documents}
          processing={library.processing}
          failed={library.failed}
          lastDocId={lastDocId}
          loading={loading || libraryLoading}
          error={error}
          onOpen={openDocument}
          onDelete={handleDeleteDocument}
          onUpload={handleFile}
          onRefresh={refreshLibrary}
          onProcess={handleProcessRegistered}
        />
        <footer className="app-footer">
          Créé par <strong>MHDINGBI</strong> &amp; <strong>sadj-kun</strong>
        </footer>
      </div>
    );
  }

  const figures = doc.figures;
  const tables = doc.tables ?? [];
  const total = figures.length;
  const current = figureIdx != null ? figures[figureIdx] : null;
  const isRegistered = doc.extraction_mode === "registered";
  const isNativeMode = doc.extraction_mode === "native" || doc.extraction_mode === "fast";
  const isMarkitdown = doc.extraction_mode === "markitdown";

  // Pour les fichiers non-PDF, forcer le mode Reader (jamais compare). Pour les non-traités, forcer PDF.
  const effectiveViewMode = isRegistered ? "pdf" : (isMarkitdown ? "reader" : viewMode);

  // Item 9 : titre du document : pdf_title (métadonnées) > nom de fichier > ID court
  const docTitle = cleanPdfTitle(doc.pdf_title)
    || (doc.filename ? doc.filename.replace(/\.[^.]+$/, "") : doc.doc_id.slice(0, 8));

  return (
    <div className={`app theme-${theme} ${isDark ? "reader--dark" : "reader--light"}${sidebarOpen ? " sidebar-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {showModeChooser && (
        <ModeChooser current={appMode} onChoose={handleChooseMode} />
      )}
      <button
        type="button"
        className="app-hamburger"
        aria-label="Ouvrir/fermer le panneau"
        aria-expanded={!sidebarCollapsed}
        onClick={() => {
          // Mobile : toggle overlay sidebar
          // Desktop : toggle sidebar collapse
          if (window.innerWidth <= 768) setSidebarOpen((v) => !v);
          else setSidebarCollapsed((v) => !v);
        }}
      >
        {sidebarCollapsed ? "☰" : "✕"}
      </button>
      <button
        type="button"
        className="app-home-btn"
        onClick={goHome}
        title="Retour à la bibliothèque"
        aria-label="Retour à la bibliothèque"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9 21v-6h6v6" />
        </svg>
        <span>Bibliothèque</span>
      </button>
      <div
        className="app-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="app-sidebar"
        style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
      >
        {/* Handle de redimensionnement — drag pour ajuster la largeur */}
        <div className="app-sidebar-resize" onMouseDown={handleResizeStart} />

        {/* Bouton collapse/expand */}
        <button
          type="button"
          className="app-sidebar-toggle"
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? "Afficher la sidebar" : "Masquer la sidebar"}
          aria-label={sidebarCollapsed ? "Afficher" : "Masquer"}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>

        <div className="app-sidebar-header">
          <h2 className="app-sidebar-title" title={doc.filename ?? doc.doc_id}>
            {docTitle}
          </h2>
          <div className="app-actions">
            {!isMarkitdown && (
              tesseract?.available ? (
                <a
                  className="app-action"
                  href={searchablePdfUrl(doc.doc_id)}
                  target="_blank"
                  rel="noreferrer"
                  title={`PDF cherchable via Tesseract ${tesseract.version ?? ""} (${tesseract.langs.join(", ")})`}
                >
                  OCR
                </a>
              ) : (
                <span
                  className="app-action app-action--disabled"
                  title="Tesseract non disponible — installez-le avec : scoop install tesseract"
                >
                  OCR
                </span>
              )
            )}
            <a
              className="app-action"
              href={markdownUrl(doc.doc_id)}
              download={`${doc.filename ?? doc.doc_id}.md`}
              title="Télécharger en Markdown"
            >
              .md
            </a>
            {!isMarkitdown && (
              <a
                className="app-action"
                href={benchmarkHtmlUrl(doc.doc_id)}
                target="_blank"
                rel="noreferrer"
                title="Rapport de benchmark — compare pypdfium2, pymupdf, pdfplumber, pdfminer, pypdf, Docling"
              >
                Bench
              </a>
            )}
            {!isMarkitdown && (
              <div className="app-reprocess-group">
                <button
                  type="button"
                  className="app-reset"
                  onClick={() => handleReprocess(false)}
                  disabled={reprocessing}
                  title={appMode === "ai" ? "Retraitement complet — Florence-2 + Texify" : "Retraitement rapide — extraction native"}
                >
                  {reprocessing ? "…" : "Retraiter"}
                </button>
                <button
                  type="button"
                  className="app-reset app-reset--ocr"
                  onClick={() => handleReprocess(true)}
                  disabled={reprocessing}
                  title="Retraitement avec OCR forcé — utile pour les PDFs hybrides (pages scannées dans un PDF natif)"
                >
                  OCR
                </button>
              </div>
            )}
            <button type="button" className="app-reset" onClick={goHome}>
              Bibliothèque
            </button>
          </div>
        </div>

        {/* Sélecteur de thème dans la sidebar */}
        <div className="app-theme-selector">
          <span>Thème :</span>
          <button
            type="button"
            className={`theme-btn${theme === "cstb" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("cstb")}
            title="CSTB / Le Reef (Défaut)"
          >
            CSTB
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "glassmorphism" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("glassmorphism")}
            title="Glassmorphism (Sombre)"
          >
            Glass
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "minimalist" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("minimalist")}
            title="Minimaliste (Clair)"
          >
            Clair
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "technical" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("technical")}
            title="Tech Dashboard (Sombre)"
          >
            Tech
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "vintage" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("vintage")}
            title="ArXiv Vintage (Sépia)"
          >
            Sépia
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "oled" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("oled")}
            title="OLED Deep Space (Sombre)"
          >
            OLED
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "forest" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("forest")}
            title="Forest Lab (Vert reposant)"
          >
            Forêt
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "swiss" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("swiss")}
            title="Swiss Grid (Documentaire)"
          >
            Swiss
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "eink" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("eink")}
            title="E-Ink Paper (Lecture)"
          >
            E-Ink
          </button>
          <button
            type="button"
            className={`theme-btn${theme === "hud" ? " is-active" : ""}`}
            onClick={() => handleThemeChange("hud")}
            title="Engineering HUD (Sombre)"
          >
            HUD
          </button>
        </div>

        {/* Toggle PDF / Reader / Comparer — masqué pour les fichiers non-PDF et non-traités */}
        {!isMarkitdown && !isRegistered && (
          <div className="app-view-toggle" role="group" aria-label="Mode d'affichage">
            <button
              type="button"
              className={`app-view-btn${viewMode === "pdf" ? " is-active" : ""}`}
              onClick={() => handleViewMode("pdf")}
            >
              PDF
            </button>
            <button
              type="button"
              className={`app-view-btn${viewMode === "reader" ? " is-active" : ""}`}
              onClick={() => handleViewMode("reader")}
            >
              Reader
            </button>
            <button
              type="button"
              className={`app-view-btn${viewMode === "compare" ? " is-active" : ""}`}
              onClick={() => handleViewMode("compare")}
              title="Vue côte à côte : PDF original vs lecture enrichie"
            >
              ⧉ Comparer
            </button>
          </div>
        )}

        {/* Toggle Standard / Mode IA */}
        <div className="app-ai-toggle" role="group" aria-label="Mode de traitement">
          <button
            type="button"
            className={`app-ai-btn${appMode === "standard" ? " is-active" : ""}`}
            onClick={() => handleAppModeToggle("standard")}
            title="Extraction rapide sans IA"
          >
            ⚡ Standard
          </button>
          <button
            type="button"
            className={`app-ai-btn app-ai-btn--ai${appMode === "ai" ? " is-active" : ""}`}
            onClick={() => handleAppModeToggle("ai")}
            title="Florence-2 (légendes figures) + Texify (formules)"
          >
            🤖 Mode IA
          </button>
        </div>

        <div className="app-sidebar-meta">
          {doc.n_pages > 0 && <>{doc.n_pages} page{doc.n_pages > 1 ? "s" : ""} · </>}
          {!isMarkitdown && <>{doc.n_figures} figure{doc.n_figures !== 1 ? "s" : ""} · </>}
          {!isMarkitdown && <>{tables.length} table{tables.length !== 1 ? "s" : ""}</>}
          {isMarkitdown && (
            <span className="app-mode-badge app-mode-badge--format" title="Extrait via markitdown">
              {doc.file_type?.toUpperCase() ?? "DOC"}
            </span>
          )}
          {isNativeMode && (
            <span className="app-mode-badge" title="Texte natif détecté — outline extrait via pypdfium2, figures et tables via Docling.">
              natif
            </span>
          )}
        </div>

        <SearchBar value={query} onChange={setQuery} />

        {!isRegistered ? (
          <>
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
              {!isMarkitdown && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "gallery"}
                  className={`app-tab${tab === "gallery" ? " is-active" : ""}`}
                  onClick={() => setTab("gallery")}
                >
                  Galerie
                </button>
              )}
              {!isMarkitdown && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "tables"}
                  className={`app-tab${tab === "tables" ? " is-active" : ""}`}
                  onClick={() => setTab("tables")}
                >
                  Tables{tables.length > 0 && <span className="app-tab-count">{tables.length}</span>}
                </button>
              )}
            </div>

            {tab === "outline" && (
              <Outline nodes={doc.outline} onSelect={handleSelect} activeId={activeId} />
            )}
            {tab === "gallery" && (
              <Gallery docId={doc.doc_id} figures={figures} onSelect={handleGallerySelect} />
            )}
            {tab === "tables" && (
              <TablesPanel tables={tables} onGotoPage={gotoPage} />
            )}
          </>
        ) : (
          <div className="sidebar-unprocessed-info" style={{ padding: "20px", margin: "20px 0", borderRadius: "var(--radius-md)", border: "1px solid rgba(255, 140, 0, 0.3)", background: "rgba(255, 140, 0, 0.05)" }}>
            <h3 style={{ color: "#ff8c00", margin: "0 0 10px", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
              ⚡ Document non traité
            </h3>
            <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: "1.45", color: "var(--text-secondary)" }}>
              Ce document a été indexé par référence. Les fonctionnalités interactives (Sommaire, Reader, Galerie d'images, Extraction de tableaux) nécessitent une analyse complète.
            </p>
            <button
              type="button"
              className="library-btn library-btn-orange"
              style={{ width: "100%", marginTop: "14px", height: "36px" }}
              onClick={() => handleProcessRegistered(doc.doc_id)}
            >
              Lancer le traitement IA
            </button>
          </div>
        )}
        <footer className="app-sidebar-footer">
          Créé par <strong>MHDINGBI</strong> &amp; <strong>sadj-kun</strong>
        </footer>
      </aside>

      <main className="app-main">
        {effectiveViewMode === "compare" ? (
          /* ── Mode Comparer : PDF (gauche) + Reader HTML (droite) ── */
          <div className="app-compare" ref={compareContainerRef}>
            <div
              className="app-compare-panel app-compare-panel--pdf"
              style={{ width: `${compareRatio * 100}%`, flex: "none" }}
            >
              <Viewer
                ref={viewerRef}
                url={pdfUrl(doc.doc_id)}
                pages={doc.pages}
                figures={doc.figures}
                searchQuery={query}
                onPageChange={handlePageChange}
                onFigureClick={setFigureIdx}
              />
            </div>
            <div className="app-compare-divider" onMouseDown={handleCompareDividerDown} />
            <div className="app-compare-panel app-compare-panel--reader" style={{ flex: 1 }}>
              <MarkdownReader
                ref={readerRef}
                docId={doc.doc_id}
                filename={doc.filename ?? undefined}
                pdfTitle={doc.pdf_title ?? undefined}
                outline={doc.outline}
                theme={readerTheme}
                onThemeChange={handleReaderTheme}
                appTheme={theme}
                isDark={isDark}
                onDarkChange={handleDarkChange}
                onPageChange={handleReaderPageChange}
                compareMode
                searchQuery={query}
              />
            </div>
          </div>
        ) : effectiveViewMode === "pdf" ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
            {doc.extraction_mode === "registered" && (
              <div style={{ 
                background: "rgba(255, 140, 0, 0.1)", 
                borderBottom: "1px solid rgba(255, 140, 0, 0.2)", 
                padding: "10px 20px", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                gap: "16px",
                fontSize: "0.85rem",
                zIndex: 10
              }}>
                <span style={{ color: "var(--text-primary)" }}>
                  ⚡ <strong>Mode lecture seule :</strong> Lancez le traitement IA pour débloquer le Reader interactif, la Galerie des figures et l'extraction de tableaux.
                </span>
                <button
                  type="button"
                  className="library-btn library-btn-orange"
                  style={{ height: "30px", padding: "0 12px", fontSize: "0.78rem" }}
                  onClick={() => handleProcessRegistered(doc.doc_id)}
                >
                  Traiter le document
                </button>
              </div>
            )}
            <Viewer
              ref={viewerRef}
              url={pdfUrl(doc.doc_id)}
              pages={doc.pages}
              figures={doc.figures}
              searchQuery={query}
              onPageChange={handlePageChange}
              onFigureClick={setFigureIdx}
            />
          </div>
        ) : (
          <MarkdownReader
            docId={doc.doc_id}
            filename={doc.filename ?? undefined}
            pdfTitle={doc.pdf_title ?? undefined}
            outline={doc.outline}
            theme={readerTheme}
            onThemeChange={handleReaderTheme}
            focusSectionTitle={readerFocusTitle}
            onFocusClear={() => setReaderFocusTitle(null)}
            appTheme={theme}
            isDark={isDark}
            onDarkChange={handleDarkChange}
            searchQuery={query}
          />
        )}
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
