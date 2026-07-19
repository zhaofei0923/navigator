import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const modulePath = resolve(scriptDirectory, "capture-benchmark-environment.mjs");
export const SCENARIO_RAW = `${JSON.stringify({
  "100k": {
    targetRps: 6,
    maxConcurrency: 16,
    warmupSeconds: 120,
    measurementSeconds: 600,
  },
  "1m": {
    targetRps: 56,
    maxConcurrency: 128,
    warmupSeconds: 120,
    measurementSeconds: 600,
  },
  "10m": {
    targetRps: 556,
    maxConcurrency: 1024,
    warmupSeconds: 120,
    measurementSeconds: 600,
  },
}, null, 2)}\n`;

export async function createRepositoryFixture(testContext) {
  const temporaryRoot = process.platform === "linux" ? "/tmp" : tmpdir();
  const repositoryRoot = await mkdtemp(join(temporaryRoot, "navigator-env-capture-"));
  testContext.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const scenarioPath = resolve(repositoryRoot, "apps/api/scripts/read-only-load-scenarios.json");
  const outputPath = resolve(repositoryRoot, "artifacts/platform-ops/environment.json");
  await mkdir(dirname(scenarioPath), { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(resolve(repositoryRoot, "packages/db"), { recursive: true });
  await writeFile(scenarioPath, SCENARIO_RAW, "utf8");
  return { outputPath, repositoryRoot, scenarioPath, scenarioRaw: SCENARIO_RAW };
}

export function fixtureCommandOutput(command, arguments_, { imageDigest, imageId }) {
  const signature = `${command} ${arguments_.join(" ")}`;
  if (signature === "git rev-parse HEAD") return `${"d".repeat(40)}\n`;
  if (signature === "node --version") return "v24.18.0\n";
  if (signature === "pnpm exec prisma --version") {
    return "prisma                  : 6.19.3\n@prisma/client          : 6.19.3\n";
  }
  if (signature.includes("--type container")) return `${JSON.stringify(imageId)}\n`;
  if (signature.includes("--type image")) {
    return `${JSON.stringify([`pgvector/pgvector@${imageDigest}`])}\n`;
  }
  if (signature.includes("SHOW server_version;")) {
    return "17.5 (Debian 17.5-1.pgdg120+1)\n";
  }
  throw new Error(`unexpected fixture command: ${signature}`);
}

export function normalizeCalls(calls) {
  return calls.map(({ arguments_, command, options }) => [command, arguments_, options.cwd]);
}

export function safeCapacity() {
  return {
    cpuCapacityCores: 1,
    cpuCapacitySource: "safe-default",
    memoryLimitBytes: 1,
    memoryLimitSource: "safe-default",
  };
}

export function fixedCaptureOptions(fixture, overrides = {}) {
  return {
    capacityResolver: safeCapacity,
    commandRunner: async () => {
      throw new Error("COMMAND_MUST_NOT_RUN");
    },
    container: "navigator-platform-ops-1-postgres",
    cwd: fixture.repositoryRoot,
    output: "artifacts/platform-ops/environment.json",
    repositoryRoot: fixture.repositoryRoot,
    scenario: "apps/api/scripts/read-only-load-scenarios.json",
    ...overrides,
  };
}
