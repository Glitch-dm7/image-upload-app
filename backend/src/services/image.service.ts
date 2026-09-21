import type { Image } from "../db/schema.js";
import type { ImageRepository, ListParams, ListResult } from "../repositories/image.repository.js";
import type { StorageClient } from "../storage/client.js";
import { generateStorageKey } from "../storage/keys.js";
import { runValidationPipeline, type PipelineResult } from "../validation/pipeline.js";

export interface ImageServiceDeps {
  repository: ImageRepository;
  storage: StorageClient;
}

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

export type SubmitResult = { accepted: true; image: Image } | { accepted: false; outcome: ValidationOutcome };

export class NotFoundError extends Error {}

function toOutcome(result: PipelineResult): ValidationOutcome {
  return {
    status: result.status,
    rejectionReasons: result.rejectionReasons,
    width: result.width,
    height: result.height,
    phash: result.phash,
    faceCount: result.faceCount,
    blurScore: result.blurScore,
    mimeType: result.mimeType,
  };
}

export type ImageService = ReturnType<typeof createImageService>;

/**
 * Business logic layer: orchestrates the validation pipeline
 * (validation/pipeline.ts, unchanged) against the repository and storage.
 * Nothing here talks to Drizzle or the S3 client directly.
 */
export function createImageService({ repository, storage }: ImageServiceDeps) {
  async function runPipeline(buffer: Buffer): Promise<PipelineResult> {
    return runValidationPipeline(buffer, { getExistingAcceptedHashes: () => repository.getAcceptedPhashes() });
  }

  return {
    /**
     * Read-only: runs the full pipeline and reports the verdict. Never
     * uploads anything or writes a row - rejected uploads are never
     * persisted, so there's nothing to do here but decide and report.
     */
    async validate(buffer: Buffer): Promise<ValidationOutcome> {
      return toOutcome(await runPipeline(buffer));
    },

    /**
     * Re-runs the full pipeline (never trusts a client-supplied "this was
     * already validated" claim - same principle as the magic-byte format
     * check). Only on acceptance does it upload the processed buffer to
     * its permanent storage key and insert the row; a rejection here
     * (e.g. a race with another just-accepted near-duplicate) persists
     * nothing.
     */
    async submit(buffer: Buffer, originalFilename: string): Promise<SubmitResult> {
      const result = await runPipeline(buffer);
      const outcome = toOutcome(result);

      if (result.status !== "accepted" || !result.processedBuffer || !result.mimeType || result.width === null || result.height === null) {
        return { accepted: false, outcome };
      }

      const storageKey = generateStorageKey(result.mimeType);
      await storage.upload(storageKey, result.processedBuffer, result.mimeType);
      const image = await repository.insertAccepted({
        originalFilename,
        storageKey,
        mimeType: result.mimeType,
        fileSizeBytes: buffer.length,
        width: result.width,
        height: result.height,
        phash: result.phash ?? "",
        faceCount: result.faceCount ?? 0,
        blurScore: result.blurScore ?? 0,
      });
      return { accepted: true, image };
    },

    async getById(id: string): Promise<Image> {
      const image = await repository.findById(id);
      if (!image) throw new NotFoundError();
      return image;
    },

    async list(params: ListParams): Promise<ListResult> {
      return repository.list(params);
    },

    async remove(id: string): Promise<void> {
      const image = await repository.deleteById(id);
      if (!image) throw new NotFoundError();
      if (image.storageKey) {
        await storage.delete(image.storageKey).catch(() => undefined);
      }
    },

    async getFileUrl(id: string): Promise<string> {
      const image = await repository.findById(id);
      if (!image || !image.storageKey) throw new NotFoundError();
      return storage.getSignedDownloadUrl(image.storageKey);
    },
  };
}
