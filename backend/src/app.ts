import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "./db/types.js";
import { images, type Image } from "./db/schema.js";
import type { StorageClient } from "./storage/client.js";
import { generateStorageKey } from "./storage/keys.js";
import { detectFormat, checkFormat } from "./validation/format.js";
import { processUpload } from "./jobs/processUpload.js";
import { loadEnv } from "./config.js";

export interface AppDeps {
  db: Database;
  storage: StorageClient;
  maxUploadSizeBytes?: number;
  corsOrigin?: string;
  /**
   * Called with the fire-and-forget background job's promise, purely as an
   * observation hook - the request handler never awaits it. Production
   * leaves this unset; integration tests use it to `await` the same
   * validation run the request just kicked off instead of polling on a
   * timer (tests shouldn't sleep).
   */
  onBackgroundJob?: (job: Promise<void>) => void;
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

function encodeCursor(image: Pick<Image, "createdAt" | "id">): string {
  return Buffer.from(JSON.stringify({ createdAt: image.createdAt.toISOString(), id: image.id })).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    return null;
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const maxUploadSizeBytes = deps.maxUploadSizeBytes ?? loadEnv().MAX_UPLOAD_SIZE_BYTES;
  app.use("*", cors({ origin: deps.corsOrigin ?? loadEnv().FRONTEND_ORIGIN }));

  app.post("/images", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "Expected multipart/form-data with a 'file' field" }, 400);
    }

    // Server-side size cap, enforced independently of whatever the frontend
    // already checked - the client is never trusted.
    if (file.size > maxUploadSizeBytes) {
      return c.json({ error: `File exceeds the ${maxUploadSizeBytes} byte upload limit` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Magic-byte format check happens synchronously, before we create any
    // DB row or upload anything - an unsupported/unrecognized format is a
    // plain request error, not a "pending -> rejected" pipeline outcome.
    const detected = await detectFormat(buffer);
    const formatResult = checkFormat(detected);
    if (!formatResult.pass) {
      return c.json({ error: formatResult.reason }, 400);
    }

    const id = uuidv4();
    const stagingKey = `staging/${generateStorageKey(detected!.mime)}`;
    await deps.storage.upload(stagingKey, buffer, detected!.mime);

    await deps.db.insert(images).values({
      id,
      originalFilename: file.name,
      storageKey: null,
      mimeType: detected!.mime,
      fileSizeBytes: buffer.length,
      status: "pending",
    });

    // Fire-and-forget: the request must return immediately (202) without
    // waiting for the (potentially slow) validation pipeline to finish.
    const job = processUpload(id, stagingKey, buffer, deps);
    deps.onBackgroundJob?.(job);

    return c.json({ id, status: "pending" }, 202);
  });

  app.get("/images/:id", async (c) => {
    const id = c.req.param("id");
    const [image] = await deps.db.select().from(images).where(eq(images.id, id)).limit(1);
    if (!image) return c.json({ error: "Not found" }, 404);
    return c.json(serializeImage(image));
  });

  app.get("/images", async (c) => {
    const status = c.req.query("status");
    const limitParam = Number(c.req.query("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
    const cursorParam = c.req.query("cursor");

    if (status && !["pending", "accepted", "rejected"].includes(status)) {
      return c.json({ error: "Invalid status filter" }, 400);
    }

    const conditions = [];
    if (status) conditions.push(eq(images.status, status as "pending" | "accepted" | "rejected"));

    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return c.json({ error: "Invalid cursor" }, 400);
    }
    if (cursor) {
      // Cursor pagination (not offset): stable under concurrent inserts and
      // avoids Postgres re-scanning + discarding `OFFSET n` rows on every
      // page. (createdAt, id) as a composite key breaks ties between rows
      // with an identical createdAt timestamp.
      conditions.push(or(lt(images.createdAt, cursor.createdAt), and(eq(images.createdAt, cursor.createdAt), lt(images.id, cursor.id))));
    }

    const rows = await deps.db
      .select()
      .from(images)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(images.createdAt), desc(images.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;

    return c.json({ items: page.map(serializeImage), nextCursor });
  });

  app.delete("/images/:id", async (c) => {
    const id = c.req.param("id");
    const [image] = await deps.db.select().from(images).where(eq(images.id, id)).limit(1);
    if (!image) return c.json({ error: "Not found" }, 404);

    if (image.storageKey) {
      await deps.storage.delete(image.storageKey).catch(() => undefined);
    }
    await deps.db.delete(images).where(eq(images.id, id));
    return c.body(null, 204);
  });

  app.get("/images/:id/file", async (c) => {
    const id = c.req.param("id");
    const [image] = await deps.db.select().from(images).where(eq(images.id, id)).limit(1);
    if (!image || !image.storageKey) return c.json({ error: "Not found" }, 404);

    // Private bucket: never expose a public bucket URL. Redirect to a
    // short-lived signed URL instead of proxying bytes through this server.
    const url = await deps.storage.getSignedDownloadUrl(image.storageKey);
    return c.redirect(url, 302);
  });

  return app;
}
