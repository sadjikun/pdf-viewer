import { useMemo, useState } from "react";
import { figureUrl } from "../../api";
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
  onUpload: (file: File, fastMode: boolean) => void;
  onRefresh: () => void;
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
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [mode, setMode] = useState<"all" | "pdf" | "other">("all");

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
}: {
  doc: LibraryDocument;
  compact?: boolean;
  isLast: boolean;
  onOpen: (docId: string) => void;
  onDelete: (docId: string) => void;
}) {
  const cover = doc.cover_figure_id ? figureUrl(doc.doc_id, doc.cover_figure_id) : null;
  return (
    <article className={`library-card${compact ? " library-card--compact" : ""}${isLast ? " is-last" : ""}`}>
      <button type="button" className="library-card-open" onClick={() => onOpen(doc.doc_id)}>
        <div className="library-poster">
          {cover ? <img src={cover} alt="" loading="lazy" /> : <PosterFallback doc={doc} />}
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
