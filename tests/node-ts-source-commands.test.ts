import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("tracked TypeScript command hook", () => {
  test("wires DB source commands through the tracked node --import hook", () => {
    const dbPackageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages/db/package.json"), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    const webPackageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "apps/web/package.json"), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(dbPackageJson.scripts?.["candidate:basic-country"]).toBe(
      "node --import ../../scripts/node-ts-source-hook.mjs src/cli/candidate-basic-country.ts",
    );
    expect(dbPackageJson.scripts?.["preflight:basic-activation"]).toBe(
      "node --import ../../scripts/node-ts-source-hook.mjs src/seed/basic-country-activation-preflight-cli.ts",
    );
    expect(dbPackageJson.scripts?.["seed:approved-basic-country"]).toBe(
      "node --experimental-transform-types --import ../../scripts/node-ts-source-hook.mjs src/seed/approved-basic-country-import.ts",
    );
    expect(
      dbPackageJson.scripts?.["validate:approved-basic-publications"],
    ).toBe(
      "node --experimental-transform-types --import ../../scripts/node-ts-source-hook.mjs src/seed/approved-basic-publications-validation.ts",
    );
    expect(webPackageJson.scripts?.prebuild).toBe(
      "pnpm --filter @navigator/db validate:approved-basic-publications",
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

  test("runs the approved Basic publication import command", () => {
    const result = runPnpm([
      "--filter",
      "@navigator/db",
      "seed:approved-basic-country",
      "--",
      "indonesia",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"coverageLevel": "BASIC"');
    expect(result.stdout).toContain('"aiEligibleKnowledgeIds": []');
    expect(result.stdout).not.toContain("id_pol_001");
    expect(result.stdout).not.toContain("id_know_001");
  }, 30_000);

  test("validates all approved Basic publications through the build gate", () => {
    const result = runPnpm([
      "--filter",
      "@navigator/db",
      "validate:approved-basic-publications",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      '{"countryDirectories":["indonesia"],"countryCodes":["ID"]}',
    );
  }, 30_000);
});

function runPnpm(args: readonly string[]) {
  return spawnSync("pnpm", args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/navigator",
    },
    encoding: "utf8",
  });
}
