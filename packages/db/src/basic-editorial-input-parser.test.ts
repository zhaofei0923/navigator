import { describe, expect, test } from "vitest";

import {
  parseBasicCountryEditorialInput,
} from "./collection/basic-editorial-input-parser.js";

const ERROR = "basic editorial input is invalid";
const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

type MutableRecord = Record<string | symbol, unknown>;

function localized(en: string, zh: string): Record<string, unknown> {
  return { en, zh };
}

function evidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rawValue: "reviewed source text",
    year: null,
    locator: "json:/reviewed/value",
    sourceId: "official-source",
    unit: null,
    ...overrides,
  };
}

function editorialItem(
  fieldPath: string,
  normalizedValue: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uncertainty: null,
    evidence: [evidence()],
    normalizedValue,
    fieldPath,
    ...overrides,
  };
}

function completeItems(): Record<string, unknown>[] {
  const values: readonly (readonly [string, unknown])[] = [
    ["country.name", localized("Indonesia", "印度尼西亚")],
    ["country.region", "southeast-asia"],
    ["country.summary", localized("Market summary", "市场摘要")],
    ["marketOverview.energyDemand", localized("Demand is rising", "需求增长")],
    ["marketOverview.industryTags", ["solar", "wind"]],
    ["marketOverview.keyIndicators[0].label", localized("Population", "人口")],
    ["marketOverview.keyIndicators[1].label", localized("GDP", "国内生产总值")],
    ["marketOverview.overview", localized("Market overview", "市场概览")],
    ["marketOverview.renewableTarget", localized("Net zero target", "净零目标")],
    ["marketOverview.techTags", ["lfp", "pv-module"]],
  ];
  return values.map(([fieldPath, normalizedValue], index) => editorialItem(
    fieldPath,
    normalizedValue,
    {
      evidence: [evidence({
        locator: `json:/editorial/${index}`,
        rawValue: index === 0
          ? { zebra: [true, null], alpha: { y: 2, x: 1 } }
          : `reviewed-${index}`,
      })],
    },
  ));
}

function validInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    items: completeItems(),
    catalogSha256: CATALOG_SHA256,
    primarySourceId: "official-source",
    countryCode: "ID",
    schemaVersion: "basic-country-editorial-input/v1",
    catalogVersion: "2026.07.13",
    runId: "run-20260713",
    ...overrides,
  };
}

function singleItemInput(
  fieldPath: string,
  normalizedValue: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return validInput({
    items: [editorialItem(fieldPath, normalizedValue, overrides)],
  });
}

function expectInvalid(value: unknown): void {
  expect(() => parseBasicCountryEditorialInput(value)).toThrow(ERROR);
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, "value")) {
      expectRecursivelyFrozen(descriptor.value);
    }
  }
}

