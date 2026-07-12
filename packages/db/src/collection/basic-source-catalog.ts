import { createHash } from "node:crypto";

import {
  CREDIBILITIES,
  type Credibility,
} from "@navigator/shared-types/schema";

import {
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
  type BasicSourceFamily,
} from "./basic-collection-contracts.js";
import {
  deepFreezeBasicOfflineValue,
  isRecord,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";

export const BASIC_SOURCE_CATALOG_SCHEMA_VERSION =
  "basic-source-catalog/v1" as const;
export const BASIC_MANUAL_DOCUMENT_ADAPTER_ID =
  "basic-manual-document-capture" as const;
export const BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION = "1.0.0" as const;

export type BasicSourceCatalogToken =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly kind: "placeholder";
      readonly value: "countryCode" | "sourceCountryId";
    };

export interface BasicSourceCatalogSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceFamily: BasicSourceFamily;
  readonly credibility: Credibility;
  readonly format: "json" | "csv" | "html" | "pdf";
  readonly countryScope: "all" | readonly string[];
  readonly requestTemplate: {
    readonly origin: string;
    readonly pathSegments: readonly BasicSourceCatalogToken[];
    readonly query: readonly {
      readonly name: string;
      readonly value: BasicSourceCatalogToken;
    }[];
  };
  readonly accept:
    | "application/json"
    | "text/csv"
    | "text/html"
    | "application/pdf";
  readonly approvedOrigins: readonly string[];
  readonly allowedQueryParameters: readonly string[];
  readonly accessMode: "open" | "optional-credentialed";
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly attribution: string;
  readonly refreshCadence:
    | "monthly"
    | "quarterly"
    | "annual"
    | "event-driven"
    | "manual";
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterKind: "deterministic" | "manual-document";
  readonly fieldPaths: readonly string[];
}

export interface BasicSourceCountryMapping {
  readonly countryCode: string;
  readonly sourceId: string;
  readonly sourceCountryId: string;
}

export interface BasicSourceCatalog {
  readonly schemaVersion: typeof BASIC_SOURCE_CATALOG_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly sources: readonly BasicSourceCatalogSource[];
  readonly countryMappings: readonly BasicSourceCountryMapping[];
}

export interface BasicSourceCatalogSnapshot {
  readonly catalog: BasicSourceCatalog;
  readonly catalogSha256: string;
}

const ERROR_MESSAGE = "basic source catalog is invalid";
const MAX_SOURCES = 2_048;
const MAX_MAPPINGS = 10_000;
const MAX_ARRAY_ITEMS = 256;
const MAX_FIELD_PATHS = 128;
const MAX_QUERY_ENTRIES = 64;
const MAX_STRING_BYTES = 65_536;
const MAX_URL_BYTES = 8_192;

const CATALOG_KEYS = [
  "schemaVersion",
  "catalogVersion",
  "sources",
  "countryMappings",
] as const;
const SOURCE_KEYS = [
  "sourceId",
  "sourceName",
  "sourceFamily",
  "credibility",
  "format",
  "countryScope",
  "requestTemplate",
  "accept",
  "approvedOrigins",
  "allowedQueryParameters",
  "accessMode",
  "licenseName",
  "licenseUrl",
  "attribution",
  "refreshCadence",
  "adapterId",
  "adapterVersion",
  "adapterKind",
  "fieldPaths",
] as const;
const REQUEST_TEMPLATE_KEYS = ["origin", "pathSegments", "query"] as const;
const TOKEN_KEYS = ["kind", "value"] as const;
const QUERY_KEYS = ["name", "value"] as const;
const MAPPING_KEYS = ["countryCode", "sourceId", "sourceCountryId"] as const;

const SOURCE_FAMILIES = [
  "international-organization",
  "official-statistics",
  "government",
  "energy-authority",
  "regulator",
  "grid-operator",
  "industry-association",
  "verified-research",
] as const satisfies readonly BasicSourceFamily[];
const FORMATS = ["json", "csv", "html", "pdf"] as const;
const ACCEPTS = [
  "application/json",
  "text/csv",
  "text/html",
  "application/pdf",
] as const;
const ACCESS_MODES = ["open", "optional-credentialed"] as const;
const REFRESH_CADENCES = [
  "monthly",
  "quarterly",
  "annual",
  "event-driven",
  "manual",
] as const;
const ADAPTER_KINDS = ["deterministic", "manual-document"] as const;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ISO2 = /^[A-Z]{2}$/;
const QUERY_NAME = /^[A-Za-z0-9._~-]+$/;
const PRE_ENCODED = /%[0-9A-Fa-f]{2}/;
const INDICATOR_FIELD_PATH =
  /^marketOverview\.keyIndicators\[(0|[1-9]\d*)\]\.(label|value|unit|year)$/;
const ALLOWED_FIELD_PATHS = new Set<string>(
  BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS,
);

