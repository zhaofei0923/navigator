import type { BigIntStats } from "node:fs";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  sep,
} from "node:path";

export interface BasicStableJsonArtifact {
  readonly bytes: Uint8Array;
  readonly value: unknown;
}

export interface BasicStableJsonFileSetRequest<Key extends string> {
  readonly files: Readonly<Record<Key, string>>;
  readonly exactDirectories: readonly Readonly<{
    pathname: string;
    entries: readonly string[];
  }>[];
  readonly maximumBytes: number;
}

const READ_ERROR = "Stable JSON artifacts could not be read";
const FILE_TYPE_MASK = 0o170000n;

type DirectoryExpectation = Readonly<{
  pathname: string;
  entries: readonly string[];
}>;
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
type ValidatedRequest<Key extends string> = Readonly<{
  files: readonly Readonly<{ key: Key; pathname: string }>[];
  exactDirectories: readonly DirectoryExpectation[];
  maximumBytes: number;
}>;

export function readBasicStableJsonFileSet<Key extends string>(
  request: BasicStableJsonFileSetRequest<Key>,
): Readonly<Record<Key, BasicStableJsonArtifact>> {
  try {
    const validated = validateRequest(request);
    const directories = snapshotDirectoryChains(validated);
    const exactDirectoryPaths = new Set(
      validated.exactDirectories.map(({ pathname }) => pathname),
    );
    const exactDirectorySnapshots = directories.filter(({ pathname }) =>
      exactDirectoryPaths.has(pathname));
    if (exactDirectorySnapshots.length !== validated.exactDirectories.length) {
      throw new Error(READ_ERROR);
    }
    requireUniqueSnapshotIdentities(exactDirectorySnapshots);
    for (const expected of validated.exactDirectories) {
      requireExactDirectoryEntries(expected);
    }

    const files = validated.files.map(({ key, pathname }) => Object.freeze({
      key,
      identity: snapshotRegularFile(pathname, validated.maximumBytes),
    }));
    requireUniqueSnapshotIdentities(files.map(({ identity }) => identity));
    const reads = files.map(({ key, identity }) => {
      const bytes = readRegularFile(identity);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return Object.freeze({ key, bytes, value: JSON.parse(text) as unknown });
    });

    for (const { identity } of files) requireUnchangedFile(identity);
    requireUnchangedDirectories(directories);
    for (const expected of validated.exactDirectories) {
      requireExactDirectoryEntries(expected);
    }

    const output: Record<string, BasicStableJsonArtifact> = {};
    for (const { key, bytes, value } of reads) {
      Object.defineProperty(output, key, {
        value: Object.freeze({
          bytes: new Uint8Array(bytes),
          value: recursivelyFreezeJson(value),
        }),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output) as Readonly<Record<Key, BasicStableJsonArtifact>>;
  } catch {
    throw new Error(READ_ERROR);
  }
}

function validateRequest<Key extends string>(
  request: BasicStableJsonFileSetRequest<Key>,
): ValidatedRequest<Key> {
  requireExactObjectKeys(request, ["files", "exactDirectories", "maximumBytes"]);
  const filesValue = ownDataValue(request, "files");
  const directoriesValue = ownDataValue(request, "exactDirectories");
  const maximumBytes = ownDataValue(request, "maximumBytes");
  if (
    !isRecord(filesValue) ||
    !Array.isArray(directoriesValue) ||
    !Number.isSafeInteger(maximumBytes) ||
    (maximumBytes as number) <= 0
  ) throw new Error(READ_ERROR);

  const fileKeys = Reflect.ownKeys(filesValue);
  if (fileKeys.length === 0 || fileKeys.some((key) => typeof key !== "string")) {
    throw new Error(READ_ERROR);
  }
  const files = fileKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(filesValue, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string"
    ) throw new Error(READ_ERROR);
    requireNormalizedAbsolutePath(descriptor.value);
    return Object.freeze({ key: key as Key, pathname: descriptor.value });
  });
  if (new Set(files.map(({ pathname }) => pathname)).size !== files.length) {
    throw new Error(READ_ERROR);
  }

  const exactDirectories = directoriesValue.map((value, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(directoriesValue, index);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error(READ_ERROR);
    }
    requireExactObjectKeys(value, ["pathname", "entries"]);
    const pathname = ownDataValue(value, "pathname");
    const entriesValue = ownDataValue(value, "entries");
    if (typeof pathname !== "string" || !Array.isArray(entriesValue)) {
      throw new Error(READ_ERROR);
    }
    requireNormalizedAbsolutePath(pathname);
    const entries = entriesValue.map((entry, entryIndex) => {
      const entryDescriptor = Object.getOwnPropertyDescriptor(entriesValue, entryIndex);
      if (
        entryDescriptor === undefined ||
        !Object.hasOwn(entryDescriptor, "value") ||
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.includes("\0") ||
        basename(entry) !== entry ||
        entry === "." ||
        entry === ".."
      ) throw new Error(READ_ERROR);
      return entry;
    }).sort();
    if (new Set(entries).size !== entries.length) throw new Error(READ_ERROR);
    return Object.freeze({ pathname, entries: Object.freeze(entries) });
  });
  if (
    new Set(exactDirectories.map(({ pathname }) => pathname)).size !==
      exactDirectories.length
  ) throw new Error(READ_ERROR);

  return Object.freeze({
    files: Object.freeze(files),
    exactDirectories: Object.freeze(exactDirectories),
    maximumBytes: maximumBytes as number,
  });
}

