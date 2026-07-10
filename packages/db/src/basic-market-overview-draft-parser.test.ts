import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { parseBasicMarketOverviewDraft } from "./collection/basic-market-overview-draft-parser.js";

type DraftInput = Record<string, unknown>;
type TrapCalls = Record<
  "get" | "getOwnPropertyDescriptor" | "getPrototypeOf" | "ownKeys",
  number
>;

function createDraft(): DraftInput {
  const cloned = structuredClone(
    createBasicCollectionAuditFixture().marketOverviewDraft,
  );
  const draft: DraftInput = {};
  for (const [key, value] of Object.entries(cloned)) {
    draft[key] = value;
  }
  return draft;
}

function expectInvalid(value: unknown, error: string): void {
  const result = parseBasicMarketOverviewDraft(value);
  expect(result.data).toBeNull();
  expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining(error)]));
}

function proxyWithThrowingReflectionTraps<T extends object>(target: T): {
  proxy: T;
  calls: TrapCalls;
} {
  const calls: TrapCalls = {
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
  };
  const trapped = (name: keyof TrapCalls): never => {
    calls[name] += 1;
    throw new Error(`unexpected ${name} trap`);
  };
  return {
    proxy: new Proxy(target, {
      get: () => trapped("get"),
      getOwnPropertyDescriptor: () => trapped("getOwnPropertyDescriptor"),
      getPrototypeOf: () => trapped("getPrototypeOf"),
      ownKeys: () => trapped("ownKeys"),
    }),
    calls,
  };
}

function expectNoTrapCalls(calls: TrapCalls): void {
  expect(calls).toEqual({
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
  });
}

