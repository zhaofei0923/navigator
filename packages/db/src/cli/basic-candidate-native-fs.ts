import { closeSync, constants, fstatSync, openSync, type BigIntStats } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

const FIXED_ERROR = "basic candidate native filesystem operation failed";
const MAX_COMPONENT_BYTES = 255;
const NATIVE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.cache/native/basic-candidate-fs.node",
);

type NativeOperations = Readonly<{
  createExclusiveDirectory(parentDirFd: number, name: string): unknown;
  ensureDirectory(parentDirFd: number, name: string, expectedMode: number): unknown;
  closeDirectory(directoryFd: number): unknown;
  renameNoReplace(
    parentDirFd: number,
    oldName: string,
    newName: string,
    expectedDev: bigint,
    expectedIno: bigint,
  ): unknown;
  unlinkRegularFile(
    parentDirFd: number,
    name: string,
    expectedDev: bigint,
    expectedIno: bigint,
  ): unknown;
  removeDirectory(
    parentDirFd: number,
    name: string,
    expectedDev: bigint,
    expectedIno: bigint,
  ): unknown;
}>;

export type BasicCandidateNativeDirectory = Readonly<{
  fd: number;
  dev: bigint;
  ino: bigint;
}>;

export type BasicCandidateEnsuredNativeDirectory = BasicCandidateNativeDirectory & Readonly<{
  created: boolean;
}>;

const nativeOperations = loadNativeOperations();
const NATIVE_DIRECTORIES = new WeakSet<object>();
const CLOSED_NATIVE_DIRECTORIES = new WeakSet<object>();

export function createBasicCandidateExclusiveDirectoryNative(
  parentDirFd: unknown,
  name: unknown,
): BasicCandidateNativeDirectory {
  try {
    if (nativeOperations === null) invalid();
    const created = parseCreatedDirectory(nativeOperations.createExclusiveDirectory(
      parseDirectoryFd(parentDirFd),
      parseComponent(name),
    ));
    NATIVE_DIRECTORIES.add(created);
    return created;
  } catch {
    invalid();
  }
}

export function ensureBasicCandidateDirectoryNative(
  parentDirFd: unknown,
  name: unknown,
  expectedMode: unknown,
): BasicCandidateEnsuredNativeDirectory {
  try {
    if (nativeOperations === null) invalid();
    const ensured = parseEnsuredDirectory(nativeOperations.ensureDirectory(
      parseDirectoryFd(parentDirFd),
      parseComponent(name),
      parseDirectoryMode(expectedMode),
    ));
    NATIVE_DIRECTORIES.add(ensured);
    return ensured;
  } catch {
    invalid();
  }
}

export function closeBasicCandidateNativeDirectory(
  directory: BasicCandidateNativeDirectory,
): void {
  try {
    if (
      typeof directory !== "object" || directory === null ||
      !NATIVE_DIRECTORIES.has(directory)
    ) invalid();
    if (CLOSED_NATIVE_DIRECTORIES.has(directory)) return;
    if (nativeOperations === null || nativeOperations.closeDirectory(directory.fd) !== "OK") {
      invalid();
    }
    CLOSED_NATIVE_DIRECTORIES.add(directory);
  } catch {
    invalid();
  }
}

export function renameBasicCandidateDirectoryChildNoReplaceNative(
  parentDirFd: unknown,
  oldName: unknown,
  newName: unknown,
  expectedDev: unknown,
  expectedIno: unknown,
): void {
  try {
    if (nativeOperations === null || nativeOperations.renameNoReplace(
      parseDirectoryFd(parentDirFd),
      parseComponent(oldName),
      parseComponent(newName),
      parseIdentity(expectedDev),
      parseIdentity(expectedIno),
    ) !== "OK") invalid();
  } catch {
    invalid();
  }
}

export function unlinkBasicCandidateRegularFileNative(
  parentDirFd: unknown,
  name: unknown,
  expectedDev: unknown,
  expectedIno: unknown,
): void {
  try {
    if (nativeOperations === null || nativeOperations.unlinkRegularFile(
      parseDirectoryFd(parentDirFd),
      parseComponent(name),
      parseIdentity(expectedDev),
      parseIdentity(expectedIno),
    ) !== "OK") invalid();
  } catch {
    invalid();
  }
}

export function removeBasicCandidateDirectoryNative(
  parentDirFd: unknown,
  name: unknown,
  expectedDev: unknown,
  expectedIno: unknown,
): void {
  try {
    if (nativeOperations === null || nativeOperations.removeDirectory(
      parseDirectoryFd(parentDirFd),
      parseComponent(name),
      parseIdentity(expectedDev),
      parseIdentity(expectedIno),
    ) !== "OK") invalid();
  } catch {
    invalid();
  }
}

