import { useEffect, useMemo, useState } from "react";
import { thumbnailUrl, registerPath, previewFolder } from "../../api";
import type { LibraryDocument, LibraryFailure, LibraryTask, RegisterResult } from "../../types";
import { UploadZone } from "../Upload/UploadZone";
import "./Library.css";

type SortKey = "recent" | "title" | "pages";

interface Props {
  documents: LibraryDocument[];
  processing: LibraryTask[];
  failed: LibraryFailure[];
  lastDocId: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (docId: string) => void;
  onDelete: (docId: string) => void;
  onUpload: (file: File, fastMode: boolean) => void;
  onRefresh: () => void;
  onProcess?: (docId: string) => void;
}

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp * 1000));

const formatSize = (bytes: number | null) => {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const cleanType = (value: string) => value.toUpperCase();

export function Library({
  documents,
  processing,
  failed,
  lastDocId,
  loading,
  error,
  onOpen,
  onDelete,
  onUpload,
  onRefresh,
  onProcess,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [mode, setMode] = useState<"all" | "pdf" | "other">("all");

  const [showIndexer, setShowIndexer] = useState(false);
  const [inputPath, setInputPath] = useState("");
  const [previewInfo, setPreviewInfo] = useState<{ loading: boolean; pdf_count: number; pdfs: string[]; error: string | null } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [feedback, setFeedback] = useState<RegisterResult | null>(null);

  // Debounced preview effect
  useEffect(() => {
    if (!inputPath.trim()) {
      setPreviewInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewInfo({ loading: true, pdf_count: 0, pdfs: [], error: null });
      try {
        const info = await previewFolder(inputPath.trim());
        setPreviewInfo({ loading: false, pdf_count: info.pdf_count, pdfs: info.pdfs, error: null });
      } catch (err: any) {
        setPreviewInfo({ loading: false, pdf_count: 0, pdfs: [], error: err.message || "Chemin introuvable ou invalide" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputPath]);

  const pywebview = (window as any).pywebview;

  const handleBrowseFiles = async () => {
    if (pywebview?.api?.pick_files) {
      try {
        const files = await pywebview.api.pick_files();
        if (files && files.length > 0) {
          if (files.length === 1) {
            setInputPath(files[0]);
          } else {
            await handleRegisterPaths(files);
          }
        }
      } catch (err) {
        console.error("Browse files failed", err);
      }
    }
  };

  const handleBrowseFolder = async () => {
    if (pywebview?.api?.pick_folder) {
      try {
        const folder = await pywebview.api.pick_folder();
        if (folder) {
          setInputPath(folder);
        }
      } catch (err) {
        console.error("Browse folder failed", err);
      }
    }
  };

  const handleRegisterPaths = async (paths: string[]) => {
    setRegistering(true);
    setFeedback(null);
    const result: RegisterResult = { registered: [], skipped: [], errors: [] };
    
    try {
      for (const p of paths) {
        const res = await registerPath(p);
        result.registered.push(...res.registered);
        result.skipped.push(...res.skipped);
        result.errors.push(...res.errors);
      }
      setFeedback(result);
      if (result.registered.length > 0) {
        onRefresh();
      }
    } catch (err: any) {
      result.errors.push({ path: paths.join(", "), reason: err.message || "Erreur d'indexation" });
      setFeedback(result);
    } finally {
      setRegistering(false);
    }
  };

  const handleRegisterInput = async () => {
    if (!inputPath.trim()) return;
    await handleRegisterPaths([inputPath.trim()]);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = documents.filter((doc) => {
      if (mode === "pdf" && doc.file_type !== "pdf") return false;
      if (mode === "other" && doc.file_type === "pdf") return false;
      if (!q) return true;
      return `${doc.title} ${doc.filename} ${doc.file_type}`.toLowerCase().includes(q);
    });
    return [...items].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "fr");
      if (sort === "pages") return (b.n_pages ?? 0) - (a.n_pages ?? 0);
      return (b.modified_at ?? 0) - (a.modified_at ?? 0);
    });
  }, [documents, mode, query, sort]);

  const recent = documents.slice(0, 6);
  const totalPages = documents.reduce((sum, doc) => sum + (doc.n_pages || 0), 0);
  const totalFigures = documents.reduce((sum, doc) => sum + (doc.n_figures || 0), 0);

  return (
    <main className="library">
      <header className="library-topbar">
        <div>
          <p className="library-kicker">Bibliothèque locale</p>
          <h1>Engineering Library</h1>
        </div>
        <div className="library-topbar-actions">
          <button
            type="button"
            className={`library-btn ${showIndexer ? "is-active" : ""}`}
            style={{ height: "38px", borderRadius: "var(--radius-md)" }}
            onClick={() => setShowIndexer(!showIndexer)}
            title="Indexer des fichiers locaux (sans traitement)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Indexer
          </button>
          <button type="button" className="library-icon-btn" onClick={onRefresh} title="Rafraîchir">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12a8 8 0 0 1-13.7 5.6" />
              <path d="M4 12A8 8 0 0 1 17.7 6.4" />
              <path d="M17 2v5h5" />
              <path d="M7 22v-5H2" />
            </svg>
          </button>
        </div>
      </header>

      {showIndexer && (
        <section className="library-indexer-panel" aria-label="Indexation rapide">
          <h2 className="library-indexer-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            Indexation rapide par référence (sans IA)
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Référencez des fichiers PDF locaux ou des dossiers entiers pour les lire instantanément. Le traitement lourd (Docling, OCR, Figures) pourra être déclenché plus tard.
          </p>

          <div className="library-indexer-input-group">
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              placeholder="Chemin absolu du PDF ou dossier (ex: C:\Documents\rapport.pdf)"
              className="library-indexer-input"
              disabled={registering}
            />
            
            {pywebview && (
              <div className="library-indexer-picker-buttons">
                <button
                  type="button"
                  className="library-btn"
                  onClick={handleBrowseFiles}
                  disabled={registering}
                >
                  Fichier...
                </button>
                <button
                  type="button"
                  className="library-btn"
                  onClick={handleBrowseFolder}
                  disabled={registering}
                >
                  Dossier...
                </button>
              </div>
            )}
          </div>

          {!pywebview && (
            <p style={{ margin: "-8px 0 14px", fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic" }}>
              💡 Version web : entrez le chemin manuellement. Sur l'application de bureau, utilisez les boutons "Fichier/Dossier" pour parcourir.
            </p>
          )}

          {previewInfo && (
            <div className="library-indexer-preview">
              <h3 className="library-indexer-preview-title">
                {previewInfo.loading ? "Analyse du chemin..." : `Prévisualisation : ${previewInfo.pdf_count} document(s) trouvé(s)`}
              </h3>
              {previewInfo.error && <p style={{ color: "#ef4444", fontSize: "0.8rem", margin: 0 }}>⚠️ {previewInfo.error}</p>}
              {!previewInfo.loading && previewInfo.pdfs.length > 0 && (
                <ul className="library-indexer-preview-list">
                  {previewInfo.pdfs.slice(0, 10).map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                  {previewInfo.pdfs.length > 10 && <li>... et {previewInfo.pdfs.length - 10} autres</li>}
                </ul>
              )}
            </div>
          )}

          <div style={{ marginTop: "14px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="library-btn"
              onClick={() => {
                setInputPath("");
                setFeedback(null);
                setPreviewInfo(null);
              }}
              disabled={registering || (!inputPath && !feedback)}
            >
              Réinitialiser
            </button>
            <button
              type="button"
              className="library-btn library-btn-orange"
              onClick={handleRegisterInput}
              disabled={registering || !inputPath.trim() || (previewInfo ? previewInfo.pdf_count === 0 : false)}
            >
              {registering ? "Indexation..." : "Ajouter à la bibliothèque"}
            </button>
          </div>

          {feedback && (
            <div className={`library-indexer-feedback ${feedback.errors.length > 0 ? "library-indexer-feedback-error" : "library-indexer-feedback-success"}`}>
              {feedback.registered.length > 0 && (
                <p style={{ margin: 0 }}>
                  ✅ Indexation réussie : <strong>{feedback.registered.length}</strong> document(s) ajouté(s) sans traitement.
                </p>
              )}
              {feedback.skipped.length > 0 && (
                <p style={{ margin: "4px 0 0 0" }}>
                  ℹ️ Ignoré (déjà présent) : {feedback.skipped.length} document(s).
                </p>
              )}
              {feedback.errors.length > 0 && (
                <div style={{ margin: "4px 0 0 0" }}>
                  <strong>⚠️ Erreur lors de l'indexation :</strong>
                  <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px" }}>
                    {feedback.errors.map((err, i) => (
                      <li key={i}>{err.path} : {err.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="library-stats" aria-label="Statistiques bibliothèque">
        <div className="library-stat">
          <span>{documents.length}</span>
          <small>documents</small>
        </div>
        <div className="library-stat">
          <span>{totalPages}</span>
          <small>pages</small>
        </div>
        <div className="library-stat">
          <span>{totalFigures}</span>
          <small>figures</small>
        </div>
        <div className="library-stat">
          <span>{processing.length}</span>
          <small>en cours</small>
        </div>
      </section>

      {error && <div className="library-error">{error}</div>}

      {processing.length > 0 && (
        <section className="library-rail" aria-label="Traitements en cours">
          <div className="library-section-head">
            <h2>En cours</h2>
          </div>
          <div className="library-processing-list">
            {processing.map((task) => (
              <div key={task.doc_id} className="library-processing">
                <div>
                  <strong>{task.doc_id.slice(0, 8)}</strong>
                  <p>{task.message ?? "Traitement en cours..."}</p>
                </div>
                <span>{task.progress ?? 0}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="library-rail" aria-label="Documents récents">
          <div className="library-section-head">
            <h2>Continuer</h2>
          </div>
          <div className="library-row">
            {recent.map((doc) => (
              <DocumentCard
                key={doc.doc_id}
                doc={doc}
                compact
                isLast={doc.doc_id === lastDocId}
                onOpen={onOpen}
                onDelete={onDelete}
                onProcess={onProcess}
              />
            ))}
          </div>
        </section>
      )}

      <section className="library-controls" aria-label="Filtres bibliothèque">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un document"
          className="library-search"
        />
        <div className="library-segments">
          <button type="button" className={mode === "all" ? "is-active" : ""} onClick={() => setMode("all")}>
            Tous
          </button>
          <button type="button" className={mode === "pdf" ? "is-active" : ""} onClick={() => setMode("pdf")}>
            PDF
          </button>
          <button type="button" className={mode === "other" ? "is-active" : ""} onClick={() => setMode("other")}>
            Autres
          </button>
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="library-sort">
          <option value="recent">Récents</option>
          <option value="title">Titre</option>
          <option value="pages">Pages</option>
        </select>
      </section>

      <section className="library-grid-section" aria-label="Catalogue">
        {filtered.length > 0 ? (
          <div className="library-grid">
            {filtered.map((doc) => (
              <DocumentCard
                key={doc.doc_id}
                doc={doc}
                isLast={doc.doc_id === lastDocId}
                onOpen={onOpen}
                onDelete={onDelete}
                onProcess={onProcess}
              />
            ))}
          </div>
        ) : (
          <div className="library-empty-state">
            <UploadZone onFile={onUpload} disabled={loading} />
          </div>
        )}
      </section>

      {documents.length > 0 && (
        <section className="library-upload-band" aria-label="Ajouter un document">
          <UploadZone onFile={onUpload} disabled={loading} />
        </section>
      )}

      {failed.length > 0 && (
        <section className="library-rail" aria-label="Documents en erreur">
          <div className="library-section-head">
            <h2>Erreurs</h2>
          </div>
          <div className="library-failed-list">
            {failed.map((item) => (
              <div key={item.doc_id} className="library-failed">
                <strong>{item.doc_id.slice(0, 8)}</strong>
                <span>{item.error}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function DocumentCard({
  doc,
  compact = false,
  isLast,
  onOpen,
  onDelete,
  onProcess,
}: {
  doc: LibraryDocument;
  compact?: boolean;
  isLast: boolean;
  onOpen: (docId: string) => void;
  onDelete: (docId: string) => void;
  onProcess?: (docId: string) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isPdf = !doc.file_type || doc.file_type.toLowerCase() === "pdf";
  const showThumb = isPdf && !thumbFailed;
  const isRegistered = doc.extraction_mode === "registered";

  return (
    <article className={`library-card${compact ? " library-card--compact" : ""}${isLast ? " is-last" : ""}`}>
      {isRegistered ? (
        <div className="library-card-content">
          <div className="library-poster" onClick={() => onOpen(doc.doc_id)} style={{ cursor: "pointer" }}>
            {showThumb
              ? <img src={thumbnailUrl(doc.doc_id)} alt="" loading="lazy" onError={() => setThumbFailed(true)} className="library-poster-thumb" />
              : <PosterFallback doc={doc} />}
            <span className="library-type">{cleanType(doc.file_type)}</span>
            <span className="library-unprocessed">⚡ Non traité</span>
          </div>
          <div className="library-card-body">
            <h3 title={doc.title} onClick={() => onOpen(doc.doc_id)} style={{ cursor: "pointer" }}>{doc.title}</h3>
            <p title={doc.filename}>{doc.filename}</p>
            
            <div className="library-card-actions">
              <button 
                type="button" 
                className="library-action-btn-primary" 
                onClick={() => onProcess?.(doc.doc_id)}
                title="Lancer le traitement IA complet (OCR/Docling)"
              >
                Traiter (IA)
              </button>
              <button 
                type="button" 
                className="library-action-btn-secondary" 
                onClick={() => onOpen(doc.doc_id)}
              >
                Ouvrir
              </button>
            </div>
            
            <div className="library-card-foot" style={{ marginTop: "12px" }}>
              <span>{formatDate(doc.modified_at)}</span>
              <span>{formatSize(doc.size_bytes)}</span>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="library-card-open" onClick={() => onOpen(doc.doc_id)}>
          <div className="library-poster">
            {showThumb
              ? <img src={thumbnailUrl(doc.doc_id)} alt="" loading="lazy" onError={() => setThumbFailed(true)} className="library-poster-thumb" />
              : <PosterFallback doc={doc} />}
            <span className="library-type">{cleanType(doc.file_type)}</span>
            {doc.needs_reprocess && <span className="library-reprocess">Cache ancien</span>}
          </div>
          <div className="library-card-body">
            <h3 title={doc.title}>{doc.title}</h3>
            <p title={doc.filename}>{doc.filename}</p>
            <div className="library-card-meta">
              {doc.n_pages > 0 && <span>{doc.n_pages} p.</span>}
              {doc.n_figures > 0 && <span>{doc.n_figures} fig.</span>}
              {doc.n_tables > 0 && <span>{doc.n_tables} tab.</span>}
            </div>
            <div className="library-card-foot">
              <span>{formatDate(doc.modified_at)}</span>
              <span>{formatSize(doc.size_bytes)}</span>
            </div>
          </div>
        </button>
      )}
      <button
        type="button"
        className="library-card-delete"
        onClick={() => onDelete(doc.doc_id)}
        title="Supprimer du cache"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </article>
  );
}

function PosterFallback({ doc }: { doc: LibraryDocument }) {
  const hash = useMemo(() => {
    let h = 0;
    const str = doc.doc_id;
    for (let i = 0; i < str.length; i++) {
      h = str.charCodeAt(i) + ((h << 5) - h);
    }
    return Math.abs(h);
  }, [doc.doc_id]);

  const initials = useMemo(() => {
    return doc.title
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((word) => word[0]?.toUpperCase())
      .join("");
  }, [doc.title]);

  const gradientClass = `fallback-gradient-${hash % 6}`;
  const layoutType = hash % 3;

  return (
    <div className={`library-poster-fallback ${gradientClass} fallback-layout-${layoutType}`}>
      {/* Spine element common to all books */}
      <div className="fallback-spine" />

      {layoutType === 0 && (
        <>
          <div className="fallback-grid" />
          <div className="fallback-tech-header">
            <span className="fallback-tech-label">REF: SPEC-SYS // #{doc.doc_id.slice(0, 6).toUpperCase()}</span>
          </div>
          <div className="fallback-title-wrapper">
            <h4 className="fallback-title" title={doc.title}>{doc.title}</h4>
            <p className="fallback-tech-sub">ENGINEERING SPECIFICATION // {doc.extraction_mode.toUpperCase()}</p>
          </div>
          <div className="fallback-tech-footer">
            <div className="fallback-barcode" />
            <span className="fallback-pages">{doc.n_pages || 0} PG</span>
          </div>
        </>
      )}

      {layoutType === 1 && (
        <div className="fallback-frame">
          <div className="fallback-journal-header">
            <span>ANNALS OF SCIENCE</span>
            <span className="fallback-divider" />
          </div>
          <div className="fallback-title-wrapper-journal">
            <h4 className="fallback-title" title={doc.title}>{doc.title}</h4>
            <p className="fallback-subtitle">Vol. {doc.n_pages ? `${doc.n_pages}` : "IX"} · No. {doc.doc_id.slice(0, 4).toUpperCase()}</p>
          </div>
          <div className="fallback-journal-footer">
            <span className="fallback-pages">{doc.n_pages || "?"} PAGES</span>
            <div className="fallback-insignia">❖</div>
          </div>
        </div>
      )}

      {layoutType === 2 && (
        <>
          <div className="fallback-watermark">{initials || "DOC"}</div>
          <div className="fallback-left-band" />
          <div className="fallback-minimal-body">
            <div className="fallback-mode-badge">{doc.extraction_mode.toUpperCase()}</div>
            <h4 className="fallback-title" title={doc.title}>{doc.title}</h4>
            <p className="fallback-minimal-sub">Technical report archive</p>
          </div>
          <div className="fallback-minimal-footer">
            <span className="fallback-format-label">{doc.file_type.toUpperCase()}</span>
            <div className="fallback-barcode-mini" />
          </div>
        </>
      )}
    </div>
  );
}
