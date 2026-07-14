import { realpath } from "node:fs/promises";
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
import {
  closeBasicCandidateWorkspace,
  openBasicCandidateWorkspace,
  type BasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";

export interface BasicCandidateCliDependencies {
  openWorkspace(): Promise<BasicCandidateWorkspace>;
  closeWorkspace(workspace: BasicCandidateWorkspace): Promise<void>;
  createTransport(): BasicSourceTransportV2;
  compose(input: BasicCandidateCompositionInput): Promise<BasicCandidateCompositionResult>;
  write(input: BasicCandidateArtifactWriteInput): Promise<BasicCandidateArtifactWriteResult>;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

const USAGE =
  "Usage: pnpm candidate:basic-country -- .cache/basic-country/<ISO2>/<runId>/candidate-config.json";

let defaultDependencies: Promise<BasicCandidateCliDependencies> | null = null;

export async function runCandidateBasicCountryCli(
  args: readonly string[],
  dependencies?: BasicCandidateCliDependencies,
): Promise<number> {
  if (
    (args.length === 1 && args[0] === "--help") ||
    (args.length === 2 && args[0] === "--" && args[1] === "--help")
  ) {
    emit(dependencies?.writeStdout ?? process.stdout.write.bind(process.stdout), `${USAGE}\n`);
    return 0;
  }
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
  let workspace: BasicCandidateWorkspace | null = null;
  let outcome: "written" | "blocked" | "error" = "error";
  try {
    workspace = await runtime.openWorkspace();
    const transport = runtime.createTransport();
    const composition = await runtime.compose({
      workspace,
      configPath,
      transport,
    });
    if (composition.status === "blocked") {
      outcome = "blocked";
    } else if (composition.status === "ready" && composition.candidate !== null) {
      await runtime.write({ workspace, candidate: composition.candidate });
      outcome = "written";
    }
  } catch {
    outcome = "error";
  } finally {
    if (workspace !== null) {
      try {
        await runtime.closeWorkspace(workspace);
      } catch {
        outcome = "error";
      }
    }
  }
  if (outcome === "written") emit(runtime.writeStdout, "basic candidate written\n");
  else if (outcome === "blocked") emit(runtime.writeStderr, "basic candidate blocked\n");
  else emit(runtime.writeStderr, "basic candidate error\n");
  return outcome === "written" ? 0 : outcome === "blocked" ? 2 : 1;
}

export async function openProductionWorkspace(): Promise<BasicCandidateWorkspace> {
  try {
    const expected = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    if (!isAbsolute(expected)) invalid();
    const current = await realpath(process.cwd());
    const fromRoot = relative(expected, current);
    if (
      fromRoot === ".." || fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) invalid();
    return await openBasicCandidateWorkspace(expected);
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
    openWorkspace: openProductionWorkspace,
    closeWorkspace: closeBasicCandidateWorkspace,
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
    process.exitCode = await runCandidateBasicCountryCli(process.argv.slice(2));
  } catch {
    emit(writeProcessStderr, "basic candidate error\n");
    process.exitCode = 1;
  }
}
