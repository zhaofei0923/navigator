import type {
  Credibility,
  IndustryTag,
  TechTag,
} from "@navigator/shared-types/schema";
import type { LocalizedText } from "@navigator/shared-types/i18n";

export const BASIC_COLLECTION_AUDIT_SCHEMA_VERSION =
  "basic-country-audit/v1" as const;

export const BASIC_COLLECTION_BLOCKER_CODES = Object.freeze([
  "MISSING_REQUIRED_FACT",
  "UNRESOLVED_CONFLICT",
  "UNTRUSTED_INPUT",
] as const);
export type BasicCollectionBlockerCode =
  (typeof BASIC_COLLECTION_BLOCKER_CODES)[number];

export const BASIC_COLLECTION_REQUIRED_STATIC_FACT_PATHS = Object.freeze([
  "country.code",
  "country.name",
  "country.summary",
  "country.region",
  "country.flagEmoji",
  "country.updatedAt",
  "marketOverview.overview",
  "marketOverview.population",
  "marketOverview.gdp",
  "marketOverview.gdpGrowth",
  "marketOverview.energyDemand",
  "marketOverview.renewableTarget",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.collectedAt",
  "marketOverview.updatedAt",
  "marketOverview.credibility",
  "marketOverview.countryCode",
  "marketOverview.industryTags",
  "marketOverview.techTags",
] as const);

export type BasicCollectionJsonValue =
  | null
  | boolean
  | number
  | string
  | BasicCollectionJsonValue[]
  | { [key: string]: BasicCollectionJsonValue };

export type BasicSourceFamily =
  | "international-organization"
  | "official-statistics"
  | "government"
  | "energy-authority"
  | "regulator"
  | "grid-operator"
  | "industry-association"
  | "verified-research";
export type BasicSourceAccessStatus = "open" | "restricted" | "unknown";
export type BasicPromptInjectionRisk = "none" | "suspected" | "confirmed";
export type BasicFactStatus = "candidate" | "missing" | "conflict" | "untrusted";
export type BasicExtractionMethod = "deterministic" | "hermes" | "manual";

export interface BasicSourceRecord {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  publishedAt: string | null;
  contentSha256: string;
  evidenceLocators: string[];
  sourceFamily: BasicSourceFamily;
  accessStatus: BasicSourceAccessStatus;
  accessNotes: string | null;
  credibility: Credibility;
  discoveryOnly: boolean;
  promptInjectionRisk: BasicPromptInjectionRisk;
}

export interface BasicSourceRegister {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  sources: BasicSourceRecord[];
}

export interface BasicFactEvidence {
  sourceId: string;
  locator: string;
  rawValue: BasicCollectionJsonValue;
  normalizedValue: BasicCollectionJsonValue;
  unit: string | null;
  year: number | null;
}

export interface BasicExtractedFact {
  factId: string;
  fieldPath: string;
  status: BasicFactStatus;
  evidence: BasicFactEvidence[];
  extractionMethod: BasicExtractionMethod;
  uncertainty: string | null;
}

export interface BasicExtractedFacts {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  facts: BasicExtractedFact[];
}

export interface BasicDraftKeyIndicator {
  label: LocalizedText;
  value: string;
  unit: string;
  year: number;
}

export interface BasicMarketOverviewDraft {
  overview: LocalizedText;
  population: number | null;
  gdp: number | null;
  gdpGrowth: number | null;
  energyDemand: LocalizedText;
  renewableTarget: LocalizedText;
  keyIndicators: BasicDraftKeyIndicator[];
  source: string;
  sourceUrl: string | null;
  collectedAt: string;
  updatedAt: string;
  credibility: Credibility;
  reviewStatus: "draft";
  aiUsable: false;
  countryCode: string;
  industryTags: IndustryTag[];
  techTags: TechTag[];
}

export interface BasicReviewConflict {
  fieldPath: string;
  factIds: string[];
  resolution: "unresolved" | "resolved";
  notes: string;
}

export interface BasicSourceCheck {
  sourceId: string;
  status: "passed" | "failed";
  notes: string | null;
}

export interface BasicInjectionRisk {
  sourceId: string;
  locator: string;
  severity: "suspected" | "confirmed";
  details: string;
}

export interface BasicHumanDecision {
  decision: "approved" | "rejected";
  reviewerId: string;
  decidedAt: string;
  notes: string;
}

export interface BasicCollectionReviewReport {
  schemaVersion: typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  status: "ready-for-human-review" | "blocked";
  missingFields: string[];
  conflicts: BasicReviewConflict[];
  sourceChecks: BasicSourceCheck[];
  injectionRisks: BasicInjectionRisk[];
  publicationRecommendation: "request-human-review" | "do-not-publish";
  humanDecision: BasicHumanDecision | null;
}

export interface BasicCollectionAuditBundle {
  countryDirectory: string;
  runId: string;
  sourceRegister: BasicSourceRegister;
  extractedFacts: BasicExtractedFacts;
  marketOverviewDraft: BasicMarketOverviewDraft;
  reviewReport: BasicCollectionReviewReport;
}

export interface BasicCollectionAuditSummary {
  countryCode: string;
  runId: string;
  sourceCount: number;
  factCount: number;
}

export type BasicCollectionAuditValidationResult =
  | {
      valid: true;
      data: BasicCollectionAuditBundle;
      errors: [];
      readyForHumanReview: boolean;
      blockers: BasicCollectionBlockerCode[];
      summary: BasicCollectionAuditSummary;
    }
  | {
      valid: false;
      data: null;
      errors: string[];
      readyForHumanReview: false;
      blockers: BasicCollectionBlockerCode[];
      summary: BasicCollectionAuditSummary;
    };
