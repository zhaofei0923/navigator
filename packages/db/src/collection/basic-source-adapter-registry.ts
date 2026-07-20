import { worldBankCountryAdapter } from "./adapters/world-bank-country.js";
import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./adapters/world-bank-indicators.js";
import {
  WORLD_BANK_BASIC_PROFILE_ADAPTERS,
  type WorldBankBasicProfileAdapter,
} from "./adapters/world-bank-basic-profile.js";
import type {
  BasicDeterministicSourceAdapter,
  BasicSourceRequest,
} from "./basic-source-adapter-contracts.js";
import type { BasicSourceExecutionPlanEntry } from "./basic-source-request-materializer.js";
import {
  isBasicSourceExecutionPlanEntryTrusted,
  snapshotBasicSourceExecutionPlanEntryProvenance,
} from "./basic-source-request-materializer.js";
import { snapshotBasicSourceRequest } from "./basic-source-metadata.js";

const BINDING_ERROR = "source catalog adapter binding is invalid";
const ISO2 = /^[A-Z]{2}$/;
const APPROVED_PROFILE_CATALOG_VERSION = "2026-07-20.1";
const APPROVED_PROFILE_CATALOG_SHA256 =
  "6afa620bfef537573e7a52522fa0ef10e4d23bb1a1b291e28401628370f2c249";

const ADAPTERS = Object.freeze([
  worldBankCountryAdapter,
  ...WORLD_BANK_CORE_INDICATOR_ADAPTERS,
]);

const REGISTRY = new Map(
  ADAPTERS.map((adapter) => [
    `${adapter.adapterId}@${adapter.adapterVersion}`,
    adapter,
  ] as const),
);
const BASIC_PROFILE_REGISTRY = new Map(
  WORLD_BANK_BASIC_PROFILE_ADAPTERS.map((adapter) => [adapter.sourceId, adapter] as const),
);

export function resolveBasicProfileWorldBankAdapter(
  entry: BasicSourceExecutionPlanEntry,
  countryCode: string,
): WorldBankBasicProfileAdapter {
  try {
    const provenance = snapshotBasicSourceExecutionPlanEntryProvenance(entry);
    if (
      !ISO2.test(countryCode) ||
      !isBasicSourceExecutionPlanEntryTrusted(entry) ||
      provenance?.catalogVersion !== APPROVED_PROFILE_CATALOG_VERSION ||
      provenance.catalogSha256 !== APPROVED_PROFILE_CATALOG_SHA256 ||
      provenance.countryCode !== countryCode
    ) invalid();
    const source = entry.source;
    const adapter = BASIC_PROFILE_REGISTRY.get(source.sourceId);
    const fieldPath = `marketOverview.basicProfile.categories.${adapter?.category}.fields.${adapter?.profileField}`;
    if (
      adapter === undefined || source.adapterId !== adapter.sourceId ||
      source.adapterVersion !== "1.0.0" || source.adapterKind !== "deterministic" ||
      source.sourceName !== "World Bank" ||
      source.sourceFamily !== "international-organization" ||
      source.credibility !== "OFFICIAL" ||
      source.format !== "json" || source.accessMode !== "open" ||
      source.countryScope !== "all" || source.accept !== "application/json" ||
      !sameStrings(source.approvedOrigins, ["https://api.worldbank.org"]) ||
      !sameStrings(source.allowedQueryParameters, ["source", "format", "mrv", "per_page"]) ||
      !sameStrings(source.fieldPaths, [fieldPath])
    ) invalid();
    const request = adapter.request(countryCode);
    if (
      entry.request.method !== "GET" || entry.request.url !== request.url ||
      entry.request.accept !== request.headers.Accept ||
      !sameStrings(entry.request.allowedOrigins, source.approvedOrigins) ||
      !sameStrings(entry.request.allowedQueryParameters, source.allowedQueryParameters)
    ) invalid();
    return adapter;
  } catch {
    throw new Error(BINDING_ERROR);
  }
}

export function resolveBasicSourceAdapter(
  entry: BasicSourceExecutionPlanEntry,
  countryCode: string,
): BasicDeterministicSourceAdapter {
  try {
    if (!ISO2.test(countryCode)) invalid();
    const source = entry.source;
    const adapter = REGISTRY.get(
      `${source.adapterId}@${source.adapterVersion}`,
    );
    if (
      adapter === undefined ||
      source.adapterKind !== "deterministic" ||
      source.format !== "json" ||
      source.accessMode !== "open" ||
      source.sourceId !== adapter.sourceId ||
      source.sourceName !== adapter.sourceName ||
      source.sourceFamily !== adapter.sourceFamily ||
      source.credibility !== adapter.credibility ||
      source.adapterId !== adapter.adapterId ||
      source.adapterVersion !== adapter.adapterVersion
    ) invalid();

    const plannedRequest = snapshotBasicSourceRequest(entry.request);
    const adapterRequest = snapshotBasicSourceRequest(
      adapter.request(countryCode),
    );
    if (
      source.accept !== plannedRequest.accept ||
      !sameStrings(source.approvedOrigins, plannedRequest.allowedOrigins) ||
      !sameStrings(
        source.allowedQueryParameters,
        plannedRequest.allowedQueryParameters,
      ) ||
      !sameRequest(plannedRequest, adapterRequest)
    ) invalid();
    return adapter;
  } catch {
    throw new Error(BINDING_ERROR);
  }
}

function sameRequest(
  left: BasicSourceRequest,
  right: BasicSourceRequest,
): boolean {
  return (
    left.method === right.method &&
    left.url === right.url &&
    left.accept === right.accept &&
    sameStrings(left.allowedOrigins, right.allowedOrigins) &&
    sameStrings(left.allowedQueryParameters, right.allowedQueryParameters)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(): never {
  throw new Error(BINDING_ERROR);
}
