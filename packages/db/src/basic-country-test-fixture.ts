import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  type BasicCollectionAuditBundle,
  type BasicCollectionJsonValue,
  type BasicMarketOverviewDraft,
} from "./collection/basic-collection-contracts.js";
import { createBasicCountryBundle } from "./seed/basic-country-template.js";
import type {
  BasicCountryBundle,
  BasicCountryTemplateInput,
  JsonRecord,
} from "./seed/basic-country-types.js";

export function createValidBundle(): BasicCountryBundle {
  return createBasicCountryBundle(createReviewedInput());
}

export function createUnapprovedBundle(): BasicCountryBundle {
  const bundle = structuredClone(createValidBundle());
  const audit = getRecord(bundle.audit.run.reviewReport, "reviewReport");
  audit.humanDecision = null;
  return bundle;
}

export function createApprovedAuditBundle(): BasicCollectionAuditBundle {
  const runId = "run-01";
  const countryCode = "VN";
  const marketOverviewDraft = createMarketOverviewDraft(countryCode);
  const countryFacts: Array<readonly [string, BasicCollectionJsonValue]> = [
    ["country.code", countryCode],
    ["country.name", { zh: "越南", en: "Vietnam" }],
    ["country.summary", { zh: "市场基础画像", en: "Market baseline" }],
    ["country.region", "southeast-asia"],
    ["country.flagEmoji", "VN"],
    ["country.updatedAt", "2026-07-10T00:00:00.000Z"],
  ];
  const marketFacts = marketFactValues(marketOverviewDraft);
  return {
    countryDirectory: "vietnam",
    runId,
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      sources: [{
        sourceId: "source-1",
        sourceName: "Official source",
        sourceUrl: "https://example.com/source",
        retrievedAt: "2026-07-09T00:00:00.000Z",
        publishedAt: "2026-07-08T00:00:00.000Z",
        contentSha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        evidenceLocators: ["table 1"],
        sourceFamily: "official-statistics",
        accessStatus: "open",
        accessNotes: null,
        credibility: "OFFICIAL",
        discoveryOnly: false,
        promptInjectionRisk: "none",
      }],
    },
    extractedFacts: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      facts: [...countryFacts, ...marketFacts].map(
        ([fieldPath, normalizedValue], index) => ({
          factId: `fact-${index + 1}`,
          fieldPath,
          status: "candidate",
          evidence: [{
            sourceId: "source-1",
            locator: "table 1",
            rawValue: structuredClone(normalizedValue),
            normalizedValue: structuredClone(normalizedValue),
            unit: null,
            year: null,
          }],
          extractionMethod: "deterministic",
          uncertainty: null,
        }),
      ),
    },
    marketOverviewDraft,
    reviewReport: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId,
      countryCode,
      status: "ready-for-human-review",
      missingFields: [],
      conflicts: [],
      sourceChecks: [{ sourceId: "source-1", status: "passed", notes: null }],
      injectionRisks: [],
      publicationRecommendation: "request-human-review",
      humanDecision: {
        decision: "approved",
        reviewerId: "fixture-reviewer",
        decidedAt: "2026-07-11T00:00:00Z",
        notes: "Approved fixture for publication-gate tests",
      },
    },
  };
}

