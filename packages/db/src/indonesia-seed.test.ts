import { describe, expect, test } from "vitest";

import {
  buildIndonesiaSeedImportPlan,
  getAiEligibleBusinessRecords,
  getAiEligibleKnowledgeChunks,
  loadIndonesiaSeed,
  type SeedImportOperation,
  validateIndonesiaSeed,
} from "./seed/indonesia-seed.js";

type JsonRecord = Record<string, unknown>;

describe("P1-2 Indonesia seed", () => {
  test("validates as COMPLETE coverage with reusable module files", () => {
    const seed = loadIndonesiaSeed();
    const result = validateIndonesiaSeed(seed);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary.countryCode).toBe("ID");
    expect(result.summary.coverageLevel).toBe("COMPLETE");
    expect(result.summary.moduleStatuses).toEqual({
      "market-overview": "COMPLETE",
      policy: "COMPLETE",
      risk: "COMPLETE",
      opportunities: "COMPLETE",
      projects: "COMPLETE",
      partners: "COMPLETE",
      "chinese-companies": "COMPLETE",
      "entry-strategy": "COMPLETE",
      "ai-advisor": "COMPLETE",
      reports: "COMPLETE",
    });
    expect(result.summary.knowledgeEligibleCount).toBeGreaterThanOrEqual(20);
    expect(result.summary.knowledgeSourceModuleCount).toBeGreaterThanOrEqual(3);
  });

  test("filters draft and UNVERIFIED examples out of AI-eligible seed data", () => {
    const seed = loadIndonesiaSeed();

    const eligibleKnowledgeIds = getAiEligibleKnowledgeChunks(seed).map(
      (chunk) => chunk.id,
    );
    const eligibleBusinessIds = getAiEligibleBusinessRecords(seed).map(
      (record) => record.id,
    );

    expect(eligibleKnowledgeIds).not.toContain("id_know_anti_unverified_001");
    expect(eligibleBusinessIds).not.toContain("id_pol_anti_draft_001");
    expect(eligibleKnowledgeIds).toHaveLength(20);
    expect(eligibleBusinessIds).toContain("id_pol_001");
  });

  test("builds a reusable import plan from validated module files", () => {
    const seed = loadIndonesiaSeed();
    const plan = buildIndonesiaSeedImportPlan(seed);
    const countryUpsert = getOperation(plan.operations, "country");
    const moduleCoverageCreateMany = getOperation(
      plan.operations,
      "moduleCoverage",
    );
    const policyCreateMany = getOperation(plan.operations, "policy");
    const knowledgeCreateMany = getOperation(plan.operations, "knowledgeChunk");
    const countryCreate = getRecord(getRecord(countryUpsert.args.create, "create"), "country");
    const coverageRows = getRecords(moduleCoverageCreateMany.args.data, "coverage data");
    const policyRows = getRecords(policyCreateMany.args.data, "policy data");
    const knowledgeRows = getRecords(knowledgeCreateMany.args.data, "knowledge data");

    expect(plan.operations).toHaveLength(12);
    expect(plan.aiEligibleKnowledgeIds).toHaveLength(20);
    expect(plan.aiEligibleKnowledgeIds).not.toContain("id_know_anti_unverified_001");
    expect(countryCreate.region).toBe("SOUTHEAST_ASIA");
    expect(coverageRows[0]?.moduleKey).toBe("MARKET_OVERVIEW");
    expect(policyRows[0]?.policyType).toBe("INCENTIVE");
    expect(policyRows[0]?.industryTags).toEqual(["SOLAR", "WIND", "STORAGE"]);
    expect(policyRows[0]?.techTags).toEqual([
      "PV_MODULE",
      "INVERTER",
      "ONSHORE_WIND",
    ]);
    expect(knowledgeRows[0]?.sourceModule).toBe("POLICY");
  });

  test("rejects module coverage values that drift from seed data", () => {
    const seed = structuredClone(loadIndonesiaSeed());
    const moduleCoverage = getRecords(
      seed.country.moduleCoverage,
      "country.moduleCoverage",
    );

    moduleCoverage[0] = {
      ...getRecord(moduleCoverage[0], "moduleCoverage[0]"),
      dataCount: 999,
    };
    seed.country.moduleCoverage = moduleCoverage;

    const result = validateIndonesiaSeed(seed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "country.moduleCoverage market-overview dataCount must be 1",
    );
  });

  test("rejects duplicate module coverage keys", () => {
    const seed = structuredClone(loadIndonesiaSeed());
    const moduleCoverage = getRecords(
      seed.country.moduleCoverage,
      "country.moduleCoverage",
    );
    moduleCoverage[1] = {
      ...getRecord(moduleCoverage[1], "moduleCoverage[1]"),
      moduleKey: "market-overview",
    };
    seed.country.moduleCoverage = moduleCoverage;

    const result = validateIndonesiaSeed(seed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "country.moduleCoverage has duplicate market-overview",
    );
  });
});

function getOperation(
  operations: SeedImportOperation[],
  model: string,
): SeedImportOperation {
  const operation = operations.find((item) => item.model === model);
  expect(operation, `missing import operation for ${model}`).toBeDefined();
  return operation as SeedImportOperation;
}

function getRecord(value: unknown, label: string): JsonRecord {
  expect(value, `${label} must be a record`).toEqual(expect.any(Object));
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as JsonRecord;
}

function getRecords(value: unknown, label: string): JsonRecord[] {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  return value as JsonRecord[];
}
