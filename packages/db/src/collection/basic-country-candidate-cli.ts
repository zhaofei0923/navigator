import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseBasicCountryCandidateInput,
  parseBasicCountryCandidateResult,
  type BasicCountryCandidateRuntime,
} from "./basic-country-candidate-contracts.js";
import { BASIC_COUNTRY_CANDIDATE_FILESYSTEM } from "./basic-country-candidate-filesystem.js";
import { runBasicCountryCandidate } from "./basic-country-candidate-runner.js";
import type { BasicLlamaCppFetch } from "./basic-hermes-llama-contracts.js";
import type { BasicSourceFetch } from "./basic-source-transport.js";

const USAGE = "Usage: candidate:basic-country --config <path> --discovery <path> --output-root <path>";
const MAX_INPUT_BYTES = 1_048_576;

export type BasicCountryCandidateCliArgs =
  | { mode: "help" }
  | { mode: "invalid" }
  | { mode: "run"; configPath: string; discoveryPath: string; outputRoot: string };

export interface BasicCountryCandidateCliDependencies {
  repositoryRoot: string;
  readJson(pathname: string): Promise<unknown>;
  runCandidate(input: unknown, runtime: BasicCountryCandidateRuntime): Promise<unknown>;
  sourceFetch: BasicSourceFetch;
  llamaFetch: BasicLlamaCppFetch;
  writeStdout(output: string): void;
  writeStderr(output: string): void;
}

export function classifyBasicCountryCandidateArgs(args: readonly string[]): BasicCountryCandidateCliArgs {
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length === 1 && values[0] === "--help") return { mode: "help" };
  if (values.length !== 6 || values[0] !== "--config" || values[2] !== "--discovery" || values[4] !== "--output-root") return { mode: "invalid" };
  const configPath = values[1]; const discoveryPath = values[3]; const outputRoot = values[5];
  if (configPath === undefined || discoveryPath === undefined || outputRoot === undefined || !configPath || !discoveryPath || !outputRoot) return { mode: "invalid" };
  return { mode: "run", configPath, discoveryPath, outputRoot };
}

export async function runBasicCountryCandidateCli(
  args: readonly string[],
  dependencies: BasicCountryCandidateCliDependencies,
): Promise<number> {
  const parsedArgs = classifyBasicCountryCandidateArgs(args);
  if (parsedArgs.mode === "help") {
    safeWrite(dependencies.writeStdout, `${USAGE}\n`);
    return 0;
  }
  if (parsedArgs.mode === "invalid") {
    safeWrite(dependencies.writeStderr, "INPUT_INVALID\n");
    return 2;
  }

  if (!(await validateOutputRoot(parsedArgs.outputRoot, dependencies.repositoryRoot))) {
    safeWrite(dependencies.writeStderr, "OUTPUT_REJECTED\n");
    return 1;
  }

  let config: unknown;
  let discoveryResponse: unknown;
  try {
    if (!(await validInputFile(parsedArgs.configPath)) || !(await validInputFile(parsedArgs.discoveryPath))) throw new Error("invalid input path");
    config = await dependencies.readJson(parsedArgs.configPath);
    discoveryResponse = await dependencies.readJson(parsedArgs.discoveryPath);
  } catch {
    safeWrite(dependencies.writeStderr, "INPUT_INVALID\n");
    return 1;
  }
  const input = parseBasicCountryCandidateInput({ config, discoveryResponse });
  if (input === null) {
    safeWrite(dependencies.writeStderr, "INPUT_INVALID\n");
    return 1;
  }
  const target = join(parsedArgs.outputRoot, "data", "staging", input.config.countryDirectory, input.config.runId);
  if (!(await targetAvailable(target, parsedArgs.outputRoot))) {
    safeWrite(dependencies.writeStderr, "OUTPUT_REJECTED\n");
    return 1;
  }

  let candidate: unknown;
  try {
    candidate = await dependencies.runCandidate(
      { config, discoveryResponse },
      {
        repositoryRoot: dependencies.repositoryRoot,
        outputRoot: parsedArgs.outputRoot,
        sourceFetch: dependencies.sourceFetch,
        llamaFetch: dependencies.llamaFetch,
        filesystem: BASIC_COUNTRY_CANDIDATE_FILESYSTEM,
      },
    );
  } catch {
    safeWrite(dependencies.writeStderr, "AUDIT_INVALID\n");
    return 1;
  }
  const result = parseBasicCountryCandidateResult(candidate, input.config);
  if (result === null) {
    safeWrite(dependencies.writeStderr, "AUDIT_INVALID\n");
    return 1;
  }
  let output: string;
  try { output = `${JSON.stringify(result)}\n`; }
  catch { safeWrite(dependencies.writeStderr, "AUDIT_INVALID\n"); return 1; }
  if (!safeWrite(dependencies.writeStdout, output)) {
    safeWrite(dependencies.writeStderr, "AUDIT_INVALID\n");
    return 1;
  }
  if (!result.ok) {
    safeWrite(dependencies.writeStderr, `${result.code}\n`);
    return 1;
  }
  return 0;
}

function safeWrite(write: (output: string) => void, output: string): boolean {
  try { write(output); return true; } catch { return false; }
}

