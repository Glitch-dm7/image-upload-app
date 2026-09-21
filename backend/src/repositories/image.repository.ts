import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Database } from "../db/types.js";
import { images, type Image } from "../db/schema.js";

export interface NewAcceptedImage {
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  phash: string;
  faceCount: number;
  blurScore: number;
}

export interface ListParams {
  status?: Image["status"];
  limit: number;
  cursor?: string;
}

export interface ListResult {
  items: Image[];
  nextCursor: string | null;
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

export type ImageRepository = ReturnType<typeof createImageRepository>;

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
  }
}

/**
 * All Drizzle access lives here. Every method other than `list` is a plain
 * CRUD operation; `list`'s cursor pagination is the one bit of real logic,
 * kept in one place so the controller/service never touch `and`/`or`/`lt`
 * directly.
 */
export function createImageRepository(db: Database) {
  return {
    /**
     * The only insert path in the app. Always writes `status: "accepted"` -
     * rejected uploads are never persisted (see services/image.service.ts),
     * so there's no "pending" row to create and later update.
     */
    async insertAccepted(data: NewAcceptedImage): Promise<Image> {
      const [row] = await db
        .insert(images)
        .values({ ...data, status: "accepted", rejectionReasons: [] })
        .returning();
      return row!;
    },

    async findById(id: string): Promise<Image | null> {
      const [row] = await db.select().from(images).where(eq(images.id, id)).limit(1);
      return row ?? null;
    },

    async list({ status, limit, cursor }: ListParams): Promise<ListResult> {
      const conditions = [];
      if (status) conditions.push(eq(images.status, status));

      const decodedCursor = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decodedCursor) {
        throw new InvalidCursorError();
      }
      if (decodedCursor) {
        // Cursor pagination (not offset): stable under concurrent inserts
        // and avoids Postgres re-scanning + discarding `OFFSET n` rows on
        // every page. (createdAt, id) as a composite key breaks ties
        // between rows with an identical createdAt timestamp.
        conditions.push(
          or(lt(images.createdAt, decodedCursor.createdAt), and(eq(images.createdAt, decodedCursor.createdAt), lt(images.id, decodedCursor.id))),
        );
      }

      const rows = await db
        .select()
        .from(images)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(images.createdAt), desc(images.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;

      return { items: page, nextCursor };
    },

    async deleteById(id: string): Promise<Image | null> {
      const [row] = await db.delete(images).where(eq(images.id, id)).returning();
      return row ?? null;
    },

    /** pHashes of every currently-accepted image, for the similarity check. */
    async getAcceptedPhashes(): Promise<string[]> {
      const rows = await db.select({ phash: images.phash }).from(images).where(eq(images.status, "accepted"));
      return rows.map((r) => r.phash).filter((h): h is string => h !== null);
    },
  };
}
