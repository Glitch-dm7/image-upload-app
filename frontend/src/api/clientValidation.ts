// UX-only pre-check: lets us reject an obviously-wrong file instantly,
// without a round trip. The server re-validates via real magic bytes
// regardless (see backend/src/validation/format.ts) - this is never trusted.
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];

export function isClientAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  // Some browsers report an empty `type` for HEIC files, so extension alone
  // is enough there; when a type IS reported, it must also be plausible.
  const hasPlausibleMime = file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  return hasAllowedExtension && hasPlausibleMime;
}
