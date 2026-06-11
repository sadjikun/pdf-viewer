import type { AnnotationStore, DocResult, DocStatus, LibraryResponse, ProcessingResponse, RegisterPreview, RegisterResult, StudyMetadata, SearchHit, QARequest, QAResponse, OllamaStatus, FicheAIResponse } from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

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

// Cache hit → DocResult complet ; sinon traitement lancé en fond → ProcessingResponse.
export async function processPdf(file: File): Promise<DocResult | ProcessingResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/process`, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getDocStatus(docId: string): Promise<DocStatus> {
  const res = await fetch(`${API_BASE}/doc/${docId}/status`);
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

export async function deleteDoc(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/doc/${docId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
}

// Lance Florence-2 sur les figures du document (légendage IA). Met à jour result.json.
export async function captionFigures(docId: string): Promise<{ figures_updated: number }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/caption-figures`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export function pdfUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/pdf`;
}

export function figureUrl(docId: string, figId: string): string {
  return `${API_BASE}/doc/${docId}/figure/${figId}`;
}

export function markdownUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/markdown`;
}

// Endpoints HTML Docling (export pleine fidélité). Absents tant que la PR
// "Reader backend HTML" n'est pas mergée → le Reader retombe sur /markdown.
export function htmlUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/html`;
}

export function htmlManifestUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/html-manifest`;
}

export function htmlPartUrl(docId: string, startPage: number): string {
  return `${API_BASE}/doc/${docId}/html-part/${startPage}`;
}

// Annotations (highlights + notes, persistées côté serveur)
export async function getAnnotations(docId: string): Promise<AnnotationStore> {
  const res = await fetch(`${API_BASE}/doc/${docId}/annotations`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function saveAnnotations(
  docId: string,
  store: AnnotationStore,
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

export function thumbnailUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/thumbnail`;
}

// Bibliothèque : référencer des PDF par chemin disque (sans copie en cache)
export async function registerPath(path: string): Promise<RegisterResult> {
  const res = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function previewPath(path: string): Promise<RegisterPreview> {
  const res = await fetch(`${API_BASE}/register/preview?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

// Lance l'analyse Docling complète d'un document référencé.
export async function processRegisteredDoc(docId: string): Promise<ProcessingResponse> {
  const res = await fetch(`${API_BASE}/doc/${docId}/process`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

// Retraite un document (force_ocr pour les PDFs hybrides natif + scanné).
export async function reprocessDoc(
  docId: string,
  forceOcr = false,
): Promise<ProcessingResponse> {
  const res = await fetch(`${API_BASE}/doc/${docId}/reprocess?force_ocr=${forceOcr}`, {
    method: "POST",
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function cleanupCache(
  maxAgeDays = 30,
): Promise<{ cleaned_directories: number; freed_space_mb: number }> {
  const res = await fetch(`${API_BASE}/cache/cleanup?max_age_days=${maxAgeDays}`, {
    method: "POST",
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getStudyMetadata(docId: string): Promise<StudyMetadata> {
  const res = await fetch(`${API_BASE}/doc/${docId}/study`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function saveStudyMetadata(
  docId: string,
  metadata: StudyMetadata,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/doc/${docId}/study`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function searchContent(query: string): Promise<SearchHit[]> {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function queryQA(req: QARequest): Promise<QAResponse> {
  const res = await fetch(`${API_BASE}/qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const res = await fetch(`${API_BASE}/ollama/status`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}

export async function getFicheAI(docId: string): Promise<FicheAIResponse | null> {
  const res = await fetch(`${API_BASE}/doc/${docId}/fiche-ai`);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  const data = await res.json();
  if (data.status === "not_generated") return null;
  return data;
}

export async function generateFicheAI(docId: string, model: string): Promise<FicheAIResponse> {
  const res = await fetch(`${API_BASE}/doc/${docId}/fiche-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.json();
}



