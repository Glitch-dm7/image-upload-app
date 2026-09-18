import { fileTypeFromBuffer } from "file-type";
import type { RuleResult } from "./types.js";

export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface DetectedFormat {
  ext: string;
  mime: string;
}

/**
 * Sniffs the real file format from magic bytes. Never trust a client-supplied
 * Content-Type or filename extension — both are attacker-controlled.
 */
export async function detectFormat(buffer: Buffer): Promise<DetectedFormat | null> {
  const result = await fileTypeFromBuffer(buffer);
  return result ?? null;
}

/**
 * Pure decision: is this a format we accept? Kept separate from the (async,
 * IO-touching) detection above so the actual accept/reject logic is a plain,
 * synchronous, trivially unit-testable function.
 */
export function checkFormat(detected: DetectedFormat | null): RuleResult {
  if (!detected) {
    return { pass: false, reason: "Unrecognized or corrupt file format" };
  }
  if (!ALLOWED_MIME_TYPES.includes(detected.mime as AllowedMimeType)) {
    return { pass: false, reason: `Unsupported format: ${detected.mime} (only JPEG, PNG, HEIC are accepted)` };
  }
  return { pass: true };
}

export function isHeic(detected: DetectedFormat): boolean {
  return detected.mime === "image/heic" || detected.mime === "image/heif";
}
