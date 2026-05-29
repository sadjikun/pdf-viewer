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
}

export interface TableItem {
  id: string;
  page: number | null;
  bbox: Bbox | null;
  caption: string;
  html: string;
}

export interface DocResult {
  doc_id: string;
  n_pages: number;
  n_figures: number;
  n_tables: number;
  pages: PageInfo[];
  outline: OutlineNode[];
  figures: Figure[];
  tables: TableItem[];
}

// Réponse de POST /process quand le traitement démarre en arrière-plan.
export interface ProcessingResponse {
  doc_id: string;
  status: "processing";
  progress: number;
  message: string;
}

// Réponse de GET /doc/{id}/status.
export interface DocStatus {
  status: "ready" | "processing" | "failed" | "not_found";
  progress?: number;
  message?: string;
  error?: string;
}

export type ExtractionMode = "native" | "docling" | "fast" | "markitdown";

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
