import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "scripts/capture-benchmark-environment*.test.mjs",
      "scripts/collect-pg-connections*.test.mjs",
      "scripts/load-read-only*.test.mjs",
    ],
  },
});
