import type { BigIntStats } from "node:fs";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  type BasicCollectionAuditBundle,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_ARTIFACT_MAX_BYTES_V2,
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
} from "./basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";

const READ_ERROR = "Basic collection audit artifacts could not be read";
const MIXED_ERROR = "Basic collection audit artifact versions must not be mixed";
const INVALID_ERROR = "Basic collection audit bundle is invalid";
const FILE_TYPE_MASK = 0o170000n;
const ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const);

type AuditSchemaVersion =
  | typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION
  | typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
type ArtifactName = typeof ARTIFACT_NAMES[number];
type DirectoryIdentity = Readonly<{
  pathname: string;
  dev: bigint;
  ino: bigint;
  type: bigint;
}>;
type FileIdentity = Readonly<{
  pathname: string;
  dev: bigint;
  ino: bigint;
  type: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;

export function loadBasicCollectionAuditBundleVersioned(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2 {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("runId must be a safe run id");
  }

  const artifacts = readArtifacts(repoRoot, countryDirectory, runId);
  const versions = [
    schemaVersionOf(artifacts.sourceRegister),
    schemaVersionOf(artifacts.extractedFacts),
    schemaVersionOf(artifacts.reviewReport),
  ];
  if (versions.some((version) => version === null)) throw new Error(INVALID_ERROR);
  if (!versions.every((version) => version === versions[0])) {
    throw new Error(MIXED_ERROR);
  }

  const bundle = { countryDirectory, runId, ...artifacts };
  if (versions[0] === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) {
    const validation = validateBasicCollectionAuditBundle(bundle);
    if (!validation.valid) throw new Error(INVALID_ERROR);
    return validation.data;
  }
  const validation = validateBasicCollectionAuditBundleV2(bundle);
  if (!validation.valid) throw new Error(INVALID_ERROR);
  return validation.data;
}

function readArtifacts(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly marketOverviewDraft: unknown;
  readonly reviewReport: unknown;
} {
  try {
    const directory = auditDirectory(repoRoot, countryDirectory, runId);
    const directories = snapshotDirectoryChain(directory);
    const files = new Map<ArtifactName, FileIdentity>();
    for (const name of ARTIFACT_NAMES) {
      files.set(name, snapshotRegularFile(join(directory, name)));
    }
    const bytes = new Map<ArtifactName, Uint8Array>();
    for (const name of ARTIFACT_NAMES) {
      const expected = files.get(name);
      if (expected === undefined) throw new Error(READ_ERROR);
      bytes.set(name, readRegularFile(expected, directories));
    }
    requireUnchangedDirectories(directories);
    for (const expected of files.values()) requireUnchangedFile(expected);
    return {
      sourceRegister: parseJson(requiredBytes(bytes, "source-register.json")),
      extractedFacts: parseJson(requiredBytes(bytes, "extracted-facts.json")),
      marketOverviewDraft: parseJson(
        requiredBytes(bytes, "market-overview.draft.json"),
      ),
      reviewReport: parseJson(requiredBytes(bytes, "review-report.json")),
    };
  } catch {
    throw new Error(READ_ERROR);
  }
}

function auditDirectory(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): string {
  if (!isAbsolute(repoRoot) || repoRoot.includes("\0")) {
    throw new Error(READ_ERROR);
  }
  const root = resolve(repoRoot);
  const directory = resolve(
    root,
    "data",
    "staging",
    countryDirectory,
    runId,
  );
  const child = relative(root, directory);
  if (
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) throw new Error(READ_ERROR);
  return directory;
}

function snapshotDirectoryChain(pathname: string): readonly DirectoryIdentity[] {
  const root = parse(pathname).root;
  const identities: DirectoryIdentity[] = [snapshotDirectory(root)];
  let current = root;
  for (const segment of relative(root, pathname).split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    identities.push(snapshotDirectory(current));
  }
  return Object.freeze(identities);
}

function snapshotDirectory(pathname: string): DirectoryIdentity {
  const details = lstatBigInt(pathname);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(READ_ERROR);
  }
  return Object.freeze({
    pathname,
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
  });
}

function snapshotRegularFile(pathname: string): FileIdentity {
  const details = lstatBigInt(pathname);
  if (
    details.isSymbolicLink() ||
    !details.isFile() ||
    details.size > BigInt(BASIC_COLLECTION_AUDIT_ARTIFACT_MAX_BYTES_V2)
  ) throw new Error(READ_ERROR);
  return fileIdentity(pathname, details);
}

function readRegularFile(
  expected: FileIdentity,
  directories: readonly DirectoryIdentity[],
): Uint8Array {
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) throw new Error(READ_ERROR);
  const descriptor = openSync(
    expected.pathname,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameFileSnapshot(expected, before)) {
      throw new Error(READ_ERROR);
    }
    const size = Number(before.size);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > BASIC_COLLECTION_AUDIT_ARTIFACT_MAX_BYTES_V2
    ) throw new Error(READ_ERROR);
    const output = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, output, offset, size - offset, null);
      if (count <= 0) throw new Error(READ_ERROR);
      offset += count;
    }
    if (readSync(descriptor, Buffer.allocUnsafe(1), 0, 1, null) !== 0) {
      throw new Error(READ_ERROR);
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (!after.isFile() || !sameFileSnapshot(expected, after)) {
      throw new Error(READ_ERROR);
    }
    requireUnchangedDirectories(directories);
    requireUnchangedFile(expected);
    return new Uint8Array(output);
  } finally {
    closeSync(descriptor);
  }
}

function requireUnchangedDirectories(
  expected: readonly DirectoryIdentity[],
): void {
  for (const identity of expected) {
    const details = lstatBigInt(identity.pathname);
    if (
      details.isSymbolicLink() ||
      !details.isDirectory() ||
      details.dev !== identity.dev ||
      details.ino !== identity.ino ||
      (details.mode & FILE_TYPE_MASK) !== identity.type
    ) throw new Error(READ_ERROR);
  }
}

function requireUnchangedFile(expected: FileIdentity): void {
  const details = lstatBigInt(expected.pathname);
  if (
    details.isSymbolicLink() ||
    !details.isFile() ||
    !sameFileSnapshot(expected, details)
  ) throw new Error(READ_ERROR);
}

function fileIdentity(pathname: string, details: BigIntStats): FileIdentity {
  return Object.freeze({
    pathname,
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
    size: details.size,
    mtimeNs: details.mtimeNs,
    ctimeNs: details.ctimeNs,
  });
}

function sameFileSnapshot(expected: FileIdentity, actual: BigIntStats): boolean {
  return actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    (actual.mode & FILE_TYPE_MASK) === expected.type &&
    actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs &&
    actual.ctimeNs === expected.ctimeNs;
}

function lstatBigInt(pathname: string): BigIntStats {
  return lstatSync(pathname, { bigint: true });
}

function requiredBytes(
  values: ReadonlyMap<ArtifactName, Uint8Array>,
  name: ArtifactName,
): Uint8Array {
  const value = values.get(name);
  if (value === undefined) throw new Error(READ_ERROR);
  return value;
}

function parseJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function schemaVersionOf(value: unknown): AuditSchemaVersion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return null;
  return descriptor.value === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION ||
    descriptor.value === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION
    ? descriptor.value
    : null;
}
