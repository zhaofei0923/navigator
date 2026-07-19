import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DOCKER_EXEC_ARGUMENTS } from "./collect-pg-connections.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const collectorModulePath = resolve(
  scriptDirectory,
  "collect-pg-connections.mjs",
);

test("SIGINT and SIGTERM wait for docker exit and flush temporary JSONL", async () => {
  const temporaryRepository = await mkdtemp(
    join(tmpdir(), "navigator-pg-collector-test-"),
  );
  const temporaryScriptDirectory = resolve(
    temporaryRepository,
    "apps/api/scripts",
  );
  const temporaryModulePath = resolve(
    temporaryScriptDirectory,
    "collect-pg-connections.mjs",
  );
  const temporaryOutputPath = resolve(
    temporaryRepository,
    "artifacts/platform-ops/pg-connections.jsonl",
  );
  const binaryDirectory = resolve(temporaryRepository, "bin");
  const dockerPath = resolve(binaryDirectory, "docker");
  const markerPath = resolve(temporaryRepository, "docker-started.json");

  await mkdir(temporaryScriptDirectory, { recursive: true });
  await mkdir(binaryDirectory);
  await copyFile(collectorModulePath, temporaryModulePath);
  await writeFile(
    dockerPath,
    `#!${process.execPath}\n` +
      `import { writeFile } from "node:fs/promises";\n` +
      `await writeFile(${JSON.stringify(markerPath)}, JSON.stringify(process.argv.slice(2)));\n` +
      `await new Promise((resolve) => setTimeout(resolve, 150));\n` +
      `process.stdout.write("1|2|3\\n");\n`,
    { mode: 0o700 },
  );
  await chmod(dockerPath, 0o700);

  try {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      await rm(markerPath, { force: true });
      await rm(temporaryOutputPath, { force: true });
      const child = spawn(
        process.execPath,
        [
          temporaryModulePath,
          "--container",
          "navigator-platform-ops-1-postgres",
          "--output",
          "artifacts/platform-ops/pg-connections.jsonl",
        ],
        {
          cwd: temporaryRepository,
          env: {
            LANG: "C",
            PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exitPromise = waitForExit(child);
      const stderr = [];
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      await waitForFile(markerPath);
      assert.equal(child.kill(signal), true);
      const exit = await exitPromise;

      assert.deepEqual(exit, { code: 0, signal: null });
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      const records = (await readFile(temporaryOutputPath, "utf8"))
        .trim()
        .split("\n");
      assert.equal(records.length, 1);
      const record = JSON.parse(records[0]);
      assert.deepEqual(
        { active: record.active, idle: record.idle, total: record.total },
        { active: 1, idle: 2, total: 3 },
      );
      assert.equal(new Date(record.timestamp).toISOString(), record.timestamp);
      assert.deepEqual(
        JSON.parse(await readFile(markerPath, "utf8")),
        DOCKER_EXEC_ARGUMENTS,
      );
    }
  } finally {
    await rm(temporaryRepository, { force: true, recursive: true });
  }
}, 5_000);

async function waitForFile(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw new Error("TEST_MARKER_TIMEOUT");
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}
