import type { BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isProxy } from "node:util/types";

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

export interface BasicCandidateArtifactWriteInput {
  readonly repoRoot: string;
  readonly candidate: BasicDeterministicCandidateResult;
}

export interface BasicCandidateArtifactWriteResult {
  readonly status: "written";
}

type Identity = Readonly<{
  pathname: string;
  dev: bigint;
  ino: bigint;
  type: bigint;
}>;

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
const INPUT_KEYS = ["repoRoot", "candidate"] as const;
const RESULT_KEYS = [
  "stages", "failedStage", "validation", "artifacts", "boundaryVerdict",
] as const;
const STAGE_KEYS = ["name", "outcome"] as const;
const BOUNDARY_KEYS = [
  "rawCache", "stagingWrite", "manifest", "canonicalWrite", "prismaWrite",
  "coverageDerivation", "publishAction", "knowledgeChunkCount",
  "aiUsableTrueCount", "aiEligibleKnowledgeIds",
] as const;
const FILE_TYPE_MASK = 0o170000n;
const DIRECTORY_TYPE = 0o040000n;
const REGULAR_FILE_TYPE = 0o100000n;
const WRITTEN_RESULT: BasicCandidateArtifactWriteResult = Object.freeze({
  status: "written",
});

export async function writeBasicCandidateArtifacts(
  value: BasicCandidateArtifactWriteInput,
): Promise<BasicCandidateArtifactWriteResult> {
  let parentIdentity: readonly Identity[] | null = null;
  let temporaryIdentity: Identity | null = null;
  let cleanupPath: string | null = null;
  let completed = false;
  try {
    const input = exactDataRecord(value, INPUT_KEYS);
    const repoRoot = safeRoot(input.get("repoRoot"));
    const authenticated = authenticateCandidate(input.get("candidate"));
    const parent = join(
      repoRoot,
      "data",
      "staging",
      authenticated.countryDirectory,
    );
    const target = join(parent, authenticated.runId);
    const temporary = join(parent, `.candidate-${authenticated.runId}.tmp`);
    parentIdentity = await prepareParent(repoRoot, parent);
    await requireMissing(target);
    await mkdir(temporary, { mode: 0o700 });
    await chmod(temporary, 0o700);
    temporaryIdentity = await snapshotDirectory(temporary);
    cleanupPath = temporary;
    await requireSameIdentities(parentIdentity);

    const fileIdentities = new Map<BasicCollectionAuditArtifactName, Identity>();
    for (const name of ARTIFACT_NAMES) {
      const identity = await writeSyncedFile(
        join(temporary, name),
        authenticated.serialized[name],
      );
      fileIdentities.set(name, identity);
    }
    await syncDirectoryIfSupported(temporary);
    await verifyTemporary(
      temporary,
      temporaryIdentity,
      fileIdentities,
      authenticated.serialized,
    );
    await requireSameIdentities(parentIdentity);
    await requireMissing(target);
    await rename(temporary, target);
    cleanupPath = target;
    await requireSameIdentities(parentIdentity);
    await requireIdentityAt(target, temporaryIdentity, DIRECTORY_TYPE, 0o700);
    await verifyFiles(target, fileIdentities, authenticated.serialized);
    await syncDirectoryIfSupported(parent);
    completed = true;
    return WRITTEN_RESULT;
  } catch {
    throw new Error("basic candidate artifact write failed");
  } finally {
    if (!completed && parentIdentity !== null && temporaryIdentity !== null && cleanupPath !== null) {
      await cleanupOwnedDirectory(parentIdentity, temporaryIdentity, cleanupPath);
    }
  }
}

function authenticateCandidate(value: unknown): AuthenticatedArtifacts {
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
  if (
    !SAFE_COUNTRY_DIRECTORY.test(countryDirectory) ||
    !SAFE_RUN_ID.test(runId)
  ) invalid();
  const serialized = serializeBasicCollectionAuditArtifactsV2(artifacts);
  if (!sameStrings(Object.keys(serialized), ARTIFACT_NAMES)) invalid();
  return Object.freeze({ countryDirectory, runId, serialized });
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

async function prepareParent(
  repoRoot: string,
  target: string,
): Promise<readonly Identity[]> {
  const root = await snapshotDirectory(repoRoot);
  const identities: Identity[] = [root];
  let current = repoRoot;
  for (const segment of ["data", "staging", target.slice(
    join(repoRoot, "data", "staging").length + 1,
  )]) {
    current = join(current, segment);
    let details = await lstatBigInt(current);
    if (details === null) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      details = await lstatBigInt(current);
      await syncDirectoryIfSupported(resolve(current, ".."));
    }
    if (details === null || details.isSymbolicLink() || !details.isDirectory()) invalid();
    identities.push(identity(current, details));
  }
  return Object.freeze(identities);
}