export function parseBasicSourceCatalog(
  value: unknown,
): BasicSourceCatalogSnapshot {
  try {
    const snapshot = snapshotBasicOfflineValue(value);
    if (!snapshot.valid) invalid();
    const catalog = parseCatalog(snapshot.data);
    validateCatalogRelations(catalog);
    const frozenCatalog = deepFreezeBasicOfflineValue(catalog);
    return deepFreezeBasicOfflineValue({
      catalog: frozenCatalog,
      catalogSha256: createHash("sha256")
        .update(canonicalizeBasicSourceCatalog(frozenCatalog), "utf8")
        .digest("hex"),
    });
  } catch {
    throw new Error(ERROR_MESSAGE);
  }
}

export function canonicalizeBasicSourceCatalog(
  catalog: BasicSourceCatalog,
): string {
  return JSON.stringify(catalog);
}

function parseCatalog(value: unknown): BasicSourceCatalog {
  const record = exactRecord(value, CATALOG_KEYS);
  if (record.schemaVersion !== BASIC_SOURCE_CATALOG_SCHEMA_VERSION) invalid();
  const catalogVersion = safeToken(record.catalogVersion);
  const sources = array(record.sources, MAX_SOURCES, false).map(parseSource);
  const countryMappings = array(record.countryMappings, MAX_MAPPINGS, true).map(
    parseCountryMapping,
  );
  requireSortedUnique(sources, ({ sourceId }) => sourceId);
  requireSortedUnique(
    countryMappings,
    ({ countryCode, sourceId }) => `${countryCode}\u0000${sourceId}`,
  );
  return {
    schemaVersion: BASIC_SOURCE_CATALOG_SCHEMA_VERSION,
    catalogVersion,
    sources,
    countryMappings,
  };
}

function parseSource(value: unknown): BasicSourceCatalogSource {
  const record = exactRecord(value, SOURCE_KEYS);
  const sourceId = safeId(record.sourceId);
  const sourceName = nonBlankText(record.sourceName);
  const sourceFamily = enumValue(record.sourceFamily, SOURCE_FAMILIES);
  const credibility = enumValue(record.credibility, CREDIBILITIES);
  const format = enumValue(record.format, FORMATS);
  const countryScope = parseCountryScope(record.countryScope);
  const requestTemplate = parseRequestTemplate(record.requestTemplate);
  const accept = enumValue(record.accept, ACCEPTS);
  const approvedOrigins = stringArray(record.approvedOrigins, false).map(
    exactOrigin,
  );
  const allowedQueryParameters = stringArray(
    record.allowedQueryParameters,
    true,
  ).map(queryName);
  const accessMode = enumValue(record.accessMode, ACCESS_MODES);
  const licenseName = nonBlankText(record.licenseName);
  const licenseUrl = httpsUrl(record.licenseUrl);
  const attribution = nonBlankText(record.attribution);
  const refreshCadence = enumValue(record.refreshCadence, REFRESH_CADENCES);
  const adapterId = safeId(record.adapterId);
  const adapterVersion = safeToken(record.adapterVersion);
  const adapterKind = enumValue(record.adapterKind, ADAPTER_KINDS);
  const fieldPaths = array(record.fieldPaths, MAX_FIELD_PATHS, false).map(
    allowedFieldPath,
  );

  requireSortedUnique(approvedOrigins, identity);
  requireSortedUnique(fieldPaths, identity);
  requireUnique(requestTemplate.query.map(({ name }) => name));
  if (!sameStrings(
    allowedQueryParameters,
    requestTemplate.query.map(({ name }) => name),
  )) invalid();
  if (!approvedOrigins.includes(requestTemplate.origin)) invalid();
  validateSourceMatrix({ format, accept, adapterId, adapterVersion, adapterKind });

  return {
    sourceId,
    sourceName,
    sourceFamily,
    credibility,
    format,
    countryScope,
    requestTemplate,
    accept,
    approvedOrigins,
    allowedQueryParameters,
    accessMode,
    licenseName,
    licenseUrl,
    attribution,
    refreshCadence,
    adapterId,
    adapterVersion,
    adapterKind,
    fieldPaths,
  };
}

function parseRequestTemplate(
  value: unknown,
): BasicSourceCatalogSource["requestTemplate"] {
  const record = exactRecord(value, REQUEST_TEMPLATE_KEYS);
  const origin = exactOrigin(record.origin);
  const pathSegments = array(record.pathSegments, MAX_ARRAY_ITEMS, false).map(
    parseToken,
  );
  if (pathSegments.some((token) => token.kind === "literal" && token.value === "")) {
    invalid();
  }
  const query = array(record.query, MAX_QUERY_ENTRIES, true).map((item) => {
    const queryRecord = exactRecord(item, QUERY_KEYS);
    return {
      name: queryName(queryRecord.name),
      value: parseToken(queryRecord.value),
    };
  });
  return { origin, pathSegments, query };
}

