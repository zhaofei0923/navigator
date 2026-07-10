import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createBasicCountryBundle } from "./seed/basic-country-template.js";
import type { BasicCountryBundle, JsonRecord } from "./seed/basic-country-types.js";
import { buildBasicCountryImportPlan } from "./seed/basic-country-import.js";
import {
  loadBasicCountryBundle,
  validateBasicCountryBundle,
} from "./seed/basic-country-validator.js";

describe("P1-5 Basic country seed", () => {
  test("creates a Basic bundle with only market overview coverage", () => {
    const bundle = createBasicCountryBundle(createReviewedInput());

    expect(bundle.canonical.country.coverageLevel).toBe("BASIC");
    expect(bundle.canonical.country.moduleCoverage).toHaveLength(10);
    expect(bundle.canonical.country.moduleCoverage).toContainEqual(
      expect.objectContaining({
        moduleKey: "market-overview",
        status: expect.stringMatching(/PARTIAL|COMPLETE/),
        dataCount: 1,
      }),
    );
    expect(bundle.canonical.entryStrategy).toBeNull();
    expect(bundle.canonical.policy).toEqual([]);
    expect(bundle.canonical.knowledge).toEqual([]);
  });

  test("rejects market overviews that cannot enter a Basic bundle", () => {
    const unpublished = createReviewedInput();
    unpublished.marketOverview.reviewStatus = "draft";
    expect(() => createBasicCountryBundle(unpublished)).toThrow(
      "marketOverview.reviewStatus must be published",
    );

    const unverified = createReviewedInput();
    unverified.marketOverview.credibility = "UNVERIFIED";
    expect(() => createBasicCountryBundle(unverified)).toThrow(
      "marketOverview.credibility must not be UNVERIFIED",
    );

    const aiUsable = createReviewedInput();
    aiUsable.marketOverview.aiUsable = true;
    expect(() => createBasicCountryBundle(aiUsable)).toThrow(
      "marketOverview.aiUsable must be false",
    );
  });

  test("validates a Basic bundle with one-language localized fallbacks", () => {
    const bundle = createValidBundle();
    setLocalizedValue(bundle.canonical.country, "name", "en", "");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "en", "");
    const indicator = getRecord(
      getRecordArray(bundle.canonical.marketOverview.keyIndicators, "keyIndicators")[0],
      "keyIndicators[0]",
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
    getRequiredArrayItem(
      getModuleCoverage(bundle),
      0,
      "moduleCoverage",
    ).updatedAt = "not-a-date";

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
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
      getRequiredArrayItem(
        getModuleCoverage(bundle),
        0,
        "moduleCoverage",
      ).updatedAt = timestamp;

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

  test("requires a Prisma Int-compatible population before import planning", () => {
    for (const population of [1.5, -1, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
      const bundle = createValidBundle();
      bundle.canonical.marketOverview.population = population;

      expect(validateBasicCountryBundle(bundle).errors).toContain(
        "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
      );
      expect(() => buildBasicCountryImportPlan(bundle)).toThrow(
        "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
      );
    }

    const nullPopulationBundle = createValidBundle();
    nullPopulationBundle.canonical.marketOverview.population = null;
    expect(validateBasicCountryBundle(nullPopulationBundle).valid).toBe(true);
  });

  test("returns structured errors for malformed runtime bundles", () => {
    const malformedInputs: unknown[] = [
      null,
      {},
      { countryDirectory: "vietnam", canonical: null, audit: {} },
      {
        countryDirectory: "vietnam",
        canonical: { country: null, marketOverview: null },
        audit: { manifest: null, run: null },
      },
    ];

    for (const input of malformedInputs) {
      expect(() => validateBasicCountryBundle(input)).not.toThrow();
      expect(validateBasicCountryBundle(input)).toMatchObject({
        valid: false,
        summary: {
          countryCode: "",
          coverageLevel: "",
          moduleStatuses: {},
        },
      });
      expect(validateBasicCountryBundle(input).errors).not.toEqual([]);
    }

    expect(() =>
      buildBasicCountryImportPlan({ canonical: null } as unknown as BasicCountryBundle),
    ).toThrow("canonical must be an object");
  });

  test("rejects blank localized fields and malformed market indicators", () => {
    const bundle = createValidBundle();
    setLocalizedValue(bundle.canonical.country, "summary", "zh", "");
    setLocalizedValue(bundle.canonical.country, "summary", "en", "");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "zh", "");
    setLocalizedValue(bundle.canonical.marketOverview, "overview", "en", "");
    bundle.canonical.marketOverview.population = "100000000";
    bundle.canonical.marketOverview.keyIndicators = [];

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "country.summary must contain zh or en text",
        "market-overview.overview must contain zh or en text",
        "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
        "market-overview.keyIndicators must be a non-empty array",
      ]),
    );
  });

  test("rejects missing and invalid Basic market metadata", () => {
    const metaFields = [
      "source",
      "sourceUrl",
      "collectedAt",
      "updatedAt",
      "credibility",
      "reviewStatus",
      "aiUsable",
      "countryCode",
      "industryTags",
      "techTags",
    ];

    for (const field of metaFields) {
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

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
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
    getRequiredArrayItem(coverage, 5, "moduleCoverage").moduleKey =
      "market-overview";
    getRequiredArrayItem(coverage, 3, "moduleCoverage").status = "PARTIAL";
    getRequiredArrayItem(coverage, 4, "moduleCoverage").status = "PARTIAL";

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
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

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Basic coverage must not qualify for STANDARD");
  });

  test("rejects unsafe audit manifests and invalid audit artifacts", () => {
    const bundle = createValidBundle();
    bundle.countryDirectory = "vietnam/../id";
    bundle.audit.manifest.activeRunId = "run-02";
    bundle.audit.manifest.auditBundlePath = "data/staging/id/run-02";
    replaceValue(bundle.audit.run, "sourceRegister", []);
    bundle.audit.run.marketOverviewDraft.reviewStatus = "published";
    bundle.audit.run.marketOverviewDraft.aiUsable = true;

    const result = validateBasicCountryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
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
    const files = writeBasicCountryFiles(createValidBundle(), {
      policy: [{ id: "unexpected-policy" }],
    });

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
      expect(() => loadBasicCountryBundle(files.repoRoot, "../vietnam")).toThrow(
        "countryDirectory must be a safe slug",
      );
      writeJson(files.manifestPath, {
        activeRunId: "../run-01",
        mappingVersion: "basic-v1",
        auditBundlePath: "data/staging/vietnam/../run-01",
      });
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow(
        "activeRunId must be a safe run id",
      );
      writeJson(files.manifestPath, createValidBundle().audit.manifest);
      rmSync(join(files.auditDirectory, "source-register.json"));
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow(
        "source-register.json",
      );
      writeJson(join(files.auditDirectory, "source-register.json"), { source: "restored" });
      writeFileSync(files.countryPath, "{", "utf8");
      expect(() => loadBasicCountryBundle(files.repoRoot, "vietnam")).toThrow(
        files.countryPath,
      );
    } finally {
      rmSync(files.repoRoot, { recursive: true, force: true });
    }
  });

  test("builds an isolated Basic Prisma import plan", () => {
    const plan = buildBasicCountryImportPlan(createValidBundle());

    expect(plan.operations).toHaveLength(12);
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country",
      ...Array.from({ length: 10 }, () => "moduleCoverage"),
      "marketOverview",
    ]);
    expect(plan.aiEligibleKnowledgeIds).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
    expect(plan.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "knowledgeChunk" }),
      ]),
    );
    expect(JSON.stringify(plan)).not.toMatch(/"id"\s*:/);

    const countryOperation = getRecord(plan.operations[0]?.args, "country operation");
    const countryCreate = getRecord(countryOperation.create, "country create");
    expect(countryCreate.region).toBe("SOUTHEAST_ASIA");
    expect(countryCreate.coverageLevel).toBe("BASIC");

    const moduleCoverageOperations = plan.operations.slice(1, 11);
    for (const operation of moduleCoverageOperations) {
      expect(operation.action).toBe("upsert");
      const args = getRecord(operation.args, "module coverage operation");
      const where = getRecord(args.where, "module coverage where");
      const composite = getRecord(
        where.countryCode_moduleKey,
        "module coverage composite key",
      );
      const create = getRecord(args.create, "module coverage create");

      expect(composite.countryCode).toBe("VN");
      expect(composite.moduleKey).toBe(create.moduleKey);
      expect(create.countryCode).toBe("VN");
      expect(create.moduleKey).toMatch(/^[A-Z_]+$/);
      expect(create).not.toHaveProperty("id");
    }

    const marketOperation = getRecord(plan.operations[11]?.args, "market operation");
    const marketCreate = getRecord(marketOperation.create, "market create");
    expect(marketCreate.industryTags).toEqual(["SOLAR"]);
    expect(marketCreate.techTags).toEqual(["PV_MODULE"]);
    expect(marketCreate).not.toHaveProperty("id");
  });

  test("throws joined validation errors for an invalid import plan", () => {
    const bundle = createValidBundle();
    bundle.canonical.country.coverageLevel = "STANDARD";
    bundle.canonical.marketOverview.aiUsable = true;

    expect(() => buildBasicCountryImportPlan(bundle)).toThrow(
      "country.coverageLevel must be BASIC\nmarket-overview.aiUsable must be false",
    );
  });
});

