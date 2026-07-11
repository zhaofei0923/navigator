import { isDeepStrictEqual } from "node:util";

import type {
  BasicCollectionAuditBundle,
  BasicCollectionJsonValue,
} from "../collection/basic-collection-contracts.js";
import { createBasicCountryBundle } from "./basic-country-template.js";
import type {
  BasicCollectionManifest,
  BasicCountryBundle,
  JsonRecord,
} from "./basic-country-types.js";

export const BASIC_COUNTRY_CANONICAL_MAPPING_VERSION =
  "basic-country-canonical/v1" as const;

const COUNTRY_FACT_FIELDS = [
  ["code", "country.code"],
  ["name", "country.name"],
  ["summary", "country.summary"],
  ["region", "country.region"],
  ["flagEmoji", "country.flagEmoji"],
  ["updatedAt", "country.updatedAt"],
] as const;

const MAPPING_ERROR =
  "approved audit identity or canonical mapping is invalid";

export interface BasicCountryCanonicalMappingInput {
  countryDirectory: string;
  manifest: BasicCollectionManifest;
  auditBundle: BasicCollectionAuditBundle;
}

export function mapBasicCountryCanonicalPublication(
  input: BasicCountryCanonicalMappingInput,
): BasicCountryBundle {
  const country = extractCountry(input.auditBundle);
  const countryCode = country.code;
  if (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error(MAPPING_ERROR);
  }
  assertIdentity(input, countryCode);

  return createBasicCountryBundle({
    countryDirectory: input.countryDirectory,
    country,
    marketOverview: {
      ...input.auditBundle.marketOverviewDraft,
      reviewStatus: "published",
    },
    manifest: { ...input.manifest },
    auditRun: {
      runId: input.auditBundle.runId,
      sourceRegister: { ...input.auditBundle.sourceRegister },
      extractedFacts: { ...input.auditBundle.extractedFacts },
      marketOverviewDraft: { ...input.auditBundle.marketOverviewDraft },
      reviewReport: { ...input.auditBundle.reviewReport },
    },
  });
}

function extractCountry(auditBundle: BasicCollectionAuditBundle): JsonRecord {
  const country: JsonRecord = {};
  for (const [field, factPath] of COUNTRY_FACT_FIELDS) {
    country[field] = extractUniqueCandidateValue(auditBundle, factPath);
  }
  return country;
}

function extractUniqueCandidateValue(
  auditBundle: BasicCollectionAuditBundle,
  factPath: string,
): BasicCollectionJsonValue {
  const facts = auditBundle.extractedFacts.facts.filter(
    (fact) => fact.fieldPath === factPath,
  );
  const fact = facts[0];
  if (
    facts.length !== 1 ||
    fact === undefined ||
    fact.status !== "candidate" ||
    fact.evidence.length === 0
  ) {
    throw new Error(MAPPING_ERROR);
  }
  const value = fact.evidence[0]?.normalizedValue;
  if (
    value === undefined ||
    !fact.evidence.every((evidence) =>
      isDeepStrictEqual(evidence.normalizedValue, value),
    )
  ) {
    throw new Error(MAPPING_ERROR);
  }
  return structuredClone(value);
}

function assertIdentity(
  input: BasicCountryCanonicalMappingInput,
  countryCode: string,
): void {
  const { auditBundle, countryDirectory, manifest } = input;
  const runId = manifest.activeRunId;
  const expectedPath = `data/staging/${countryDirectory}/${runId}`;
  const countryCodes = [
    auditBundle.sourceRegister.countryCode,
    auditBundle.extractedFacts.countryCode,
    auditBundle.marketOverviewDraft.countryCode,
    auditBundle.reviewReport.countryCode,
  ];
  const runIds = [
    auditBundle.runId,
    auditBundle.sourceRegister.runId,
    auditBundle.extractedFacts.runId,
    auditBundle.reviewReport.runId,
  ];
  if (
    auditBundle.countryDirectory !== countryDirectory ||
    manifest.mappingVersion !== BASIC_COUNTRY_CANONICAL_MAPPING_VERSION ||
    manifest.auditBundlePath !== expectedPath ||
    countryCodes.some((value) => value !== countryCode) ||
    runIds.some((value) => value !== runId)
  ) {
    throw new Error(MAPPING_ERROR);
  }
}
