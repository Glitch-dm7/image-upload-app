import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "./db/types.js";
import type { StorageClient } from "./storage/client.js";
import { createImageRepository } from "./repositories/image.repository.js";
import { createImageService } from "./services/image.service.js";
import { createImagesRouter } from "./routes/images.routes.js";
import { loadEnv } from "./config.js";

export interface AppDeps {
  db: Database;
  storage: StorageClient;
  maxUploadSizeBytes?: number;
  corsOrigin?: string;
}

/**
 * Wires repository -> service -> controller -> router and mounts it. Any
 * actual request handling lives in routes/controllers/services/repositories
 * - this file is just composition.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: deps.corsOrigin ?? loadEnv().FRONTEND_ORIGIN }));

  const repository = createImageRepository(deps.db);
  const service = createImageService({ repository, storage: deps.storage });
  const maxUploadSizeBytes = deps.maxUploadSizeBytes ?? loadEnv().MAX_UPLOAD_SIZE_BYTES;

  app.route("/", createImagesRouter({ service, maxUploadSizeBytes }));

  return app;
}
