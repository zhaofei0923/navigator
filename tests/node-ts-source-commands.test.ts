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
    expect(
      dbPackageJson.scripts?.["import:approved-basic-publications"],
    ).toBe(
      "node --experimental-transform-types --import ../../scripts/node-ts-source-hook.mjs src/seed/approved-basic-countries-prisma-import-cli.ts",
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

  test("runs the approved Basic publication import command for every published country", () => {
    for (const countryDirectory of [
      "brazil",
      "indonesia",
      "saudi-arabia",
      "south-africa",
      "united-arab-emirates",
      "vietnam",
    ]) {
      const result = runPnpm([
        "--filter",
        "@navigator/db",
        "seed:approved-basic-country",
        "--",
        countryDirectory,
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('"coverageLevel": "BASIC"');
      expect(result.stdout).toContain('"aiEligibleKnowledgeIds": []');
      expect(result.stdout).not.toMatch(
        /"model": "(?:policy|risk|opportunity|project|partner|chineseCompany|knowledgeChunk)"/,
      );
    }
  }, 30_000);

  test("validates all approved Basic publications through the build gate", () => {
    const result = runPnpm([
      "--filter",
      "@navigator/db",
      "validate:approved-basic-publications",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      '{"countryDirectories":["brazil","indonesia","saudi-arabia","south-africa","united-arab-emirates","vietnam"],"countryCodes":["BR","ID","SA","ZA","AE","VN"]}',
    );
  }, 30_000);

  test("launches the TypeScript all-country import CLI with an injected fake client", () => {
    const cliModule = "./packages/db/src/seed/approved-basic-countries-prisma-import-cli.ts";
    const childSource = `
      import { runApprovedBasicCountriesPrismaImportCli } from ${JSON.stringify(cliModule)};
      const emptyCount = () => ({ count: async () => 0 });
      const client = {
        async $transaction(run) {
          let country = null;
          const coverages = new Map();
          let marketOverview = null;
          const transaction = {
            country: {
              async upsert(args) { country = args.create; return country; },
              async findUnique() {
                return country === null ? null : {
                  ...country,
                  moduleCoverage: [...coverages.values()].reverse(),
                  marketOverview,
                  policies: [], risks: [], opportunities: [], projects: [], partners: [],
                  chineseCompanies: [], entryStrategy: null, reports: [], knowledgeChunks: [],
                };
              },
            },
            moduleCoverage: {
              async upsert(args) {
                coverages.set(String(args.create.moduleKey), args.create);
                return args.create;
              },
            },
            marketOverview: {
              ...emptyCount(),
              async upsert(args) { marketOverview = args.create; return marketOverview; },
            },
            policy: emptyCount(), risk: emptyCount(), opportunity: emptyCount(),
            project: emptyCount(), partner: emptyCount(), chineseCompany: emptyCount(),
            entryStrategy: emptyCount(), report: emptyCount(), knowledgeChunk: emptyCount(),
          };
          return run(transaction);
        },
        async $disconnect() {},
      };
      const status = await runApprovedBasicCountriesPrismaImportCli([], {
        repoRoot: process.cwd(),
        createClient: () => client,
        stdout: (line) => process.stdout.write(line),
        stderr: (line) => process.stderr.write(line),
      });
      process.exitCode = status;
    `;
    const result = spawnSync("node", [
      "--experimental-transform-types",
      "--import",
      resolve(repositoryRoot, "scripts/node-ts-source-hook.mjs"),
      "--input-type=module",
      "--eval",
      childSource,
    ], {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      '{"status":"ok","countryCount":6,"operationCount":72}\n',
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
