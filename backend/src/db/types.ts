import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

// Driver-agnostic Drizzle database type: the real server uses node-postgres
// (see client.ts), while integration tests use PGlite (see
// test/helpers/testDb.ts). Both satisfy this shape, so app.ts and the job
// module can depend on it without caring which driver is behind it.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
