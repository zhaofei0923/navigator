import {
  getCountryCoverageLevel,
  getListModuleCoverageStatus,
  type ModuleCoverageDecision,
} from "@navigator/shared-types/coverage";

import type {
  StandardCountrySyntheticFixture,
  StandardFixtureMetadata,
} from "./standard-fixture-contracts.js";

export interface StandardFixtureMarketOverviewCoverage {
  readonly status: "PARTIAL" | "COMPLETE";
  readonly dataCount: number;
}

export interface StandardFixtureCoverageInput {
  readonly marketOverview: StandardFixtureMarketOverviewCoverage;
}

export interface StandardFixtureCoverageVerdict {
  readonly coverageLevel: "BASIC" | "STANDARD";
  readonly moduleCoverage: readonly ModuleCoverageDecision[];
  readonly knowledge: readonly never[];
  readonly aiEligibleKnowledgeIds: readonly never[];
}

export function deriveStandardFixtureCoverage(
  fixture: StandardCountrySyntheticFixture,
  input: StandardFixtureCoverageInput,
): StandardFixtureCoverageVerdict {
  validateMarketOverview(input.marketOverview);
  const policyCount = visibleCount(fixture.policy);
  const riskCount = visibleCount(fixture.risk);
  const opportunityCount = visibleCount(fixture.opportunities);
  const moduleCoverage: ModuleCoverageDecision[] = [
    { moduleKey: "market-overview", ...input.marketOverview },
    listCoverage("policy", policyCount),
    listCoverage("risk", riskCount),
    listCoverage("opportunities", opportunityCount),
    building("projects"),
    building("partners"),
    building("chinese-companies"),
    building("entry-strategy"),
    building("ai-advisor"),
    building("reports"),
  ];
  const coverageLevel = getCountryCoverageLevel(moduleCoverage);
  if (coverageLevel === "COMPLETE") invalid();
  return deepFreeze({
    coverageLevel,
    moduleCoverage,
    knowledge: [],
    aiEligibleKnowledgeIds: [],
  });
}

function visibleCount(records: readonly StandardFixtureMetadata[]): number {
  return records.filter(
    (record) =>
      record.reviewStatus === "published" &&
      record.credibility !== "UNVERIFIED",
  ).length;
}

function listCoverage(
  moduleKey: "policy" | "risk" | "opportunities",
  dataCount: number,
): ModuleCoverageDecision {
  return {
    moduleKey,
    status: getListModuleCoverageStatus(dataCount),
    dataCount,
  };
}

function building(
  moduleKey:
    | "projects"
    | "partners"
    | "chinese-companies"
    | "entry-strategy"
    | "ai-advisor"
    | "reports",
): ModuleCoverageDecision {
  return { moduleKey, status: "BUILDING", dataCount: 0 };
}

function validateMarketOverview(
  coverage: StandardFixtureMarketOverviewCoverage,
): void {
  if (
    (coverage.status !== "PARTIAL" && coverage.status !== "COMPLETE") ||
    !Number.isSafeInteger(coverage.dataCount) ||
    coverage.dataCount < 1
  ) invalid();
}

function invalid(): never {
  throw new Error("STANDARD_FIXTURE_COVERAGE_INVALID");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
