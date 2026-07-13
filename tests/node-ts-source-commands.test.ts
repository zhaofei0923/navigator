import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath =
  "/home/kevin/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:/bin";

describe("tracked TypeScript command hook", () => {
  test("wires both DB source commands through the tracked node --import hook", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages/db/package.json"), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(packageJson.scripts?.["candidate:basic-country"]).toBe(
      "node --import ../../scripts/node-ts-source-hook.mjs src/cli/candidate-basic-country.ts",
    );
    expect(packageJson.scripts?.["preflight:basic-activation"]).toBe(
      "node --import ../../scripts/node-ts-source-hook.mjs src/seed/basic-country-activation-preflight-cli.ts",
    );
  });

  test("runs candidate help through the root package command", () => {
    const result = runPnpm(["candidate:basic-country", "--", "--help"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Usage: pnpm candidate:basic-country -- .cache/basic-country/<ISO2>/<runId>/candidate-config.json",
    );
  }, 30_000);

  test("runs preflight help without a datastore command", () => {
    const result = runPnpm([
      "--filter",
      "@navigator/db",
      "run",
      "preflight:basic-activation",
      "--",
      "--help",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Usage: pnpm --filter @navigator/db run preflight:basic-activation -- ID",
    );
  }, 30_000);
});

function runPnpm(args: readonly string[]) {
  return spawnSync("pnpm", args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: runtimePath,
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/navigator",
    },
    encoding: "utf8",
  });
}
