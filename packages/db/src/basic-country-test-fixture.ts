import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  type BasicProfile,
  type BasicProfileCategories,
} from "@navigator/shared-types/basic-profile";

import { createBasicCountryBundle } from "./seed/basic-country-template.js";
import type {
  BasicCountryBundle,
  BasicCountryTemplateInput,
  JsonRecord,
} from "./seed/basic-country-types.js";

export function createValidBundle(): BasicCountryBundle {
  return createBasicCountryBundle(createReviewedInput());
}

export function createValidBasicProfile(): BasicProfile {
  const categories = Object.fromEntries(Object.entries(
    BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  ).map(
    ([category, keys]) => [category, {
      fields: keys.map((key) => ({
        key,
        label: { zh: `${key} 标签`, en: `${key} label` },
        status: "AVAILABLE" as const,
        value: key === "countryName"
          ? { zh: "越南", en: "Vietnam" }
          : key === "countryCode" ? "VN" : `${key} value`,
        unit: null,
        year: null,
        sourceIds: ["source-1"],
        checkedAt: "2026-07-20",
        reason: null,
        note: null,
      })),
    }],
  )) as unknown as BasicProfileCategories;
  return {
    schemaVersion: "basic-market-profile/v2",
    categories,
    sources: [{
      id: "source-1",
      publisher: "Example authority",
      title: { zh: "官方数据", en: "Official data" },
      url: "https://example.com/basic-profile",
      publishedAt: "2026-07-01T00:00:00.000Z",
      retrievedAt: "2026-07-20T00:00:00.000Z",
      credibility: "OFFICIAL",
    }],
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

export function createReviewedInput(): BasicCountryTemplateInput {
  return {
    countryDirectory: "vietnam",
    country: {
      code: "VN",
      name: { zh: "越南", en: "Vietnam" },
      summary: { zh: "市场基础画像", en: "Market baseline" },
      region: "southeast-asia",
      flagEmoji: "VN",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
    marketOverview: {
      overview: { zh: "市场概览", en: "Market overview" },
      population: 100000000,
      gdp: 400000000000,
      gdpGrowth: 5.2,
      energyDemand: { zh: "能源需求", en: "Energy demand" },
      renewableTarget: { zh: "可再生能源目标", en: "Renewable target" },
      keyIndicators: [
        {
          label: { zh: "装机容量", en: "Installed capacity" },
          value: "20",
          unit: "GW",
          year: 2025,
        },
      ],
      source: "Official source",
      sourceUrl: "https://example.com/source",
      collectedAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      credibility: "OFFICIAL",
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "VN",
      industryTags: ["solar"],
      techTags: ["pv-module"],
    },
    manifest: {
      activeRunId: "run-01",
      mappingVersion: "basic-v1",
      auditBundlePath: "data/staging/vietnam/run-01",
    },
    auditRun: {
      runId: "run-01",
      sourceRegister: { marker: "AUDIT_SENTINEL" },
      extractedFacts: { marker: "AUDIT_SENTINEL" },
      marketOverviewDraft: {
        marker: "AUDIT_SENTINEL",
        reviewStatus: "draft",
        aiUsable: false,
      },
      reviewReport: { marker: "AUDIT_SENTINEL" },
    },
  };
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
