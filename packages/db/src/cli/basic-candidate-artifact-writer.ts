import { randomUUID } from "node:crypto";

import { serializeBasicCollectionAuditArtifactsV2 } from "../collection/basic-audit-v2-artifacts.js";
import { isBasicCollectionAuditValidationResultV2FromValidator } from "../collection/basic-collection-v2-validator.js";
import type { BasicCollectionAuditArtifactName } from "../collection/basic-offline-audit-artifacts.js";
import { validArtifacts } from "../collection/basic-deterministic-candidate-guards.js";
import {
  BASIC_DETERMINISTIC_STAGE_NAMES,
  type BasicDeterministicCandidateResult,
} from "../collection/basic-deterministic-candidate-contracts.js";
import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  cleanupBasicCandidateTemporaryDirectory,
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
  ensureBasicCandidateDirectoryChild,
  requireBasicCandidateDirectoryEntries,
  requireBasicCandidateHeldChild,
  setBasicCandidateDirectoryMode,
  syncBasicCandidateDirectory,
  syncBasicCandidateParentDirectory,
  verifyBasicCandidateRegularFile,
  writeBasicCandidateExclusiveFile,
  type BasicCandidateHeldDirectory,
  type BasicCandidateRegularFileIdentity,
} from "./basic-candidate-constrained-fs.js";
import { renameBasicCandidateDirectoryChildNoReplaceNative } from "./basic-candidate-native-fs.js";
import { isBasicCandidateProductionResult } from "./basic-candidate-production-runner.js";
import {
  getBasicCandidateWorkspaceRootDirectory,
  type BasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import { exactBasicCandidateMap } from "./basic-candidate-values.js";

export interface BasicCandidateArtifactWriteInput {
  readonly workspace: BasicCandidateWorkspace;
  readonly candidate: BasicDeterministicCandidateResult;
}

export interface BasicCandidateArtifactWriteResult {
  readonly status: "written";
}

type AuthenticatedArtifacts = Readonly<{
  countryDirectory: string;
  runId: string;
  serialized: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>;
}>;

const ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const INPUT_KEYS = ["workspace", "candidate"] as const;
const RESULT_KEYS = [
  "stages", "failedStage", "validation", "artifacts", "boundaryVerdict",
] as const;
const STAGE_KEYS = ["name", "outcome"] as const;
const BOUNDARY_KEYS = [
  "rawCache", "stagingWrite", "manifest", "canonicalWrite", "prismaWrite",
  "coverageDerivation", "publishAction", "knowledgeChunkCount",
  "aiUsableTrueCount", "aiEligibleKnowledgeIds",
] as const;
const WRITTEN_RESULT: BasicCandidateArtifactWriteResult = Object.freeze({
  status: "written",
});

export async function writeBasicCandidateArtifacts(
  value: BasicCandidateArtifactWriteInput,
): Promise<BasicCandidateArtifactWriteResult> {
  let root: BasicCandidateHeldDirectory | null = null;
  let data: BasicCandidateHeldDirectory | null = null;
  let staging: BasicCandidateHeldDirectory | null = null;
  let country: BasicCandidateHeldDirectory | null = null;
  let temporary: BasicCandidateHeldDirectory | null = null;
  let temporaryName: string | null = null;
  let runId: string | null = null;
  let temporaryOwned = false;
  let published = false;
  let completed = false;
  try {
    const input = exactDataRecord(value, INPUT_KEYS);
    const authenticated = authenticateCandidate(input.get("candidate"));
    runId = authenticated.runId;
    root = getBasicCandidateWorkspaceRootDirectory(
      input.get("workspace") as BasicCandidateWorkspace,
    );
    data = await prepareDirectory(root, "data");
    staging = await prepareDirectory(data, "staging");
    country = await prepareDirectory(staging, authenticated.countryDirectory);
    await requireWriterHierarchy(root, data, staging, country, authenticated.countryDirectory);

    temporaryName = `.candidate-${authenticated.runId}-${randomUUID()}.tmp`;
    temporary = await createBasicCandidateExclusiveDirectory(country, temporaryName, 0o700);
    await setBasicCandidateDirectoryMode(temporary, 0o700);
    await syncBasicCandidateParentDirectory(country);
    await requireBasicCandidateHeldChild(country, temporaryName, temporary);
    temporaryOwned = true;

    const temporaryFiles = await writeAndVerifyArtifacts(
      temporary,
      authenticated.serialized,
      async () => {
        await requireWriterHierarchy(root!, data!, staging!, country!, authenticated.countryDirectory);
        await requireBasicCandidateHeldChild(country!, temporaryName!, temporary!);
      },
    );
    await syncBasicCandidateDirectory(temporary);
    await verifyArtifacts(temporary, temporaryFiles, authenticated.serialized);
    await requireBasicCandidateHeldChild(country, temporaryName, temporary);
    await requireWriterHierarchy(root, data, staging, country, authenticated.countryDirectory);

    renameBasicCandidateDirectoryChildNoReplaceNative(
      country.handle.fd,
      temporaryName,
      authenticated.runId,
      temporary.identity.dev,
      temporary.identity.ino,
    );
    published = true;
    await requireBasicCandidateHeldChild(country, authenticated.runId, temporary);
    await verifyArtifacts(temporary, temporaryFiles, authenticated.serialized);
    await syncBasicCandidateParentDirectory(country);
    await requireBasicCandidateHeldChild(country, authenticated.runId, temporary);
    completed = true;
    return WRITTEN_RESULT;
  } catch {
    throw new Error("basic candidate artifact write failed");
  } finally {
    if (!completed && !published && country !== null && runId !== null) {
      if (temporary !== null && temporaryName !== null && temporaryOwned) {
        await cleanupBasicCandidateTemporaryDirectory(
          country,
          temporaryName,
          temporary,
        );
      }
    }
    await closeBasicCandidateHeldDirectories([
      temporary,
      country,
      staging,
      data,
    ]);
  }
}

function authenticateCandidate(value: unknown): AuthenticatedArtifacts {
  if (!isBasicCandidateProductionResult(value)) invalid();
  const result = exactDataRecord(value, RESULT_KEYS);
  if (
    result.get("failedStage") !== null ||
    !isPassingStages(result.get("stages")) ||
    !isPassingBoundary(result.get("boundaryVerdict"))
  ) invalid();
  const validation = result.get("validation");
  const artifacts = result.get("artifacts");
  if (
    !isBasicCollectionAuditValidationResultV2FromValidator(validation) ||
    !validation.valid || !validation.readyForHumanReview ||
    validation.blockers.length !== 0 || artifacts === null ||
    !validArtifacts(artifacts, validation.data)
  ) invalid();
  const { countryDirectory, runId } = validation.data;
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory) || !SAFE_RUN_ID.test(runId)) invalid();
  const serialized = serializeBasicCollectionAuditArtifactsV2(artifacts);
  if (!sameStrings(Object.keys(serialized), ARTIFACT_NAMES)) invalid();
  return Object.freeze({ countryDirectory, runId, serialized });
}

