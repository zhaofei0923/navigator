import { lstatSync } from "node:fs";
import { isAbsolute, join, normalize, parse, sep } from "node:path";

import {
  sortCountrySnapshots,
  type CountryDataSnapshot,
  type CountryReadRepository,
  type JsonObject,
  type JsonValue,
} from "@navigator/shared-types/country-runtime";

import { loadApprovedBasicCountryPublicationVersioned } from "../collection/basic-publication-versioned-loader.js";
import { discoverApprovedBasicCountryDirectories } from "../seed/approved-basic-publications-validation.js";
import { normalizeCountryReadSnapshot } from "./country-read-normalization.js";

const APPROVED_PUBLICATION_RUNTIME_INVALID =
  "APPROVED_PUBLICATION_RUNTIME_INVALID" as const;

export interface ApprovedPublicationCountryReadRepositoryOptions {
  readonly repositoryRoot: string;
}

export class ApprovedPublicationCountryReadRepositoryError extends Error {
  constructor() {
    super(APPROVED_PUBLICATION_RUNTIME_INVALID);
    this.name = "ApprovedPublicationCountryReadRepositoryError";
  }
}

export function createApprovedPublicationCountryReadRepository(
  options: ApprovedPublicationCountryReadRepositoryOptions,
): CountryReadRepository {
  const snapshots = loadApprovedSnapshots(options.repositoryRoot);
  const byCode = new Map(
    snapshots.map((snapshot) => [readCountryCode(snapshot), snapshot] as const),
  );

  return Object.freeze({
    async list(): Promise<readonly CountryDataSnapshot[]> {
      return snapshots;
    },
    async findByCode(code: string): Promise<CountryDataSnapshot | null> {
      if (!isNormalizedCountryCode(code)) return null;
      return byCode.get(code) ?? null;
    },
  });
}

function loadApprovedSnapshots(
  repositoryRootInput: string,
): readonly CountryDataSnapshot[] {
  try {
    const repositoryRoot = normalizeRepositoryRoot(repositoryRootInput);
    assertDataDirectory(repositoryRoot);
    const directories = discoverApprovedBasicCountryDirectories(repositoryRoot);
    if (directories.length === 0) throw invalidRuntime();

    const snapshots = directories.map((countryDirectory) => {
      const publication = loadApprovedBasicCountryPublicationVersioned(
        repositoryRoot,
        countryDirectory,
      );
      if (!publication.valid) throw invalidRuntime();
      const canonical = publication.data.canonical;
      return deepFreeze(normalizeCountryReadSnapshot({
        country: cloneJsonObject(canonical.country),
        marketOverview: cloneJsonObject(canonical.marketOverview),
        policy: cloneJsonObjectArray(canonical.policy),
        risk: cloneJsonObjectArray(canonical.risk),
        opportunities: cloneJsonObjectArray(canonical.opportunities),
        projects: cloneJsonObjectArray(canonical.projects),
        partners: cloneJsonObjectArray(canonical.partners),
        chineseCompanies: cloneJsonObjectArray(canonical.chineseCompanies),
        entryStrategy: canonical.entryStrategy === null
          ? null
          : cloneJsonObject(canonical.entryStrategy),
        reports: cloneJsonObjectArray(canonical.reports),
        knowledge: cloneJsonObjectArray(canonical.knowledge),
      } satisfies CountryDataSnapshot));
    });
    const sorted = sortCountrySnapshots(snapshots);
    const seenCodes = new Set<string>();
    for (const snapshot of sorted) {
      const code = readCountryCode(snapshot);
      if (seenCodes.has(code)) throw invalidRuntime();
      seenCodes.add(code);
    }
    return deepFreeze(sorted);
  } catch (error) {
    if (error instanceof ApprovedPublicationCountryReadRepositoryError) {
      throw error;
    }
    throw invalidRuntime(error);
  }
}

function normalizeRepositoryRoot(value: string): string {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value)) {
    throw invalidRuntime();
  }
  const normalized = normalize(value);
  const root = parse(normalized).root;
  const withoutTrailingSeparator = normalized === root
    ? normalized
    : normalized.replace(new RegExp(`${escapeRegExp(sep)}+$`, "u"), "");
  if (!isAbsolute(withoutTrailingSeparator) || withoutTrailingSeparator === "") {
    throw invalidRuntime();
  }
  return withoutTrailingSeparator;
}

function assertDataDirectory(repositoryRoot: string): void {
  const data = lstatSync(join(repositoryRoot, "data"));
  if (!data.isDirectory() || data.isSymbolicLink()) throw invalidRuntime();
}

function cloneJsonObject(value: unknown): JsonObject {
  const cloned = cloneJson(value);
  if (Array.isArray(cloned) || cloned === null || typeof cloned !== "object") {
    throw invalidRuntime();
  }
  return cloned as JsonObject;
}

function cloneJsonObjectArray(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) throw invalidRuntime();
  return value.map(cloneJsonObject);
}

function cloneJson(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidRuntime();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw invalidRuntime();
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) throw invalidRuntime();

  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = cloneJson(child, seen);
  }
  return result;
}

function readCountryCode(snapshot: CountryDataSnapshot): string {
  const code = snapshot.country.code;
  if (typeof code !== "string" || !isNormalizedCountryCode(code)) {
    throw invalidRuntime();
  }
  return code;
}

function isNormalizedCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/u.test(value);
}

function invalidRuntime(_cause?: unknown): ApprovedPublicationCountryReadRepositoryError {
  return new ApprovedPublicationCountryReadRepositoryError();
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
