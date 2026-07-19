import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const collectorModulePath = resolve(
  scriptDirectory,
  "collect-pg-connections.mjs",
);

test("rejects a symlinked artifacts directory without touching its target", async () => {
  await withTemporaryCollector(async (fixture) => {
    await writeFile(resolve(fixture.externalPath, "sentinel"), "unchanged");
    await symlink(fixture.externalPath, resolve(fixture.repositoryRoot, "artifacts"));

    await assertUnsafeOutputRejected(fixture);
    assert.equal(
      await readFile(resolve(fixture.externalPath, "sentinel"), "utf8"),
      "unchanged",
    );
  });
});

test("rejects a symlinked platform-ops directory without touching its target", async () => {
  await withTemporaryCollector(async (fixture) => {
    const artifactsPath = resolve(fixture.repositoryRoot, "artifacts");
    await mkdir(artifactsPath);
    await writeFile(resolve(fixture.externalPath, "sentinel"), "unchanged");
    await symlink(fixture.externalPath, resolve(artifactsPath, "platform-ops"));

    await assertUnsafeOutputRejected(fixture);
    assert.equal(
      await readFile(resolve(fixture.externalPath, "sentinel"), "utf8"),
      "unchanged",
    );
  });
});

test("rejects a symlinked final output without changing its target", async () => {
  await withTemporaryCollector(async (fixture) => {
    const outputDirectory = resolve(
      fixture.repositoryRoot,
      "artifacts/platform-ops",
    );
    const targetPath = resolve(fixture.externalPath, "target.jsonl");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(targetPath, "unchanged");
    await symlink(
      targetPath,
      resolve(outputDirectory, "pg-connections.jsonl"),
    );

    await assertUnsafeOutputRejected(fixture);
    assert.equal(await readFile(targetPath, "utf8"), "unchanged");
  });
});

async function withTemporaryCollector(work) {
  const repositoryRoot = await mkdtemp(
    join(tmpdir(), "navigator-pg-collector-fs-"),
  );
  const temporaryScriptDirectory = resolve(repositoryRoot, "apps/api/scripts");
  const temporaryModulePath = resolve(
    temporaryScriptDirectory,
    "collect-pg-connections.mjs",
  );
  const externalPath = resolve(repositoryRoot, "external");
  const binaryPath = resolve(repositoryRoot, "bin");
  const dockerMarkerPath = resolve(repositoryRoot, "docker-called");
  try {
    await mkdir(temporaryScriptDirectory, { recursive: true });
    await mkdir(externalPath);
    await mkdir(binaryPath);
    await copyFile(collectorModulePath, temporaryModulePath);
    await writeFile(
      resolve(binaryPath, "docker"),
      `#!${process.execPath}\n` +
        `import { writeFile } from "node:fs/promises";\n` +
        `await writeFile(${JSON.stringify(dockerMarkerPath)}, "called");\n`,
      { mode: 0o700 },
    );
    await work({
      binaryPath,
      dockerMarkerPath,
      externalPath,
      repositoryRoot,
      temporaryModulePath,
    });
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
}

async function assertUnsafeOutputRejected(fixture) {
  const child = spawn(
    process.execPath,
    [
      fixture.temporaryModulePath,
      "--container",
      "navigator-platform-ops-1-postgres",
      "--output",
      "artifacts/platform-ops/pg-connections.jsonl",
    ],
    {
      cwd: fixture.repositoryRoot,
      env: { LANG: "C", PATH: fixture.binaryPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = await waitForExit(child);

  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(Buffer.concat(stdout).toString("utf8"), "");
  assert.equal(
    Buffer.concat(stderr).toString("utf8"),
    "PG_CONNECTION_COLLECTOR_FAILED\n",
  );
  await assert.rejects(lstat(fixture.dockerMarkerPath), { code: "ENOENT" });
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error("TEST_COLLECTOR_EXIT_TIMEOUT"));
    }, 2_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}