function snapshotDirectoryChains<Key extends string>(
  request: ValidatedRequest<Key>,
): readonly DirectoryIdentity[] {
  const identities = new Map<string, DirectoryIdentity>();
  const targets = new Set([
    ...request.exactDirectories.map(({ pathname }) => pathname),
    ...request.files.map(({ pathname }) => dirname(pathname)),
  ]);
  for (const pathname of targets) {
    const root = parse(pathname).root;
    let current = root;
    if (!identities.has(current)) identities.set(current, snapshotDirectory(current));
    for (const segment of relative(root, pathname).split(sep)) {
      if (segment === "") continue;
      current = join(current, segment);
      if (!identities.has(current)) {
        identities.set(current, snapshotDirectory(current));
      }
    }
  }
  return Object.freeze([...identities.values()]);
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

function snapshotRegularFile(pathname: string, maximumBytes: number): FileIdentity {
  const details = lstatBigInt(pathname);
  if (
    details.isSymbolicLink() ||
    !details.isFile() ||
    details.size > BigInt(maximumBytes)
  ) throw new Error(READ_ERROR);
  return fileIdentity(pathname, details);
}

function readRegularFile(expected: FileIdentity): Uint8Array {
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
    const size = Number(expected.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(READ_ERROR);
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
    return output;
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

function requireExactDirectoryEntries(expected: DirectoryExpectation): void {
  const actual = readdirSync(expected.pathname, { encoding: "utf8" }).sort();
  if (
    actual.length !== expected.entries.length ||
    actual.some((entry, index) => entry !== expected.entries[index])
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

function requireUniqueSnapshotIdentities(
  snapshots: readonly Readonly<{
    dev: bigint;
    ino: bigint;
    type: bigint;
  }>[],
): void {
  const identities = new Set<string>();
  for (const snapshot of snapshots) {
    const identity = `${snapshot.dev}:${snapshot.ino}:${snapshot.type}`;
    if (identities.has(identity)) throw new Error(READ_ERROR);
    identities.add(identity);
  }
}

function recursivelyFreezeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error(READ_ERROR);
    }
    recursivelyFreezeJson(descriptor.value);
  }
  return Object.freeze(value);
}

function requireNormalizedAbsolutePath(pathname: string): void {
  const root = parse(pathname).root;
  if (
    pathname.includes("\0") ||
    !isAbsolute(pathname) ||
    (pathname !== root && pathname.endsWith(sep)) ||
    normalize(pathname) !== pathname
  ) throw new Error(READ_ERROR);
}

function requireExactObjectKeys(value: unknown, expected: readonly string[]): void {
  if (!isRecord(value)) throw new Error(READ_ERROR);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) throw new Error(READ_ERROR);
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
    throw new Error(READ_ERROR);
  }
  return descriptor.value;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lstatBigInt(pathname: string): BigIntStats {
  return lstatSync(pathname, { bigint: true });
}
