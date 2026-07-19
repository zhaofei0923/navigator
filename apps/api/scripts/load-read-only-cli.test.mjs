import assert from "node:assert/strict";
import {
  lstat, mkdir, mkdtemp, open as openFile, readFile, rm, symlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";

import {
  parseCliArguments,
  prepareArtifactPaths,
  readEnvironmentArtifact,
  resolveArtifactPaths,
  writeArtifactAtomic,
} from "./load-read-only-artifacts.mjs";
import { captureBenchmarkEnvironment } from "./capture-benchmark-environment.mjs";
import {
  createRepositoryFixture,
  fixtureCommandOutput,
} from "./capture-benchmark-environment-test-fixtures.mjs";

describe("load runner CLI boundary", () => {
  test("accepts each required argument once and rejects duplicates or omissions", () => {
    const valid = [
      "--base-url", "http://127.0.0.1:3100", "--metrics-url", "http://127.0.0.1:9464/metrics",
      "--scenario", "100k", "--output", "../../artifacts/platform-ops/100k.json",
    ];
    assert.deepEqual(parseCliArguments(valid), {
      baseUrl: "http://127.0.0.1:3100", metricsUrl: "http://127.0.0.1:9464/metrics",
      output: "../../artifacts/platform-ops/100k.json", scenario: "100k",
    });
    for (const invalid of [
      valid.slice(0, -2),
      [...valid.slice(0, 6), "--scenario", "100k"],
      [...valid.slice(0, -2), "--unknown", "value"],
    ]) assert.throws(() => parseCliArguments(invalid), { message: "LOAD_ARGUMENTS_INVALID" });
  });

  test("rejects unknown, missing, or unsafe environment fields", async () => {
    await withRepository(async ({ paths }) => {
      await prepareArtifactPaths(paths);
      const valid = benchmarkEnvironment();
      for (const invalid of [
        { ...valid, databaseUrl: "postgresql://secret" },
        { ...valid, versions: { node: "v24", prisma: "6.19.3" } },
        { ...valid, cpu: { ...valid.cpu, source: "cgroup\nsecret" } },
      ]) {
        await writeFile(paths.environmentPath, JSON.stringify(invalid));
        await assert.rejects(readEnvironmentArtifact(paths.environmentPath, "a".repeat(64)),
          { message: "LOAD_ENVIRONMENT_INVALID" });
      }
    });
  });

  test("accepts and safely projects the exact capture-script evidence", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const imageDigest = `sha256:${"e".repeat(64)}`;
    const imageId = `sha256:${"f".repeat(64)}`;
    await captureBenchmarkEnvironment({
      capacityResolver: () => ({
        cpuCapacityCores: 2, cpuCapacitySource: "cgroup-v2",
        memoryLimitBytes: 2_147_483_648, memoryLimitSource: "cgroup-v2",
      }),
      commandRunner: async (command, arguments_) => fixtureCommandOutput(command, arguments_, { imageDigest, imageId }),
      container: "navigator-platform-ops-1-postgres",
      cwd: fixture.repositoryRoot,
      output: "artifacts/platform-ops/environment.json",
      repositoryRoot: fixture.repositoryRoot,
      scenario: "apps/api/scripts/read-only-load-scenarios.json",
    });
    const raw = JSON.parse(await readFile(fixture.outputPath, "utf8"));
    const projected = await readEnvironmentArtifact(fixture.outputPath, raw.scenarioFileSha256);
    assert.equal(projected.gitSha, "d".repeat(40));
    assert.equal(projected.imageDigest, imageDigest);
    assert.equal(projected.configuration, undefined);
    assert.equal(projected.imageId, undefined);
  });
});

