import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat, mkdir, open as openFile, readFile, rename as renameFile, unlink as unlinkFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { assertEnvironment, assertOutputPath } from "./load-read-only-contract.mjs";

const REQUIRED_ARGUMENTS = Object.freeze(["--base-url", "--metrics-url", "--scenario", "--output"]);

export function parseCliArguments(argv) {
  const parsed = {};
  if (!Array.isArray(argv) || argv.length !== REQUIRED_ARGUMENTS.length * 2) {
    throw new Error("LOAD_ARGUMENTS_INVALID");
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!REQUIRED_ARGUMENTS.includes(key) || parsed[key] !== undefined || typeof value !== "string" || value.length === 0) {
      throw new Error("LOAD_ARGUMENTS_INVALID");
    }
    parsed[key] = value;
  }
  if (Object.keys(parsed).length !== REQUIRED_ARGUMENTS.length) throw new Error("LOAD_ARGUMENTS_INVALID");
  return Object.freeze({
    baseUrl: parsed["--base-url"], metricsUrl: parsed["--metrics-url"],
    output: parsed["--output"], scenario: parsed["--scenario"],
  });
}

export function resolveArtifactPaths(output, scenario, options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const outputPath = assertOutputPath(output, scenario, { cwd: options.cwd, repositoryRoot });
  const artifactDirectory = resolve(repositoryRoot, "artifacts/platform-ops");
  return Object.freeze({
    artifactDirectory,
    environmentPath: resolve(artifactDirectory, "environment.json"),
    outputPath,
    repositoryRoot,
  });
}

export async function prepareArtifactPaths(paths) {
  try {
    await assertDirectory(paths.repositoryRoot);
    await ensureDirectory(resolve(paths.repositoryRoot, "artifacts"));
    await ensureDirectory(paths.artifactDirectory);
    await assertOptionalRegularFile(paths.outputPath);
  } catch {
    throw new Error("LOAD_OUTPUT_PATH_UNSAFE");
  }
}

export async function readEnvironmentArtifact(path, expectedScenarioSha) {
  let raw;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576) throw new Error();
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error("LOAD_ENVIRONMENT_PATH_UNSAFE");
  }
  try {
    return assertEnvironment(JSON.parse(raw), expectedScenarioSha);
  } catch {
    throw new Error("LOAD_ENVIRONMENT_INVALID");
  }
}

export async function writeArtifactAtomic(path, value, options = {}) {
  const token = options.temporaryToken ?? randomUUID();
  if (typeof token !== "string" || !/^[a-z0-9-]{1,64}$/i.test(token)) throw new Error("LOAD_ARTIFACT_WRITE_FAILED");
  const temporaryPath = `${path}.${token}.tmp`;
  const open = options.open ?? openFile;
  const rename = options.rename ?? renameFile;
  const unlink = options.unlink ?? unlinkFile;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  let created = false;
  let handle;
  try {
    handle = await open(temporaryPath, flags, 0o600);
    created = true;
    await handle.writeFile(serialized, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch {
    await handle?.close().catch(() => undefined);
    if (created) await unlink(temporaryPath).catch(() => undefined);
    throw new Error("LOAD_ARTIFACT_WRITE_FAILED");
  }
}

async function ensureDirectory(path) {
  try {
    await assertDirectory(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
    await assertDirectory(path);
  }
}

async function assertDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_DIRECTORY");
}

async function assertOptionalRegularFile(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("UNSAFE_FILE");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function environmentPathForOutput(outputPath) {
  return resolve(dirname(outputPath), "environment.json");
}
