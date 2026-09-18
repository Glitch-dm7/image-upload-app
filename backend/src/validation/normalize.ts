import sharp from "sharp";
import type { DecodedImage } from "./types.js";

/**
 * Auto-rotates pixels to match EXIF orientation (so width/height reflect how
 * the image actually looks, not the raw sensor orientation) and re-encodes
 * without metadata, which strips EXIF as a side effect. This must happen
 * before the resolution check — otherwise a portrait photo tagged as
 * landscape via EXIF orientation could pass a dimension check it should fail
 * (or vice versa).
 */
export async function normalizeImage(buffer: Buffer): Promise<DecodedImage> {
  const rotated = sharp(buffer).rotate();
  const metadata = await rotated.metadata();
  const isPng = metadata.format === "png";
  const output = isPng ? await rotated.png().toBuffer() : await rotated.jpeg({ quality: 92 }).toBuffer();
  const finalMetadata = await sharp(output).metadata();

  return {
    buffer: output,
    width: finalMetadata.width ?? 0,
    height: finalMetadata.height ?? 0,
    mimeType: isPng ? "image/png" : "image/jpeg",
  };
}