async function validateOutputRoot(outputRoot: string, repositoryRoot: string): Promise<boolean> {
  try {
    if (!cleanAbsolute(outputRoot) || !cleanAbsolute(repositoryRoot)) return false;
    const temporaryRoots = await trustedTemporaryRoots();
    const repository = await realpath(repositoryRoot);
    const ancestor = await nearestExistingAncestor(outputRoot);
    if (ancestor === null) return false;
    const ancestorReal = await realpath(ancestor);
    if (!(await belongsToTrustedTemporaryRoot(temporaryRoots, ancestor, ancestorReal)) || inside(repository, resolve(outputRoot))) return false;
    const details = await lstat(outputRoot).catch(() => null);
    if (details !== null && (!details.isDirectory() || details.isSymbolicLink())) return false;
    const staging = join(outputRoot, "data", "staging");
    const stagingDetails = await lstat(staging).catch(() => null);
    if (stagingDetails !== null) return false;
    return true;
  } catch { return false; }
}

async function validInputFile(pathname: string): Promise<boolean> {
  try {
    if (!cleanAbsolute(pathname)) return false;
    const temporaryRoots = await trustedTemporaryRoots();
    const actual = await realpath(pathname);
    if (actual !== pathname || !(await belongsToTrustedTemporaryRoot(temporaryRoots, pathname, actual))) return false;
    const details = await lstat(pathname);
    return details.isFile() && !details.isSymbolicLink() && details.size <= MAX_INPUT_BYTES;
  } catch { return false; }
}

async function trustedTemporaryRoots(): Promise<string[]> {
  const configured = process.platform === "linux" ? [tmpdir(), "/tmp"] : [tmpdir()];
  const roots: string[] = [];
  for (const value of configured) {
    try {
      const root = await realpath(value);
      const details = await lstat(root);
      if (details.isDirectory() && !details.isSymbolicLink() && !roots.includes(root)) roots.push(root);
    } catch { /* An invalid inherited temp root must not hide another trusted root. */ }
  }
  return roots;
}

async function belongsToTrustedTemporaryRoot(
  roots: readonly string[],
  pathname: string,
  actual: string,
): Promise<boolean> {
  for (const root of roots) {
    if (inside(root, actual) && await pathHasNoSymlink(root, pathname)) return true;
  }
  return false;
}

async function targetAvailable(target: string, outputRoot: string): Promise<boolean> {
  try {
    if (!inside(resolve(outputRoot), resolve(target)) || await lstat(target).then(() => true, () => false)) return false;
    return await nearestExistingAncestor(target) !== null;
  } catch { return false; }
}

async function nearestExistingAncestor(pathname: string): Promise<string | null> {
  let current = pathname;
  for (;;) {
    const details = await lstat(current).catch(() => null);
    if (details !== null) return details.isSymbolicLink() ? null : current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathHasNoSymlink(root: string, descendant: string): Promise<boolean> {
  if (!inside(root, descendant) && resolve(root) !== resolve(descendant)) return false;
  const parts = relative(resolve(root), resolve(descendant)).split(sep).filter(Boolean);
  let current = resolve(root);
  const rootDetails = await lstat(current);
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) return false;
  for (const part of parts) {
    current = join(current, part);
    const details = await lstat(current).catch(() => null);
    if (details === null) break;
    if (details.isSymbolicLink()) return false;
  }
  return true;
}

function cleanAbsolute(value: string): boolean {
  return isAbsolute(value) && !value.includes("\0") && resolve(value) === value;
}

function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function deriveRepositoryRoot(): Promise<string> {
  const modulePath = fileURLToPath(import.meta.url);
  const actualModule = await realpath(modulePath);
  if (actualModule !== modulePath) throw new Error("repository root rejected");
  const expected = resolve(dirname(modulePath), "../../../..");
  const repositoryRoot = await realpath(expected);
  if (repositoryRoot !== expected || !(await pathHasNoSymlink(repositoryRoot, modulePath))) throw new Error("repository root rejected");
  const markers = await Promise.all(["AGENTS.md", "pnpm-workspace.yaml", "packages/db/package.json"].map(async (name) => {
    const details = await lstat(join(repositoryRoot, name));
    return details.isFile() && !details.isSymbolicLink();
  }));
  if (markers.some((valid) => !valid)) throw new Error("repository root rejected");
  return repositoryRoot;
}

async function readJson(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, "utf8")) as unknown;
}

const sourceFetch: BasicSourceFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, headers: response.headers, body: response.body };
};
const llamaFetch: BasicLlamaCppFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, redirected: response.redirected, headers: response.headers, body: response.body };
};

async function main(): Promise<number> {
  if (classifyBasicCountryCandidateArgs(process.argv.slice(2)).mode === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    return await runBasicCountryCandidateCli(process.argv.slice(2), {
      repositoryRoot: await deriveRepositoryRoot(),
      readJson,
      runCandidate: runBasicCountryCandidate,
      sourceFetch,
      llamaFetch,
      writeStdout: (output) => process.stdout.write(output),
      writeStderr: (output) => process.stderr.write(output),
    });
  } catch {
    process.stderr.write("OUTPUT_REJECTED\n");
    return 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) process.exitCode = await main();
