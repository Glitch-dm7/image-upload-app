import { createApp, type AppDeps } from "../../src/app.js";
import { createTestDb } from "./testDb.js";
import { createFakeStorage } from "./fakeStorage.js";

export async function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const { db, close } = await createTestDb();
  const storage = overrides.storage ?? createFakeStorage();

  const app = createApp({
    db,
    storage,
    maxUploadSizeBytes: 10 * 1024 * 1024,
    corsOrigin: "*",
    ...overrides,
  });

  return { app, db, storage, close };
}
