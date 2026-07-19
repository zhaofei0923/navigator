import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCapacityEnvironment } from "../src/ops/metrics-capacity.ts";
import { writeJsonArtifact } from "./capture-benchmark-artifact.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "../../..");
const FIXED_CONTAINER = "navigator-platform-ops-1-postgres";
const FIXED_SCENARIO = "apps/api/scripts/read-only-load-scenarios.json";
const FIXED_OUTPUT = "artifacts/platform-ops/environment.json";
const FIXED_CONFIGURATION = Object.freeze({
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
  readCacheMaxEntries: 1000,
  readCacheStaleIfErrorSeconds: 300,
  readCacheTtlSeconds: 60,
  readRatio: 1,
  writeRatio: 0,
});
const EXPECTED_SCENARIOS = Object.freeze({
  "100k": Object.freeze({ targetRps: 6, maxConcurrency: 16, warmupSeconds: 120, measurementSeconds: 600 }),
  "1m": Object.freeze({ targetRps: 56, maxConcurrency: 128, warmupSeconds: 120, measurementSeconds: 600 }),
  "10m": Object.freeze({ targetRps: 556, maxConcurrency: 1024, warmupSeconds: 120, measurementSeconds: 600 }),
});
const CPU_SOURCES = new Set(["cgroup-v2", "host-available-parallelism", "safe-default"]);
const MEMORY_SOURCES = new Set(["cgroup-v2", "host-total-memory", "safe-default"]);
const OUTPUT_LIMIT_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FORCE_KILL_MS = 1_000;
const SEMVER =
  "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)" +
  "(?:-(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)?" +
  "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const NODE_VERSION_PATTERN = new RegExp(`^v${SEMVER}$`, "u");
const PRISMA_VERSION_PATTERN = new RegExp(`^prisma\\s*:\\s*(${SEMVER})\\s*$`, "u");
const POSTGRES_VERSION_PATTERN = /^(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)(?: \(Debian [0-9A-Za-z][0-9A-Za-z.+~:_-]{0,127}\))?$/u;

export async function captureBenchmarkEnvironment(options) {
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const cwd = resolve(options.cwd ?? process.cwd());
  const container = assertContainer(options.container);
  const scenarioPath = assertControlledPath(options.scenario, FIXED_SCENARIO, "ENV_SCENARIO_PATH_INVALID", { cwd, repositoryRoot });
  const outputPath = assertControlledPath(options.output, FIXED_OUTPUT, "ENV_OUTPUT_PATH_INVALID", { cwd, repositoryRoot });
  await assertInputFile(scenarioPath);
  await assertOutputPath(outputPath);

  const scenarioRaw = await readFile(scenarioPath);
  assertScenarioFile(scenarioRaw);
  const scenarioFileSha256 = createHash("sha256").update(scenarioRaw).digest("hex");
  const capacity = assertCapacity((options.capacityResolver ?? resolveCapacityEnvironment)());
  const run = options.commandRunner ?? runCommand;
  const gitSha = parseMatch(await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }), /^[0-9a-f]{40}$/u, "ENV_GIT_SHA_INVALID");
  const nodeVersion = parseMatch(await run("node", ["--version"], { cwd: repositoryRoot }), NODE_VERSION_PATTERN, "ENV_NODE_VERSION_INVALID");
  const prismaVersion = parsePrismaVersion(await run("pnpm", ["exec", "prisma", "--version"], { cwd: resolve(repositoryRoot, "packages/db") }));
  const imageId = parseImageId(await run("docker", ["inspect", "--type", "container", "--format", "{{json .Image}}", container], { cwd: repositoryRoot }));
  const imageDigest = parseImageDigest(await run("docker", ["inspect", "--type", "image", "--format", "{{json .RepoDigests}}", imageId], { cwd: repositoryRoot }));
  const postgresArgs = [
    "exec", container, "psql", "--username", "navigator_test", "--dbname",
    "navigator_platform_db_1_test", "--tuples-only", "--no-align", "--no-psqlrc",
    "--set", "ON_ERROR_STOP=1", "--command", "SHOW server_version;",
  ];
  const postgresVersion = parsePostgresVersion(await run("docker", postgresArgs, { cwd: repositoryRoot }));
  const evidence = {
    configuration: { ...FIXED_CONFIGURATION },
    cpu: { capacityCores: capacity.cpuCapacityCores, source: capacity.cpuCapacitySource },
    gitSha,
    imageDigest,
    imageId,
    memory: { limitBytes: capacity.memoryLimitBytes, source: capacity.memoryLimitSource },
    scenarioFileSha256,
    schemaVersion: 1,
    versions: { node: nodeVersion, postgres: postgresVersion, prisma: prismaVersion },
  };
  await writeJsonArtifact(outputPath, evidence);
  return evidence;
}

