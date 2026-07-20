import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import { writeApprovedBasicPublication } from "./basic-publication-writer.js";
import { locateApprovedBasicPublicationSnapshot } from "./basic-publication-snapshot.js";

const ISO2 = /^[A-Z]{2}$/;
const INPUT_ERROR = "basic publication input is invalid";
const PUBLISH_ERROR = "basic publication failed";
const USAGE =
  "Usage: pnpm basic:publish --country=ID --run-id=<runId> --approval-file=<path>";

export interface BasicPublicationArguments {
  readonly countryCode: string;
  readonly runId: string;
  readonly countryDirectory: string;
  readonly approvalFile: string;
}

export interface PublishBasicCountryInput extends BasicPublicationArguments {
  readonly repoRoot: string;
}

export interface PublishBasicCountryResult {
  readonly status: "published";
  readonly countryCode: string;
  readonly runId: string;
  readonly relativeDirectory: string;
}

export function parseBasicPublicationArguments(
  args: readonly string[],
): BasicPublicationArguments {
  try {
    if (!Array.isArray(args) || args.length !== 3) invalidInput();
    const country = uniqueArgument(args, "--country=");
    const run = uniqueArgument(args, "--run-id=");
    const approvalFile = uniqueArgument(args, "--approval-file=");
    if (!ISO2.test(country) || !SAFE_RUN_ID.test(run)) invalidInput();
    const segments = approvalFile.split("/");
    if (
      segments.length !== 4 || segments[0] !== "data" ||
      segments[1] !== "approvals" || !SAFE_COUNTRY_DIRECTORY.test(segments[2]!) ||
      segments[3] !== `${run}.json` ||
      approvalFile !== `data/approvals/${segments[2]}/${run}.json`
    ) invalidInput();
    return Object.freeze({
      countryCode: country,
      runId: run,
      countryDirectory: segments[2]!,
      approvalFile,
    });
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

export async function publishBasicCountry(
  input: PublishBasicCountryInput,
): Promise<PublishBasicCountryResult> {
  let workspace: Awaited<ReturnType<typeof openBasicCandidateWorkspace>> | null = null;
  let snapshot: Awaited<ReturnType<typeof locateApprovedBasicPublicationSnapshot>> | null = null;
  let result: PublishBasicCountryResult | null = null;
  let failed = false;
  try {
    const parsed = parseBasicPublicationArguments([
      `--country=${input.countryCode}`,
      `--run-id=${input.runId}`,
      `--approval-file=${input.approvalFile}`,
    ]);
    if (parsed.countryDirectory !== input.countryDirectory) invalidInput();
    workspace = await openBasicCandidateWorkspace(resolve(input.repoRoot));
    const root = getBasicCandidateWorkspaceRootDirectory(workspace);
    snapshot = await locateApprovedBasicPublicationSnapshot(root, parsed);
    await writeApprovedBasicPublication(snapshot);
    result = Object.freeze({
      status: "published",
      countryCode: parsed.countryCode,
      runId: parsed.runId,
      relativeDirectory: `data/${parsed.countryDirectory}`,
    });
  } catch {
    failed = true;
  } finally {
    try {
      await snapshot?.close();
    } catch {
      if (result === null) failed = true;
    } finally {
      if (workspace !== null) {
        try {
          await closeBasicCandidateWorkspace(workspace);
        } catch {
          if (result === null) failed = true;
        }
      }
    }
  }
  if (failed || result === null) throw new Error(PUBLISH_ERROR);
  return result;
}

function uniqueArgument(args: readonly string[], prefix: string): string {
  const matches = args.filter((value) => typeof value === "string" && value.startsWith(prefix));
  if (matches.length !== 1) invalidInput();
  const value = matches[0]!.slice(prefix.length);
  if (value === "") invalidInput();
  return value;
}

function invalidInput(): never {
  throw new Error(INPUT_ERROR);
}

export interface BasicPublicationCliOutput {
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
}

export async function runBasicPublicationCli(
  args: readonly string[],
  output: BasicPublicationCliOutput = {
    writeStdout: process.stdout.write.bind(process.stdout),
    writeStderr: process.stderr.write.bind(process.stderr),
  },
): Promise<number> {
  if (Array.isArray(args) && args.length === 1 && args[0] === "--help") {
    output.writeStdout(`${USAGE}\n`);
    return 0;
  }
  try {
    const parsed = parseBasicPublicationArguments(args);
    const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    const result = await publishBasicCountry({ repoRoot, ...parsed });
    output.writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    output.writeStderr("basic publication error\n");
    return 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  process.exitCode = await runBasicPublicationCli(process.argv.slice(2));
}
