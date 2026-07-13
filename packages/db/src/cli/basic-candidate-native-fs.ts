import { lstatSync } from "node:fs";
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

type NativeRenameNoReplace = (
  parentDirFd: number,
  oldName: string,
  newName: string,
) => unknown;

let nativeRenameNoReplace: NativeRenameNoReplace | null = null;

export function renameBasicCandidateDirectoryChildNoReplaceNative(
  parentDirFd: unknown,
  oldName: unknown,
  newName: unknown,
): void {
  try {
    const parsedFd = parseDirectoryFd(parentDirFd);
    const parsedOldName = parseComponent(oldName);
    const parsedNewName = parseComponent(newName);
    if (loadNativeRenameNoReplace()(parsedFd, parsedOldName, parsedNewName) !== "OK") {
      invalid();
    }
  } catch {
    invalid();
  }
}

function loadNativeRenameNoReplace(): NativeRenameNoReplace {
  const details = lstatSync(NATIVE_PATH);
  if (
    details.isSymbolicLink() || !details.isFile() ||
    (details.mode & 0o777) !== 0o500
  ) invalid();
  if (nativeRenameNoReplace !== null) return nativeRenameNoReplace;

  const binding: unknown = require(NATIVE_PATH);
  if (
    typeof binding !== "object" || binding === null || isProxy(binding) ||
    Object.getPrototypeOf(binding) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(binding);
  if (ownKeys.length !== 1 || ownKeys[0] !== "renameNoReplace") invalid();
  const descriptor = Object.getOwnPropertyDescriptor(binding, "renameNoReplace");
  if (
    descriptor === undefined || !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function" || isProxy(descriptor.value)
  ) invalid();
  nativeRenameNoReplace = descriptor.value as NativeRenameNoReplace;
  return nativeRenameNoReplace;
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
