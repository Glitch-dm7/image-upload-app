import { eq } from "drizzle-orm";
import type { Database } from "../db/types.js";
import { images } from "../db/schema.js";
import type { StorageClient } from "../storage/client.js";
import { generateStorageKey } from "../storage/keys.js";
import { runValidationPipeline } from "../validation/pipeline.js";

export interface ProcessUploadDeps {
  db: Database;
  storage: StorageClient;
}

/**
 * The actual background job body. The HTTP route fires this without
 * awaiting it (see routes/images.ts) — a real production system would hand
 * this off to a durable job queue (Redis/BullMQ/SQS) instead of an
 * in-process async function, so an in-flight job isn't silently lost on a
 * server restart/redeploy. That's an explicit, documented tradeoff for this
 * project (see README) to avoid a second always-on service on free hosting
 * tiers. Exported standalone (not inlined in the route handler) so
 * integration tests can `await` it directly instead of polling on a timer.
 */
export async function processUpload(imageId: string, stagingKey: string, rawBuffer: Buffer, deps: ProcessUploadDeps): Promise<void> {
  try {
    const result = await runValidationPipeline(rawBuffer, {
      getExistingAcceptedHashes: async () => {
        const rows = await deps.db.select({ phash: images.phash }).from(images).where(eq(images.status, "accepted"));
        return rows.map((r) => r.phash).filter((h): h is string => h !== null);
      },
    });

    let finalStorageKey: string | null = null;
    if (result.status === "accepted" && result.processedBuffer && result.mimeType) {
      finalStorageKey = generateStorageKey(result.mimeType);
      await deps.storage.upload(finalStorageKey, result.processedBuffer, result.mimeType);
    }

    // Reject or accept, we're done with the staging copy of the original
    // upload: on accept the (possibly HEIC->JPEG converted) processed file
    // lives under its own permanent key; on reject we delete rather than
    // keep rejected originals around, to avoid unbounded storage growth on
    // a free-tier bucket. A product that wants to let users see/download
    // their rejected upload would keep it instead.
    await deps.storage.delete(stagingKey).catch(() => undefined);

    await deps.db
      .update(images)
      .set({
        status: result.status,
        rejectionReasons: result.rejectionReasons,
        storageKey: finalStorageKey,
        mimeType: result.mimeType ?? undefined,
        width: result.width,
        height: result.height,
        phash: result.phash,
        faceCount: result.faceCount,
        blurScore: result.blurScore,
        updatedAt: new Date(),
      })
      .where(eq(images.id, imageId));
  } catch (err) {
    // Never leave a row stuck in "pending" forever if something in the
    // pipeline throws unexpectedly (e.g. a transient storage error).
    console.error(`Validation pipeline failed for image ${imageId}:`, err);
    await deps.db
      .update(images)
      .set({
        status: "rejected",
        rejectionReasons: ["Internal error while processing this image"],
        updatedAt: new Date(),
      })
      .where(eq(images.id, imageId));
  }
}
