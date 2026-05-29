import type { DocResult, DocStatus, ProcessingResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

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

export function pdfUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/pdf`;
}

export function figureUrl(docId: string, figId: string): string {
  return `${API_BASE}/doc/${docId}/figure/${figId}`;
}

export function markdownUrl(docId: string): string {
  return `${API_BASE}/doc/${docId}/markdown`;
}