export function createReviewedInput(): BasicCountryTemplateInput {
  const audit = createApprovedAuditBundle();
  return {
    countryDirectory: audit.countryDirectory,
    country: {
      code: "VN",
      name: { zh: "越南", en: "Vietnam" },
      summary: { zh: "市场基础画像", en: "Market baseline" },
      region: "southeast-asia",
      flagEmoji: "VN",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
    marketOverview: { ...audit.marketOverviewDraft, reviewStatus: "published" },
    manifest: {
      activeRunId: audit.runId,
      mappingVersion: "basic-country-canonical/v1",
      auditBundlePath: `data/staging/${audit.countryDirectory}/${audit.runId}`,
    },
    auditRun: {
      runId: audit.runId,
      sourceRegister: { ...audit.sourceRegister },
      extractedFacts: { ...audit.extractedFacts },
      marketOverviewDraft: { ...audit.marketOverviewDraft },
      reviewReport: { ...audit.reviewReport },
    },
  };
}

function createMarketOverviewDraft(countryCode: string): BasicMarketOverviewDraft {
  return {
    overview: { zh: "市场概览", en: "Market overview" },
    population: 100000000,
    gdp: 400000000000,
    gdpGrowth: 5.2,
    energyDemand: { zh: "能源需求", en: "Energy demand" },
    renewableTarget: { zh: "可再生能源目标", en: "Renewable target" },
    keyIndicators: [{
      label: { zh: "装机容量", en: "Installed capacity" },
      value: "20",
      unit: "GW",
      year: 2025,
    }],
    source: "Official source",
    sourceUrl: "https://example.com/source",
    collectedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    credibility: "OFFICIAL",
    reviewStatus: "draft",
    aiUsable: false,
    countryCode,
    industryTags: ["solar"],
    techTags: ["pv-module"],
  };
}

function marketFactValues(
  draft: BasicMarketOverviewDraft,
): Array<readonly [string, BasicCollectionJsonValue]> {
  const values: Array<readonly [string, BasicCollectionJsonValue]> = [
    ["marketOverview.overview", { zh: draft.overview.zh, en: draft.overview.en }],
    ["marketOverview.population", draft.population],
    ["marketOverview.gdp", draft.gdp],
    ["marketOverview.gdpGrowth", draft.gdpGrowth],
    ["marketOverview.energyDemand", {
      zh: draft.energyDemand.zh,
      en: draft.energyDemand.en,
    }],
    ["marketOverview.renewableTarget", {
      zh: draft.renewableTarget.zh,
      en: draft.renewableTarget.en,
    }],
    ["marketOverview.source", draft.source],
    ["marketOverview.sourceUrl", draft.sourceUrl],
    ["marketOverview.collectedAt", draft.collectedAt],
    ["marketOverview.updatedAt", draft.updatedAt],
    ["marketOverview.credibility", draft.credibility],
    ["marketOverview.countryCode", draft.countryCode],
    ["marketOverview.industryTags", draft.industryTags],
    ["marketOverview.techTags", draft.techTags],
  ];
  for (const [index, indicator] of draft.keyIndicators.entries()) {
    values.push(
      [`marketOverview.keyIndicators[${index}].label`, {
        zh: indicator.label.zh,
        en: indicator.label.en,
      }],
      [`marketOverview.keyIndicators[${index}].value`, indicator.value],
      [`marketOverview.keyIndicators[${index}].unit`, indicator.unit],
      [`marketOverview.keyIndicators[${index}].year`, indicator.year],
    );
  }
  return values;
}

export function getRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function getRecordArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => getRecord(item, `${label}[${index}]`));
}

export function getRequiredArrayItem<T>(
  values: readonly T[],
  index: number,
  label: string,
): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] is required`);
  }
  return value;
}

export function getModuleCoverage(bundle: BasicCountryBundle): JsonRecord[] {
  return getRecordArray(bundle.canonical.country.moduleCoverage, "moduleCoverage");
}

export function getCoverageByModule(
  bundle: BasicCountryBundle,
  moduleKey: string,
): JsonRecord {
  const coverage = getModuleCoverage(bundle).find(
    (item) => item.moduleKey === moduleKey,
  );
  if (coverage === undefined) {
    throw new Error(`moduleCoverage missing ${moduleKey}`);
  }
  return coverage;
}

export function setLocalizedValue(
  record: JsonRecord,
  field: string,
  locale: "zh" | "en",
  value: string,
): void {
  getRecord(record[field], field)[locale] = value;
}

export function replaceValue(target: object, key: string, value: unknown): void {
  Object.assign(target, { [key]: value });
}

export interface BasicFileFixture {
  repoRoot: string;
  countryPath: string;
  manifestPath: string;
  auditDirectory: string;
}

export function writeBasicCountryFiles(
  bundle: BasicCountryBundle,
  optional: { policy?: JsonRecord[] } = {},
): BasicFileFixture {
  const repoRoot = mkdtempSync(join(tmpdir(), "basic-country-"));
  const countryDirectory = join(repoRoot, "data", bundle.countryDirectory);
  const auditDirectory = join(repoRoot, bundle.audit.manifest.auditBundlePath);
  const countryPath = join(countryDirectory, "country.json");
  const manifestPath = join(countryDirectory, "collection-manifest.json");

  mkdirSync(countryDirectory, { recursive: true });
  mkdirSync(auditDirectory, { recursive: true });
  writeJson(countryPath, bundle.canonical.country);
  writeJson(join(countryDirectory, "market-overview.json"), bundle.canonical.marketOverview);
  writeJson(manifestPath, bundle.audit.manifest);
  writeJson(join(auditDirectory, "source-register.json"), bundle.audit.run.sourceRegister);
  writeJson(join(auditDirectory, "extracted-facts.json"), bundle.audit.run.extractedFacts);
  writeJson(
    join(auditDirectory, "market-overview.draft.json"),
    bundle.audit.run.marketOverviewDraft,
  );
  writeJson(join(auditDirectory, "review-report.json"), bundle.audit.run.reviewReport);
  if (optional.policy !== undefined) {
    writeJson(join(countryDirectory, "policy.json"), optional.policy);
  }
  return { repoRoot, countryPath, manifestPath, auditDirectory };
}

export function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
