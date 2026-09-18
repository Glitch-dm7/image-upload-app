import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Loading the face-api WASM backend + model weights on first use can be
    // slow in CI; give those tests room instead of flaking on a tight default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
