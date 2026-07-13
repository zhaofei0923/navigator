import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import {
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { isProxy } from "node:util/types";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";

export const BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION =
  "basic-country-candidate-config/v1" as const;

export interface BasicCountryCandidateConfig {
  readonly schemaVersion:
    typeof BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION;
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly sourceIds: readonly string[];
  readonly structuredReviewPath: string | null;
  readonly manualReviewPath: string | null;
  readonly documentPlanPaths: readonly string[];
  readonly editorialInputPath: string;
}

export interface LoadedBasicCandidateConfig {
  readonly config: BasicCountryCandidateConfig;
}

type FileIdentity = Readonly<{
  pathname: string;
  dev: bigint;
  ino: bigint;
  type: bigint;
}>;

type LoadedProvenance = Readonly<{
  runDirectory: string;
  runIdentity: readonly FileIdentity[];
  allowedPaths: ReadonlySet<string>;
}>;

const CONFIG_KEYS = [
  "schemaVersion",
  "countryDirectory",
  "countryCode",
  "runId",
  "sourceIds",
  "structuredReviewPath",
  "manualReviewPath",
  "documentPlanPaths",
  "editorialInputPath",
] as const;
const CONFIG_PATH =
  /^\.cache\/basic-country\/([A-Z]{2})\/([A-Za-z0-9][A-Za-z0-9_-]*)\/candidate-config\.json$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO2 = /^[A-Z]{2}$/;
const FILE_TYPE_MASK = 0o170000n;
const MAX_ACTIVE_SOURCES = 64;
const MAX_DOCUMENT_PLANS = 64;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const CATALOG_CHILD = "packages/db/catalog/basic-source-catalog.json";
const LOADED_PROVENANCE = new WeakMap<object, LoadedProvenance>();

export function parseBasicCandidateConfig(
  value: unknown,
): BasicCountryCandidateConfig {
  try {
    const record = exactDataRecord(value, CONFIG_KEYS);
    if (
      record.schemaVersion !== BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION ||
      typeof record.countryDirectory !== "string" ||
      !SAFE_COUNTRY_DIRECTORY.test(record.countryDirectory) ||
      typeof record.countryCode !== "string" ||
      !ISO2.test(record.countryCode) ||
      typeof record.runId !== "string" ||
      !SAFE_RUN_ID.test(record.runId)
    ) invalid();
    const sourceIds = sortedIds(record.sourceIds);
    const structuredReviewPath = nullableChildPath(record.structuredReviewPath);
    const manualReviewPath = nullableChildPath(record.manualReviewPath);
    const documentPlanPaths = sortedPaths(record.documentPlanPaths);
    const editorialInputPath = childPath(record.editorialInputPath);
    const paths = [
      ...(structuredReviewPath === null ? [] : [structuredReviewPath]),
      ...(manualReviewPath === null ? [] : [manualReviewPath]),
      ...documentPlanPaths,
      editorialInputPath,
    ];
    if (new Set(paths).size !== paths.length) invalid();
    return deepFreeze({
      schemaVersion: BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
      countryDirectory: record.countryDirectory,
      countryCode: record.countryCode,
      runId: record.runId,
      sourceIds,
      structuredReviewPath,
      manualReviewPath,
      documentPlanPaths,
      editorialInputPath,
    });
  } catch {
    throw new Error("basic candidate config is invalid");
  }
}

export async function loadBasicCandidateConfig(
  repoRoot: string,
  configPath: string,
): Promise<LoadedBasicCandidateConfig> {
  try {
    const root = trustedRoot(repoRoot);
    if (typeof configPath !== "string" || configPath.includes("\0")) invalid();
    const match = CONFIG_PATH.exec(configPath);
    if (match === null || posix.normalize(configPath) !== configPath) invalid();
    const value = await readBoundedJson(root, configPath);
    const config = parseBasicCandidateConfig(value);
    if (config.countryCode !== match[1] || config.runId !== match[2]) invalid();
    const runDirectory = join(root, ".cache", "basic-country", config.countryCode, config.runId);
    const runIdentity = await snapshotDirectories(root, runDirectory);
    const loaded = Object.freeze({ config });
    LOADED_PROVENANCE.set(loaded, Object.freeze({
      runDirectory,
      runIdentity,
      allowedPaths: new Set([
        ...(config.structuredReviewPath === null ? [] : [config.structuredReviewPath]),
        ...(config.manualReviewPath === null ? [] : [config.manualReviewPath]),
        ...config.documentPlanPaths,
        config.editorialInputPath,
      ]),
    }));
    return loaded;
  } catch {
    throw new Error("basic candidate config is invalid");
  }
}

export async function readBasicCandidateConfigInput(
  loaded: LoadedBasicCandidateConfig,
  inputPath: string,
): Promise<unknown> {
  try {
    const provenance = typeof loaded === "object" && loaded !== null
      ? LOADED_PROVENANCE.get(loaded)
      : undefined;
    if (
      provenance === undefined ||
      typeof inputPath !== "string" ||
      !provenance.allowedPaths.has(inputPath) ||
      childPath(inputPath) !== inputPath
    ) invalid();
    await requireSameDirectories(provenance.runIdentity);
    const value = await readBoundedJson(provenance.runDirectory, inputPath);
    await requireSameDirectories(provenance.runIdentity);
    return value;
  } catch {
    throw new Error("basic candidate input is invalid");
  }
}

export async function readBasicCandidateCatalog(repoRoot: string): Promise<unknown> {
  try {
    return await readBoundedJson(trustedRoot(repoRoot), CATALOG_CHILD);
  } catch {
    throw new Error("basic candidate catalog is invalid");
  }
}

async function readBoundedJson(root: string, child: string): Promise<unknown> {
  const pathname = confinedChild(root, child);
  const directories = await snapshotDirectories(root, resolve(pathname, ".."));
  const before = await lstat(pathname, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() ||
    before.size > BigInt(MAX_INPUT_BYTES)
  ) invalid();
  const handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(before, opened)) invalid();
    await requireSameDirectories(directories);
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_INPUT_BYTES) invalid();
    const afterRead = await handle.stat({ bigint: true });
    if (!sameStableFile(opened, afterRead)) invalid();
    const afterPath = await lstat(pathname, { bigint: true });
    if (!sameStableFile(afterRead, afterPath)) invalid();
    await requireSameDirectories(directories);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function snapshotDirectories(
  root: string,
  target: string,
): Promise<readonly FileIdentity[]> {
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) invalid();
  const identities: FileIdentity[] = [];
  let current = root;
  identities.push(await directoryIdentity(current));
  for (const segment of child.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    identities.push(await directoryIdentity(current));
  }
  return Object.freeze(identities);
}

