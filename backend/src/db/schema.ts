import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, real, pgEnum, index } from "drizzle-orm/pg-core";

export const imageStatusEnum = pgEnum("image_status", ["pending", "accepted", "rejected"]);

export const images = pgTable(
  "images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originalFilename: text("original_filename").notNull(),
    storageKey: text("storage_key"), // null until finalized
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    status: imageStatusEnum("status").notNull().default("pending"),
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>().default([]),
    phash: text("phash"),
    faceCount: integer("face_count"),
    blurScore: real("blur_score"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Exact/prefix lookups only. At real scale, comparing a new pHash against
    // every accepted row (see validation/similarity.ts) is O(n) — this index
    // doesn't fix that, it just keeps status/phash filtering itself cheap.
    // A real implementation would bucket hashes (LSH) or use a vector index.
    index("images_phash_idx").on(table.phash),
    index("images_status_idx").on(table.status),
  ],
);

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
