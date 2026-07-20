import type { LocalizedText } from "@navigator/shared-types/i18n";
import type { Credibility } from "@navigator/shared-types/schema";

import type {
  BasicCollectionAuditSummary,
  BasicCollectionBlockerCode,
  BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import type {
  BasicCollectionReviewReportV2,
  BasicExtractedFactV2,
  BasicSourceRegisterV2,
  ReadonlyDeep,
} from "./basic-collection-v2-contracts.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";

export const BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION =
  "basic-country-audit/v3" as const;
export const BASIC_V3_PROFILE_SCHEMA_VERSION =
  "basic-market-profile/v2" as const;
export const BASIC_V3_PROFILE_CATEGORY_KEYS = [
  "countryBasics",
  "electricityMarket",
  "energyAccess",
  "renewableCapacity",
  "solarResource",
  "windResource",
  "policyOverview",
  "marketSummary",
] as const;

export const BASIC_V3_PROFILE_FACT_PATH_PREFIX =
  "marketOverview.basicProfile.categories." as const;

export type BasicV3ProfileCategoryKey =
  (typeof BASIC_V3_PROFILE_CATEGORY_KEYS)[number];
export interface BasicV3ProfileField {
  readonly key: string;
  readonly label: LocalizedText;
  readonly status: "AVAILABLE" | "NOT_AVAILABLE";
  readonly value: number | string | LocalizedText | null;
  readonly unit: string | null;
  readonly year: number | null;
  readonly sourceIds: readonly string[];
  readonly checkedAt: string;
  readonly reason: LocalizedText | null;
  readonly note: LocalizedText | null;
}
export interface BasicV3ProfileSource {
  readonly id: string;
  readonly publisher: string;
  readonly title: LocalizedText;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly credibility: Credibility;
}
export interface BasicV3Profile {
  readonly schemaVersion: typeof BASIC_V3_PROFILE_SCHEMA_VERSION;
  readonly categories: Readonly<Record<
    BasicV3ProfileCategoryKey,
    Readonly<{ fields: readonly BasicV3ProfileField[] }>
  >>;
  readonly sources: readonly BasicV3ProfileSource[];
  readonly updatedAt: string;
}

export type BasicMarketOverviewDraftV3 = ReadonlyDeep<BasicMarketOverviewDraft> &
  Readonly<{ basicProfile: ReadonlyDeep<BasicV3Profile> }>;

export interface BasicSourceRegisterV3
  extends Omit<BasicSourceRegisterV2, "schemaVersion"> {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION;
}

export type BasicExtractedFactV3 = BasicExtractedFactV2;

export interface BasicExtractedFactsV3 {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly facts: readonly BasicExtractedFactV3[];
}

export interface BasicCollectionReviewReportV3
  extends Omit<BasicCollectionReviewReportV2, "schemaVersion"> {
  readonly schemaVersion: typeof BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION;
}

export interface BasicCollectionAuditBundleV3 {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: BasicSourceRegisterV3;
  readonly extractedFacts: BasicExtractedFactsV3;
  readonly marketOverviewDraft: BasicMarketOverviewDraftV3;
  readonly reviewReport: BasicCollectionReviewReportV3;
}

export interface BasicCollectionAuditParseResultV3 {
  readonly data: BasicCollectionAuditBundleV3 | null;
  readonly errors: readonly string[];
  readonly summary: Readonly<BasicCollectionAuditSummary>;
}

export type BasicCollectionAuditArtifactsV3 = Readonly<{
  "source-register.json": ReadonlyDeep<BasicSourceRegisterV3>;
  "extracted-facts.json": ReadonlyDeep<BasicExtractedFactsV3>;
  "market-overview.draft.json": ReadonlyDeep<BasicMarketOverviewDraftV3>;
  "review-report.json": ReadonlyDeep<BasicCollectionReviewReportV3>;
}>;

export type BasicCollectionAuditSerializedArtifactsV3 = Readonly<
  Record<BasicCollectionAuditArtifactName, Uint8Array>
>;

export type BasicCollectionAuditValidationResultV3 =
  | Readonly<{
      valid: true;
      data: BasicCollectionAuditBundleV3;
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

export interface BasicV3ProfileFactPath {
  readonly category: BasicV3ProfileCategoryKey;
  readonly fieldKey: string;
}

const PROFILE_FACT_PATH = new RegExp(
  `^${escapeRegExp(BASIC_V3_PROFILE_FACT_PATH_PREFIX)}(${BASIC_V3_PROFILE_CATEGORY_KEYS.join("|")})\\.fields\\.([a-z][A-Za-z0-9]*)$`,
);

export function parseBasicV3ProfileFactPath(
  fieldPath: string,
): BasicV3ProfileFactPath | null {
  const match = PROFILE_FACT_PATH.exec(fieldPath);
  if (match === null) return null;
  return {
    category: match[1] as BasicV3ProfileCategoryKey,
    fieldKey: match[2]!,
  };
}

export function basicV3ProfileFactPath(
  category: BasicV3ProfileCategoryKey,
  fieldKey: string,
): string {
  return `${BASIC_V3_PROFILE_FACT_PATH_PREFIX}${category}.fields.${fieldKey}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
