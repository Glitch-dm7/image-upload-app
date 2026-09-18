export interface RuleResult {
  pass: boolean;
  reason?: string;
}

export interface DecodedImage {
  /** EXIF-orientation-normalized, EXIF-stripped image buffer (JPEG or PNG). */
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
}