function createValidBundle(): BasicCountryBundle {
  return createBasicCountryBundle(createReviewedInput());
}

function createReviewedInput() {
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

function getRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function getRecordArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => getRecord(item, `${label}[${index}]`));
}

function getRequiredArrayItem<T>(
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

function getModuleCoverage(bundle: BasicCountryBundle): JsonRecord[] {
  return getRecordArray(bundle.canonical.country.moduleCoverage, "moduleCoverage");
}

function getCoverageByModule(
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

function setLocalizedValue(
  record: JsonRecord,
  field: string,
  locale: "zh" | "en",
  value: string,
): void {
  getRecord(record[field], field)[locale] = value;
}

function replaceValue(target: object, key: string, value: unknown): void {
  Object.assign(target, { [key]: value });
}

interface BasicFileFixture {
  repoRoot: string;
  countryPath: string;
  manifestPath: string;
  auditDirectory: string;
}

function writeBasicCountryFiles(
  bundle: BasicCountryBundle,
  optional: { policy?: JsonRecord[] } = {},
): BasicFileFixture {
  const repoRoot = mkdtempSync(join(tmpdir(), "basic-country-"));
  const countryDirectory = join(repoRoot, "data", bundle.countryDirectory);
  const auditDirectory = join(
    repoRoot,
    bundle.audit.manifest.auditBundlePath,
  );
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

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
