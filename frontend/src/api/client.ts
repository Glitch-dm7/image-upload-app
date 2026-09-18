import type { ImageListResponse, ImageRecord } from "../types/image.js";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

export async function uploadImage(file: File): Promise<{ id: string; status: "pending" }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/images`, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  return res.json();
}

export async function getImage(id: string): Promise<ImageRecord> {
  const res = await fetch(`${API_BASE_URL}/images/${id}`);
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  return res.json();
}

export async function listImages(params: { status?: ImageRecord["status"]; limit?: number; cursor?: string } = {}): Promise<ImageListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const res = await fetch(`${API_BASE_URL}/images?${query.toString()}`);
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  return res.json();
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/images/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
}

/** The backend redirects this URL to a short-lived signed Supabase Storage URL. */
export function getImageFileUrl(id: string): string {
  return `${API_BASE_URL}/images/${id}/file`;
}