describe("parseBasicMarketOverviewDraft", () => {
  test("reconstructs the exact draft shape from own enumerable data properties", () => {
    const draft = createDraft();
    const result = parseBasicMarketOverviewDraft(draft);

    expect(result.errors).toEqual([]);
    expect(result.data).not.toBeNull();
    if (result.data === null) return;
    expect(Object.keys(result.data)).toEqual([
      "overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget",
      "keyIndicators", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility",
      "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags",
    ]);
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(Object.keys(result.data.overview)).toEqual(["zh", "en"]);
    expect(Object.keys(result.data.keyIndicators[0]!)).toEqual(["label", "value", "unit", "year"]);
    expect(Object.keys(result.data.keyIndicators[0]!.label)).toEqual(["zh", "en"]);
    expect(Array.isArray(result.data.keyIndicators)).toBe(true);
    expect(Object.getPrototypeOf(result.data.keyIndicators)).toBe(Array.prototype);
  });

  test.each([
    {
      name: "a missing draft key",
      mutate(draft: DraftInput) { delete draft.overview; },
      error: "marketOverviewDraft must have exactly",
    },
    {
      name: "an extra draft key",
      mutate(draft: DraftInput) { draft.extra = true; },
      error: "marketOverviewDraft must have exactly",
    },
    {
      name: "a symbol draft key",
      mutate(draft: DraftInput) { Object.defineProperty(draft, Symbol("extra"), { enumerable: true, value: true }); },
      error: "marketOverviewDraft must have exactly",
    },
    {
      name: "an inherited draft key",
      mutate(draft: DraftInput) { Object.setPrototypeOf(draft, { overview: draft.overview }); },
      error: "marketOverviewDraft must have exactly",
    },
  ])("rejects $name", ({ mutate, error }) => {
    const draft = createDraft();
    mutate(draft);
    expectInvalid(draft, error);
  });

  test("rejects an accessor draft key without invoking its getter", () => {
    const draft = createDraft();
    let getterCalls = 0;
    Object.defineProperty(draft, "overview", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { zh: "ZH", en: "EN" };
      },
    });

    expectInvalid(draft, "marketOverviewDraft must use enumerable data properties");
    expect(getterCalls).toBe(0);
  });

  test.each([
    {
      name: "top-level draft",
      createValue() {
        return proxyWithThrowingReflectionTraps(createDraft());
      },
      error: "marketOverviewDraft must have exactly",
    },
    {
      name: "localized object",
      createValue() {
        const draft = createDraft();
        const tracked = proxyWithThrowingReflectionTraps({ zh: "ZH", en: "EN" });
        draft.overview = tracked.proxy;
        return { proxy: draft, calls: tracked.calls };
      },
      error: "marketOverviewDraft.overview must have exactly",
    },
    {
      name: "indicator",
      createValue() {
        const draft = createDraft();
        const indicators = draft.keyIndicators as unknown[];
        const tracked = proxyWithThrowingReflectionTraps(
          indicators[0] as Record<string, unknown>,
        );
        indicators[0] = tracked.proxy;
        return { proxy: draft, calls: tracked.calls };
      },
      error: "marketOverviewDraft.keyIndicators[0] must have exactly",
    },
    {
      name: "array",
      createValue() {
        const draft = createDraft();
        const tracked = proxyWithThrowingReflectionTraps(
          draft.keyIndicators as unknown[],
        );
        draft.keyIndicators = tracked.proxy;
        return { proxy: draft, calls: tracked.calls };
      },
      error: "marketOverviewDraft.keyIndicators must be a standard JSON array",
    },
  ])("rejects a $name proxy before invoking reflection traps", ({ createValue, error }) => {
    const tracked = createValue();

    expectInvalid(tracked.proxy, error);
    expectNoTrapCalls(tracked.calls);
  });

  test.each([
    {
      name: "self-referential draft field",
      mutate(draft: DraftInput) {
        draft.overview = draft;
      },
      error: "marketOverviewDraft.overview must have exactly",
    },
    {
      name: "self-referential localized value",
      mutate(draft: DraftInput) {
        const localized: DraftInput = { zh: "ZH", en: "EN" };
        localized.zh = localized;
        draft.overview = localized;
      },
      error: "marketOverviewDraft.overview.zh must be a string",
    },
    {
      name: "self-referential indicator array",
      mutate(draft: DraftInput) {
        const indicators: unknown[] = [];
        indicators.push(indicators);
        draft.keyIndicators = indicators;
      },
      error: "marketOverviewDraft.keyIndicators[0] must have exactly",
    },
  ])("rejects a $name without throwing or hanging", ({ mutate, error }) => {
    const draft = createDraft();
    mutate(draft);

    expect(() => parseBasicMarketOverviewDraft(draft)).not.toThrow();
    expectInvalid(draft, error);
  });

  test.each([
    {
      name: "a sparse indicator array",
      mutate(draft: DraftInput) { draft.keyIndicators = new Array(1); },
      error: "marketOverviewDraft.keyIndicators must be a standard JSON array",
    },
    {
      name: "a custom tag array",
      mutate(draft: DraftInput) { Object.setPrototypeOf(draft.industryTags as object, null); },
      error: "marketOverviewDraft.industryTags must be a standard JSON array",
    },
  ])("rejects $name", ({ mutate, error }) => {
    const draft = createDraft();
    mutate(draft);
    expectInvalid(draft, error);
  });

  test.each([
    ["a blank source", "source", " ", "marketOverviewDraft.source"],
    ["a non-finite population", "population", Number.NaN, "marketOverviewDraft.population"],
    ["a non-finite GDP", "gdp", Number.POSITIVE_INFINITY, "marketOverviewDraft.gdp"],
    ["a malformed country code", "countryCode", "x", "marketOverviewDraft.countryCode"],
    ["an invalid credibility", "credibility", "TRUST_ME", "marketOverviewDraft.credibility"],
    ["an invalid industry tag", "industryTags", ["not-a-tag"], "marketOverviewDraft.industryTags[0]"],
    ["an invalid tech tag", "techTags", ["not-a-tag"], "marketOverviewDraft.techTags[0]"],
    ["a non-HTTP URL", "sourceUrl", "ftp://example.com", "marketOverviewDraft.sourceUrl"],
    ["an invalid collected timestamp", "collectedAt", "2026-02-29T00:00:00Z", "marketOverviewDraft.collectedAt"],
    ["a released review status", "reviewStatus", "published", "marketOverviewDraft.reviewStatus"],
    ["an AI-usable draft", "aiUsable", true, "marketOverviewDraft.aiUsable"],
  ] as const)("rejects %s", (_name, key, value, error) => {
    const draft = createDraft();
    draft[key] = value;
    expectInvalid(draft, error);
  });

  test("requires a sourceUrl-null explanation", () => {
    const draft = createDraft();
    draft.sourceUrl = null;
    draft.source = "Official source";
    expectInvalid(draft, "marketOverviewDraft.source must explain why sourceUrl is null");
  });

  test("allows a blank secondary bilingual side and rejects two blank sides", () => {
    const fallback = createDraft();
    (fallback.overview as Record<string, unknown>).en = " ";
    expect(parseBasicMarketOverviewDraft(fallback).errors).toEqual([]);

    const blank = createDraft();
    (blank.overview as Record<string, unknown>).zh = " ";
    (blank.overview as Record<string, unknown>).en = "\t";
    expectInvalid(blank, "marketOverviewDraft.overview must contain zh or en text");
  });

  test.each([
    {
      name: "an indicator with an extra key",
      mutate(draft: DraftInput) { (draft.keyIndicators as Array<Record<string, unknown>>)[0]!.extra = true; },
      error: "marketOverviewDraft.keyIndicators[0] must have exactly",
    },
    {
      name: "an indicator with a non-finite year",
      mutate(draft: DraftInput) { (draft.keyIndicators as Array<Record<string, unknown>>)[0]!.year = Number.NaN; },
      error: "marketOverviewDraft.keyIndicators[0].year must be a finite number",
    },
  ])("rejects $name", ({ mutate, error }) => {
    const draft = createDraft();
    mutate(draft);
    expectInvalid(draft, error);
  });

  test("returns a fresh reconstruction that input mutation cannot change", () => {
    const draft = createDraft();
    const result = parseBasicMarketOverviewDraft(draft);
    expect(result.data).not.toBeNull();
    if (result.data === null) return;

    const parsed = result.data;
    (draft.overview as Record<string, unknown>).zh = "changed";
    (draft.keyIndicators as Array<Record<string, unknown>>)[0]!.value = "changed";
    (draft.industryTags as string[])[0] = "wind";

    expect(parsed.overview.zh).toBe("市场概览");
    expect(parsed.keyIndicators[0]!.value).toBe("20");
    expect(parsed.industryTags[0]).toBe("solar");
    expect(parsed.overview).not.toBe(draft.overview);
    expect(parsed.keyIndicators).not.toBe(draft.keyIndicators);
    expect(parsed.keyIndicators[0]).not.toBe((draft.keyIndicators as unknown[])[0]);
    expect(parsed.industryTags).not.toBe(draft.industryTags);
  });
});