function parseToken(value: unknown): BasicSourceCatalogToken {
  const record = exactRecord(value, TOKEN_KEYS);
  if (record.kind === "literal") {
    const literal = text(record.value);
    if (literal.includes("{") || literal.includes("}") || PRE_ENCODED.test(literal)) {
      invalid();
    }
    return { kind: "literal", value: literal };
  }
  if (
    record.kind === "placeholder" &&
    (record.value === "countryCode" || record.value === "sourceCountryId")
  ) {
    return { kind: "placeholder", value: record.value };
  }
  invalid();
}

function parseCountryScope(value: unknown): "all" | readonly string[] {
  if (value === "all") return "all";
  const countries = array(value, MAX_ARRAY_ITEMS, false).map(countryCode);
  requireSortedUnique(countries, identity);
  return countries;
}

function parseCountryMapping(value: unknown): BasicSourceCountryMapping {
  const record = exactRecord(value, MAPPING_KEYS);
  return {
    countryCode: countryCode(record.countryCode),
    sourceId: safeId(record.sourceId),
    sourceCountryId: componentText(record.sourceCountryId),
  };
}

function validateCatalogRelations(catalog: BasicSourceCatalog): void {
  const sources = new Map(catalog.sources.map((source) => [source.sourceId, source]));
  const externalIds = new Set<string>();
  for (const mapping of catalog.countryMappings) {
    const source = sources.get(mapping.sourceId);
    if (
      source === undefined ||
      !usesPlaceholder(source, "sourceCountryId") ||
      (source.countryScope !== "all" &&
        !source.countryScope.includes(mapping.countryCode))
    ) {
      invalid();
    }
    const externalKey = `${mapping.sourceId}\u0000${mapping.sourceCountryId}`;
    if (externalIds.has(externalKey)) invalid();
    externalIds.add(externalKey);
  }
}

function validateSourceMatrix(input: {
  readonly format: BasicSourceCatalogSource["format"];
  readonly accept: BasicSourceCatalogSource["accept"];
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterKind: BasicSourceCatalogSource["adapterKind"];
}): void {
  const expectedAccept = {
    json: "application/json",
    csv: "text/csv",
    html: "text/html",
    pdf: "application/pdf",
  } as const;
  if (input.accept !== expectedAccept[input.format]) invalid();
  if (input.format === "json" || input.format === "csv") {
    if (input.adapterKind !== "deterministic") invalid();
    return;
  }
  if (
    input.adapterKind !== "manual-document" ||
    input.adapterId !== BASIC_MANUAL_DOCUMENT_ADAPTER_ID ||
    input.adapterVersion !== BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION
  ) {
    invalid();
  }
}

function usesPlaceholder(
  source: BasicSourceCatalogSource,
  value: "countryCode" | "sourceCountryId",
): boolean {
  return [...source.requestTemplate.pathSegments, ...source.requestTemplate.query.map(
    (entry) => entry.value,
  )].some((token) => token.kind === "placeholder" && token.value === value);
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (!isRecord(value)) invalid();
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    actual.some((key) => !keys.includes(key))
  ) invalid();
  return value as Record<Keys[number], unknown>;
}

function array(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0)
  ) invalid();
  return value;
}

function stringArray(value: unknown, allowEmpty: boolean): readonly string[] {
  return array(value, MAX_ARRAY_ITEMS, allowEmpty).map(text);
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES
  ) invalid();
  return value;
}

function nonBlankText(value: unknown): string {
  const result = text(value);
  if (result.trim() === "") invalid();
  return result;
}

function componentText(value: unknown): string {
  const result = nonBlankText(value);
  if (result.trim() !== result || PRE_ENCODED.test(result)) invalid();
  return result;
}

function safeId(value: unknown): string {
  const result = text(value);
  if (!SAFE_ID.test(result)) invalid();
  return result;
}

function safeToken(value: unknown): string {
  const result = text(value);
  if (!SAFE_VERSION.test(result)) invalid();
  return result;
}

function countryCode(value: unknown): string {
  const result = text(value);
  if (!ISO2.test(result)) invalid();
  return result;
}

function queryName(value: unknown): string {
  const result = text(value);
  if (!QUERY_NAME.test(result)) invalid();
  return result;
}

function exactOrigin(value: unknown): string {
  const result = urlText(value);
  const parsed = new URL(result);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== result
  ) invalid();
  return result;
}

function httpsUrl(value: unknown): string {
  const result = urlText(value);
  const parsed = new URL(result);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) invalid();
  return result;
}

function urlText(value: unknown): string {
  const result = nonBlankText(value);
  if (Buffer.byteLength(result, "utf8") > MAX_URL_BYTES) invalid();
  return result;
}

function allowedFieldPath(value: unknown): string {
  const result = text(value);
  if (!ALLOWED_FIELD_PATHS.has(result) && !INDICATOR_FIELD_PATH.test(result)) {
    invalid();
  }
  return result;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function requireSortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
): void {
  let previous: string | null = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && previous >= current) invalid();
    previous = current;
  }
}

function requireUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function identity(value: string): string {
  return value;
}

function invalid(): never {
  throw new Error(ERROR_MESSAGE);
}
