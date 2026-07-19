import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const SAMPLE_INTERVAL_MS = 1_000;
const MAX_STDOUT_BYTES = 256;
const SAFE_ENVIRONMENT_KEYS = Object.freeze(["PATH", "LANG", "LC_ALL"]);
export const DEFAULT_SAMPLE_TIMEOUT_MS = 5_000;
export const DEFAULT_FORCE_KILL_DELAY_MS = 1_000;
export const FIXED_CONTAINER_NAME = "navigator-platform-ops-1-postgres";
export const PG_ACTIVITY_SQL = [
  "SELECT count(*) FILTER (WHERE state = 'active')::bigint,",
  "count(*) FILTER (WHERE state = 'idle')::bigint,",
  "count(*)::bigint",
  "FROM pg_stat_activity",
  "WHERE application_name = 'navigator-api'",
].join(" ");
export const DOCKER_EXEC_ARGUMENTS = Object.freeze([
  "exec", FIXED_CONTAINER_NAME, "psql", "--no-psqlrc",
  "--username", "navigator_test",
  "--dbname", "navigator_platform_db_1_test",
  "--tuples-only", "--no-align", "--quiet",
  "--set=ON_ERROR_STOP=1", "--field-separator=|",
  "--command", PG_ACTIVITY_SQL,
]);
export function assertCollectorOutputPath(input, options = {}) {
  const root = resolve(options.repositoryRoot ?? repositoryRoot);
  const cwd = resolve(options.cwd ?? process.cwd());
  const expected = resolve(root, "artifacts/platform-ops/pg-connections.jsonl");
  const canonicalRelativePath = relative(cwd, expected);
  if (
    typeof input !== "string" ||
    (input !== expected && input !== canonicalRelativePath)
  ) {
    throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
  }
  return expected;
}
export function parseCollectorArguments(argv, options = {}) {
  try {
    if (!Array.isArray(argv) || argv.length !== 4) throw new Error();
    const values = new Map();
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (
        (flag !== "--container" && flag !== "--output") ||
        typeof value !== "string" ||
        values.has(flag)
      ) {
        throw new Error();
      }
      values.set(flag, value);
    }
    if (values.get("--container") !== FIXED_CONTAINER_NAME) throw new Error();
    const outputPath = assertCollectorOutputPath(values.get("--output"), options);
    return Object.freeze({ container: FIXED_CONTAINER_NAME, outputPath });
  } catch {
    throw new Error("PG_CONNECTION_COLLECTOR_ARGUMENTS_INVALID");
  }
}
export function parsePgConnectionCounts(output) {
  if (typeof output !== "string" || Buffer.byteLength(output) > MAX_STDOUT_BYTES) {
    throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
  }
  const match = /^[ \t]*(0|[1-9][0-9]*)\|(0|[1-9][0-9]*)\|(0|[1-9][0-9]*)[ \t]*(?:\r?\n)?$/.exec(
    output,
  );
  const counts = match?.slice(1).map(Number) ?? [];
  if (
    counts.length !== 3 ||
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    counts[0] + counts[1] > counts[2]
  ) {
    throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
  }
  return Object.freeze({ active: counts[0], idle: counts[1], total: counts[2] });
}
export function collectPgConnectionSample(options = {}) {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const cancelTimeout = options.cancelTimeout ?? clearTimeout;
  const sampleTimeoutMs = assertTimeout(options.sampleTimeoutMs, DEFAULT_SAMPLE_TIMEOUT_MS);
  const forceKillDelayMs = assertTimeout(options.forceKillDelayMs, DEFAULT_FORCE_KILL_DELAY_MS);
  return new Promise((resolveSample, rejectSample) => {
    let child;
    try {
      child = spawnImpl("docker", [...DOCKER_EXEC_ARGUMENTS], {
        env: safeDockerEnvironment(options.environment ?? process.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      rejectSample(new Error("PG_CONNECTION_COLLECTOR_SAMPLE_FAILED"));
      return;
    }
    let stdout = "";
    let failed = false;
    let forceKillTimer;
    const sampleTimer = setTimeout(() => {
      failed = true;
      child.kill?.("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill?.("SIGKILL"), forceKillDelayMs);
      forceKillTimer.unref?.();
    }, sampleTimeoutMs);
    sampleTimer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) {
        failed = true;
        child.kill?.("SIGTERM");
      }
    });
    child.stderr?.resume();
    child.once("error", () => {
      failed = true;
    });
    child.once("close", (code) => {
      cancelTimeout(sampleTimer);
      cancelTimeout(forceKillTimer);
      if (failed || code !== 0) {
        rejectSample(new Error("PG_CONNECTION_COLLECTOR_SAMPLE_FAILED"));
        return;
      }
      try {
        resolveSample(parsePgConnectionCounts(stdout));
      } catch {
        rejectSample(new Error("PG_CONNECTION_COLLECTOR_SAMPLE_FAILED"));
      }
    });
  });
}
function safeDockerEnvironment(environment) {
  return Object.fromEntries(SAFE_ENVIRONMENT_KEYS.flatMap((key) =>
    typeof environment[key] === "string" ? [[key, environment[key]]] : [],
  ));
}
function assertTimeout(value, fallback) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 60_000) {
    throw new Error("PG_CONNECTION_COLLECTOR_SAMPLE_FAILED");
  }
  return selected;
}
export async function runCollectionLoop(options) {
  const signal = options?.signal;
  const collectSample = options?.collectSample ?? collectPgConnectionSample;
  const writeLine = options?.writeLine;
  const clock = options?.clock ?? defaultClock;
  if (
    signal === undefined ||
    typeof signal.aborted !== "boolean" ||
    typeof collectSample !== "function" ||
    typeof writeLine !== "function" ||
    typeof clock.now !== "function" ||
    typeof clock.sleep !== "function"
  ) {
    throw new Error("PG_CONNECTION_COLLECTOR_RUNTIME_INVALID");
  }
  while (!signal.aborted) {
    const startedAt = clock.now();
    const counts = assertCounts(await collectSample());
    const completedAt = clock.now();
    if (!Number.isFinite(completedAt)) {
      throw new Error("PG_CONNECTION_COLLECTOR_RUNTIME_INVALID");
    }
    const record = {
      timestamp: new Date(completedAt).toISOString(),
      active: counts.active,
      idle: counts.idle,
      total: counts.total,
    };
    await writeLine(`${JSON.stringify(record)}\n`);
    if (signal.aborted) break;
    const elapsed = Math.max(0, clock.now() - startedAt);
    await clock.sleep(Math.max(0, SAMPLE_INTERVAL_MS - elapsed), signal);
  }
}
export async function runCollector(argv = process.argv.slice(2)) {
  const { outputPath } = parseCollectorArguments(argv);
  const controller = new AbortController();
  const requestStop = () => controller.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    await collectToFile(outputPath, controller.signal);
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
}
async function collectToFile(outputPath, signal) {
  await prepareArtifactDirectory();
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let file;
  let created = false;
  let succeeded = false;
  try {
    file = await open(
      outputPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        noFollow,
      0o600,
    );
    created = true;
    await runCollectionLoop({
      signal,
      writeLine: (line) => writeFully(file, line),
    });
    await file.sync();
    succeeded = true;
  } finally {
    await file?.close().catch(() => undefined);
    if (created && !succeeded) await unlink(outputPath).catch(() => undefined);
  }
}
async function prepareArtifactDirectory() {
  const artifactsDirectory = resolve(repositoryRoot, "artifacts");
  const outputDirectory = resolve(artifactsDirectory, "platform-ops");
  await ensurePlainDirectory(artifactsDirectory);
  await ensurePlainDirectory(outputDirectory);
}
async function ensurePlainDirectory(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
    }
  }
}
async function writeFully(file, line) {
  const bytes = Buffer.from(line, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.length - offset,
      null,
    );
    if (bytesWritten <= 0) throw new Error("PG_CONNECTION_COLLECTOR_WRITE_FAILED");
    offset += bytesWritten;
  }
}
function assertCounts(counts) {
  if (
    counts === null ||
    typeof counts !== "object" ||
    !Number.isSafeInteger(counts.active) ||
    !Number.isSafeInteger(counts.idle) ||
    !Number.isSafeInteger(counts.total) ||
    counts.active < 0 ||
    counts.idle < 0 ||
    counts.total < counts.active + counts.idle
  ) {
    throw new Error("PG_CONNECTION_COLLECTOR_OUTPUT_INVALID");
  }
  return counts;
}
const defaultClock = Object.freeze({
  now: () => Date.now(),
  sleep: (milliseconds, signal) => new Promise((resolveSleep) => {
    if (signal.aborted || milliseconds <= 0) {
      resolveSleep();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveSleep();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  }),
});
function isEntrypoint() {
  return process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
if (isEntrypoint()) {
  await runCollector().catch(() => {
    process.stderr.write("PG_CONNECTION_COLLECTOR_FAILED\n");
    process.exitCode = 1;
  });
}