async function directoryIdentity(pathname: string): Promise<FileIdentity> {
  const details = await lstat(pathname, { bigint: true });
  if (details.isSymbolicLink() || !details.isDirectory()) invalid();
  return Object.freeze({
    pathname,
    dev: details.dev,
    ino: details.ino,
    type: details.mode & FILE_TYPE_MASK,
  });
}

async function requireSameDirectories(values: readonly FileIdentity[]): Promise<void> {
  for (const expected of values) {
    const actual = await directoryIdentity(expected.pathname);
    if (
      actual.dev !== expected.dev || actual.ino !== expected.ino ||
      actual.type !== expected.type
    ) invalid();
  }
}

function trustedRoot(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) invalid();
  const normalized = resolve(value);
  if (normalized !== value) invalid();
  return normalized;
}

function confinedChild(root: string, child: string): string {
  if (childPath(child) !== child) invalid();
  const pathname = resolve(root, ...child.split("/"));
  const confined = relative(root, pathname);
  if (confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) invalid();
  return pathname;
}

function exactDataRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  const result = {} as Record<Keys[number], unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) invalid();
    (result as Record<string, unknown>)[key] = descriptor.value;
  }
  return result;
}

function sortedIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ACTIVE_SOURCES) invalid();
  const result = value.map((item) => {
    if (typeof item !== "string" || !SOURCE_ID.test(item)) invalid();
    return item;
  });
  requireSortedUnique(result);
  return Object.freeze(result);
}

function sortedPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_DOCUMENT_PLANS) invalid();
  const result = value.map(childPath);
  requireSortedUnique(result);
  return Object.freeze(result);
}

function nullableChildPath(value: unknown): string | null {
  return value === null ? null : childPath(value);
}

function childPath(value: unknown): string {
  if (
    typeof value !== "string" || value === "" || value.includes("\0") ||
    value.includes("\\") || isAbsolute(value) || posix.normalize(value) !== value ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) invalid();
  return value;
}

function requireSortedUnique(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) invalid();
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    (left.mode & FILE_TYPE_MASK) === (right.mode & FILE_TYPE_MASK) && right.isFile();
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameFile(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(): never {
  throw new Error("invalid");
}