function loadNativeOperations(): NativeOperations | null {
  let descriptor = -1;
  let result: NativeOperations | null = null;
  try {
    descriptor = openSync(
      NATIVE_PATH,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!validNativeFile(before)) return null;
    const holder = { exports: {} } as unknown as NodeModule;
    process.dlopen(holder, `/proc/self/fd/${descriptor}`);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameNativeFile(before, after)) return null;
    result = parseNativeOperations(holder.exports);
  } catch {
    result = null;
  } finally {
    if (descriptor >= 0) {
      try {
        closeSync(descriptor);
      } catch {
        result = null;
      }
    }
  }
  return result;
}

function parseNativeOperations(binding: unknown): NativeOperations | null {
  if (
    typeof binding !== "object" || binding === null || isProxy(binding) ||
    Object.getPrototypeOf(binding) !== Object.prototype
  ) return null;
  const ownKeys = Reflect.ownKeys(binding);
  if (
    ownKeys.length !== 6 || ownKeys[0] !== "createExclusiveDirectory" ||
    ownKeys[1] !== "ensureDirectory" || ownKeys[2] !== "closeDirectory" ||
    ownKeys[3] !== "renameNoReplace" || ownKeys[4] !== "unlinkRegularFile" ||
    ownKeys[5] !== "removeDirectory"
  ) return null;
  const create = readFunction(binding, "createExclusiveDirectory");
  const ensure = readFunction(binding, "ensureDirectory");
  const close = readFunction(binding, "closeDirectory");
  const rename = readFunction(binding, "renameNoReplace");
  const unlink = readFunction(binding, "unlinkRegularFile");
  const remove = readFunction(binding, "removeDirectory");
  if (
    create === null || ensure === null || close === null || rename === null ||
    unlink === null || remove === null
  ) return null;
  return Object.freeze({
    createExclusiveDirectory: create as NativeOperations["createExclusiveDirectory"],
    ensureDirectory: ensure as NativeOperations["ensureDirectory"],
    closeDirectory: close as NativeOperations["closeDirectory"],
    renameNoReplace: rename as NativeOperations["renameNoReplace"],
    unlinkRegularFile: unlink as NativeOperations["unlinkRegularFile"],
    removeDirectory: remove as NativeOperations["removeDirectory"],
  });
}

function validNativeFile(details: BigIntStats): boolean {
  return details.isFile() && (details.mode & 0o777n) === 0o500n;
}

function sameNativeFile(left: BigIntStats, right: BigIntStats): boolean {
  return validNativeFile(left) && validNativeFile(right) &&
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function parseEnsuredDirectory(value: unknown): BasicCandidateEnsuredNativeDirectory {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== 4 || ownKeys[0] !== "fd" || ownKeys[1] !== "dev" ||
    ownKeys[2] !== "ino" || ownKeys[3] !== "created"
  ) invalid();
  const directory = parseCreatedDirectory(Object.freeze({
    fd: readDataProperty(value, "fd"),
    dev: readDataProperty(value, "dev"),
    ino: readDataProperty(value, "ino"),
  }));
  const created = readDataProperty(value, "created");
  if (typeof created !== "boolean") invalid();
  return Object.freeze({ ...directory, created });
}

function readFunction(value: object, name: string): ((...args: never[]) => unknown) | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (
    descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function" || isProxy(descriptor.value)
  ) return null;
  return descriptor.value as (...args: never[]) => unknown;
}

function parseCreatedDirectory(value: unknown): BasicCandidateNativeDirectory {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== 3 || ownKeys[0] !== "fd" || ownKeys[1] !== "dev" ||
    ownKeys[2] !== "ino"
  ) invalid();
  const fd = readDataProperty(value, "fd");
  const dev = readDataProperty(value, "dev");
  const ino = readDataProperty(value, "ino");
  if (typeof dev !== "bigint" || dev < 0n || typeof ino !== "bigint" || ino < 0n) {
    invalid();
  }
  return Object.freeze({ fd: parseDirectoryFd(fd), dev, ino });
}

function readDataProperty(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) invalid();
  return descriptor.value;
}

function parseDirectoryFd(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isInteger(value) ||
    value < 0 || value > 0x7fff_ffff
  ) invalid();
  return value;
}

function parseIdentity(value: unknown): bigint {
  if (
    typeof value !== "bigint" || value < 0n ||
    value > 0xffff_ffff_ffff_ffffn
  ) invalid();
  return value;
}

function parseDirectoryMode(value: unknown): number {
  if (value !== 0o700 && value !== 0o755) invalid();
  return value;
}

function parseComponent(value: unknown): string {
  if (
    typeof value !== "string" || value === "" || value === "." || value === ".." ||
    value.includes("/") || value.includes("\\") || value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_COMPONENT_BYTES ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) invalid();
  return value;
}

function invalid(): never {
  throw new Error(FIXED_ERROR);
}
