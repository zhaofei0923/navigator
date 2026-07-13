import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

const FILE_TYPE_MASK = 0o170000n;
const REGULAR_FILE_TYPE = 0o100000n;

export type BasicCandidateDirectoryIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  type: bigint;
}>;

export type BasicCandidateRegularFileIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  type: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;

export type BasicCandidateHeldDirectory = Readonly<{
  handle: FileHandle;
  identity: BasicCandidateDirectoryIdentity;
}>;

export function basicCandidateDirectoryIdentity(
  details: BigIntStats,
): BasicCandidateDirectoryIdentity {
  if (!details.isDirectory()) invalid();
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
  });
}

export function basicCandidateRegularFileIdentity(
  details: BigIntStats,
): BasicCandidateRegularFileIdentity {
  if (!details.isFile()) invalid();
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
    mode: details.mode & 0o777n,
    size: details.size,
    mtimeNs: details.mtimeNs,
    ctimeNs: details.ctimeNs,
  });
}

export function sameBasicCandidateDirectoryIdentity(
  left: BasicCandidateDirectoryIdentity,
  right: BasicCandidateDirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.type === right.type;
}

export function sameBasicCandidateRegularFileIdentity(
  details: BigIntStats,
  expected: BasicCandidateRegularFileIdentity,
): boolean {
  return details.isFile() && details.dev === expected.dev && details.ino === expected.ino &&
    (details.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE &&
    (details.mode & 0o777n) === expected.mode && details.size === expected.size &&
    details.mtimeNs === expected.mtimeNs && details.ctimeNs === expected.ctimeNs;
}

export function sameStableBasicCandidateRegularFile(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev &&
    left.ino === right.ino && (left.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE &&
    (right.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export function isBoundedBasicCandidateRegularFile(
  details: BigIntStats,
  maximumBytes: number,
): boolean {
  return details.isFile() && details.size >= 0n && details.size <= BigInt(maximumBytes);
}

function invalid(): never {
  throw new Error("basic candidate constrained filesystem is invalid");
}
