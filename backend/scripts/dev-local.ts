// Runs the full API locally against PGlite (embedded Postgres) and an
// in-memory storage client instead of real Neon/Supabase - so the app can be
// tried end-to-end (including the real validation pipeline: sharp, HEIC
// conversion, face-api, phash) without creating any external accounts or
// setting any env vars. Not how the deployed app runs (see src/index.ts) -
// this is a convenience for local review/demoing only.
import { serve } from "@hono/node-server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import * as schema from "../src/db/schema.js";
import type { StorageClient } from "../src/storage/client.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function createInMemoryStorage(): StorageClient {
  const objects = new Map<string, Buffer>();
  return {
    async upload(key, body) {
      objects.set(key, body);
    },
    async getSignedDownloadUrl(key) {
      // No real bucket - serve straight from this same process instead of a
      // signed cloud URL.
      return `http://localhost:${PORT}/dev/objects/${encodeURIComponent(key)}`;
    },
    async delete(key) {
      objects.delete(key);
    },
    // Exposed for the dev-only file route below; not part of the StorageClient interface.
    _objects: objects,
  } as StorageClient & { _objects: Map<string, Buffer> };
}

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(dirname, "..", "src", "db", "migrations") });

  const storage = createInMemoryStorage() as StorageClient & { _objects: Map<string, Buffer> };
  const app = createApp({ db, storage, maxUploadSizeBytes: 10 * 1024 * 1024, corsOrigin: "*" });

  app.get("/dev/objects/:key{.+}", (c) => {
    const key = c.req.param("key");
    const body = storage._objects.get(key);
    if (!body) return c.body("Not found", 404);
    return c.body(new Uint8Array(body));
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Local dev backend (PGlite + in-memory storage) on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
