import { describe, expect, test } from "vitest";

import { buildBasicCountryImportPlan } from "./seed/basic-country-import.js";
import { validateBasicCountryBundle } from "./seed/basic-country-validator.js";
import {
  createValidBundle,
  getRecord,
  getRecordArray,
  getRequiredArrayItem,
} from "./basic-country-test-fixture.js";

describe("Basic country import plan", () => {
  test("builds an isolated Basic Prisma import plan", () => {
    const plan = buildBasicCountryImportPlan(createValidBundle());
    expect(plan.operations).toHaveLength(12);
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country", ...Array.from({ length: 10 }, () => "moduleCoverage"), "marketOverview",
    ]);
    expect(plan.aiEligibleKnowledgeIds).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
    expect(plan.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "knowledgeChunk" }),
    ]));
    expect(JSON.stringify(plan)).not.toMatch(/"id"\s*:/);

    const countryCreate = getRecord(getRecord(plan.operations[0]?.args, "country operation").create, "country create");
    expect(countryCreate.region).toBe("SOUTHEAST_ASIA");
    expect(countryCreate.coverageLevel).toBe("BASIC");
    for (const operation of plan.operations.slice(1, 11)) {
      const args = getRecord(operation.args, "module coverage operation");
      const composite = getRecord(getRecord(args.where, "where").countryCode_moduleKey, "composite key");
      const create = getRecord(args.create, "module coverage create");
      expect(composite.countryCode).toBe("VN");
      expect(composite.moduleKey).toBe(create.moduleKey);
      expect(create.countryCode).toBe("VN");
      expect(create.moduleKey).toMatch(/^[A-Z_]+$/);
      expect(create).not.toHaveProperty("id");
    }
    const marketCreate = getRecord(getRecord(plan.operations[11]?.args, "market operation").create, "market create");
    expect(marketCreate.industryTags).toEqual(["SOLAR"]);
    expect(marketCreate.techTags).toEqual(["PV_MODULE"]);
    expect(marketCreate).not.toHaveProperty("id");
  });

  test("throws joined validation errors before transforming invalid data", () => {
    const bundle = createValidBundle();
    bundle.canonical.country.coverageLevel = "STANDARD";
    bundle.canonical.marketOverview.aiUsable = true;
    expect(() => buildBasicCountryImportPlan(bundle)).toThrow(
      "country.coverageLevel must be BASIC\nmarket-overview.aiUsable must be false",
    );

    const cyclicBundle = createValidBundle();
    const localized = { zh: "市场概览", en: "Market overview" } as Record<string, unknown>;
    localized.evidence = localized;
    cyclicBundle.canonical.marketOverview.overview = localized;
    const bigintBundle = createValidBundle();
    bigintBundle.canonical.marketOverview.renewableTarget = {
      zh: "可再生能源目标",
      en: "Renewable target",
      evidence: BigInt(1),
    };
    for (const invalidBundle of [cyclicBundle, bigintBundle]) {
      expect(validateBasicCountryBundle(invalidBundle).valid).toBe(false);
      expect(() => buildBasicCountryImportPlan(invalidBundle)).toThrow(
        "must have exactly zh and en own keys",
      );
    }
  });

  test("reconstructs exact canonical localized and indicator objects", () => {
    const plan = buildBasicCountryImportPlan(createValidBundle());
    const countryCreate = getRecord(getRecord(plan.operations[0]?.args, "country operation").create, "country create");
    const marketCreate = getRecord(getRecord(plan.operations[11]?.args, "market operation").create, "market create");
    const indicator = getRequiredArrayItem(
      getRecordArray(marketCreate.keyIndicators, "keyIndicators"), 0, "keyIndicators",
    );
    for (const localized of [
      countryCreate.name, countryCreate.summary, marketCreate.overview,
      marketCreate.energyDemand, marketCreate.renewableTarget, indicator.label,
    ]) {
      expect(Object.keys(getRecord(localized, "localized value")).sort()).toEqual(["en", "zh"]);
    }
    expect(Object.keys(indicator).sort()).toEqual(["label", "unit", "value", "year"]);
    expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
  });
});
