import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  MODULE_KEYS,
  getAiAdvisorCoverageStatus,
  getCountryCoverageLevel,
  getListModuleCoverageStatus,
  getObjectModuleCoverageStatus,
  type ModuleCoverageStatus,
  type ModuleKey,
} from "./index.js";

type JsonRecord = Record<string, unknown>;

describe("coverage decision logic", () => {
  test.each([
    [0, "BUILDING"],
    [1, "PARTIAL"],
    [4, "PARTIAL"],
    [5, "COMPLETE"],
  ] satisfies Array<[number, ModuleCoverageStatus]>)(
    "evaluates list module count %i as %s",
    (dataCount, expected) => {
      expect(getListModuleCoverageStatus(dataCount)).toBe(expected);
    },
  );

  test("evaluates empty object modules as BUILDING", () => {
    expect(
      getObjectModuleCoverageStatus(
        { a: "", b: null, c: undefined, d: [], e: {} },
        ["a", "b", "c", "d", "e"],
      ),
    ).toBe("BUILDING");
  });

  test("evaluates schema-shaped empty localized object modules as BUILDING", () => {
    expect(
      getObjectModuleCoverageStatus(
        {
          overview: { zh: "", en: " " },
          energyDemand: { zh: "", en: "" },
          renewableTarget: { zh: "", en: "" },
          keyIndicators: [],
        },
        ["overview", "energyDemand", "renewableTarget", "keyIndicators"],
      ),
    ).toBe("BUILDING");
  });

  test("evaluates object modules below 80 percent fill as PARTIAL", () => {
    expect(
      getObjectModuleCoverageStatus(
        { a: "filled", b: 0, c: ["filled"], d: null, e: "" },
        ["a", "b", "c", "d", "e"],
      ),
    ).toBe("PARTIAL");
  });

  test("evaluates object modules at 80 percent fill as COMPLETE", () => {
    expect(
      getObjectModuleCoverageStatus(
        { a: "filled", b: 0, c: ["filled"], d: { nested: true }, e: "" },
        ["a", "b", "c", "d", "e"],
      ),
    ).toBe("COMPLETE");
  });

  test.each([
    [{ usableKnowledgeCount: 0, sourceModuleCount: 0 }, "BUILDING"],
    [{ usableKnowledgeCount: 1, sourceModuleCount: 1 }, "PARTIAL"],
    [{ usableKnowledgeCount: 19, sourceModuleCount: 3 }, "PARTIAL"],
    [{ usableKnowledgeCount: 20, sourceModuleCount: 2 }, "PARTIAL"],
    [{ usableKnowledgeCount: 20, sourceModuleCount: 3 }, "COMPLETE"],
  ] satisfies Array<
    [
      { usableKnowledgeCount: number; sourceModuleCount: number },
      ModuleCoverageStatus,
    ]
  >)("evaluates ai-advisor coverage %j as %s", (input, expected) => {
    expect(getAiAdvisorCoverageStatus(input)).toBe(expected);
  });

  test("evaluates country BASIC when only market overview is at least PARTIAL", () => {
    expect(
      getCountryCoverageLevel({
        ...allModuleStatuses("BUILDING"),
        "market-overview": "PARTIAL",
      }),
    ).toBe("BASIC");
  });

  test("rejects country coverage when market overview is not at least PARTIAL", () => {
    expect(() => getCountryCoverageLevel(allModuleStatuses("BUILDING"))).toThrow(
      "market-overview must be at least PARTIAL before assigning BASIC coverage",
    );
  });

  test("evaluates country STANDARD when decision modules are at least PARTIAL", () => {
    expect(
      getCountryCoverageLevel({
        ...allModuleStatuses("BUILDING"),
        "market-overview": "PARTIAL",
        policy: "PARTIAL",
        risk: "PARTIAL",
        opportunities: "PARTIAL",
      }),
    ).toBe("STANDARD");
  });

  test("evaluates country COMPLETE only when all ten modules are COMPLETE", () => {
    expect(getCountryCoverageLevel(allModuleStatuses("COMPLETE"))).toBe(
      "COMPLETE",
    );
  });

  test("rounds country coverage downward when a COMPLETE requirement is missing", () => {
    expect(
      getCountryCoverageLevel({
        ...allModuleStatuses("COMPLETE"),
        reports: "PARTIAL",
      }),
    ).toBe("STANDARD");
  });

  test("rounds country coverage downward to BASIC when a STANDARD module is missing", () => {
    expect(
      getCountryCoverageLevel({
        ...allModuleStatuses("COMPLETE"),
        policy: "BUILDING",
      }),
    ).toBe("BASIC");
  });

  test("evaluates the approved Indonesia publication as BASIC", () => {
    const country = readJson("country.json") as JsonRecord;
    const marketOverview = readJson("market-overview.json") as JsonRecord;
    const moduleStatuses: Record<ModuleKey, ModuleCoverageStatus> = {
      "market-overview": getObjectModuleCoverageStatus(marketOverview, [
        "overview",
        "population",
        "gdp",
        "gdpGrowth",
        "energyDemand",
        "renewableTarget",
        "keyIndicators",
      ]),
      policy: "BUILDING",
      risk: "BUILDING",
      opportunities: "BUILDING",
      projects: "BUILDING",
      partners: "BUILDING",
      "chinese-companies": "BUILDING",
      "entry-strategy": "BUILDING",
      "ai-advisor": "BUILDING",
      reports: "BUILDING",
    };

    expect(moduleStatuses).toEqual({
      ...allModuleStatuses("BUILDING"),
      "market-overview": "COMPLETE",
    });
    expect(getCountryCoverageLevel(moduleStatuses)).toBe("BASIC");
    expect(country.coverageLevel).toBe("BASIC");
    expect(marketOverview.reviewStatus).toBe("published");
    expect(marketOverview.aiUsable).toBe(false);
  });
});

function allModuleStatuses(
  status: ModuleCoverageStatus,
): Record<ModuleKey, ModuleCoverageStatus> {
  return Object.fromEntries(MODULE_KEYS.map((moduleKey) => [moduleKey, status])) as Record<
    ModuleKey,
    ModuleCoverageStatus
  >;
}

function readJson(pathname: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../data/indonesia/${pathname}`, import.meta.url), "utf8"));
}
