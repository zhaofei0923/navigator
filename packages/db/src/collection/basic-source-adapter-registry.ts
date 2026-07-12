import { worldBankCountryAdapter } from "./adapters/world-bank-country.js";
import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./adapters/world-bank-indicators.js";
import type {
  BasicDeterministicSourceAdapter,
  BasicSourceRequest,
} from "./basic-source-adapter-contracts.js";
import type { BasicSourceExecutionPlanEntry } from "./basic-source-request-materializer.js";
import { snapshotBasicSourceRequest } from "./basic-source-metadata.js";

const BINDING_ERROR = "source catalog adapter binding is invalid";
const ISO2 = /^[A-Z]{2}$/;

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
