import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseBasicPublicationArguments,
  type BasicPublicationArguments,
  type PublishBasicCountryInput,
} from "./publish-basic-country.js";
import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceRootDirectory,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import {
  locateActiveBasicPublicationSnapshot,
  type ActiveBasicPublicationSnapshot,
} from "./basic-active-publication-snapshot.js";
import {
  locateApprovedBasicPublicationSnapshot,
  type ApprovedBasicPublicationSnapshot,
} from "./basic-publication-snapshot.js";
import { writeRefreshedBasicPublication } from "./basic-refresh-writer.js";

const INPUT_ERROR = "basic refresh input is invalid";
const REFRESH_ERROR = "basic refresh failed";
const USAGE =
  "Usage: pnpm basic:refresh --country=ID --run-id=<runId> --approval-file=<path>";

export interface RefreshBasicCountryResult {
  readonly status: "refreshed";
  readonly countryCode: string;
  readonly countryDirectory: string;
  readonly previousRunId: string;
  readonly activeRunId: string;
  readonly postCommitVerified: boolean;
}

export function parseBasicRefreshArguments(
  args: readonly string[],
): BasicPublicationArguments {
  try {
    return parseBasicPublicationArguments(args);
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

export async function refreshBasicCountry(
  input: PublishBasicCountryInput,
): Promise<RefreshBasicCountryResult> {
  let workspace: Awaited<ReturnType<typeof openBasicCandidateWorkspace>> | null = null;
  let active: ActiveBasicPublicationSnapshot | null = null;
  let target: ApprovedBasicPublicationSnapshot | null = null;
  let result: RefreshBasicCountryResult | null = null;
  let failed = false;
  try {
    const parsed = parseBasicRefreshArguments([
      `--country=${input.countryCode}`,
      `--run-id=${input.runId}`,
      `--approval-file=${input.approvalFile}`,
    ]);
    if (parsed.countryDirectory !== input.countryDirectory) invalidInput();

    workspace = await openBasicCandidateWorkspace(resolve(input.repoRoot));
    const root = getBasicCandidateWorkspaceRootDirectory(workspace);
    active = await locateActiveBasicPublicationSnapshot(
      root,
      parsed.countryDirectory,
    );
    target = await locateApprovedBasicPublicationSnapshot(root, parsed);
    requireIdentityAgreement(parsed, active, target);

    const writeResult = await writeRefreshedBasicPublication(active, target);
    result = Object.freeze({
      status: "refreshed",
      countryCode: parsed.countryCode,
      countryDirectory: parsed.countryDirectory,
      previousRunId: active.runId,
      activeRunId: target.runId,
      postCommitVerified: writeResult.postCommitVerified,
    });
  } catch {
    failed = true;
  } finally {
    const closers: readonly (() => Promise<void>)[] = [
      async () => { await target?.close(); },
      async () => { await active?.close(); },
      async () => {
        if (workspace !== null) await closeBasicCandidateWorkspace(workspace);
      },
    ];
    for (const close of closers) {
      try {
        await close();
      } catch {
        if (result === null) failed = true;
        else result = postCommitWarning(result);
      }
    }
  }

  if (failed || result === null) throw new Error(REFRESH_ERROR);
  return result;
}

function requireIdentityAgreement(
  parsed: BasicPublicationArguments,
  active: ActiveBasicPublicationSnapshot,
  target: ApprovedBasicPublicationSnapshot,
): void {
  if (
    active.countryDirectory !== parsed.countryDirectory ||
    active.countryCode !== parsed.countryCode ||
    target.countryDirectory !== parsed.countryDirectory ||
    target.countryCode !== parsed.countryCode ||
    target.runId !== parsed.runId ||
    active.runId === target.runId
  ) invalidInput();
}

function postCommitWarning(
  result: RefreshBasicCountryResult,
): RefreshBasicCountryResult {
  return Object.freeze({ ...result, postCommitVerified: false });
}

function invalidInput(): never {
  throw new Error(INPUT_ERROR);
}

export interface BasicRefreshCliOutput {
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
}

export async function runBasicRefreshCli(
  args: readonly string[],
  output: BasicRefreshCliOutput = {
    writeStdout: process.stdout.write.bind(process.stdout),
    writeStderr: process.stderr.write.bind(process.stderr),
  },
): Promise<number> {
  if (Array.isArray(args) && args.length === 1 && args[0] === "--help") {
    output.writeStdout(`${USAGE}\n`);
    return 0;
  }
  try {
    const parsed = parseBasicRefreshArguments(args);
    const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    const result = await refreshBasicCountry({ repoRoot, ...parsed });
    output.writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    output.writeStderr("basic refresh error\n");
    return 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  process.exitCode = await runBasicRefreshCli(process.argv.slice(2));
}
