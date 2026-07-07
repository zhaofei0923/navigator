import { defineConfig, devices } from "@playwright/test";

for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
  delete process.env[key];
}

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY]
  .filter((value): value is string => value !== undefined && value !== "")
  .join(",");
process.env.no_proxy = process.env.NO_PROXY;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @navigator/web dev --hostname 127.0.0.1 --port 3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000/en",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
