import { lstat, readFile, realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { BasicSourceFetchV2 } from "../collection/basic-source-transport-v2.js";
import type { BasicSourceTransportV2 } from "../collection/basic-source-v2-contracts.js";
import type {
  BasicCandidateArtifactWriteInput,
  BasicCandidateArtifactWriteResult,
} from "./basic-candidate-artifact-writer.js";
import type {
  BasicCandidateCompositionInput,
  BasicCandidateCompositionResult,
} from "./basic-candidate-composition.js";

export interface BasicCandidateCliDependencies {
  resolveRepoRoot(): Promise<string>;
  createTransport(): BasicSourceTransportV2;
  compose(input: BasicCandidateCompositionInput): Promise<BasicCandidateCompositionResult>;
  write(input: BasicCandidateArtifactWriteInput): Promise<BasicCandidateArtifactWriteResult>;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

let defaultDependencies: Promise<BasicCandidateCliDependencies> | null = null;

export async function runCandidateBasicCountryCli(
  args: readonly string[],
  dependencies?: BasicCandidateCliDependencies,
): Promise<number> {
  const configPath = Array.isArray(args) && args.length === 2 && args[0] === "--"
    ? args[1]
    : Array.isArray(args) && args.length === 1
      ? args[0]
      : undefined;
  if (
    typeof configPath !== "string" || configPath.length === 0 ||
    configPath.startsWith("-")
  ) {
    emit(dependencies?.writeStderr ?? writeProcessStderr, "basic candidate error\n");
    return 1;
  }
  let runtime: BasicCandidateCliDependencies;
  try {
    runtime = dependencies ?? await loadDefaultDependencies();
  } catch {
    emit(dependencies?.writeStderr ?? writeProcessStderr, "basic candidate error\n");
    return 1;
  }
  try {
    const repoRoot = await runtime.resolveRepoRoot();
    const transport = runtime.createTransport();
    const composition = await runtime.compose({
      repoRoot,
      configPath,
      transport,
    });
    if (composition.status === "blocked") {
      emit(runtime.writeStderr, "basic candidate blocked\n");
      return 2;
    }
    if (composition.status !== "ready" || composition.candidate === null) {
      emit(runtime.writeStderr, "basic candidate error\n");
      return 1;
    }
    await runtime.write({ repoRoot, candidate: composition.candidate });
    emit(runtime.writeStdout, "basic candidate written\n");
    return 0;
  } catch {
    emit(runtime.writeStderr, "basic candidate error\n");
    return 1;
  }
}

export async function resolveProductionRepoRoot(): Promise<string> {
  try {
    const expected = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    const root = await realpath(expected);
    if (root !== expected || !isAbsolute(root)) invalid();
    const rootDetails = await lstat(root);
    if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) invalid();
    const current = await realpath(process.cwd());
    const fromRoot = relative(root, current);
    if (
      fromRoot === ".." || fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) invalid();
    await requireWorkspaceFile(root, "pnpm-workspace.yaml");
    const packageJson = await readWorkspaceJson(root, "package.json");
    const dbPackageJson = await readWorkspaceJson(root, "packages/db/package.json");
    if (packageJson.name !== "navigator" || dbPackageJson.name !== "@navigator/db") {
      invalid();
    }
    return root;
  } catch {
    throw new Error("basic candidate workspace is invalid");
  }
}

function createProductionTransport(
  createTransport: typeof import("../collection/basic-source-transport-v2.js")["createBasicSourceTransportV2"],
): BasicSourceTransportV2 {
  const fetchImpl: BasicSourceFetchV2 = async (url, init) => {
    const response = await globalThis.fetch(url, init);
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  };
  return createTransport(fetchImpl);
}

async function loadDefaultDependencies(): Promise<BasicCandidateCliDependencies> {
  defaultDependencies ??= Promise.all([
    import("../collection/basic-source-transport-v2.js"),
    import("./basic-candidate-composition.js"),
    import("./basic-candidate-artifact-writer.js"),
  ]).then(([transportModule, compositionModule, writerModule]) => Object.freeze({
    resolveRepoRoot: resolveProductionRepoRoot,
    createTransport() {
      return createProductionTransport(transportModule.createBasicSourceTransportV2);
    },
    compose: compositionModule.composeBasicCountryCandidate,
    write: writerModule.writeBasicCandidateArtifacts,
    writeStdout(value: string) {
      process.stdout.write(value);
    },
    writeStderr(value: string) {
      process.stderr.write(value);
    },
  }));
  return defaultDependencies;
}

function registerLocalTypeScriptResolution(): void {
  const sourceRoot = new URL("../", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier.startsWith(".") && specifier.endsWith(".js") &&
        context.parentURL?.startsWith(sourceRoot) === true
      ) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

async function requireWorkspaceFile(root: string, child: string): Promise<void> {
  const pathname = resolve(root, child);
  const details = await lstat(pathname);
  if (details.isSymbolicLink() || !details.isFile()) invalid();
}

async function readWorkspaceJson(
  root: string,
  child: string,
): Promise<{ readonly name?: unknown }> {
  await requireWorkspaceFile(root, child);
  const value: unknown = JSON.parse(await readFile(resolve(root, child), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as { readonly name?: unknown };
}

function emit(writer: (value: string) => void, value: string): void {
  try {
    writer(value);
  } catch {
    // Output failures do not expose dependency or filesystem details.
  }
}

function writeProcessStderr(value: string): void {
  process.stderr.write(value);
}

function invalid(): never {
  throw new Error("invalid");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  try {
    registerLocalTypeScriptResolution();
    process.exitCode = await runCandidateBasicCountryCli(process.argv.slice(2));
  } catch {
    emit(writeProcessStderr, "basic candidate error\n");
    process.exitCode = 1;
  }
}
