import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../../src/db/schema.js";

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "db", "migrations");

/**
 * Integration tests run against PGlite (an embedded, in-memory Postgres
 * compiled to WASM) instead of a real Neon branch or a Dockerized Postgres.
 * We considered testcontainers per the spec, but this sandbox's Docker
 * daemon isn't reachable from WSL, and PGlite gives every test file its own
 * clean, disposable, real-Postgres-compatible database with zero external
 * dependency - it applies the exact same migration SQL that ships to Neon,
 * so it's exercising real schema/SQL, not a mock.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}
