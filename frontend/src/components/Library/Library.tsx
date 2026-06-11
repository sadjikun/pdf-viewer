import { useMemo, useState } from "react";
import { figureUrl, thumbnailUrl } from "../../api";
import type { LibraryDocument, LibraryFailure, LibraryTask } from "../../types";
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
  onUpload: (file: File) => void;
  onRefresh: () => void;
  /** Référence un PDF/dossier par chemin disque. Retourne un message de résultat. */
  onRegister: (path: string) => Promise<string>;
  /** Lance l'analyse Docling d'un document référencé. */
  onProcess: (docId: string) => void;
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
  onRegister,
  onProcess,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [regPath, setRegPath] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [regMsg, setRegMsg] = useState<string | null>(null);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const handleRegister = async () => {
    const path = regPath.trim();
    if (!path || regBusy) return;
    setRegBusy(true);
    setRegMsg(null);
    try {
      setRegMsg(await onRegister(path));
      setRegPath("");
    } finally {
      setRegBusy(false);
    }
  };
  const [mode, setMode] = useState<"all" | "pdf" | "other">("all");

  // Filter and Tag Computations
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((doc) => {
      if (doc.folder) {
        counts[doc.folder] = (counts[doc.folder] || 0) + 1;
      }
    });
    return counts;
  }, [documents]);
  const sortedFolders = useMemo(() => Object.keys(folderCounts).sort(), [folderCounts]);

  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((doc) => {
      if (doc.subject) {
        counts[doc.subject] = (counts[doc.subject] || 0) + 1;
      }
    });
    return counts;
  }, [documents]);
  const sortedSubjects = useMemo(() => Object.keys(subjectCounts).sort(), [subjectCounts]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((doc) => {
      if (doc.tags) {
        doc.tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });
    return counts;
  }, [documents]);
  const sortedTags = useMemo(() => Object.keys(tagCounts).sort(), [tagCounts]);

  const statusCounts = useMemo(() => {
    const counts = { todo: 0, in_progress: 0, done: 0 };
    documents.forEach((doc) => {
      const s = doc.status || "todo";
      if (s in counts) counts[s as keyof typeof counts]++;
    });
    return counts;
  }, [documents]);

  const priorityCounts = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0 };
    documents.forEach((doc) => {
      const p = doc.priority || "medium";
      if (p in counts) counts[p as keyof typeof counts]++;
    });
    return counts;
  }, [documents]);

  const hasActiveFilters = !!(selectedFolder || selectedSubject || selectedStatus || selectedPriority || selectedTag);
  const clearAllFilters = () => {
    setSelectedFolder(null);
    setSelectedSubject(null);
    setSelectedStatus(null);
    setSelectedPriority(null);
    setSelectedTag(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = documents.filter((doc) => {
      if (mode === "pdf" && doc.file_type !== "pdf") return false;
      if (mode === "other" && doc.file_type === "pdf") return false;
      
      // Folder filter (supports nesting)
      if (selectedFolder) {
        if (!doc.folder) return false;
        const docFolderNormalized = doc.folder.replace(/\\/g, "/");
        const selFolderNormalized = selectedFolder.replace(/\\/g, "/");
        const isPrefix = docFolderNormalized.startsWith(selFolderNormalized + "/");
        const isExact = docFolderNormalized === selFolderNormalized;
        if (!isExact && !isPrefix) return false;
      }
      
      // Subject filter
      if (selectedSubject && doc.subject !== selectedSubject) return false;
      
      // Status filter
      if (selectedStatus && (doc.status || "todo") !== selectedStatus) return false;
      
      // Priority filter
      if (selectedPriority && (doc.priority || "medium") !== selectedPriority) return false;
      
      // Tag filter
      if (selectedTag && (!doc.tags || !doc.tags.includes(selectedTag))) return false;

      if (!q) return true;
      return `${doc.title} ${doc.filename} ${doc.file_type} ${doc.subject || ""} ${doc.folder || ""} ${(doc.tags || []).join(" ")}`
        .toLowerCase()
        .includes(q);
    });
    return [...items].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "fr");
      if (sort === "pages") return (b.n_pages ?? 0) - (a.n_pages ?? 0);
      return (b.modified_at ?? 0) - (a.modified_at ?? 0);
    });
  }, [documents, mode, query, sort, selectedFolder, selectedSubject, selectedStatus, selectedPriority, selectedTag]);

  const recent = documents.slice(0, 6);
  const totalPages = documents.reduce((sum, doc) => sum + (doc.n_pages || 0), 0);
  const totalFigures = documents.reduce((sum, doc) => sum + (doc.n_figures || 0), 0);

  return (
    <div className="library-layout">
      {/* Sidebar de Filtrage */}
      <aside className="library-sidebar" aria-label="Filtres de la bibliothèque">
        <div className="library-sidebar-header">
          <h2>Filtres</h2>
          {hasActiveFilters && (
            <button type="button" className="library-clear-btn" onClick={clearAllFilters}>
              Effacer
            </button>
          )}
        </div>

        {/* Dossiers */}
        <div className="library-filter-group">
          <h3>Dossiers</h3>
          <div className="library-filter-list">
            <button
              type="button"
              className={`library-filter-item ${!selectedFolder ? "is-active" : ""}`}
              onClick={() => setSelectedFolder(null)}
            >
              <span>📁 Tous les dossiers</span>
            </button>
            {sortedFolders.map((f) => (
              <button
                key={f}
                type="button"
                className={`library-filter-item ${selectedFolder === f ? "is-active" : ""}`}
                onClick={() => setSelectedFolder(f)}
              >
                <span className="library-filter-text" title={f}>📁 {f}</span>
                <span className="filter-count">{folderCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sujets / Matières */}
        <div className="library-filter-group">
          <h3>Matières</h3>
          <div className="library-filter-list">
            <button
              type="button"
              className={`library-filter-item ${!selectedSubject ? "is-active" : ""}`}
              onClick={() => setSelectedSubject(null)}
            >
              <span>🎓 Toutes les matières</span>
            </button>
            {sortedSubjects.map((s) => (
              <button
                key={s}
                type="button"
                className={`library-filter-item ${selectedSubject === s ? "is-active" : ""}`}
                onClick={() => setSelectedSubject(s)}
              >
                <span className="library-filter-text" title={s}>🎓 {s}</span>
                <span className="filter-count">{subjectCounts[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Statuts */}
        <div className="library-filter-group">
          <h3>Statuts</h3>
          <div className="library-filter-list">
            <button
              type="button"
              className={`library-filter-item ${!selectedStatus ? "is-active" : ""}`}
              onClick={() => setSelectedStatus(null)}
            >
              <span>📖 Tous les statuts</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedStatus === "todo" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("todo")}
            >
              <span>📖 À lire</span>
              <span className="filter-count">{statusCounts.todo}</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedStatus === "in_progress" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("in_progress")}
            >
              <span>⚡ En cours</span>
              <span className="filter-count">{statusCounts.in_progress}</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedStatus === "done" ? "is-active" : ""}`}
              onClick={() => setSelectedStatus("done")}
            >
              <span>✅ Lu</span>
              <span className="filter-count">{statusCounts.done}</span>
            </button>
          </div>
        </div>

        {/* Priorités */}
        <div className="library-filter-group">
          <h3>Priorités</h3>
          <div className="library-filter-list">
            <button
              type="button"
              className={`library-filter-item ${!selectedPriority ? "is-active" : ""}`}
              onClick={() => setSelectedPriority(null)}
            >
              <span>🔥 Toutes les priorités</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedPriority === "low" ? "is-active" : ""}`}
              onClick={() => setSelectedPriority("low")}
            >
              <span>🟡 Basse</span>
              <span className="filter-count">{priorityCounts.low}</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedPriority === "medium" ? "is-active" : ""}`}
              onClick={() => setSelectedPriority("medium")}
            >
              <span>🟠 Moyenne</span>
              <span className="filter-count">{priorityCounts.medium}</span>
            </button>
            <button
              type="button"
              className={`library-filter-item ${selectedPriority === "high" ? "is-active" : ""}`}
              onClick={() => setSelectedPriority("high")}
            >
              <span>🔴 Haute</span>
              <span className="filter-count">{priorityCounts.high}</span>
            </button>
          </div>
        </div>

        {/* Tags */}
        {sortedTags.length > 0 && (
          <div className="library-filter-group">
            <h3>Tags</h3>
            <div className="library-tags-cloud">
              <button
                type="button"
                className={`library-tag-btn ${!selectedTag ? "is-active" : ""}`}
                onClick={() => setSelectedTag(null)}
              >
                Tous
              </button>
              {sortedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`library-tag-btn ${selectedTag === tag ? "is-active" : ""}`}
                  onClick={() => setSelectedTag(tag)}
                >
                  #{tag} <span className="tag-btn-count">({tagCounts[tag]})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="library">
        <header className="library-topbar">
          <div>
            <p className="library-kicker">Bibliothèque locale</p>
            <h1>Engineering Library</h1>
          </div>
          <div className="library-topbar-actions">
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

        {recent.length > 0 && !hasActiveFilters && (
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

        <section className="library-register" aria-label="Référencer des PDF par chemin">
          <label className="library-register-label" htmlFor="reg-path">
            Référencer un PDF ou un dossier (sans copie)
          </label>
          <div className="library-register-row">
            <input
              id="reg-path"
              className="library-register-input"
              value={regPath}
              onChange={(e) => { setRegPath(e.target.value); if (regMsg) setRegMsg(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              placeholder="Ex : C:\\Documents\\rapports  ou  /Users/moi/pdfs/rapport.pdf"
              spellCheck={false}
              aria-describedby={regMsg ? "reg-msg" : undefined}
            />
            <button
              type="button"
              className="library-register-btn"
              onClick={handleRegister}
              disabled={regBusy || !regPath.trim()}
            >
              {regBusy ? "…" : "Référencer"}
            </button>
          </div>
          {regMsg && <p id="reg-msg" className="library-register-msg">{regMsg}</p>}
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
    </div>
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
  onProcess: (docId: string) => void;
}) {
  const isRegistered = doc.extraction_mode === "registered";
  const [imgError, setImgError] = useState(false);
  
  // Cover helper
  const cover = doc.cover_figure_id
    ? figureUrl(doc.doc_id, doc.cover_figure_id)
    : doc.file_type === "pdf"
      ? thumbnailUrl(doc.doc_id)
      : null;

  return (
    <article className={`library-card${compact ? " library-card--compact" : ""}${isLast ? " is-last" : ""}`}>
      <button type="button" className="library-card-open" onClick={() => onOpen(doc.doc_id)}>
        <div className="library-poster">
          {cover && !imgError ? (
            <img src={cover} alt="" loading="lazy" onError={() => setImgError(true)} />
          ) : (
            <PosterFallback doc={doc} />
          )}
          <span className="library-type">{cleanType(doc.file_type)}</span>
          {isRegistered && <span className="library-registered">Référencé</span>}
          {!isRegistered && doc.needs_reprocess && <span className="library-reprocess">Cache ancien</span>}
        </div>
        <div className="library-card-body">
          <h3 title={doc.title}>{doc.title}</h3>
          <p title={doc.filename}>{doc.filename}</p>

          <div className="library-card-study-badges">
            {doc.folder && (
              <span className="library-badge-folder" title={`Dossier : ${doc.folder}`}>
                📁 {doc.folder}
              </span>
            )}
            {doc.subject && (
              <span className="library-badge-subject" title={`Matière : ${doc.subject}`}>
                🎓 {doc.subject}
              </span>
            )}
            <span className={`library-badge-status status-${doc.status || "todo"}`}>
              {doc.status === "done" ? "Lu" : doc.status === "in_progress" ? "En cours" : "À lire"}
            </span>
          </div>

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
      {isRegistered && (
        <button
          type="button"
          className="library-card-analyze"
          onClick={() => onProcess(doc.doc_id)}
          title="Analyser (extraction Docling complète : sommaire, figures, tables)"
        >
          Analyser
        </button>
      )}
      <button
        type="button"
        className="library-card-delete"
        onClick={() => onDelete(doc.doc_id)}
        title="Retirer de la bibliothèque"
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
