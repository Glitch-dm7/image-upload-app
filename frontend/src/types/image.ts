export type ImageStatus = "pending" | "accepted" | "rejected";

/** A persisted image, as the API returns it. In practice `status` is always `"accepted"` - rejected uploads are never persisted. */
export interface ImageRecord {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReasons: string[];
  phash: string | null;
  faceCount: number | null;
  blurScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageListResponse {
  items: ImageRecord[];
  nextCursor: string | null;
}

/** What POST /images/validate (and a rejected POST /images/submit) returns. */
export interface ValidationOutcome {
  status: "accepted" | "rejected";
  rejectionReasons: string[];
  width: number | null;
  height: number | null;
  phash: string | null;
  faceCount: number | null;
  blurScore: number | null;
  mimeType: string | null;
}

/** Shown briefly while POST /images/validate is in flight for a dropped file. */
export interface ValidatingItem {
  localKey: string;
  originalFilename: string;
  localPreviewUrl: string;
}

/**
 * Validated as accepted, not yet submitted. Keeps the real `File` so
 * Submit can resend its bytes - nothing is held server-side in between
 * validating and submitting.
 */
export interface StagedItem {
  localKey: string;
  file: File;
  originalFilename: string;
  localPreviewUrl: string;
  submitting: boolean;
  submitError?: string;
}

/** Persisted (a submit success, or hydrated from GET /images on load). */
export interface SubmittedItem {
  id: string;
  originalFilename: string;
  createdAt: string;
}

/** Client- or server-rejected. Informational only - never submitted. */
export interface RejectedItem {
  localKey: string;
  originalFilename: string;
  localPreviewUrl?: string;
  rejectionReasons: string[];
}