function assertContainer(value) {
  if (value !== FIXED_CONTAINER) throw new Error("ENV_CONTAINER_INVALID");
  return value;
}

function assertControlledPath(value, relativePath, errorCode, { cwd, repositoryRoot }) {
  const expected = resolve(repositoryRoot, relativePath);
  if (typeof value !== "string" || resolve(cwd, value) !== expected) throw new Error(errorCode);
  return expected;
}

function assertCapacity(value) {
  if (value === null || typeof value !== "object" ||
      !positiveFinite(value.cpuCapacityCores) || !positiveInteger(value.memoryLimitBytes) ||
      !CPU_SOURCES.has(value.cpuCapacitySource) || !MEMORY_SOURCES.has(value.memoryLimitSource)) {
    throw new Error("ENV_CAPACITY_INVALID");
  }
  return value;
}

function assertScenarioFile(raw) {
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!sameKeys(parsed, EXPECTED_SCENARIOS)) throw new Error();
    for (const name of Object.keys(EXPECTED_SCENARIOS)) {
      if (!sameKeys(parsed[name], EXPECTED_SCENARIOS[name])) throw new Error();
      for (const [key, expected] of Object.entries(EXPECTED_SCENARIOS[name])) {
        if (parsed[name][key] !== expected) throw new Error();
      }
    }
  } catch {
    throw new Error("ENV_SCENARIO_FILE_INVALID");
  }
}

function sameKeys(left, right) {
  if (left === null || typeof left !== "object" || Array.isArray(left)) return false;
  return JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort());
}

function parseMatch(output, pattern, errorCode) {
  const value = output.trim();
  if (!pattern.test(value)) throw new Error(errorCode);
  return value;
}

function parsePrismaVersion(output) {
  const matches = output.split(/\r?\n/u).flatMap((line) => {
    const match = PRISMA_VERSION_PATTERN.exec(line);
    return match === null ? [] : [match[1]];
  });
  if (matches.length !== 1) throw new Error("ENV_PRISMA_VERSION_INVALID");
  return matches[0];
}

function parseImageId(output) {
  const value = parseJson(output, "ENV_IMAGE_ID_INVALID");
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error("ENV_IMAGE_ID_INVALID");
  return value;
}

function parseImageDigest(output) {
  const value = parseJson(output, "ENV_IMAGE_DIGEST_INVALID");
  if (!Array.isArray(value)) throw new Error("ENV_IMAGE_DIGEST_INVALID");
  const matches = value.flatMap((entry) => {
    const match = typeof entry === "string" ? /^pgvector\/pgvector@(?<digest>sha256:[0-9a-f]{64})$/u.exec(entry) : null;
    return match?.groups?.digest === undefined ? [] : [match.groups.digest];
  });
  if (matches.length !== 1) throw new Error("ENV_IMAGE_DIGEST_INVALID");
  return matches[0];
}

function parsePostgresVersion(output) {
  const match = POSTGRES_VERSION_PATTERN.exec(output.trim());
  if (match?.groups?.version === undefined) throw new Error("ENV_POSTGRES_VERSION_INVALID");
  return match.groups.version;
}

