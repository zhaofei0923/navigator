import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readRootFile = (filePath: string) =>
  readFileSync(join(process.cwd(), filePath), "utf8");

const getRunCommands = (workflow: string) =>
  [...workflow.matchAll(/^\s+run:\s+(.+)$/gm)].map((match) => match[1]);

describe("P0-4 CI gates", () => {
  it("runs the required local gates in GitHub Actions", () => {
    const workflow = readRootFile(".github/workflows/ci.yml");
    const runCommands = getRunCommands(workflow);

    expect(workflow).toContain("pull_request:");
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s+main/);
    expect(runCommands).toEqual(
      expect.arrayContaining([
        "pnpm install --frozen-lockfile",
        "pnpm --filter @navigator/db validate:approved-basic-publications",
        "pnpm lint",
        "pnpm typecheck",
        "pnpm test",
        "pnpm test:e2e",
      ]),
    );
  });

  it("routes Playwright through the controlled full-stack orchestrator", () => {
    const packageJson = JSON.parse(readRootFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readRootFile(".github/workflows/ci.yml");
    const playwrightConfig = readRootFile("playwright.config.ts");

    expect(packageJson.scripts?.["test:e2e"]).toBe(
      "node scripts/run-platform-e2e.mjs",
    );
    expect(playwrightConfig).not.toContain("webServer:");
    expect(playwrightConfig).toContain("E2E_SERVERS_MANAGED");
    expect(playwrightConfig).toContain("pnpm test:e2e");
    expect(workflow).toContain(
      "API_INTERNAL_BASE_URL: http://127.0.0.1:9/api/v1",
    );
    expect(workflow).toContain(
      "DATABASE_URL: postgresql://navigator_test:navigator_test_only@127.0.0.1:5432/navigator_platform_db_1_test",
    );
  });

  it("keeps the platform orchestrator safety suite in the mandatory root test gate", () => {
    const packageJson = JSON.parse(readRootFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.test).toBe(
      "node --test scripts/run-platform-e2e.test.mjs && vitest run tests && turbo run test",
    );
  });
});
