import type {
  Credibility,
  IndustryTag,
  PolicyType,
  ReviewStatus,
  RiskLevel,
  TechTag,
} from "@navigator/shared-types/schema";
import type { LocalizedText } from "@navigator/shared-types/i18n";

export const STANDARD_COUNTRY_SYNTHETIC_FIXTURE_SCHEMA_VERSION =
  "standard-country-synthetic-fixture/v1" as const;

export type StandardFixtureLocalizedText = Readonly<LocalizedText>;

export interface StandardFixtureCoverageRecord {
  readonly credibility: Credibility;
  readonly reviewStatus: ReviewStatus;
}

export interface StandardFixtureCoverageScenario {
  readonly policy: readonly StandardFixtureCoverageRecord[];
  readonly risk: readonly StandardFixtureCoverageRecord[];
  readonly opportunities: readonly StandardFixtureCoverageRecord[];
}

export interface StandardFixtureMetadata extends StandardFixtureCoverageRecord {
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly collectedAt: string;
  readonly updatedAt: string;
  readonly aiUsable: false;
  readonly countryCode: string;
  readonly industryTags: readonly IndustryTag[];
  readonly techTags: readonly TechTag[];
}

export interface StandardFixturePolicy extends StandardFixtureMetadata {
  readonly fixtureRecordId: string;
  readonly title: StandardFixtureLocalizedText;
  readonly summary: StandardFixtureLocalizedText;
  readonly body: StandardFixtureLocalizedText;
  readonly policyType: PolicyType;
  readonly effectiveDate: string | null;
  readonly authority: StandardFixtureLocalizedText;
}

export interface StandardFixtureRisk extends StandardFixtureMetadata {
  readonly fixtureRecordId: string;
  readonly title: StandardFixtureLocalizedText;
  readonly category: "fixture-category";
  readonly level: RiskLevel;
  readonly description: StandardFixtureLocalizedText;
  readonly mitigation: StandardFixtureLocalizedText;
}

export interface StandardFixtureOpportunity extends StandardFixtureMetadata {
  readonly fixtureRecordId: string;
  readonly title: StandardFixtureLocalizedText;
  readonly description: StandardFixtureLocalizedText;
  readonly marketSize: StandardFixtureLocalizedText | null;
  readonly timeWindow: StandardFixtureLocalizedText | null;
}

export interface StandardCountrySyntheticFixture {
  readonly schemaVersion: typeof STANDARD_COUNTRY_SYNTHETIC_FIXTURE_SCHEMA_VERSION;
  readonly fixtureOnly: true;
  readonly countryCode: string;
  readonly policy: readonly StandardFixturePolicy[];
  readonly risk: readonly StandardFixtureRisk[];
  readonly opportunities: readonly StandardFixtureOpportunity[];
}