async function writeSyncedFile(
  pathname: string,
  content: Uint8Array,
): Promise<Identity> {
  const file = await open(pathname, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(content);
    await file.sync();
    const details = await file.stat({ bigint: true });
    if (!details.isFile() || details.size !== BigInt(content.byteLength)) invalid();
    return identity(pathname, details);
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function verifyTemporary(
  pathname: string,
  directoryIdentity: Identity,
  fileIdentities: ReadonlyMap<BasicCollectionAuditArtifactName, Identity>,
  content: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
): Promise<void> {
  await requireIdentityAt(pathname, directoryIdentity, DIRECTORY_TYPE, 0o700);
  await verifyFiles(pathname, fileIdentities, content);
}

async function verifyFiles(
  directory: string,
  identities: ReadonlyMap<BasicCollectionAuditArtifactName, Identity>,
  content: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
): Promise<void> {
  const entries = (await readdir(directory)).sort(compareText);
  if (!sameStrings(entries, [...ARTIFACT_NAMES].sort(compareText))) invalid();
  for (const name of ARTIFACT_NAMES) {
    const expected = identities.get(name);
    if (expected === undefined) invalid();
    const pathname = join(directory, name);
    await requireIdentityAt(pathname, expected, REGULAR_FILE_TYPE, 0o600);
    const bytes = new Uint8Array(await readFile(pathname));
    if (!sameBytes(bytes, content[name])) invalid();
    await requireIdentityAt(pathname, expected, REGULAR_FILE_TYPE, 0o600);
  }
}

async function requireMissing(pathname: string): Promise<void> {
  try {
    await lstat(pathname);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  invalid();
}

async function snapshotDirectory(pathname: string): Promise<Identity> {
  const details = await lstat(pathname, { bigint: true });
  if (details.isSymbolicLink() || !details.isDirectory()) invalid();
  return identity(pathname, details);
}

async function requireIdentityAt(
  pathname: string,
  expected: Identity,
  type: bigint,
  mode: number,
): Promise<void> {
  const details = await lstat(pathname, { bigint: true });
  if (
    details.isSymbolicLink() || details.dev !== expected.dev ||
    details.ino !== expected.ino || (details.mode & FILE_TYPE_MASK) !== type ||
    Number(details.mode & 0o777n) !== mode
  ) invalid();
}

async function requireSameIdentities(expected: readonly Identity[]): Promise<void> {
  for (const item of expected) {
    await requireIdentityAt(item.pathname, item, DIRECTORY_TYPE,
      Number((await lstat(item.pathname, { bigint: true })).mode & 0o777n));
  }
}

async function cleanupOwnedDirectory(
  parentIdentity: readonly Identity[],
  owned: Identity,
  pathname: string,
): Promise<void> {
  try {
    await requireSameIdentities(parentIdentity);
    const details = await lstat(pathname, { bigint: true });
    if (
      details.isSymbolicLink() || !details.isDirectory() ||
      details.dev !== owned.dev || details.ino !== owned.ino ||
      (details.mode & FILE_TYPE_MASK) !== owned.type
    ) return;
    await rm(pathname, { recursive: true, force: true });
    await syncDirectoryIfSupported(resolve(pathname, ".."));
  } catch {
    // Leaving an unverified path is safer than following a replaced identity.
  }
}

async function syncDirectoryIfSupported(pathname: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  try {
    directory = await open(pathname, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> {
  return exactDataRecordOrNull(value, keys) ?? invalid();
}

function exactDataRecordOrNull(
  value: unknown,
  keys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    if (
      typeof value !== "object" || value === null || isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return null;
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      result.set(key, descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function safeRoot(value: unknown): string {
  if (
    typeof value !== "string" || !isAbsolute(value) || value.includes("\0") ||
    resolve(value) !== value
  ) invalid();
  return value;
}

function identity(pathname: string, details: BigIntStats): Identity {
  return Object.freeze({
    pathname,
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
  });
}

async function lstatBigInt(pathname: string): Promise<BigIntStats | null> {
  try {
    return await lstat(pathname, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return ["EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
    errorCode(error) ?? "",
  );
}

function invalid(): never {
  throw new Error("invalid");
}
