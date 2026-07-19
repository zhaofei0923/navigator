import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, test } from "node:test";

import {
  captureBenchmarkEnvironment,
  parseCliArguments,
} from "./capture-benchmark-environment.mjs";
import {
  createRepositoryFixture,
  fixtureCommandOutput,
  modulePath,
  normalizeCalls,
} from "./capture-benchmark-environment-test-fixtures.mjs";
import "./capture-benchmark-environment-security.test.mjs";

describe("benchmark environment evidence", () => {
  test("captures fixed, load-runner-compatible evidence with parameter-array commands", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const calls = [];
    const imageId = `sha256:${"a".repeat(64)}`;
    const imageDigest = `sha256:${"b".repeat(64)}`;
    const commandRunner = async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return fixtureCommandOutput(command, arguments_, { imageDigest, imageId });
    };
    const result = await captureBenchmarkEnvironment({
      capacityResolver: () => ({
        cpuCapacityCores: 2,
        cpuCapacitySource: "cgroup-v2",
        memoryLimitBytes: 2_147_483_648,
        memoryLimitSource: "cgroup-v2",
      }),
      commandRunner,
      container: "navigator-platform-ops-1-postgres",
      cwd: fixture.repositoryRoot,
      output: "artifacts/platform-ops/environment.json",
      repositoryRoot: fixture.repositoryRoot,
      scenario: "apps/api/scripts/read-only-load-scenarios.json",
    });
    const scenarioFileSha256 = createHash("sha256").update(fixture.scenarioRaw).digest("hex");
    const expected = {
      configuration: {
        aiShare: 0,
        apiPort: 3100,
        countryReadSource: "database",
        databaseConnectTimeoutSeconds: 5,
        databasePoolMax: 10,
        databasePort: 55434,
        databasePoolTimeoutSeconds: 5,
        healthReadyTimeoutMs: 1000,
        metricsPort: 9464,
        nodeEnvironment: "production",
        readRatio: 1,
        readCacheMaxEntries: 1000,
        readCacheStaleIfErrorSeconds: 300,
        readCacheTtlSeconds: 60,
        writeRatio: 0,
      },
      cpu: { capacityCores: 2, source: "cgroup-v2" },
      gitSha: "d".repeat(40),
      imageDigest,
      imageId,
      memory: { limitBytes: 2_147_483_648, source: "cgroup-v2" },
      scenarioFileSha256,
      schemaVersion: 1,
      versions: { node: "v24.18.0", postgres: "17.5", prisma: "6.19.3" },
    };
    const serialized = await readFile(fixture.outputPath, "utf8");
    assert.deepEqual(result, expected);
    assert.deepEqual(JSON.parse(serialized), expected);
    assert.equal((await stat(fixture.outputPath)).mode & 0o777, 0o600);
    assert.doesNotMatch(serialized, /DATABASE_URL|password|credential/u);
    assert.deepEqual(normalizeCalls(calls), [
      ["git", ["rev-parse", "HEAD"], fixture.repositoryRoot],
      ["node", ["--version"], fixture.repositoryRoot],
      ["pnpm", ["exec", "prisma", "--version"], resolve(fixture.repositoryRoot, "packages/db")],
      [
        "docker",
        ["inspect", "--type", "container", "--format", "{{json .Image}}", "navigator-platform-ops-1-postgres"],
        fixture.repositoryRoot,
      ],
      [
        "docker",
        ["inspect", "--type", "image", "--format", "{{json .RepoDigests}}", imageId],
        fixture.repositoryRoot,
      ],
      [
        "docker",
        [
          "exec", "navigator-platform-ops-1-postgres", "psql", "--username",
          "navigator_test", "--dbname", "navigator_platform_db_1_test",
          "--tuples-only", "--no-align", "--no-psqlrc", "--set",
          "ON_ERROR_STOP=1", "--command", "SHOW server_version;",
        ],
        fixture.repositoryRoot,
      ],
    ]);
  });

  test("accepts exactly the three fixed CLI flag names once", () => {
    const arguments_ = [
      "--scenario", "apps/api/scripts/read-only-load-scenarios.json",
      "--container", "navigator-platform-ops-1-postgres",
      "--output", "artifacts/platform-ops/environment.json",
    ];
    assert.deepEqual(parseCliArguments(arguments_), {
      container: "navigator-platform-ops-1-postgres",
      output: "artifacts/platform-ops/environment.json",
      scenario: "apps/api/scripts/read-only-load-scenarios.json",
    });
    for (const invalid of [
      arguments_.slice(0, -1),
      [...arguments_, "--extra", "value"],
      ["--scenario", "x", "--scenario", "y", "--output", "z"],
      ["--container", "x", "--scenario", "y", "--unknown", "z"],
    ]) {
      assert.throws(() => parseCliArguments(invalid), { message: "ENV_ARGUMENTS_INVALID" });
    }
  });

  test("fails CLI validation with one fixed code and no input echo", () => {
    const result = spawnSync(process.execPath, [modulePath, "DATABASE_URL=secret"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ENV_ARGUMENTS_INVALID\n");
    assert.doesNotMatch(result.stderr, /secret|Error|at file:/u);
  });

  test("rejects a changed scenario contract before executing commands", async (context) => {
    const fixture = await createRepositoryFixture(context);
    await writeFile(fixture.scenarioPath, '{"external":{"targetRps":1}}\n', "utf8");
    let commandCalls = 0;
    await assert.rejects(
      captureBenchmarkEnvironment({
        capacityResolver: () => ({
          cpuCapacityCores: 1,
          cpuCapacitySource: "safe-default",
          memoryLimitBytes: 1,
          memoryLimitSource: "safe-default",
        }),
        commandRunner: async () => { commandCalls += 1; throw new Error("COMMAND_MUST_NOT_RUN"); },
        container: "navigator-platform-ops-1-postgres",
        cwd: fixture.repositoryRoot,
        output: "artifacts/platform-ops/environment.json",
        repositoryRoot: fixture.repositoryRoot,
        scenario: "apps/api/scripts/read-only-load-scenarios.json",
      }),
      { message: "ENV_SCENARIO_FILE_INVALID" },
    );
    assert.equal(commandCalls, 0);
  });
});
