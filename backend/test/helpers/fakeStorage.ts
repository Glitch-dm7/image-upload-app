import type { StorageClient } from "../../src/storage/client.js";

/** In-memory stand-in for Supabase Storage — integration tests never hit the real bucket. */
export function createFakeStorage(): StorageClient & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    async upload(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async getSignedDownloadUrl(key) {
      if (!objects.has(key)) throw new Error(`No such object: ${key}`);
      return `https://fake-storage.test/${key}?signature=fake`;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
