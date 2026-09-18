import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getDb } from "./db/client.js";
import { createS3StorageClient } from "./storage/client.js";
import { loadEnv } from "./config.js";

const env = loadEnv();
const app = createApp({ db: getDb(), storage: createS3StorageClient() });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Backend listening on http://localhost:${info.port}`);
});
