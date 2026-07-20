import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SAFE_RUN_ID } from "../seed/basic-country-validation-utils.js";
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import { generateBasicReviewPackFiles } from "./basic-review-pack-filesystem.js";

const ISO2 = /^[A-Z]{2}$/;
const INPUT_ERROR = "basic review pack input is invalid";
const WRITE_ERROR = "basic review pack write failed";
const USAGE = "Usage: pnpm basic:review-pack --country=<ISO2> --run-id=<runId>";

export interface BasicReviewPackArguments {
  readonly countryCode: string;
  readonly runId: string;
}

export interface BasicReviewPackWriteInput extends BasicReviewPackArguments {
  readonly repoRoot: string;
}

export interface BasicReviewPackWriteResult {
  readonly status: "written";
  readonly relativeDirectory: string;
}

export function parseBasicReviewPackArguments(args: readonly string[]): BasicReviewPackArguments {
  try {
    if (!Array.isArray(args) || args.length !== 2) invalidInput();
    const countryArgument = args.find((value) => value.startsWith("--country="));
    const runArgument = args.find((value) => value.startsWith("--run-id="));
    if (countryArgument === undefined || runArgument === undefined) invalidInput();
    const countryCode = countryArgument.slice("--country=".length);
    const runId = runArgument.slice("--run-id=".length);
    if (!ISO2.test(countryCode) || !SAFE_RUN_ID.test(runId)) invalidInput();
    return Object.freeze({ countryCode, runId });
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

export async function writeBasicReviewPack(
  input: BasicReviewPackWriteInput,
): Promise<BasicReviewPackWriteResult> {
  try {
    const validated = parseBasicReviewPackArguments([
      `--country=${input.countryCode}`,
      `--run-id=${input.runId}`,
    ]);
    const repoRoot = resolve(input.repoRoot);
    const workspace = await openBasicCandidateWorkspace(repoRoot);
    try {
      const root = getBasicCandidateWorkspaceRootDirectory(workspace);
      await generateBasicReviewPackFiles(root, validated);
      return Object.freeze({
        status: "written",
        relativeDirectory: `.cache/basic-country/${validated.countryCode}/${validated.runId}/review`,
      });
    } finally {
      await closeBasicCandidateWorkspace(workspace);
    }
  } catch {
    throw new Error(WRITE_ERROR);
  }
}

function invalidInput(): never {
  throw new Error(INPUT_ERROR);
}

export interface BasicReviewPackCliOutput {
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
}

export async function runBasicReviewPackCli(
  args: readonly string[],
  output: BasicReviewPackCliOutput = {
    writeStdout: process.stdout.write.bind(process.stdout),
    writeStderr: process.stderr.write.bind(process.stderr),
  },
): Promise<number> {
  if (Array.isArray(args) && args.length === 1 && args[0] === "--help") {
    output.writeStdout(`${USAGE}\n`);
    return 0;
  }
  try {
    const parsed = parseBasicReviewPackArguments(args);
    const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    const result = await writeBasicReviewPack({ repoRoot, ...parsed });
    output.writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    output.writeStderr("basic review pack error\n");
    return 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  process.exitCode = await runBasicReviewPackCli(process.argv.slice(2));
}