function nestedArrays(depth: number, leaf: unknown): unknown {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

describe("Basic country editorial input parser", () => {
  test("reconstructs the complete bilingual schema in stable key order and freezes it", () => {
    const input = validInput();

    const result = parseBasicCountryEditorialInput(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.items).not.toBe(input.items);
    expect(Object.keys(result)).toEqual([
      "schemaVersion",
      "runId",
      "countryCode",
      "catalogVersion",
      "catalogSha256",
      "primarySourceId",
      "items",
    ]);
    expect(Object.keys(result.items[0]!)).toEqual([
      "fieldPath",
      "normalizedValue",
      "evidence",
      "uncertainty",
    ]);
    expect(Object.keys(result.items[0]!.normalizedValue as object)).toEqual([
      "zh",
      "en",
    ]);
    expect(Object.keys(result.items[0]!.evidence[0]!)).toEqual([
      "sourceId",
      "locator",
      "rawValue",
      "unit",
      "year",
    ]);
    const rawValue = result.items[0]!.evidence[0]!.rawValue as Record<string, unknown>;
    expect(Object.keys(rawValue)).toEqual(["alpha", "zebra"]);
    expect(Object.keys(rawValue.alpha as object)).toEqual(["x", "y"]);
    expectRecursivelyFrozen(result);
  });

  test("produces byte-identical output for schema and raw-object insertion-order changes", () => {
    const first = validInput();
    const firstItem = (first.items as Record<string, unknown>[])[0]!;
    const firstEvidence = (firstItem.evidence as Record<string, unknown>[])[0]!;
    const second = {
      runId: "run-20260713",
      catalogVersion: "2026.07.13",
      schemaVersion: "basic-country-editorial-input/v1",
      primarySourceId: "official-source",
      items: [
        {
          normalizedValue: { zh: "印度尼西亚", en: "Indonesia" },
          fieldPath: "country.name",
          uncertainty: null,
          evidence: [{
            locator: "json:/editorial/0",
            unit: null,
            sourceId: "official-source",
            year: null,
            rawValue: { alpha: { x: 1, y: 2 }, zebra: [true, null] },
          }],
        },
        ...(first.items as Record<string, unknown>[]).slice(1),
      ],
      countryCode: "ID",
      catalogSha256: CATALOG_SHA256,
    };

    expect(firstEvidence.rawValue).toEqual({
      zebra: [true, null],
      alpha: { y: 2, x: 1 },
    });
    expect(JSON.stringify(parseBasicCountryEditorialInput(first))).toBe(
      JSON.stringify(parseBasicCountryEditorialInput(second)),
    );
  });

  test.each([
    ["an extra top-level key", () => ({ ...validInput(), extra: true })],
    ["a missing top-level key", () => {
      const value = validInput();
      delete value.runId;
      return value;
    }],
    ["an extra item key", () => singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { extra: true },
    )],
    ["a missing item key", () => {
      const item = editorialItem("country.summary", localized("Summary", "摘要"));
      delete item.uncertainty;
      return validInput({ items: [item] });
    }],
    ["an extra evidence key", () => singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ extra: true })] },
    )],
    ["a missing evidence key", () => {
      const value = evidence();
      delete value.year;
      return singleItemInput(
        "country.summary",
        localized("Summary", "摘要"),
        { evidence: [value] },
      );
    }],
    ["an extra localized-text key", () => singleItemInput(
      "country.summary",
      { zh: "摘要", en: "Summary", extra: true },
    )],
    ["a missing localized-text key", () => singleItemInput(
      "country.summary",
      { zh: "摘要" },
    )],
  ])("rejects %s", (_label, createValue) => {
    expectInvalid(createValue());
  });

  test("rejects accessors and proxies without executing their traps", () => {
    const accessorProbe = { executions: 0 };
    const accessor = validInput();
    Object.defineProperty(accessor, "runId", {
      configurable: true,
      enumerable: true,
      get() {
        accessorProbe.executions += 1;
        return "run-20260713";
      },
    });
    const proxyProbe = { executions: 0 };
    const proxy = new Proxy(validInput(), {
      get(target, property, receiver) {
        proxyProbe.executions += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        proxyProbe.executions += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        proxyProbe.executions += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyProbe.executions += 1;
        return Reflect.ownKeys(target);
      },
    });

    expectInvalid(accessor);
    expectInvalid(proxy);
    expect(accessorProbe.executions).toBe(0);
    expect(proxyProbe.executions).toBe(0);
  });

  test("rejects symbol keys and nested accessors without reading them", () => {
    const symbolValue = validInput() as MutableRecord;
    symbolValue[Symbol("hidden")] = true;
    const probe = { executions: 0 };
    const rawValue: Record<string, unknown> = {};
    Object.defineProperty(rawValue, "secret", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return "must-not-run";
      },
    });

    expectInvalid(symbolValue);
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ rawValue })] },
    ));
    expect(probe.executions).toBe(0);
  });

  test.each([
    ["schema version", { schemaVersion: "basic-country-editorial-input/v2" }],
    ["run ID", { runId: "bad run" }],
    ["country code", { countryCode: "id" }],
    ["catalog version", { catalogVersion: "Bad Version" }],
    ["catalog digest", { catalogSha256: "A".repeat(64) }],
    ["empty primary source", { primarySourceId: "" }],
    ["unsafe primary source", { primarySourceId: "Official/Source" }],
  ])("rejects an invalid %s", (_label, overrides) => {
    expectInvalid(validInput(overrides));
  });

  test("rejects cyclic, sparse, deep, oversized, and invalid finite JSON", () => {
    const cyclicRaw: Record<string, unknown> = {};
    cyclicRaw.self = cyclicRaw;
    const sparseItems = new Array(1);
    const sparseEvidence = new Array(1);
    const sparseRaw = new Array(1);
    const oversizedRaw = Array.from({ length: 257 }, (_, index) => index);
    const invalidValues = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      1n,
      new Date("2026-07-13T00:00:00.000Z"),
    ];

    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ rawValue: cyclicRaw })] },
    ));
    expectInvalid(validInput({ items: sparseItems }));
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: sparseEvidence },
    ));
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ rawValue: sparseRaw })] },
    ));
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ rawValue: nestedArrays(65, "deep") })] },
    ));
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence({ rawValue: oversizedRaw })] },
    ));
    for (const rawValue of invalidValues) {
      expectInvalid(singleItemInput(
        "country.summary",
        localized("Summary", "摘要"),
        { evidence: [evidence({ rawValue })] },
      ));
    }
  });

  test("rejects more than 256 items and more than 32 evidence entries", () => {
    const items = Array.from({ length: 257 }, (_, index) => editorialItem(
      `marketOverview.keyIndicators[${index}].label`,
      localized(`Indicator ${index}`, `指标 ${index}`),
    )).sort((left, right) => {
      const leftPath = left.fieldPath as string;
      const rightPath = right.fieldPath as string;
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    });
    const itemEvidence = Array.from({ length: 33 }, (_, index) => evidence({
      locator: `json:/values/${String(index).padStart(2, "0")}`,
    }));

    expectInvalid(validInput({ items }));
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: itemEvidence },
    ));
  });

  test.each([
    ["empty evidence", []],
    ["duplicate evidence", [evidence(), evidence()]],
    ["source-unsorted evidence", [
      evidence({ sourceId: "z-source" }),
      evidence({ sourceId: "a-source" }),
    ]],
    ["locator-unsorted evidence", [
      evidence({ locator: "json:/z" }),
      evidence({ locator: "json:/a" }),
    ]],
  ])("rejects %s", (_label, itemEvidence) => {
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: itemEvidence },
    ));
  });

  test.each([
    ["an empty evidence source ID", { sourceId: "" }],
    ["an unsafe evidence source ID", { sourceId: "Official/Source" }],
    ["a blank evidence locator", { locator: "  " }],
    ["a non-null evidence unit", { unit: "MW" }],
    ["a non-null evidence year", { year: 2025 }],
  ])("rejects %s", (_label, overrides) => {
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { evidence: [evidence(overrides)] },
    ));
  });

  test("rejects unsorted and duplicate item field paths", () => {
    expectInvalid(validInput({ items: [
      editorialItem("country.summary", localized("Summary", "摘要")),
      editorialItem("country.name", localized("Indonesia", "印度尼西亚")),
    ] }));
    expectInvalid(validInput({ items: [
      editorialItem("country.name", localized("Indonesia", "印度尼西亚")),
      editorialItem("country.name", localized("Indonesia", "印度尼西亚")),
    ] }));
  });

  test.each([
    ["country.code"],
    ["country.flagEmoji"],
    ["country.updatedAt"],
    ["marketOverview.population"],
    ["marketOverview.gdp"],
    ["marketOverview.gdpGrowth"],
    ["marketOverview.source"],
    ["marketOverview.sourceUrl"],
    ["marketOverview.collectedAt"],
    ["marketOverview.updatedAt"],
    ["marketOverview.credibility"],
    ["marketOverview.countryCode"],
    ["marketOverview.keyIndicators[0].value"],
    ["marketOverview.keyIndicators[0].unit"],
    ["marketOverview.keyIndicators[0].year"],
    ["marketOverview.unknown"],
    ["policy.overview"],
  ])("rejects unsupported or protected path %s", (fieldPath) => {
    expectInvalid(singleItemInput(
      fieldPath,
      localized("Protected", "受保护"),
    ));
  });

  test.each([
    ["marketOverview.keyIndicators[01].label"],
    ["marketOverview.keyIndicators[-1].label"],
    ["marketOverview.keyIndicators[+1].label"],
    ["marketOverview.keyIndicators[1.0].label"],
    ["marketOverview.keyIndicators[].label"],
    ["marketOverview.keyIndicators[*].label"],
    ["marketOverview.keyIndicators[ 1].label"],
    ["marketOverview.keyIndicators[1]label"],
  ])("rejects non-exact indicator path %s", (fieldPath) => {
    expectInvalid(singleItemInput(
      fieldPath,
      localized("Indicator", "指标"),
    ));
  });

  test.each([
    ["localized text without Chinese", "country.summary", { en: "Summary" }],
    ["localized text without English", "country.summary", { zh: "摘要" }],
    ["blank Chinese text", "country.summary", localized("Summary", "  ")],
    ["blank English text", "country.name", localized(" ", "印度尼西亚")],
    ["scalar localized text", "marketOverview.overview", "Overview"],
    ["invalid indicator label", "marketOverview.keyIndicators[0].label", {
      zh: "指标",
      en: "",
    }],
    ["unknown region", "country.region", "asia"],
    ["non-string region", "country.region", ["southeast-asia"]],
    ["unknown industry tag", "marketOverview.industryTags", ["coal"]],
    ["duplicate industry tags", "marketOverview.industryTags", ["solar", "solar"]],
    ["unsorted industry tags", "marketOverview.industryTags", ["wind", "solar"]],
    ["unknown tech tag", "marketOverview.techTags", ["unknown-tech"]],
    ["duplicate tech tags", "marketOverview.techTags", ["lfp", "lfp"]],
    ["unsorted tech tags", "marketOverview.techTags", ["pv-module", "lfp"]],
  ])("rejects %s", (_label, fieldPath, normalizedValue) => {
    expectInvalid(singleItemInput(fieldPath, normalizedValue));
  });

  test.each([
    ["empty uncertainty", ""],
    ["blank uncertainty", " \t "],
    ["non-string uncertainty", 1],
  ])("rejects %s", (_label, uncertainty) => {
    expectInvalid(singleItemInput(
      "country.summary",
      localized("Summary", "摘要"),
      { uncertainty },
    ));
  });

  test("rejects overlong and ill-formed JSON strings and object keys", () => {
    const overlong = "x".repeat(65_537);
    const illFormed = "\uD800";

    for (const rawValue of [overlong, illFormed, { [overlong]: true }, { [illFormed]: true }]) {
      expectInvalid(singleItemInput(
        "country.summary",
        localized("Summary", "摘要"),
        { evidence: [evidence({ rawValue })] },
      ));
    }
  });

  test("uses one stable redacted error", () => {
    const sentinel = "EDITORIAL_SECRET_MUST_NOT_LEAK";

    try {
      parseBasicCountryEditorialInput(singleItemInput(
        `unsupported.${sentinel}`,
        localized("Secret", "机密"),
      ));
      throw new Error("expected parser to reject input");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });
});
