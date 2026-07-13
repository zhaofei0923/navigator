import { closeSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

const FIXED_ERROR = "basic candidate native filesystem operation failed";
const MAX_COMPONENT_BYTES = 255;
const NATIVE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.cache/native/basic-candidate-fs.node",
);
const require = createRequire(import.meta.url);

type NativeOperations = Readonly<{
  createExclusiveDirectory(parentDirFd: number, name: string): unknown;
  renameNoReplace(parentDirFd: number, oldName: string, newName: string): unknown;
}>;

export type BasicCandidateNativeDirectory = Readonly<{
  fd: number;
  dev: bigint;
  ino: bigint;
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

export function closeBasicCandidateNativeDirectory(
  directory: BasicCandidateNativeDirectory,
): void {
  try {
    if (
      typeof directory !== "object" || directory === null ||
      !NATIVE_DIRECTORIES.has(directory)
    ) invalid();
    if (CLOSED_NATIVE_DIRECTORIES.has(directory)) return;
    closeSync(directory.fd);
    CLOSED_NATIVE_DIRECTORIES.add(directory);
  } catch {
    invalid();
  }
}

export function renameBasicCandidateDirectoryChildNoReplaceNative(
  parentDirFd: unknown,
  oldName: unknown,
  newName: unknown,
): void {
  try {
    if (nativeOperations === null || nativeOperations.renameNoReplace(
      parseDirectoryFd(parentDirFd),
      parseComponent(oldName),
      parseComponent(newName),
    ) !== "OK") invalid();
  } catch {
    invalid();
  }
}

function loadNativeOperations(): NativeOperations | null {
  try {
    const details = lstatSync(NATIVE_PATH);
    if (
      details.isSymbolicLink() || !details.isFile() ||
      (details.mode & 0o777) !== 0o500
    ) return null;
    const binding: unknown = require(NATIVE_PATH);
    if (
      typeof binding !== "object" || binding === null || isProxy(binding) ||
      Object.getPrototypeOf(binding) !== Object.prototype
    ) return null;
    const ownKeys = Reflect.ownKeys(binding);
    if (
      ownKeys.length !== 2 || ownKeys[0] !== "createExclusiveDirectory" ||
      ownKeys[1] !== "renameNoReplace"
    ) return null;
    const create = readFunction(binding, "createExclusiveDirectory");
    const rename = readFunction(binding, "renameNoReplace");
    if (create === null || rename === null) return null;
    return Object.freeze({
      createExclusiveDirectory: create as NativeOperations["createExclusiveDirectory"],
      renameNoReplace: rename as NativeOperations["renameNoReplace"],
    });
  } catch {
    return null;
  }
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
