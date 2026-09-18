import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv } from "../config.js";

// Resolved relative to this file (not process.cwd()) so `npm run db:migrate`
// works the same whether it's invoked from the repo root, from inside
// backend/, or as compiled dist/db/migrate.js.
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  const env = loadEnv();
  console.log(`Applying migrations from ${migrationsFolder} to ${maskPassword(env.DATABASE_URL)}`);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("Migrations applied.");
}

function maskPassword(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
