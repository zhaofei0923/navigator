import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { describe, test } from "node:test";

import {
  captureBenchmarkEnvironment,
  runCommand,
} from "./capture-benchmark-environment.mjs";
import {
  createRepositoryFixture,
  fixedCaptureOptions,
  fixtureCommandOutput,
  modulePath,
  scriptDirectory,
} from "./capture-benchmark-environment-test-fixtures.mjs";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;

function successfulOptions(fixture, overrides = {}) {
  return fixedCaptureOptions(fixture, {
    commandRunner: async (command, arguments_) =>
      fixtureCommandOutput(command, arguments_, {
        imageDigest: IMAGE_DIGEST,
        imageId: IMAGE_ID,
      }),
    ...overrides,
  });
}

describe("benchmark environment security boundary", () => {
  test("rejects CPU and memory capacity sources assigned to the wrong resource", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const invalid = [
      {
        cpuCapacityCores: 1,
        cpuCapacitySource: "host-total-memory",
        memoryLimitBytes: 1,
        memoryLimitSource: "safe-default",
      },
      {
        cpuCapacityCores: 1,
        cpuCapacitySource: "safe-default",
        memoryLimitBytes: 1,
        memoryLimitSource: "host-available-parallelism",
      },
    ];
    for (const capacity of invalid) {
      await assert.rejects(
        captureBenchmarkEnvironment(fixedCaptureOptions(fixture, {
          capacityResolver: () => capacity,
        })),
        { message: "ENV_CAPACITY_INVALID" },
      );
    }
  });

  test("force-kills a timed-out command that ignores SIGTERM", async () => {
    const startedAt = Date.now();
    await assert.rejects(
      runCommand(
        process.execPath,
        ["--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);"],
        {
          cwd: scriptDirectory,
          forceKillAfterMilliseconds: 25,
          timeoutMilliseconds: 25,
        },
      ),
      { message: "ENV_COMMAND_FAILED" },
    );
    assert.ok(Date.now() - startedAt < 1_000);
  });

  test("returns one fixed error without exposing failed-command stderr", async () => {
    await assert.rejects(
      runCommand(
        process.execPath,
        ["--eval", "process.stderr.write('credential=secret'); process.exit(2);"],
        { cwd: scriptDirectory },
      ),
      (error) => error instanceof Error &&
        error.message === "ENV_COMMAND_FAILED" &&
        !JSON.stringify(error).includes("secret"),
    );
  });

  test("does not pass DATABASE_URL or use a shell for evidence commands", async () => {
    const source = await readFile(modulePath, "utf8");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:secret@example.invalid/db";
    try {
      const inherited = await runCommand(
        process.execPath,
        ["--eval", "process.stdout.write(process.env.DATABASE_URL ?? 'absent')"],
        { cwd: scriptDirectory },
      );
      assert.equal(inherited, "absent");
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
    assert.match(source, /from "\.\.\/src\/ops\/metrics-capacity\.ts"/u);
    assert.match(source, /spawn\(command, arguments_, \{/u);
    assert.match(source, /shell: false/u);
    assert.match(source, /"SHOW server_version;"/u);
    assert.doesNotMatch(source, /DATABASE_URL|POSTGRES_PASSWORD|shell:\s*true/u);
  });

  test("rejects every container, scenario, or output target outside the fixed boundary", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const base = fixedCaptureOptions(fixture);
    const invalid = [
      [{ ...base, container: "other;docker exec" }, "ENV_CONTAINER_INVALID"],
      [{ ...base, scenario: "/tmp/scenarios.json" }, "ENV_SCENARIO_PATH_INVALID"],
      [{ ...base, output: "artifacts/environment.json" }, "ENV_OUTPUT_PATH_INVALID"],
    ];
    for (const [options, message] of invalid) {
      await assert.rejects(captureBenchmarkEnvironment(options), { message });
    }
  });

  test("never deletes a pre-existing temporary file it did not create", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const preExistingPath = `${fixture.outputPath}.${process.pid}.tmp`;
    await writeFile(preExistingPath, "not-owned-by-capture", "utf8");

    await captureBenchmarkEnvironment(successfulOptions(fixture));

    assert.equal(await readFile(preExistingPath, "utf8"), "not-owned-by-capture");
  });

  test("cleans only its owned temporary file when serialization fails", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const preExistingPath = `${fixture.outputPath}.${process.pid}.tmp`;
    await writeFile(preExistingPath, "not-owned-by-capture", "utf8");
    let capacityReads = 0;
    const capacity = {
      get cpuCapacityCores() {
        capacityReads += 1;
        return capacityReads === 1 ? 1 : 1n;
      },
      cpuCapacitySource: "safe-default",
      memoryLimitBytes: 1,
      memoryLimitSource: "safe-default",
    };

    await assert.rejects(captureBenchmarkEnvironment(successfulOptions(fixture, {
      capacityResolver: () => capacity,
    })));

    assert.equal(await readFile(preExistingPath, "utf8"), "not-owned-by-capture");
    assert.deepEqual((await readdir(dirname(fixture.outputPath))).sort(), [
      `${basename(fixture.outputPath)}.${process.pid}.tmp`,
    ]);
  });

  test("cleans its owned temporary file when atomic rename fails", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const options = successfulOptions(fixture, {
      commandRunner: async (command, arguments_) => {
        if (arguments_.includes("SHOW server_version;")) {
          await mkdir(fixture.outputPath);
        }
        return fixtureCommandOutput(command, arguments_, {
          imageDigest: IMAGE_DIGEST,
          imageId: IMAGE_ID,
        });
      },
    });

    await assert.rejects(captureBenchmarkEnvironment(options));

    assert.deepEqual(await readdir(dirname(fixture.outputPath)), ["environment.json"]);
  });

  test("supports concurrent atomic captures without sharing a temporary path", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const options = successfulOptions(fixture);

    const results = await Promise.all([
      captureBenchmarkEnvironment(options),
      captureBenchmarkEnvironment(options),
    ]);

    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(await readdir(dirname(fixture.outputPath)), ["environment.json"]);
  });

  test("rejects malformed version output with fixed non-echoing error codes", async (context) => {
    const fixture = await createRepositoryFixture(context);
    const malformed = [
      ["node", "v24.18.0-.marker\n", "ENV_NODE_VERSION_INVALID"],
      ["node", "v024.18.0\n", "ENV_NODE_VERSION_INVALID"],
      ["pnpm", "prisma : 6.19.3-.marker\n", "ENV_PRISMA_VERSION_INVALID"],
      ["pnpm", "prisma : 6.19.3+build..marker\n", "ENV_PRISMA_VERSION_INVALID"],
      ["postgres", "17 marker\n", "ENV_POSTGRES_VERSION_INVALID"],
      ["postgres", "17.5 arbitrary-marker\n", "ENV_POSTGRES_VERSION_INVALID"],
      ["postgres", "17.5 (Ubuntu marker)\n", "ENV_POSTGRES_VERSION_INVALID"],
    ];
    for (const [target, output, errorCode] of malformed) {
      const options = successfulOptions(fixture, {
        commandRunner: async (command, arguments_) => {
          const matchesTarget = target === command ||
            (target === "postgres" && arguments_.includes("SHOW server_version;"));
          return matchesTarget
            ? output
            : fixtureCommandOutput(command, arguments_, {
                imageDigest: IMAGE_DIGEST,
                imageId: IMAGE_ID,
              });
        },
      });
      await assert.rejects(
        captureBenchmarkEnvironment(options),
        (error) => error instanceof Error &&
          error.message === errorCode &&
          !error.message.includes("marker"),
      );
    }
  });
});
