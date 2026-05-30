import type { DocResult, LibraryResponse, AnnotationStore } from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    return JSON.stringify(data);
  } catch {
    return res.statusText;
  }
}

export async function processPdf(file: File, fastMode?: boolean): Promise<DocResult | { doc_id: string; status: "processing"; progress?: number; message?: string }> {
  const form = new FormData();
  form.append("file", file);
  const url = fastMode ? `${API_BASE}/process?fast_mode=true` : `${API_BASE}/process`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getResult(docId: string): Promise<DocResult> {
  const res = await fetch(`${API_BASE}/doc/${docId}/raw`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getLibrary(): Promise<LibraryResponse> {
  const res = await fetch(`${API_BASE}/library`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export function pdfUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/pdf`;
}

export function figureUrl(docId: string, figId: string): string {
  return `${API_BASE}/doc/${docId}/figure/${figId}`;
}

export function thumbnailUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/thumbnail`;
}

export function markdownUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/markdown`;
}

export function htmlUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/html`;
}

export function htmlManifestUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/html-manifest`;
}

export function htmlPartUrl(docId: string, startPage: number): string {
  return `${API_BASE}/doc/${docId}/html-part/${startPage}`;
}

export function searchablePdfUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/searchable-pdf`;
}

export async function runLatexOcr(docId: string): Promise<{ figures_updated: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/latex-ocr`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function captionFigures(docId: string): Promise<{ figures_updated: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/caption-figures`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export interface TesseractStatus {
  available: boolean;
  cmd: string | null;
  tessdata: string | null;
  langs: string[];
  version: string | null;
}

export async function getTesseractStatus(): Promise<TesseractStatus> {
  const res = await fetch(`${API_BASE}/tesseract/status`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function reprocessDoc(docId: string, fastMode?: boolean): Promise<DocResult | { doc_id: string; status: "processing"; progress?: number; message?: string }> {
  const url = fastMode ? `${API_BASE}/doc/${docId}/reprocess?fast_mode=true` : `${API_BASE}/doc/${docId}/reprocess`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function deleteDoc(docId: string): Promise<void> {
  await fetch(`${API_BASE}/doc/${docId}`, { method: "DELETE" });
}

export function benchmarkHtmlUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/benchmark.html`;
}

export interface DocStatus {
  status: "ready" | "processing" | "failed" | "not_found";
  progress?: number;
  message?: string;
  error?: string | null;
}

export async function getDocStatus(docId: string): Promise<DocStatus> {
  const res = await fetch(`${API_BASE}/doc/${docId}/status`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getAppMode(): Promise<{ mode: string }> {
  const res = await fetch(`${API_BASE}/app-mode`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function setAppMode(mode: "standard" | "ai"): Promise<{ mode: string }> {
  const res = await fetch(`${API_BASE}/app-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getAnnotations(docId: string): Promise<AnnotationStore> {
  const res = await fetch(`${API_BASE}/doc/${docId}/annotations`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function saveAnnotations(
  docId: string,
  store: { highlights: unknown[]; notes: Record<string, string> },
): Promise<{ ok: boolean; saved_at: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/annotations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export function ficheUrl(docId: string, format: "html" | "md"): string {
  return `${API_BASE}/doc/${docId}/fiche?format=${format}`;
}
