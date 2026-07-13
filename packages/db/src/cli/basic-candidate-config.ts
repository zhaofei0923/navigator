import { isProxy } from "node:util/types";

import {
  closeBasicCandidateHeldDirectories,
  openBasicCandidateDirectoryChild,
  openBasicCandidateTrustedDirectory,
  readBasicCandidateBoundedRegularFile,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import { parseBasicCandidateRelativePath } from "./basic-candidate-paths.js";
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

type LoadedProvenance = Readonly<{
  runDirectory: BasicCandidateHeldDirectory;
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
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO2 = /^[A-Z]{2}$/;
const MAX_ACTIVE_SOURCES = 64;
const MAX_DOCUMENT_PLANS = 64;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const LOADED_PROVENANCE = new WeakMap<object, LoadedProvenance>();
const CLOSED_CONFIGS = new WeakSet<object>();

export function parseBasicCandidateConfig(
  value: unknown,
): BasicCountryCandidateConfig {
  try {
    const record = exactDataRecord(value, CONFIG_KEYS);
    if (
      record.schemaVersion !== BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION ||
      typeof record.countryDirectory !== "string" ||
      !SAFE_COUNTRY_DIRECTORY.test(record.countryDirectory) ||
      typeof record.countryCode !== "string" || !ISO2.test(record.countryCode) ||
      typeof record.runId !== "string" || !SAFE_RUN_ID.test(record.runId)
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
  let root: BasicCandidateHeldDirectory | null = null;
  let cache: BasicCandidateHeldDirectory | null = null;
  let basicCountry: BasicCandidateHeldDirectory | null = null;
  let country: BasicCandidateHeldDirectory | null = null;
  let run: BasicCandidateHeldDirectory | null = null;
  try {
    const location = configLocation(configPath);
    root = await openBasicCandidateTrustedDirectory(repoRoot);
    cache = await openBasicCandidateDirectoryChild(root, ".cache");
    basicCountry = await openBasicCandidateDirectoryChild(cache, "basic-country");
    country = await openBasicCandidateDirectoryChild(basicCountry, location.countryCode);
    run = await openBasicCandidateDirectoryChild(country, location.runId);
    const config = parseBasicCandidateConfig(await readJson(run, "candidate-config.json"));
    if (config.countryCode !== location.countryCode || config.runId !== location.runId) invalid();
    const loaded = Object.freeze({ config });
    LOADED_PROVENANCE.set(loaded, Object.freeze({
      runDirectory: run,
      allowedPaths: new Set([
        ...(config.structuredReviewPath === null ? [] : [config.structuredReviewPath]),
        ...(config.manualReviewPath === null ? [] : [config.manualReviewPath]),
        ...config.documentPlanPaths,
        config.editorialInputPath,
      ]),
    }));
    run = null;
    return loaded;
  } catch {
    throw new Error("basic candidate config is invalid");
  } finally {
    await closeBasicCandidateHeldDirectories([country, basicCountry, cache, root, run]);
  }
}

export async function readBasicCandidateConfigInput(
  loaded: LoadedBasicCandidateConfig,
  inputPath: string,
): Promise<unknown> {
  const opened: BasicCandidateHeldDirectory[] = [];
  try {
    const provenance = typeof loaded === "object" && loaded !== null
      ? LOADED_PROVENANCE.get(loaded)
      : undefined;
    if (
      provenance === undefined || CLOSED_CONFIGS.has(loaded) ||
      typeof inputPath !== "string" || !provenance.allowedPaths.has(inputPath) ||
      childPath(inputPath) !== inputPath
    ) invalid();
    const segments = parseBasicCandidateRelativePath(inputPath);
    let directory = provenance.runDirectory;
    for (const segment of segments.slice(0, -1)) {
      const child = await openBasicCandidateDirectoryChild(directory, segment);
      opened.push(child);
      directory = child;
    }
    return await readJson(directory, segments.at(-1)!);
  } catch {
    throw new Error("basic candidate input is invalid");
  } finally {
    await closeBasicCandidateHeldDirectories(opened);
  }
}

export async function readBasicCandidateCatalog(repoRoot: string): Promise<unknown> {
  let root: BasicCandidateHeldDirectory | null = null;
  let packages: BasicCandidateHeldDirectory | null = null;
  let database: BasicCandidateHeldDirectory | null = null;
  let catalog: BasicCandidateHeldDirectory | null = null;
  try {
    root = await openBasicCandidateTrustedDirectory(repoRoot);
    packages = await openBasicCandidateDirectoryChild(root, "packages");
    database = await openBasicCandidateDirectoryChild(packages, "db");
    catalog = await openBasicCandidateDirectoryChild(database, "catalog");
    return await readJson(catalog, "basic-source-catalog.json");
  } catch {
    throw new Error("basic candidate catalog is invalid");
  } finally {
    await closeBasicCandidateHeldDirectories([catalog, database, packages, root]);
  }
}

export async function closeBasicCandidateConfig(
  loaded: LoadedBasicCandidateConfig,
): Promise<void> {
  if (typeof loaded !== "object" || loaded === null) return;
  const provenance = LOADED_PROVENANCE.get(loaded);
  if (provenance === undefined || CLOSED_CONFIGS.has(loaded)) return;
  CLOSED_CONFIGS.add(loaded);
  await closeBasicCandidateHeldDirectories([provenance.runDirectory]);
}

async function readJson(
  directory: BasicCandidateHeldDirectory,
  name: string,
): Promise<unknown> {
  const bytes = await readBasicCandidateBoundedRegularFile(
    directory,
    name,
    MAX_INPUT_BYTES,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function configLocation(value: unknown): Readonly<{ countryCode: string; runId: string }> {
  const segments = parseBasicCandidateRelativePath(value);
  if (
    segments.length !== 5 || segments[0] !== ".cache" ||
    segments[1] !== "basic-country" || segments[4] !== "candidate-config.json" ||
    !ISO2.test(segments[2]!) || !SAFE_RUN_ID.test(segments[3]!)
  ) invalid();
  return Object.freeze({ countryCode: segments[2]!, runId: segments[3]! });
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
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ACTIVE_SOURCES) {
    invalid();
  }
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
  return parseBasicCandidateRelativePath(value).join("/");
}

function requireSortedUnique(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) invalid();
  }
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
