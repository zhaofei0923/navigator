import type {
  BasicCollectionAuditSummary,
  BasicCollectionBlockerCode,
  BasicCollectionJsonValue,
  BasicCollectionReviewReport,
  BasicFactStatus,
  BasicInjectionRisk,
  BasicMarketOverviewDraft,
  BasicReviewConflict,
  BasicSourceCheck,
  BasicSourceRecord,
} from "./basic-collection-contracts.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import type { BasicDeterministicObservation } from "./basic-source-adapter-contracts.js";
import type { BasicSourceCatalogSource } from "./basic-source-catalog.js";
import type {
  BasicRawCaptureManifestV2,
  BasicRawCaptureReceiptV2,
} from "./basic-source-v2-contracts.js";

export const BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION =
  "basic-country-audit/v2" as const;
// Package-private boundary shared by v2 artifact creation and filesystem loading.
export const BASIC_COLLECTION_AUDIT_ARTIFACT_MAX_BYTES_V2 = 2 * 1024 * 1024;

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

export interface BasicCollectionReviewReportV2
  extends Omit<
    BasicCollectionReviewReport,
    | "schemaVersion"
    | "runId"
    | "countryCode"
    | "status"
    | "missingFields"
    | "conflicts"
    | "sourceChecks"
    | "injectionRisks"
    | "publicationRecommendation"
    | "humanDecision"
  > {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly status: "ready-for-human-review" | "blocked";
  readonly missingFields: readonly string[];
  readonly conflicts: readonly ReadonlyDeep<BasicReviewConflict>[];
  readonly sourceChecks: readonly ReadonlyDeep<BasicSourceCheck>[];
  readonly injectionRisks: readonly ReadonlyDeep<BasicInjectionRisk>[];
  readonly publicationRecommendation: "request-human-review" | "do-not-publish";
  readonly humanDecision: null;
}

export interface BasicCollectionAuditBundleV2 {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly marketOverviewDraft: ReadonlyDeep<BasicMarketOverviewDraft>;
  readonly reviewReport: BasicCollectionReviewReportV2;
}

export interface BasicCollectionAuditAssemblyInputV2 {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sourceRegister: BasicSourceRegisterV2;
  readonly extractedFacts: BasicExtractedFactsV2;
  readonly marketOverviewDraft: ReadonlyDeep<BasicMarketOverviewDraft>;
  readonly sourceChecks: readonly ReadonlyDeep<BasicSourceCheck>[];
  readonly injectionRisks: readonly ReadonlyDeep<BasicInjectionRisk>[];
}

export interface BasicCollectionAuditParseResultV2 {
  readonly data: BasicCollectionAuditBundleV2 | null;
  readonly errors: readonly string[];
  readonly summary: Readonly<BasicCollectionAuditSummary>;
}

export type BasicCollectionAuditValidationResultV2 =
  | Readonly<{
      valid: true;
      data: BasicCollectionAuditBundleV2;
      errors: readonly [];
      readyForHumanReview: boolean;
      blockers: readonly BasicCollectionBlockerCode[];
      summary: Readonly<BasicCollectionAuditSummary>;
    }>
  | Readonly<{
      valid: false;
      data: null;
      errors: readonly string[];
      readyForHumanReview: false;
      blockers: readonly BasicCollectionBlockerCode[];
      summary: Readonly<BasicCollectionAuditSummary>;
    }>;

export type BasicCollectionAuditArtifactsV2 = Readonly<{
  "source-register.json": ReadonlyDeep<BasicSourceRegisterV2>;
  "extracted-facts.json": ReadonlyDeep<BasicExtractedFactsV2>;
  "market-overview.draft.json": ReadonlyDeep<BasicMarketOverviewDraft>;
  "review-report.json": ReadonlyDeep<BasicCollectionReviewReportV2>;
}>;

export type BasicCollectionAuditSerializedArtifactsV2 = Readonly<
  Record<BasicCollectionAuditArtifactName, Uint8Array>
>;

export type ReadonlyDeep<T> = T extends readonly (infer U)[]
  ? ReadonlyArray<ReadonlyDeep<U>>
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;

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
export const BASIC_V2_REQUIRED_EDITORIAL_PATHS = Object.freeze([
  "country.summary",
  "country.region",
  "marketOverview.overview",
  "marketOverview.energyDemand",
  "marketOverview.renewableTarget",
  "marketOverview.industryTags",
  "marketOverview.techTags",
] as const);
const EDITORIAL_PATHS = new Set<string>(BASIC_V2_REQUIRED_EDITORIAL_PATHS);
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
