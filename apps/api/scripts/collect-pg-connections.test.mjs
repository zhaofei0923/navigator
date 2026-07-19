import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import "./collect-pg-connections-filesystem.test.mjs";
import "./collect-pg-connections-signal.test.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const outputPath = resolve(
  repositoryRoot,
  "artifacts/platform-ops/pg-connections.jsonl",
);
const collector = await import("./collect-pg-connections.mjs").catch(
  () => Object.create(null),
);
describe("collector argument boundary", () => {
  test("accepts only the fixed container and canonical artifact path", () => {
    assert.equal(
      collector.FIXED_CONTAINER_NAME,
      "navigator-platform-ops-1-postgres",
    );
    assert.deepEqual(
      collector.parseCollectorArguments(
        [
          "--container",
          collector.FIXED_CONTAINER_NAME,
          "--output",
          "artifacts/platform-ops/pg-connections.jsonl",
        ],
        { cwd: repositoryRoot, repositoryRoot },
      ),
      {
        container: collector.FIXED_CONTAINER_NAME,
        outputPath,
      },
    );
    assert.equal(
      collector.assertCollectorOutputPath(
        "../../artifacts/platform-ops/pg-connections.jsonl",
        { cwd: resolve(repositoryRoot, "apps/api"), repositoryRoot },
      ),
      outputPath,
    );
  });
  test("rejects alternate containers, output targets, SQL, hosts, and command fragments", () => {
    const fixed = collector.FIXED_CONTAINER_NAME;
    const validOutput = "artifacts/platform-ops/pg-connections.jsonl";
    const invalidArgumentVectors = [
      ["--container", "postgres", "--output", validOutput],
      ["--container", `${fixed};id`, "--output", validOutput],
      ["--container", fixed, "--output", "/tmp/pg-connections.jsonl"],
      ["--container", fixed, "--output", "artifacts/platform-ops/other.jsonl"],
      ["--container", fixed, "--output", "artifacts/platform-ops/nested/pg-connections.jsonl"],
      ["--container", fixed, "--output", "artifacts/platform-ops/../pg-connections.jsonl"],
      ["--container", fixed, "--sql", "SELECT 1", "--output", validOutput],
      ["--container", fixed, "--host", "example.com", "--output", validOutput],
      ["--container", fixed, "--command", "sh -c id", "--output", validOutput],
      ["--container", fixed, "--output", validOutput, "--output", validOutput],
      ["--container", fixed],
    ];

    for (const argv of invalidArgumentVectors) {
      assert.throws(
        () => collector.parseCollectorArguments(argv, {
          cwd: repositoryRoot,
          repositoryRoot,
        }),
        (error) => {
          assert.equal(error.message, "PG_CONNECTION_COLLECTOR_ARGUMENTS_INVALID");
          assert.doesNotMatch(error.message, /SELECT|example\.com|sh -c|;id/);
          return true;
        },
      );
    }
  });
});
describe("fixed PostgreSQL sample", () => {
  test("spawns an argument-array docker exec with static pg_stat_activity SQL", async () => {
    const calls = [];
    const environment = {
      DATABASE_URL: "postgresql://user:password@example.invalid/database",
      HOME: "/secret-home",
      LANG: "C.UTF-8",
      LC_ALL: "C",
      PATH: "/controlled/bin",
      PGPASSWORD: "secret",
    };
    const spawnImpl = (command, args, options) => {
      calls.push({ args, command, options });
      return completedChild("2|3|5\n");
    };
    assert.deepEqual(
      await collector.collectPgConnectionSample({ environment, spawnImpl }),
      { active: 2, idle: 3, total: 5 },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "docker");
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
    assert.deepEqual(calls[0].options.env, {
      LANG: "C.UTF-8",
      LC_ALL: "C",
      PATH: "/controlled/bin",
    });
    assert.doesNotMatch(JSON.stringify(calls[0].options.env), /password|secret|DATABASE_URL|PGPASSWORD/);
    assert.deepEqual(calls[0].args, collector.DOCKER_EXEC_ARGUMENTS);
    assert.deepEqual(calls[0].args.slice(0, 3), [
      "exec",
      collector.FIXED_CONTAINER_NAME,
      "psql",
    ]);
    assert.equal(calls[0].args.at(-1), collector.PG_ACTIVITY_SQL);
    assert.match(
      collector.PG_ACTIVITY_SQL,
      /FROM pg_stat_activity\s+WHERE application_name = 'navigator-api'/,
    );
    assert.equal(
      collector.PG_ACTIVITY_SQL.match(/application_name\s*=\s*'navigator-api'/g)?.length,
      1,
    );
    assert.ok(!calls[0].args.includes("--host"));
  });
  test("strictly parses non-negative aggregate counts", () => {
    assert.deepEqual(collector.parsePgConnectionCounts("0|7|7\n"), {
      active: 0,
      idle: 7,
      total: 7,
    });
    for (const output of [
      "",
      "1|2|3\n4|5|9\n",
      "-1|2|3\n",
      "1.5|2|3\n",
      "1|2|2\n",
      "NaN|2|3\n",
      "1|2|3;id\n",
      `${Number.MAX_SAFE_INTEGER + 1}|0|0\n`,
    ]) {
      assert.throws(() => collector.parsePgConnectionCounts(output), {
        message: "PG_CONNECTION_COLLECTOR_OUTPUT_INVALID",
      });
    }
  });
  test("fails closed without exposing child stderr", async () => {
    const secret = "postgresql://user:password@example.invalid/database";
    await assert.rejects(
      collector.collectPgConnectionSample({
        spawnImpl: () => completedChild("", { code: 2, stderr: secret }),
      }),
      (error) => {
        assert.equal(error.message, "PG_CONNECTION_COLLECTOR_SAMPLE_FAILED");
        assert.doesNotMatch(error.message, /password|example\.invalid|postgresql/);
        return true;
      },
    );
  });
  test("times out with TERM then KILL, waits for close, and clears both timers", async () => {
    assert.equal(collector.DEFAULT_SAMPLE_TIMEOUT_MS, 5_000);
    assert.equal(collector.DEFAULT_FORCE_KILL_DELAY_MS, 1_000);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const kills = [];
    const canceledTimers = [];
    let closeEmitted = false;
    let settledAfterClose = false;
    child.kill = (signal) => {
      kills.push(signal);
      if (signal === "SIGKILL") {
        setTimeout(() => {
          closeEmitted = true;
          child.emit("close", null, "SIGKILL");
        }, 1);
      }
      return true;
    };

    const sample = collector.collectPgConnectionSample({
      cancelTimeout: (handle) => {
        canceledTimers.push(handle);
        clearTimeout(handle);
      },
      environment: { PATH: "/controlled/bin" },
      forceKillDelayMs: 5,
      sampleTimeoutMs: 5,
      spawnImpl: () => child,
    }).catch((error) => {
      settledAfterClose = closeEmitted;
      throw error;
    });

    await assert.rejects(sample, { message: "PG_CONNECTION_COLLECTOR_SAMPLE_FAILED" });
    assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]);
    assert.equal(settledAfterClose, true);
    assert.equal(canceledTimers.length, 2);
    assert.equal(new Set(canceledTimers).size, 2);
  });
});
describe("one-second JSONL collection loop", () => {
  test("serializes bounded fields once per second and flushes a sample completed after stop", async () => {
    const controller = new AbortController();
    const sleeps = [];
    const lines = [];
    let nowMilliseconds = Date.parse("2026-07-19T00:00:00.000Z");
    let samples = 0;
    await collector.runCollectionLoop({
      clock: {
        now: () => nowMilliseconds,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
          nowMilliseconds += milliseconds;
        },
      },
      collectSample: async () => {
        samples += 1;
        nowMilliseconds += 100;
        if (samples === 3) controller.abort();
        return { active: samples, idle: 1, total: samples + 1 };
      },
      signal: controller.signal,
      writeLine: async (line) => lines.push(line),
    });
    assert.equal(samples, 3);
    assert.deepEqual(sleeps, [900, 900]);
    assert.equal(lines.length, 3);
    for (const [index, line] of lines.entries()) {
      assert.match(line, /^\{[^\n]+\}\n$/);
      assert.deepEqual(Object.keys(JSON.parse(line)), [
        "timestamp",
        "active",
        "idle",
        "total",
      ]);
      assert.deepEqual(JSON.parse(line), {
        timestamp: new Date(
          Date.parse("2026-07-19T00:00:00.100Z") + index * 1_000,
        ).toISOString(),
        active: index + 1,
        idle: 1,
        total: index + 2,
      });
    }
  });
});
function completedChild(stdout, options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(options.stderr ?? "");
    child.emit("close", options.code ?? 0, null);
  });
  return child;
}
