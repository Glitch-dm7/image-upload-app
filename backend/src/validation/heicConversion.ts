import convert from "heic-convert";

/**
 * Converts a HEIC/HEIF buffer to JPEG. Everything downstream in the pipeline
 * (resolution/blur/face/similarity checks, and the final stored file on
 * accept) operates on this converted buffer, never the original HEIC bytes.
 */
export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const output = await convert({ buffer, format: "JPEG", quality: 0.92 });
  return Buffer.from(output);
}
