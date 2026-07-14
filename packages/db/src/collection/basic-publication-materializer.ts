import { createBasicCountryBundle } from "../seed/basic-country-template.js";
import type { BasicCanonicalData, JsonRecord } from "../seed/basic-country-types.js";
import type {
  BasicCollectionAuditBundleV2,
} from "./basic-collection-v2-contracts.js";
import {
  deepFreezeBasicOfflineValue,
  deeplyEqualBasicOfflineValue,
} from "./basic-offline-value.js";
import type {
  BasicCountryPublicationManifestV2,
} from "./basic-publication-contracts.js";

const COUNTRY_FACT_PATHS = Object.freeze([
  "country.code",
  "country.name",
  "country.summary",
  "country.region",
  "country.flagEmoji",
  "country.updatedAt",
] as const);
const MATERIALIZATION_ERROR = "Basic canonical materialization failed";

export function materializeBasicCanonicalFromApprovedCandidateV2(
  candidate: BasicCollectionAuditBundleV2,
  manifest: BasicCountryPublicationManifestV2,
): BasicCanonicalData {
  try {
    const values = Object.fromEntries(
      COUNTRY_FACT_PATHS.map((fieldPath) => [
        fieldPath.slice("country.".length),
        uniqueCountryFactValue(candidate, fieldPath),
      ]),
    );
    const bundle = createBasicCountryBundle({
      countryDirectory: candidate.countryDirectory,
      country: values,
      marketOverview: {
        ...candidate.marketOverviewDraft,
        reviewStatus: "published",
        aiUsable: false,
      },
      manifest: {
        activeRunId: manifest.activeRunId,
        mappingVersion: manifest.mappingVersion,
        auditBundlePath: manifest.auditBundlePath,
      },
      auditRun: {
        runId: candidate.runId,
        sourceRegister: { ...candidate.sourceRegister },
        extractedFacts: { ...candidate.extractedFacts },
        marketOverviewDraft: { ...candidate.marketOverviewDraft },
        reviewReport: { ...candidate.reviewReport },
      },
    });
    return deepFreezeBasicOfflineValue(bundle.canonical);
  } catch {
    throw new Error(MATERIALIZATION_ERROR);
  }
}

function uniqueCountryFactValue(
  candidate: BasicCollectionAuditBundleV2,
  fieldPath: typeof COUNTRY_FACT_PATHS[number],
): JsonRecord[string] {
  const facts = candidate.extractedFacts.facts.filter(
    (fact) => fact.fieldPath === fieldPath && fact.status === "candidate",
  );
  const fact = facts[0];
  if (facts.length !== 1 || fact === undefined || fact.evidence.length === 0) {
    throw new Error(MATERIALIZATION_ERROR);
  }
  const first = fact.evidence[0]?.normalizedValue;
  if (
    first === undefined ||
    !fact.evidence.every((evidence) =>
      deeplyEqualBasicOfflineValue(evidence.normalizedValue, first))
  ) {
    throw new Error(MATERIALIZATION_ERROR);
  }
  return first;
}
