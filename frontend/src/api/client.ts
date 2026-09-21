import type { ImageListResponse, ImageRecord, ValidationOutcome } from "../types/image.js";

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

/** Runs the full server-side pipeline against a file. Never persists anything. */
export async function validateImage(file: File): Promise<ValidationOutcome> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/images/validate`, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  return res.json();
}

export type SubmitOutcome = { accepted: true; image: ImageRecord } | { accepted: false; outcome: ValidationOutcome };

/**
 * Re-validates server-side and, only if it's still accepted, uploads it and
 * creates its row. A 201 means it was persisted; a 200 means the re-check
 * rejected it (e.g. a race with another just-accepted near-duplicate) and
 * nothing was persisted.
 */
export async function submitImage(file: File): Promise<SubmitOutcome> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/images/submit`, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  if (res.status === 201) return { accepted: true, image: await res.json() };
  return { accepted: false, outcome: await res.json() };
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
