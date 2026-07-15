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

  it("runs the Playwright E2E gate after P2 adds browser flows", () => {
    const packageJson = JSON.parse(readRootFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:e2e"]).toBe("playwright test");
  });
});
