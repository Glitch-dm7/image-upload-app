import type { Context } from "hono";
import type { Image } from "../db/schema.js";
import { InvalidCursorError } from "../repositories/image.repository.js";
import type { ImageService } from "../services/image.service.js";
import { NotFoundError } from "../services/image.service.js";

export interface ImagesControllerDeps {
  service: ImageService;
  maxUploadSizeBytes: number;
}

function serializeImage(image: Image) {
  return {
    id: image.id,
    originalFilename: image.originalFilename,
    mimeType: image.mimeType,
    fileSizeBytes: image.fileSizeBytes,
    width: image.width,
    height: image.height,
    status: image.status,
    rejectionReasons: image.rejectionReasons ?? [],
    phash: image.phash,
    faceCount: image.faceCount,
    blurScore: image.blurScore,
    createdAt: image.createdAt.toISOString(),
    updatedAt: image.updatedAt.toISOString(),
  };
}

type ParsedUpload = { file: File; buffer: Buffer } | { error: { message: string; status: 400 | 413 } };

/**
 * Shared by validate and submit: pull the "file" field out of the
 * multipart body, enforce the size cap independently of whatever the
 * frontend already checked, and hand back the raw bytes.
 */
async function parseUpload(c: Context, maxUploadSizeBytes: number): Promise<ParsedUpload> {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return { error: { message: "Expected multipart/form-data with a 'file' field", status: 400 } };
  }
  if (file.size > maxUploadSizeBytes) {
    return { error: { message: `File exceeds the ${maxUploadSizeBytes} byte upload limit`, status: 413 } };
  }
  return { file, buffer: Buffer.from(await file.arrayBuffer()) };
}

/**
 * HTTP layer: parses the request, calls the service, shapes the response.
 * No Drizzle, no S3 client, no validation-pipeline logic lives here.
 */
export function createImagesController({ service, maxUploadSizeBytes }: ImagesControllerDeps) {
  return {
    async validateUpload(c: Context) {
      const parsed = await parseUpload(c, maxUploadSizeBytes);
      if ("error" in parsed) return c.json({ error: parsed.error.message }, parsed.error.status);

      const outcome = await service.validate(parsed.buffer);
      // Both accepted and rejected are normal outcomes here, not request
      // errors - a rejected image is exactly what the Rejected section is
      // for, not something to surface as an HTTP error.
      return c.json(outcome, 200);
    },

    async submitUpload(c: Context) {
      const parsed = await parseUpload(c, maxUploadSizeBytes);
      if ("error" in parsed) return c.json({ error: parsed.error.message }, parsed.error.status);

      const result = await service.submit(parsed.buffer, parsed.file.name);
      if (result.accepted) {
        return c.json(serializeImage(result.image), 201);
      }
      // Re-validation rejected it (e.g. a race with a just-accepted
      // near-duplicate) - report it the same way /validate would, nothing
      // was persisted.
      return c.json(result.outcome, 200);
    },

    async getImage(c: Context) {
      try {
        const image = await service.getById(c.req.param("id")!);
        return c.json(serializeImage(image));
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: "Not found" }, 404);
        throw err;
      }
    },

    async listImages(c: Context) {
      const status = c.req.query("status");
      if (status && !["pending", "accepted", "rejected"].includes(status)) {
        return c.json({ error: "Invalid status filter" }, 400);
      }
      const limitParam = Number(c.req.query("limit") ?? "20");
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
      const cursor = c.req.query("cursor");

      try {
        const result = await service.list({ status: status as Image["status"] | undefined, limit, cursor });
        return c.json({ items: result.items.map(serializeImage), nextCursor: result.nextCursor });
      } catch (err) {
        if (err instanceof InvalidCursorError) return c.json({ error: "Invalid cursor" }, 400);
        throw err;
      }
    },

    async deleteImage(c: Context) {
      try {
        await service.remove(c.req.param("id")!);
        return c.body(null, 204);
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: "Not found" }, 404);
        throw err;
      }
    },

    async getImageFile(c: Context) {
      try {
        const url = await service.getFileUrl(c.req.param("id")!);
        // Private bucket: never expose a public bucket URL. Redirect to a
        // short-lived signed URL instead of proxying bytes through this server.
        return c.redirect(url, 302);
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: "Not found" }, 404);
        throw err;
      }
    },
  };
}
