import { createApp, type AppDeps } from "../../src/app.js";
import { createTestDb } from "./testDb.js";
import { createFakeStorage } from "./fakeStorage.js";

export async function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const { db, close } = await createTestDb();
  const storage = overrides.storage ?? createFakeStorage();
  const jobs: Promise<void>[] = [];

  const app = createApp({
    db,
    storage,
    maxUploadSizeBytes: 10 * 1024 * 1024,
    corsOrigin: "*",
    onBackgroundJob: (job) => jobs.push(job),
    ...overrides,
  });

  return {
    app,
    db,
    storage,
    /** Wait for every upload's background validation job fired so far to settle. */
    flushBackgroundJobs: () => Promise.all(jobs),
    close,
  };
}
