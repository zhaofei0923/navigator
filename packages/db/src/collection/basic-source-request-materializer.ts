import {
  type BasicSourceCatalogSnapshot,
  type BasicSourceCatalogSource,
  type BasicSourceCatalogToken,
  parseBasicSourceCatalog,
} from "./basic-source-catalog.js";
import {
  deepFreezeBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";

export interface BasicSourceExecutionPlanEntry {
  readonly source: BasicSourceCatalogSource;
  readonly request: BasicSourcePlannedRequest;
}

export interface BasicSourcePlannedRequest {
  readonly method: "GET";
  readonly url: string;
  readonly accept:
    | "application/json"
    | "text/csv"
    | "text/html"
    | "application/pdf";
  readonly allowedOrigins: readonly string[];
  readonly allowedQueryParameters: readonly string[];
}

export interface BasicSourceExecutionPlan {
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly countryCode: string;
  readonly sources: readonly BasicSourceExecutionPlanEntry[];
}

const PLAN_ERROR = "source catalog execution plan is invalid";
const MAPPING_ERROR = "source catalog mapping is invalid";
const INPUT_KEYS = ["catalog", "countryCode", "sourceIds"] as const;
const SNAPSHOT_KEYS = ["catalog", "catalogSha256"] as const;
const ISO2 = /^[A-Z]{2}$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PRE_ENCODED = /%[0-9A-Fa-f]{2}/;
const MAX_ACTIVE_SOURCES = 64;

export function createBasicSourceExecutionPlan(input: {
  readonly catalog: BasicSourceCatalogSnapshot;
  readonly countryCode: string;
  readonly sourceIds: readonly string[];
}): BasicSourceExecutionPlan {
  try {
    const safeInput = snapshotBasicOfflineValue(input);
    if (!safeInput.valid) planInvalid();
    const record = exactRecord(safeInput.data, INPUT_KEYS);
    const snapshotRecord = exactRecord(record.catalog, SNAPSHOT_KEYS);
    if (
      typeof snapshotRecord.catalogSha256 !== "string" ||
      !SHA256.test(snapshotRecord.catalogSha256)
    ) planInvalid();
    const catalog = parseBasicSourceCatalog(snapshotRecord.catalog);
    if (catalog.catalogSha256 !== snapshotRecord.catalogSha256) planInvalid();
    const countryCode = iso2(record.countryCode);
    const sourceIds = selectedSourceIds(record.sourceIds);
    const sourcesById = new Map(
      catalog.catalog.sources.map((source) => [source.sourceId, source]),
    );
    const sources = sourceIds.map((sourceId) => {
      const source = sourcesById.get(sourceId);
      if (
        source === undefined ||
        source.accessMode !== "open" ||
        (source.countryScope !== "all" &&
          !source.countryScope.includes(countryCode))
      ) planInvalid();
      const sourceCountryId = resolveSourceCountryId(
        catalog,
        source,
        countryCode,
      );
      return {
        source,
        request: materializeRequest(source, countryCode, sourceCountryId),
      };
    });
    return deepFreezeBasicOfflineValue({
      catalogVersion: catalog.catalog.catalogVersion,
      catalogSha256: catalog.catalogSha256,
      countryCode,
      sources,
    });
  } catch (error) {
    if (error instanceof Error && error.message === MAPPING_ERROR) throw error;
    throw new Error(PLAN_ERROR);
  }
}

function materializeRequest(
  source: BasicSourceCatalogSource,
  countryCode: string,
  sourceCountryId: string | null,
): BasicSourcePlannedRequest {
  const url = new URL(source.requestTemplate.origin);
  const path = source.requestTemplate.pathSegments.map((token) =>
    encodeURIComponent(pathTokenValue(token, countryCode, sourceCountryId)));
  url.pathname = `/${path.join("/")}`;
  url.search = "";
  for (const query of source.requestTemplate.query) {
    url.searchParams.append(
      query.name,
      tokenValue(query.value, countryCode, sourceCountryId),
    );
  }
  const canonicalUrl = url.toString();
  const reparsed = new URL(canonicalUrl);
  const queryNames = Array.from(reparsed.searchParams.keys());
  if (
    reparsed.protocol !== "https:" ||
    reparsed.username !== "" ||
    reparsed.password !== "" ||
    reparsed.hash !== "" ||
    !source.approvedOrigins.includes(reparsed.origin) ||
    !sameStrings(queryNames, source.allowedQueryParameters) ||
    new Set(queryNames).size !== queryNames.length ||
    reparsed.toString() !== canonicalUrl
  ) planInvalid();
  return {
    method: "GET",
    url: canonicalUrl,
    accept: source.accept,
    allowedOrigins: Array.from(source.approvedOrigins),
    allowedQueryParameters: Array.from(source.allowedQueryParameters),
  };
}

function pathTokenValue(
  token: BasicSourceCatalogToken,
  countryCode: string,
  sourceCountryId: string | null,
): string {
  const value = tokenValue(token, countryCode, sourceCountryId);
  if (value === "." || value === "..") planInvalid();
  return value;
}

function resolveSourceCountryId(
  catalog: BasicSourceCatalogSnapshot,
  source: BasicSourceCatalogSource,
  countryCode: string,
): string | null {
  if (!usesSourceCountryId(source)) return null;
  const matches = catalog.catalog.countryMappings.filter(
    (mapping) =>
      mapping.sourceId === source.sourceId && mapping.countryCode === countryCode,
  );
  if (matches.length !== 1) mappingInvalid();
  return rejectPreEncoded(matches[0]!.sourceCountryId);
}

function usesSourceCountryId(source: BasicSourceCatalogSource): boolean {
  return [
    ...source.requestTemplate.pathSegments,
    ...source.requestTemplate.query.map(({ value }) => value),
  ].some(
    (token) =>
      token.kind === "placeholder" && token.value === "sourceCountryId",
  );
}

function tokenValue(
  token: BasicSourceCatalogToken,
  countryCode: string,
  sourceCountryId: string | null,
): string {
  if (token.kind === "literal") return rejectPreEncoded(token.value);
  if (token.value === "countryCode") return countryCode;
  if (sourceCountryId === null) mappingInvalid();
  return rejectPreEncoded(sourceCountryId);
}

function selectedSourceIds(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ACTIVE_SOURCES
  ) planInvalid();
  let previous: string | null = null;
  const result = value.map((item) => {
    if (typeof item !== "string" || !SOURCE_ID.test(item)) planInvalid();
    if (previous !== null && previous >= item) planInvalid();
    previous = item;
    return item;
  });
  return result;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (!isRecord(value)) planInvalid();
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    actual.some((key) => !keys.includes(key))
  ) planInvalid();
  return value as Record<Keys[number], unknown>;
}

function iso2(value: unknown): string {
  if (typeof value !== "string" || !ISO2.test(value)) planInvalid();
  return value;
}

function rejectPreEncoded(value: string): string {
  if (PRE_ENCODED.test(value)) planInvalid();
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mappingInvalid(): never {
  throw new Error(MAPPING_ERROR);
}

function planInvalid(): never {
  throw new Error(PLAN_ERROR);
}
