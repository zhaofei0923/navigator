import type { BasicProfile } from "@navigator/shared-types/basic-profile";

export type JsonRecord = Record<string, unknown>;

export interface BasicMarketOverviewCanonical extends JsonRecord {
  basicProfile?: BasicProfile | null;
}

export interface BasicCollectionManifest {
  activeRunId: string;
  mappingVersion: string;
  auditBundlePath: string;
}

export interface BasicAuditRun {
  runId: string;
  sourceRegister: JsonRecord;
  extractedFacts: JsonRecord;
  marketOverviewDraft: JsonRecord;
  reviewReport: JsonRecord;
}

export interface BasicCanonicalData {
  country: JsonRecord;
  marketOverview: BasicMarketOverviewCanonical;
  policy: JsonRecord[];
  risk: JsonRecord[];
  opportunities: JsonRecord[];
  projects: JsonRecord[];
  partners: JsonRecord[];
  chineseCompanies: JsonRecord[];
  entryStrategy: JsonRecord | null;
  reports: JsonRecord[];
  knowledge: JsonRecord[];
}

export interface BasicCountryBundle {
  countryDirectory: string;
  canonical: BasicCanonicalData;
  audit: {
    manifest: BasicCollectionManifest;
    run: BasicAuditRun;
  };
}

export interface BasicCountryTemplateInput {
  countryDirectory: string;
  country: Omit<JsonRecord, "coverageLevel" | "moduleCoverage">;
  marketOverview: BasicMarketOverviewCanonical;
  manifest: BasicCollectionManifest;
  auditRun: BasicAuditRun;
}

export interface BasicCountryValidationResult {
  valid: boolean;
  errors: string[];
  summary: {
    countryCode: string;
    coverageLevel: string;
    moduleStatuses: Record<string, string>;
  };
}
