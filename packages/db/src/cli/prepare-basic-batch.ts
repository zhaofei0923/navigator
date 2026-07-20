import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseBasicBatchArguments,
  validateBasicBatchConfig,
  type BasicBatchConfig,
} from "./basic-batch-config.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "../collection/adapters/basic-global-source-pack.js";
import { createBasicSourceTransportV2 } from "../collection/basic-source-transport-v2.js";
import { parseBasicSourceCatalog } from "../collection/basic-source-catalog.js";
import { createBasicSourceExecutionPlan } from "../collection/basic-source-request-materializer.js";
import { composeBasicCountryCandidate } from "./basic-candidate-composition.js";
import { createBasicV3CandidateComposition } from "./basic-v3-candidate-composition.js";
import { writeBasicCandidateArtifactsV3 } from "./basic-candidate-artifact-writer.js";
import { closeBasicCandidateWorkspace, openBasicCandidateWorkspace } from "./basic-candidate-workspace.js";
import {
  createFilesystemBasicBatchCache,
  BasicBatchExpectedBlockError,
  readBasicBatchCountryInput,
  readOptionalBasicBatchCountryInput,
  readOptionalBasicBatchGlobalInput,
  type BasicBatchCache,
} from "./basic-batch-filesystem-cache.js";
import { readReviewedManualProfileCaptures } from "./basic-batch-manual-profile.js";
import { parseProductionCountryInput } from "./basic-batch-production-input.js";
import { assembleProductionBasicProfile } from "./basic-batch-profile-assembly.js";
import {
  captureWorldBankProfileSourceForBatch,
  readReviewedEmberSnapshotOrUnavailable,
} from "./basic-batch-source-adapters.js";

export { createFilesystemBasicBatchCache } from "./basic-batch-filesystem-cache.js";
export type { BasicBatchCache } from "./basic-batch-filesystem-cache.js";
export {
  bindReviewedGlobalProfileSnapshots,
  parseProductionCountryInput,
  type ReviewedGlobalProfileInput,
} from "./basic-batch-production-input.js";
export {
  bindReviewedManualProfileCaptures,
  readReviewedManualProfileCaptures,
} from "./basic-batch-manual-profile.js";
export { assembleProductionBasicProfile } from "./basic-batch-profile-assembly.js";
export {
  captureWorldBankProfileSourceForBatch,
  createEmberNoCredentialTabularSnapshot,
  readReviewedEmberSnapshotOrUnavailable,
} from "./basic-batch-source-adapters.js";

export type BasicBatchCountryStatus = "ready" | "blocked" | "error";
export interface BasicBatchCountryResult {
  readonly countryCode: string;
  readonly status: BasicBatchCountryStatus;
}
export interface BasicBatchResult {
  readonly batchId: string;
  readonly results: readonly BasicBatchCountryResult[];
}
export interface PrepareBasicBatchInput {
  readonly config: BasicBatchConfig;
  readonly globalSourceIds: readonly string[];
  readonly cache: BasicBatchCache;
  readonly captureGlobalSource: (sourceId: string) => Promise<Uint8Array>;
  readonly prepareCountry: (
    countryCode: string,
    globalCaptures: ReadonlyMap<string, Uint8Array>,
  ) => Promise<Readonly<{ status: BasicBatchCountryStatus; countryCode: string }>>;
}

const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function prepareBasicBatch(input: PrepareBasicBatchInput): Promise<BasicBatchResult> {
  const config = validateBasicBatchConfig(input.config);
  const globalIds = [...input.globalSourceIds];
  if (
    globalIds.length > 16 || new Set(globalIds).size !== globalIds.length ||
    globalIds.some((sourceId) => !SAFE_SOURCE_ID.test(sourceId))
  ) throw new Error("basic batch preparation failed");
  globalIds.sort(compareText);
  const captures = new Map<string, Uint8Array>();
  try {
    for (const sourceId of globalIds) {
      captures.set(sourceId, await input.cache.getOrCapture(sourceId, () => input.captureGlobalSource(sourceId)));
    }
  } catch (error) {
    const status = error instanceof BasicBatchExpectedBlockError ? "blocked" : "error";
    return Object.freeze({
      batchId: config.batchId,
      results: Object.freeze(config.countries.map((countryCode) => Object.freeze({ countryCode, status }))),
    });
  }
  const results = await Promise.all(config.countries.map(async (countryCode) => {
    try {
      const prepared = await input.prepareCountry(countryCode, captures);
      if (prepared.countryCode !== countryCode || !["ready", "blocked", "error"].includes(prepared.status)) {
        throw new Error("invalid result");
      }
      return Object.freeze({ countryCode, status: prepared.status });
    } catch (error) {
      return Object.freeze({
        countryCode,
        status: error instanceof BasicBatchExpectedBlockError ? "blocked" as const : "error" as const,
      });
    }
  }));
  return Object.freeze({ batchId: config.batchId, results: Object.freeze(results) });
}