describe("load runner filesystem boundary", () => {
  test("rejects symlinked parent directories without touching their targets", async () => {
    await withRepository(async ({ repositoryRoot, paths }) => {
      const external = await mkdtemp(join(tmpdir(), "navigator-load-external-"));
      try {
        await symlink(external, resolve(repositoryRoot, "artifacts"));
        await assert.rejects(prepareArtifactPaths(paths), { message: "LOAD_OUTPUT_PATH_UNSAFE" });
        assert.deepEqual(await readDirectoryNames(external), []);
      } finally {
        await rm(external, { recursive: true, force: true });
      }
    }, { createArtifacts: false });

    await withRepository(async ({ repositoryRoot, paths }) => {
      const external = await mkdtemp(join(tmpdir(), "navigator-load-external-"));
      try {
        await symlink(external, resolve(repositoryRoot, "artifacts/platform-ops"));
        await assert.rejects(prepareArtifactPaths(paths), { message: "LOAD_OUTPUT_PATH_UNSAFE" });
        assert.deepEqual(await readDirectoryNames(external), []);
      } finally {
        await rm(external, { recursive: true, force: true });
      }
    });
  });

  test("rejects symlinked output and environment files", async () => {
    await withRepository(async ({ paths, repositoryRoot }) => {
      await prepareArtifactPaths(paths);
      const target = resolve(repositoryRoot, "outside.json");
      await writeFile(target, "unchanged");
      await symlink(target, paths.outputPath);
      await assert.rejects(prepareArtifactPaths(paths), { message: "LOAD_OUTPUT_PATH_UNSAFE" });
      assert.equal(await readFile(target, "utf8"), "unchanged");
    });
    await withRepository(async ({ paths, repositoryRoot }) => {
      await prepareArtifactPaths(paths);
      const target = resolve(repositoryRoot, "outside.json");
      await writeFile(target, JSON.stringify(benchmarkEnvironment()));
      await symlink(target, paths.environmentPath);
      await assert.rejects(readEnvironmentArtifact(paths.environmentPath, "a".repeat(64)),
        { message: "LOAD_ENVIRONMENT_PATH_UNSAFE" });
    });
  });

  test("writes atomically and cleans only temporary files it created", async () => {
    await withRepository(async ({ paths }) => {
      await prepareArtifactPaths(paths);
      await writeArtifactAtomic(paths.outputPath, { ok: true }, { temporaryToken: "safe-token" });
      assert.deepEqual(JSON.parse(await readFile(paths.outputPath, "utf8")), { ok: true });
      await assert.rejects(lstat(`${paths.outputPath}.safe-token.tmp`), { code: "ENOENT" });

      const preexisting = `${paths.outputPath}.occupied.tmp`;
      await writeFile(preexisting, "do-not-delete");
      await assert.rejects(writeArtifactAtomic(paths.outputPath, { ok: false }, { temporaryToken: "occupied" }),
        { message: "LOAD_ARTIFACT_WRITE_FAILED" });
      assert.equal(await readFile(preexisting, "utf8"), "do-not-delete");
    });
  });

  test("removes its temporary file when the atomic rename fails", async () => {
    await withRepository(async ({ paths }) => {
      await prepareArtifactPaths(paths);
      const temporaryPath = `${paths.outputPath}.rename-failure.tmp`;
      await assert.rejects(writeArtifactAtomic(paths.outputPath, { ok: true }, {
        rename: async () => { throw new Error("injected rename failure"); },
        temporaryToken: "rename-failure",
      }), { message: "LOAD_ARTIFACT_WRITE_FAILED" });
      await assert.rejects(lstat(temporaryPath), { code: "ENOENT" });
      await assert.rejects(lstat(paths.outputPath), { code: "ENOENT" });
    });
  });

  test("removes an owned temporary file when writing fails after exclusive open", async () => {
    await withRepository(async ({ paths }) => {
      await prepareArtifactPaths(paths);
      const temporaryPath = `${paths.outputPath}.write-failure.tmp`;
      await assert.rejects(writeArtifactAtomic(paths.outputPath, { ok: true }, {
        open: async (path, flags, mode) => {
          const handle = await openFile(path, flags, mode);
          return {
            close: handle.close.bind(handle),
            sync: handle.sync.bind(handle),
            writeFile: async () => { throw new Error("injected write failure"); },
          };
        },
        temporaryToken: "write-failure",
      }), { message: "LOAD_ARTIFACT_WRITE_FAILED" });
      await assert.rejects(lstat(temporaryPath), { code: "ENOENT" });
    });
  });
});

async function withRepository(work, options = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "navigator-load-repository-"));
  try {
    const cwd = resolve(repositoryRoot, "apps/api");
    await mkdir(cwd, { recursive: true });
    if (options.createArtifacts !== false) await mkdir(resolve(repositoryRoot, "artifacts"));
    const paths = resolveArtifactPaths("../../artifacts/platform-ops/100k.json", "100k", { cwd, repositoryRoot });
    await work({ cwd, paths, repositoryRoot });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

function benchmarkEnvironment() {
  return {
    configuration: fixedConfiguration(),
    cpu: { capacityCores: 2, source: "cgroup-v2" }, gitSha: "b".repeat(40),
    imageDigest: `sha256:${"c".repeat(64)}`,
    imageId: `sha256:${"d".repeat(64)}`,
    memory: { limitBytes: 1_000_000, source: "cgroup-v2" }, scenarioFileSha256: "a".repeat(64),
    schemaVersion: 1,
    versions: { node: "v24.18.0", postgres: "17.5", prisma: "6.19.3" },
  };
}

function fixedConfiguration() {
  return {
    aiShare: 0, apiPort: 3100, countryReadSource: "database", databaseConnectTimeoutSeconds: 5,
    databasePoolMax: 10, databasePort: 55434, databasePoolTimeoutSeconds: 5,
    healthReadyTimeoutMs: 1000, metricsPort: 9464, nodeEnvironment: "production",
    readCacheMaxEntries: 1000, readCacheStaleIfErrorSeconds: 300, readCacheTtlSeconds: 60,
    readRatio: 1, writeRatio: 0,
  };
}

async function readDirectoryNames(path) {
  const { readdir } = await import("node:fs/promises");
  return readdir(path);
}
