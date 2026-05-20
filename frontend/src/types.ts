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
