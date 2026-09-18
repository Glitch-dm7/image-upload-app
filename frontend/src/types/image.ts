export type ImageStatus = "pending" | "accepted" | "rejected";

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

/** A client-side upload-in-progress, before/while the server has an opinion. */
export interface UploadItem {
  /** The server's image id once known; a temporary client-generated id until then. */
  id: string;
  /**
   * Stable identity for this card, set once and never changed - unlike
   * `id`, which is replaced by the real server id once the upload resolves.
   * Using `id` as a React list key would make that transition look like a
   * totally different item (remounting the card, dropping any in-flight
   * state) instead of the same item just getting an id assigned.
   */
  localKey: string;
  originalFilename: string;
  /** Local object URL for an immediate preview, swapped for the server-hosted file once accepted. */
  localPreviewUrl?: string;
  status: ImageStatus | "uploading" | "client-rejected";
  rejectionReasons: string[];
  createdAt: string;
}
