export const BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION =
  "basic-structured-source-review/v1" as const;
export const BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION =
  "basic-manual-source-review/v1" as const;

export interface BasicReviewIdentityExpectation {
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly deterministicSourceIds: readonly string[];
  readonly manualSourceIds: readonly string[];
}

export interface BasicReviewedSourceCheck {
  readonly status: "passed" | "failed";
  readonly notes: string | null;
}

export interface BasicStructuredInjectionRisk {
  readonly sourceId: string;
  readonly locator: string;
  readonly severity: "suspected" | "confirmed";
  readonly details: string;
}

export interface BasicStructuredSourceReviewSource {
  readonly sourceId: string;
  readonly sourceCheck: BasicReviewedSourceCheck;
}

export interface BasicStructuredSourceReview {
  readonly schemaVersion: typeof BASIC_STRUCTURED_SOURCE_REVIEW_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sources: readonly BasicStructuredSourceReviewSource[];
  readonly injectionRisks: readonly BasicStructuredInjectionRisk[];
}

export interface BasicManualInjectionRisk {
  readonly locator: string;
  readonly severity: "suspected" | "confirmed";
  readonly details: string;
}

export interface BasicManualSourceReviewSource {
  readonly sourceId: string;
  readonly publishedAt: string | null;
  readonly accessNotes: string | null;
  readonly promptInjectionRisk: "none" | "suspected" | "confirmed";
  readonly sourceCheck: BasicReviewedSourceCheck;
  readonly injectionRisks: readonly BasicManualInjectionRisk[];
}

export interface BasicManualSourceReview {
  readonly schemaVersion: typeof BASIC_MANUAL_SOURCE_REVIEW_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sources: readonly BasicManualSourceReviewSource[];
}
