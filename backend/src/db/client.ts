import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "../config.js";
import * as schema from "./schema.js";
import type { Database } from "./types.js";

export type { Database };

let pool: Pool | undefined;
let db: Database | undefined;

// Real Postgres connection (Neon, Supabase, or any other Postgres) used by
// the running server. Integration tests use a separate in-memory driver —
// see test/helpers/testDb.ts — so this module is never imported from tests.
export function getDb(): Database {
  if (!db) {
    const env = loadEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
