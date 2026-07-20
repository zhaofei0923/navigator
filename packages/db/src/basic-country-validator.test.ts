import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { BasicCountryBundle, JsonRecord } from "./seed/basic-country-types.js";
import { loadBasicCountryBundle } from "./seed/basic-country-loader.js";
import { validateBasicCountryBundle } from "./seed/basic-country-validator.js";
import {
  createValidBundle,
  createValidBasicProfile,
  getCoverageByModule,
  getModuleCoverage,
  getRecord,
  getRecordArray,
  getRequiredArrayItem,
  replaceValue,
  setLocalizedValue,
  writeBasicCountryFiles,
  writeJson,
} from "./basic-country-test-fixture.js";

describe("Basic country validation", () => {
  test("accepts legacy omission and a valid BASIC v2 profile but rejects malformed profiles", () => {
    const legacy = createValidBundle();
    expect(legacy.canonical.marketOverview).not.toHaveProperty("basicProfile");
    expect(validateBasicCountryBundle(legacy).valid).toBe(true);

    const current = createValidBundle();
    getRecord(current.canonical.marketOverview, "market overview").basicProfile =
      createValidBasicProfile();
    expect(validateBasicCountryBundle(current).valid).toBe(true);

    const malformed = createValidBundle();
    getRecord(malformed.canonical.marketOverview, "market overview").basicProfile = {
      ...createValidBasicProfile(),
      schemaVersion: "basic-market-profile/v1",
    };
    expect(validateBasicCountryBundle(malformed).errors).toContain(
      "market-overview.basicProfile must be a valid basic-market-profile/v2 profile or null",
    );
  });

  test("validates a Basic bundle with one-language localized fallbacks", () => {
    const bundle = createValidBundle();
    setLocalizedValue(bundle.canonical.country, "name", "en", "");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "en", "");
    const indicator = getRequiredArrayItem(
      getRecordArray(bundle.canonical.marketOverview.keyIndicators, "keyIndicators"),
      0,
      "keyIndicators",
    );
    setLocalizedValue(indicator, "label", "en", "");

    expect(validateBasicCountryBundle(bundle)).toMatchObject({
      valid: true,
      errors: [],
      summary: { countryCode: "VN", coverageLevel: "BASIC" },
    });
  });

  test("rejects invalid country identity and timestamps", () => {
    const bundle = createValidBundle();
    bundle.canonical.country.code = "vn";
    bundle.canonical.country.region = "east-asia";
    bundle.canonical.country.flagEmoji = " ";
    bundle.canonical.country.updatedAt = "not-a-date";
    getRequiredArrayItem(getModuleCoverage(bundle), 0, "moduleCoverage").updatedAt = "not-a-date";

    expect(validateBasicCountryBundle(bundle).errors).toEqual(
      expect.arrayContaining([
        "country.code must be an uppercase two-letter country code",
        expect.stringContaining("country.region must be one of"),
        "country.flagEmoji must be a non-empty string",
        "country.updatedAt must be a strict UTC RFC3339 timestamp",
        "moduleCoverage[0].updatedAt must be a strict UTC RFC3339 timestamp",
      ]),
    );
  });

  test("requires strict UTC RFC3339 timestamps", () => {
    for (const timestamp of [
      "2026-02-28T00:00:00Z",
      "2026-02-28T00:00:00.1Z",
      "2026-02-28T00:00:00.12Z",
      "2026-02-28T00:00:00.123Z",
    ]) {
      const bundle = createValidBundle();
      bundle.canonical.country.updatedAt = timestamp;
      expect(validateBasicCountryBundle(bundle).valid).toBe(true);
    }
    for (const timestamp of [
      "2026-02-31T00:00:00Z",
      "2026-01-01T00:00:00+08:00",
      "2026-01-01",
      "2026-01-01T00:00:00.1234Z",
      "2026-01-01T00:00Z",
    ]) {
      const bundle = createValidBundle();
      bundle.canonical.country.updatedAt = timestamp;
      bundle.canonical.marketOverview.collectedAt = timestamp;
      bundle.canonical.marketOverview.updatedAt = timestamp;
      getRequiredArrayItem(getModuleCoverage(bundle), 0, "moduleCoverage").updatedAt = timestamp;
      expect(validateBasicCountryBundle(bundle).errors).toEqual(
        expect.arrayContaining([
          "country.updatedAt must be a strict UTC RFC3339 timestamp",
          "market-overview.collectedAt must be a strict UTC RFC3339 timestamp",
          "market-overview.updatedAt must be a strict UTC RFC3339 timestamp",
          "moduleCoverage[0].updatedAt must be a strict UTC RFC3339 timestamp",
        ]),
      );
    }
  });

  test("requires a Prisma Int-compatible population", () => {
    for (const population of [1.5, -1, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
      const bundle = createValidBundle();
      bundle.canonical.marketOverview.population = population;
      expect(validateBasicCountryBundle(bundle).errors).toContain(
        "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
      );
    }
    const bundle = createValidBundle();
    bundle.canonical.marketOverview.population = null;
    expect(validateBasicCountryBundle(bundle).valid).toBe(true);
  });

  test("returns structured errors for malformed runtime bundles", () => {
    const malformedInputs: unknown[] = [
      null,
      {},
      { countryDirectory: "vietnam", canonical: null, audit: {} },
      { countryDirectory: "vietnam", canonical: { country: null }, audit: { manifest: null } },
    ];
    for (const input of malformedInputs) {
      expect(() => validateBasicCountryBundle(input)).not.toThrow();
      expect(validateBasicCountryBundle(input)).toMatchObject({
        valid: false,
        summary: { countryCode: "", coverageLevel: "", moduleStatuses: {} },
      });
      expect(validateBasicCountryBundle(input).errors).not.toEqual([]);
    }
  });

  test("rejects blank localized fields and malformed market indicators", () => {
    const bundle = createValidBundle();
    setLocalizedValue(bundle.canonical.country, "summary", "zh", " ");
    setLocalizedValue(bundle.canonical.country, "summary", "en", " ");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "zh", " ");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "en", " ");
    bundle.canonical.marketOverview.population = "100000000";
    bundle.canonical.marketOverview.keyIndicators = [];

    expect(validateBasicCountryBundle(bundle).errors).toEqual(
      expect.arrayContaining([
        "country.summary must contain zh or en text",
        "market-overview.overview must contain zh or en text",
        "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
        "market-overview.keyIndicators must be a non-empty array",
      ]),
    );
  });

  test("requires own market metadata and registered enum values", () => {
    for (const field of [
      "source", "sourceUrl", "collectedAt", "updatedAt", "credibility", "reviewStatus",
      "aiUsable", "countryCode", "industryTags", "techTags",
    ]) {
      const bundle = createValidBundle();
      delete bundle.canonical.marketOverview[field];
      expect(validateBasicCountryBundle(bundle).valid).toBe(false);
    }

    const bundle = createValidBundle();
    bundle.canonical.marketOverview.sourceUrl = "ftp://example.com/source";
    bundle.canonical.marketOverview.collectedAt = "invalid";
    bundle.canonical.marketOverview.updatedAt = "invalid";
    bundle.canonical.marketOverview.credibility = "UNVERIFIED";
    bundle.canonical.marketOverview.reviewStatus = "draft";
    bundle.canonical.marketOverview.aiUsable = true;
    bundle.canonical.marketOverview.countryCode = "ID";
    bundle.canonical.marketOverview.industryTags = ["unknown"];
    bundle.canonical.marketOverview.techTags = ["unknown"];
    expect(validateBasicCountryBundle(bundle).errors).toEqual(
      expect.arrayContaining([
        "market-overview.sourceUrl must be an HTTP(S) URL or null",
        "market-overview.collectedAt must be a strict UTC RFC3339 timestamp",
        "market-overview.updatedAt must be a strict UTC RFC3339 timestamp",
        "market-overview.credibility must not be UNVERIFIED",
        "market-overview.reviewStatus must be published",
        "market-overview.aiUsable must be false",
        "market-overview.countryCode must match country.code",
        "market-overview.industryTags contains unsupported value unknown",
        "market-overview.techTags contains unsupported value unknown",
      ]),
    );

    const nullUrlBundle = createValidBundle();
    nullUrlBundle.canonical.marketOverview.sourceUrl = null;
    expect(validateBasicCountryBundle(nullUrlBundle).valid).toBe(false);
    nullUrlBundle.canonical.marketOverview.source =
      "Official source; sourceUrl null because the source does not publish a link";
    expect(validateBasicCountryBundle(nullUrlBundle).valid).toBe(true);
  });

  test("rejects product data and coverage that exceed the Basic contract", () => {
    const bundle = createValidBundle();
    bundle.canonical.policy.push({ title: "not allowed" });
    bundle.canonical.entryStrategy = { overview: "not allowed" };
    bundle.canonical.knowledge.push({ content: "not allowed" });
    bundle.canonical.country.coverageLevel = "STANDARD";
    const coverage = getModuleCoverage(bundle);
    getRequiredArrayItem(coverage, 0, "moduleCoverage").dataCount = 2;
    getRequiredArrayItem(coverage, 1, "moduleCoverage").status = "PARTIAL";
    getRequiredArrayItem(coverage, 1, "moduleCoverage").dataCount = 1;
    getRequiredArrayItem(coverage, 5, "moduleCoverage").moduleKey = "market-overview";
    getRequiredArrayItem(coverage, 3, "moduleCoverage").status = "PARTIAL";
    getRequiredArrayItem(coverage, 4, "moduleCoverage").status = "PARTIAL";

    expect(validateBasicCountryBundle(bundle).errors).toEqual(
      expect.arrayContaining([
        "canonical.policy must be empty for BASIC",
        "canonical.entryStrategy must be null for BASIC",
        "canonical.knowledge must be empty for BASIC",
        "country.coverageLevel must be BASIC",
        "country.moduleCoverage has duplicate market-overview",
        "country.moduleCoverage missing partners",
        "country.moduleCoverage market-overview dataCount must be 1",
        "country.moduleCoverage policy status must be BUILDING",
        "country.moduleCoverage policy dataCount must be 0",
      ]),
    );
  });

  test("rejects coverage that qualifies for Standard", () => {
    const bundle = createValidBundle();
    for (const moduleKey of ["policy", "risk", "opportunities"]) {
      getCoverageByModule(bundle, moduleKey).status = "PARTIAL";
    }
    expect(validateBasicCountryBundle(bundle).errors).toContain(
      "Basic coverage must not qualify for STANDARD",
    );
  });

  test("rejects unsafe audit manifests and invalid audit artifacts", () => {
    const bundle = createValidBundle();
    bundle.countryDirectory = "vietnam/../id";
    bundle.audit.manifest.activeRunId = "run-02";
    bundle.audit.manifest.auditBundlePath = "data/staging/id/run-02";
    replaceValue(bundle.audit.run, "sourceRegister", []);
    bundle.audit.run.marketOverviewDraft.reviewStatus = "published";
    bundle.audit.run.marketOverviewDraft.aiUsable = true;

    expect(validateBasicCountryBundle(bundle).errors).toEqual(
      expect.arrayContaining([
        "countryDirectory must be a safe slug",
        "audit.manifest.activeRunId must match audit.run.runId",
        "audit.manifest.auditBundlePath must equal data/staging/vietnam/../id/run-02",
        "audit.run.sourceRegister must be an object",
        "audit.run.marketOverviewDraft.reviewStatus must be draft",
        "audit.run.marketOverviewDraft.aiUsable must be false",
      ]),
    );
  });

  test("loads canonical and audit files while defaulting absent optional modules", () => {
    const files = writeBasicCountryFiles(createValidBundle(), { policy: [{ id: "unexpected-policy" }] });
    try {
      const loaded = loadBasicCountryBundle(files.repoRoot, "vietnam");
      expect(loaded.canonical.policy).toEqual([{ id: "unexpected-policy" }]);
      expect(loaded.canonical.risk).toEqual([]);
      expect(loaded.canonical.entryStrategy).toBeNull();
      expect(loaded.canonical.knowledge).toEqual([]);
      expect(loaded.audit.manifest.activeRunId).toBe("run-01");
      expect(loaded.audit.run.marketOverviewDraft.reviewStatus).toBe("draft");
    } finally {
      rmSync(files.repoRoot, { recursive: true, force: true });
    }
  });

  test("rejects unsafe, missing, and malformed Basic bundle files", () => {
    const files = writeBasicCountryFiles(createValidBundle());
    try {
      expect(() => loadBasicCountryBundle(files.repoRoot, "../vietnam")).toThrow("countryDirectory must be a safe slug");
      writeJson(files.manifestPath, { activeRunId: "../run-01", mappingVersion: "basic-v1", auditBundlePath: "data/staging/vietnam/../run-01" });
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow("activeRunId must be a safe run id");
      writeJson(files.manifestPath, createValidBundle().audit.manifest);
      rmSync(join(files.auditDirectory, "source-register.json"));
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow("source-register.json");
      writeJson(join(files.auditDirectory, "source-register.json"), { source: "restored" });
      writeFileSync(files.countryPath, "{", "utf8");
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow(files.countryPath);
    } finally {
      rmSync(files.repoRoot, { recursive: true, force: true });
    }
  });

  test("rejects localized text with an undeclared own property", () => {
    const bundle = createValidBundle();
    bundle.canonical.marketOverview.overview = { zh: "市场概览", en: "Market overview", evidence: "AUDIT_SENTINEL" };
    expect(validateBasicCountryBundle(bundle).errors).toContain(
      "market-overview.overview must have exactly zh and en own keys",
    );
  });

  test("rejects indicators with undeclared fields", () => {
    const bundle = createValidBundle();
    getRequiredArrayItem(getRecordArray(bundle.canonical.marketOverview.keyIndicators, "keyIndicators"), 0, "keyIndicators").evidence = "AUDIT_SENTINEL";
    expect(validateBasicCountryBundle(bundle).errors).toContain(
      "market-overview.keyIndicators[0] must have exactly label, value, unit, and year own keys",
    );
  });

  test("rejects inherited and non-plain localized and indicator values", () => {
    const inheritedLocalized = Object.create({ zh: "市场概览", en: "Market overview" }) as JsonRecord;
    const nonPlainLocalized = Object.assign(Object.create({}), { zh: "能源需求", en: "Energy demand" }) as JsonRecord;
    const inheritedIndicator = Object.create({ label: { zh: "装机容量", en: "Installed capacity" }, value: "20", unit: "GW", year: 2025 }) as JsonRecord;
    const nonPlainIndicator = Object.assign(Object.create({}), { label: { zh: "装机容量", en: "Installed capacity" }, value: "20", unit: "GW", year: 2025 }) as JsonRecord;
    for (const [localized, indicator] of [
      [inheritedLocalized, inheritedIndicator],
      [nonPlainLocalized, nonPlainIndicator],
    ]) {
      const bundle = createValidBundle();
      bundle.canonical.marketOverview.overview = localized;
      bundle.canonical.marketOverview.energyDemand = localized;
      bundle.canonical.marketOverview.keyIndicators = [indicator];
      expect(validateBasicCountryBundle(bundle).errors).toEqual(
        expect.arrayContaining([
          "market-overview.overview must have exactly zh and en own keys",
          "market-overview.energyDemand must have exactly zh and en own keys",
          "market-overview.keyIndicators[0] must have exactly label, value, unit, and year own keys",
        ]),
      );
    }
  });

  test("rejects cyclic and bigint extras without throwing serialization errors", () => {
    const cyclicBundle = createValidBundle();
    const cyclicLocalized: JsonRecord = { zh: "市场概览", en: "Market overview" };
    cyclicLocalized.evidence = cyclicLocalized;
    cyclicBundle.canonical.marketOverview.overview = cyclicLocalized;
    const bigintBundle = createValidBundle();
    bigintBundle.canonical.marketOverview.renewableTarget = { zh: "可再生能源目标", en: "Renewable target", evidence: BigInt(1) };

    for (const bundle of [cyclicBundle, bigintBundle]) {
      expect(validateBasicCountryBundle(bundle).errors).toEqual(
        expect.arrayContaining([expect.stringContaining("must have exactly zh and en own keys")]),
      );
    }
  });
});
