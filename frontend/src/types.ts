export type Bbox = [number, number, number, number];

export interface PageInfo {
  number: number;
  width: number | null;
  height: number | null;
}

export interface OutlineNode {
  id: string;
  level: number;
  title: string;
  page: number | null;
  bbox: Bbox | null;
  children: OutlineNode[];
}

export interface Figure {
  id: string;
  page: number | null;
  bbox: Bbox | null;
  caption: string;
  caption_ai?: string;
  latex?: string;
}

export interface Table {
  id: string;
  page: number | null;
  bbox: Bbox | null;
  caption: string;
  html: string;
  n_rows: number;
  n_cols: number;
}

export type ExtractionMode = "native" | "docling" | "fast" | "markitdown";

export interface HtmlManifestEntry {
  start: number;
  end: number;
  file: string;
}

export interface DocResult {
  doc_id: string;
  filename?: string;
  file_type?: string;
  pdf_title?: string;      // Item 9 : titre depuis les métadonnées PDF (peut être absent ou vide)
  n_pages: number;
  n_figures: number;
  n_tables: number;
  pages: PageInfo[];
  outline: OutlineNode[];
  figures: Figure[];
  tables: Table[];
  extraction_mode: ExtractionMode;
}

export interface LibraryDocument {
  doc_id: string;
  title: string;
  filename: string;
  file_type: string;
  extraction_mode: ExtractionMode | "unknown";
  n_pages: number;
  n_figures: number;
  n_tables: number;
  n_sections: number;
  modified_at: number;
  size_bytes: number | null;
  cover_figure_id: string | null;
  needs_reprocess: boolean;
}

export interface LibraryTask {
  doc_id: string;
  status: "processing";
  progress?: number;
  message?: string;
}

export interface LibraryFailure {
  doc_id: string;
  status: "failed";
  error: string;
}

export interface LibraryResponse {
  documents: LibraryDocument[];
  processing: LibraryTask[];
  failed: LibraryFailure[];
  total: number;
}

export interface StoredHighlight {
  key: string;
  color: string;
  text: string;
  section: string;        // section[data-sid], "" if unknown (legacy)
  sectionTitle: string;   // derived heading text, "" if unknown
  page: number;           // nearest preceding .pdf-page-marker, 0 if unknown
  prefix?: string;        // up to 30 chars before text (disambiguation)
  suffix?: string;        // up to 30 chars after text
}

export interface AnnotationStore {
  version: number;
  highlights: StoredHighlight[];
  notes: Record<string, string>;  // key → note text
  saved_at: number;               // ms epoch, server-stamped
}
