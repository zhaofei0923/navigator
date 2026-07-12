import type {
  BasicCollectionJsonValue,
  BasicFactStatus,
  BasicInjectionRisk,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import type { BasicDeterministicObservation } from "./basic-source-adapter-contracts.js";
import type { BasicSourceCatalogSource } from "./basic-source-catalog.js";
import type {
  BasicRawCaptureManifestV2,
  BasicRawCaptureReceiptV2,
} from "./basic-source-v2-contracts.js";

export const BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION =
  "basic-country-audit/v2" as const;

export type BasicExtractionMethodV2 = "deterministic" | "manual";

export interface BasicFactEvidenceV2 {
  readonly sourceId: string;
  readonly locator: string;
  readonly rawValue: BasicCollectionJsonValue;
  readonly normalizedValue: BasicCollectionJsonValue;
  readonly unit: string | null;
  readonly year: number | null;
}

export interface BasicExtractedFactV2 {
  readonly factId: string;
  readonly fieldPath: string;
  readonly status: BasicFactStatus;
  readonly evidence: readonly BasicFactEvidenceV2[];
  readonly extractionMethod: BasicExtractionMethodV2;
  readonly uncertainty: string | null;
}

export interface BasicSourceRegisterV2 {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sources: readonly BasicSourceRecord[];
}

export interface BasicExtractedFactsV2 {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly facts: readonly BasicExtractedFactV2[];
}

export interface BasicSourcedObservationV2 extends BasicDeterministicObservation {
  readonly sourceId: string;
}

export interface BasicDocumentCaptureV2 {
  readonly catalogSource: BasicSourceCatalogSource;
  readonly manifest: BasicRawCaptureManifestV2;
}

export interface BasicEditorialEvidenceObservation {
  readonly sourceId: string;
  readonly fieldPath: string;
  readonly locator: string;
  readonly rawValue: BasicCollectionJsonValue;
}

export interface BasicStructuredEditorialEvidenceObservation {
  readonly sourceId: string;
  readonly fieldPath: string;
  readonly locator: string;
  readonly rawValue: BasicCollectionJsonValue;
}

export interface BasicPreliminarySourceRunV2 {
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly structuredEditorialEvidence:
    readonly BasicStructuredEditorialEvidenceObservation[];
  readonly documentCaptures: readonly BasicDocumentCaptureV2[];
  readonly receipts: readonly BasicRawCaptureReceiptV2[];
}

export interface BasicDeterministicMaterializationResultV2 {
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly receipts: readonly BasicRawCaptureReceiptV2[];
}

export interface BasicReviewedMaterializationV2 {
  readonly materialization: BasicDeterministicMaterializationResultV2;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

export type BasicV2FieldOwner =
  | "source-backed"
  | "hybrid-name"
  | "editorial"
  | "derived";

const SOURCE_BACKED_PATHS = new Set<string>([
  "country.code",
  "marketOverview.population",
  "marketOverview.gdp",
  "marketOverview.gdpGrowth",
]);
const EDITORIAL_PATHS = new Set<string>([
  "country.summary",
  "country.region",
  "marketOverview.overview",
  "marketOverview.energyDemand",
  "marketOverview.renewableTarget",
  "marketOverview.industryTags",
  "marketOverview.techTags",
]);
const DERIVED_PATHS = new Set<string>([
  "country.flagEmoji",
  "country.updatedAt",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.collectedAt",
  "marketOverview.updatedAt",
  "marketOverview.credibility",
  "marketOverview.countryCode",
]);
const INDICATOR_PATH =
  /^marketOverview\.keyIndicators\[(?:0|[1-9]\d*)\]\.(label|value|unit|year)$/;

export function classifyBasicV2FieldPath(
  fieldPath: string,
): BasicV2FieldOwner | null {
  if (SOURCE_BACKED_PATHS.has(fieldPath)) return "source-backed";
  if (fieldPath === "country.name") return "hybrid-name";
  if (EDITORIAL_PATHS.has(fieldPath)) return "editorial";
  if (DERIVED_PATHS.has(fieldPath)) return "derived";
  const indicator = INDICATOR_PATH.exec(fieldPath);
  if (indicator === null) return null;
  return indicator[1] === "label" ? "editorial" : "source-backed";
}

export type { BasicRawCaptureReceiptV2 } from "./basic-source-v2-contracts.js";
