import { v4 as uuidv4 } from "uuid";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Never derive a storage key from the user-supplied filename: it's
 * attacker-controlled (path traversal, collisions) and leaks unrelated
 * information. The original filename is kept only as DB metadata.
 */
export function generateStorageKey(mimeType: string): string {
  const ext = EXT_BY_MIME[mimeType] ?? "bin";
  return `${uuidv4()}.${ext}`;
}