function parseJson(output, errorCode) {
  try { return JSON.parse(output.trim()); }
  catch { throw new Error(errorCode); }
}

async function safeLstat(path, errorCode, optional = false) {
  try { return await lstat(path); }
  catch (error) {
    if (optional && error?.code === "ENOENT") return undefined;
    throw new Error(errorCode);
  }
}

async function assertInputFile(path) {
  const value = await safeLstat(path, "ENV_SCENARIO_PATH_UNSAFE");
  if (!value.isFile() || value.isSymbolicLink()) throw new Error("ENV_SCENARIO_PATH_UNSAFE");
}

async function assertOutputPath(path) {
  for (const directory of [dirname(dirname(path)), dirname(path)]) {
    const value = await safeLstat(directory, "ENV_OUTPUT_PATH_UNSAFE");
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error("ENV_OUTPUT_PATH_UNSAFE");
  }
  const value = await safeLstat(path, "ENV_OUTPUT_PATH_UNSAFE", true);
  if (value !== undefined && (!value.isFile() || value.isSymbolicLink())) throw new Error("ENV_OUTPUT_PATH_UNSAFE");
}

export async function runCommand(command, arguments_, options) {
  const timeoutMs = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MS;
  const forceKillMs = options.forceKillAfterMilliseconds ?? DEFAULT_FORCE_KILL_MS;
  if (!positiveInteger(timeoutMs) || !positiveInteger(forceKillMs)) throw new Error("ENV_COMMAND_FAILED");
  return new Promise((resolveCommand, rejectCommand) => {
    let child;
    try {
      child = spawn(command, arguments_, {
        cwd: options.cwd,
        env: safeCommandEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      rejectCommand(new Error("ENV_COMMAND_FAILED"));
      return;
    }
    const stdout = [];
    let outputBytes = 0;
    let failed = false;
    let forceKillTimer;
    let terminating = false;
    const terminate = () => {
      failed = true;
      if (terminating) return;
      terminating = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), forceKillMs);
    };
    const timeoutTimer = setTimeout(terminate, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    };
    const consume = (chunk, retain) => {
      outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT_BYTES) terminate();
      else if (retain) stdout.push(chunk);
    };
    child.stdout.on("data", (chunk) => consume(chunk, true));
    child.stderr.on("data", (chunk) => consume(chunk, false));
    child.on("error", () => { clearTimers(); rejectCommand(new Error("ENV_COMMAND_FAILED")); });
    child.on("close", (code, signal) => {
      clearTimers();
      if (failed || code !== 0 || signal !== null) rejectCommand(new Error("ENV_COMMAND_FAILED"));
      else resolveCommand(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function safeCommandEnvironment() {
  return Object.fromEntries(["LANG", "LC_ALL", "PATH"].flatMap((key) =>
    typeof process.env[key] === "string" ? [[key, process.env[key]]] : [],
  ));
}

function positiveFinite(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }

export function parseCliArguments(argv) {
  const allowed = new Set(["--container", "--scenario", "--output"]);
  const parsed = {};
  if (!Array.isArray(argv) || argv.length !== 6) throw new Error("ENV_ARGUMENTS_INVALID");
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || parsed[key] !== undefined || typeof value !== "string" || value.length === 0) throw new Error("ENV_ARGUMENTS_INVALID");
    parsed[key] = value;
  }
  if (Object.keys(parsed).length !== allowed.size) throw new Error("ENV_ARGUMENTS_INVALID");
  return { container: parsed["--container"], output: parsed["--output"], scenario: parsed["--scenario"] };
}

function isEntrypoint() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

async function main(argv = process.argv.slice(2)) {
  await captureBenchmarkEnvironment(parseCliArguments(argv));
}

if (isEntrypoint()) {
  main().catch((error) => {
    const code = error instanceof Error && /^ENV_[A-Z0-9_]+$/u.test(error.message) ? error.message : "ENV_CAPTURE_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
