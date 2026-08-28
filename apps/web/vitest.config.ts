import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test-support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["components/**/*.tsx", "lib/**/*.ts"],
      exclude: [
        "**/*.test.*",
        "lib/demo-session.ts",
        "lib/basic60/api.ts",
        "lib/basic60/session.ts",
      ],
    },
  },
});