async function prepareDirectory(
  parent: BasicCandidateHeldDirectory,
  name: string,
): Promise<BasicCandidateHeldDirectory> {
  const result = await ensureBasicCandidateDirectoryChild(parent, name, 0o700);
  try {
    if (result.created) await syncBasicCandidateParentDirectory(parent);
    return result.directory;
  } catch (error) {
    await closeBasicCandidateHeldDirectories([result.directory]);
    throw error;
  }
}

async function requireWriterHierarchy(
  root: BasicCandidateHeldDirectory,
  data: BasicCandidateHeldDirectory,
  staging: BasicCandidateHeldDirectory,
  country: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<void> {
  await requireBasicCandidateHeldChild(root, "data", data);
  await requireBasicCandidateHeldChild(data, "staging", staging);
  await requireBasicCandidateHeldChild(staging, countryDirectory, country);
}

async function writeAndVerifyArtifacts(
  directory: BasicCandidateHeldDirectory,
  serialized: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
  beforeWrite: () => Promise<void>,
): Promise<ReadonlyMap<BasicCollectionAuditArtifactName, BasicCandidateRegularFileIdentity>> {
  const identities = new Map<BasicCollectionAuditArtifactName, BasicCandidateRegularFileIdentity>();
  for (const name of ARTIFACT_NAMES) {
    await beforeWrite();
    identities.set(name, await writeBasicCandidateExclusiveFile(directory, name, serialized[name]));
  }
  return identities;
}

async function verifyArtifacts(
  directory: BasicCandidateHeldDirectory,
  identities: ReadonlyMap<BasicCollectionAuditArtifactName, BasicCandidateRegularFileIdentity>,
  serialized: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
): Promise<void> {
  await requireBasicCandidateDirectoryEntries(directory, ARTIFACT_NAMES);
  for (const name of ARTIFACT_NAMES) {
    const identity = identities.get(name);
    if (identity === undefined) invalid();
    await verifyBasicCandidateRegularFile(directory, name, identity, serialized[name]);
  }
}

function isPassingStages(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== BASIC_DETERMINISTIC_STAGE_NAMES.length) {
    return false;
  }
  return value.every((stage, index) => {
    const record = exactDataRecordOrNull(stage, STAGE_KEYS);
    return record !== null &&
      record.get("name") === BASIC_DETERMINISTIC_STAGE_NAMES[index] &&
      record.get("outcome") === "passed";
  });
}

function isPassingBoundary(value: unknown): boolean {
  const boundary = exactDataRecordOrNull(value, BOUNDARY_KEYS);
  if (boundary === null) return false;
  const eligible = boundary.get("aiEligibleKnowledgeIds");
  return boundary.get("rawCache") === "not-produced" &&
    boundary.get("stagingWrite") === "not-attempted" &&
    boundary.get("manifest") === "not-produced" &&
    boundary.get("canonicalWrite") === "not-attempted" &&
    boundary.get("prismaWrite") === "not-attempted" &&
    boundary.get("coverageDerivation") === "not-attempted" &&
    boundary.get("publishAction") === "not-attempted" &&
    boundary.get("knowledgeChunkCount") === 0 &&
    boundary.get("aiUsableTrueCount") === 0 &&
    Array.isArray(eligible) && eligible.length === 0;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> {
  return exactBasicCandidateMap(value, keys) ?? invalid();
}

function exactDataRecordOrNull(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  return exactBasicCandidateMap(value, keys);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(): never {
  throw new Error("invalid");
}