export interface BasicBatchCliDependencies {
  run(config: BasicBatchConfig): Promise<BasicBatchResult>;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

const USAGE = "Usage: pnpm basic:prepare-batch --countries=ID,VN,SA --batch-id=basic-v2-202607";

export async function runPrepareBasicBatchCli(
  args: readonly string[],
  dependencies?: BasicBatchCliDependencies,
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    (dependencies?.writeStdout ?? process.stdout.write.bind(process.stdout))(`${USAGE}\n`);
    return 0;
  }
  let config: BasicBatchConfig;
  try {
    config = parseBasicBatchArguments(args);
  } catch {
    (dependencies?.writeStderr ?? process.stderr.write.bind(process.stderr))("basic batch error\n");
    return 1;
  }
  try {
    const runtime = dependencies ?? createProductionBasicBatchCliDependencies();
    const result = await runtime.run(config);
    runtime.writeStdout(`${JSON.stringify(result)}\n`);
    return result.results.some(({ status }) => status === "error") ? 1 :
      result.results.some(({ status }) => status === "blocked") ? 2 : 0;
  } catch {
    (dependencies?.writeStderr ?? process.stderr.write.bind(process.stderr))("basic batch error\n");
    return 1;
  }
}

export function createProductionBasicBatchCliDependencies(
  repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url))),
): BasicBatchCliDependencies {
  return Object.freeze({
    async run(config: BasicBatchConfig) {
      const workspace = await openBasicCandidateWorkspace(repoRoot);
      try {
        const approvedCatalog = parseBasicSourceCatalog(JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(await readBasicBatchCountryInput(
            repoRoot, join(repoRoot, "packages", "db", "catalog", "basic-source-catalog.json"),
          )),
        ) as unknown);
        const cache = createFilesystemBasicBatchCache(repoRoot, config.batchId);
        return await prepareBasicBatch({
          config,
          globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
          cache,
          async captureGlobalSource(sourceId) {
            const pathname = join(
              repoRoot, ".cache", "basic-country", "batches", config.batchId,
              "inputs", "global", `${sourceId}.snapshot`,
            );
            if (sourceId === "ember-electricity") {
              return readReviewedEmberSnapshotOrUnavailable(repoRoot, pathname, config.countries);
            }
            const bytes = await readOptionalBasicBatchGlobalInput(repoRoot, pathname);
            if (bytes === null) throw new BasicBatchExpectedBlockError();
            return bytes;
          },
          async prepareCountry(countryCode, globalCaptures) {
            const countryBytes = await readOptionalBasicBatchCountryInput(repoRoot, join(
              repoRoot, ".cache", "basic-country", "batches", config.batchId,
              "inputs", `${countryCode}.json`,
            ));
            if (countryBytes === null) return Object.freeze({ status: "blocked" as const, countryCode });
            const manualCaptures = await readReviewedManualProfileCaptures(repoRoot, config.batchId, countryCode);
            const input = parseProductionCountryInput(countryCode, JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(countryBytes),
            ) as unknown, globalCaptures, manualCaptures);
            const base = await composeBasicCountryCandidate({
              workspace,
              configPath: input.candidateConfigPath,
              transport: createProductionSourceTransport(),
            });
            if (base.status === "blocked") return Object.freeze({ status: "blocked" as const, countryCode });
            if (base.status !== "ready" || base.candidate?.validation?.valid !== true) {
              throw new Error("basic batch base candidate is invalid");
            }
            const profileTransport = createProductionSourceTransport();
            const profilePlan = createBasicSourceExecutionPlan({
              catalog: approvedCatalog,
              countryCode,
              sourceIds: ["world-bank-electricity-access", "world-bank-gdp-per-capita"],
            });
            const additiveWorldBank = await Promise.all(profilePlan.sources.map((entry) =>
              captureWorldBankProfileSourceForBatch(entry, countryCode, profileTransport)
            ));
            const baseBundle = base.candidate.validation.data;
            if (baseBundle.sourceRegister.countryCode !== countryCode) {
              throw new Error("basic batch country identity is invalid");
            }
            const profile = assembleProductionBasicProfile({
              baseBundle,
              additiveWorldBank,
              reviewedProfile: input.reviewedProfile,
            });
            const candidate = createBasicV3CandidateComposition({
              baseBundle,
              basicProfile: profile,
              profileAuditSources: [
                ...additiveWorldBank.map(({ auditSource }) => auditSource),
                ...input.reviewedProfile.auditSources,
              ],
              profileSourceChecks: [
                ...additiveWorldBank.map(({ auditSource }) => ({
                  sourceId: auditSource.sourceId,
                  status: "passed" as const,
                  notes: "strict deterministic adapter validation passed",
                })),
                ...input.reviewedProfile.auditSources.map(({ sourceId }) => ({
                  sourceId,
                  status: "passed" as const,
                  notes: "reviewed immutable source input passed",
                })),
              ],
            });
            await writeBasicCandidateArtifactsV3({ workspace, candidate });
            return Object.freeze({ status: "ready" as const, countryCode });
          },
        });
      } finally {
        await closeBasicCandidateWorkspace(workspace);
      }
    },
    writeStdout(value: string) { process.stdout.write(value); },
    writeStderr(value: string) { process.stderr.write(value); },
  });
}

function createProductionSourceTransport() {
  return createBasicSourceTransportV2(async (url, init) => {
    const response = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    return { status: response.status, headers: response.headers, body: response.body };
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) process.exitCode = await runPrepareBasicBatchCli(process.argv.slice(2));
