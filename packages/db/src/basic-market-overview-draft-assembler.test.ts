import { beforeEach, describe, expect, test, vi } from "vitest";

const { legacySnapshot } = vi.hoisted(() => ({ legacySnapshot: vi.fn() }));

vi.mock("./collection/basic-llama-draft-schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection/basic-llama-draft-schema.js")>();
  return {
    ...actual,
    snapshotBasicLlamaJson: (...args: Parameters<typeof actual.snapshotBasicLlamaJson>) => {
      legacySnapshot();
      return actual.snapshotBasicLlamaJson(...args);
    },
  };
});

import {
  createBasicCollectionAuditFixture,
  readBasicCollectionAuditFixture,
} from "./basic-collection-test-fixture.js";
import type {
  BasicCollectionAuditBundle,
  BasicCollectionJsonValue,
  BasicExtractedFact,
  BasicMarketOverviewDraft,
} from "./collection/basic-collection-contracts.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./collection/basic-collection-v2-contracts.js";
import { assembleBasicMarketOverviewDraft } from "./collection/basic-market-overview-draft-assembler.js";

type DraftInput = {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
};

beforeEach(() => {
  legacySnapshot.mockClear();
});

function assemble(bundle: BasicCollectionAuditBundle): BasicMarketOverviewDraft | null {
  return assembleBasicMarketOverviewDraft({
    sourceRegister: bundle.sourceRegister,
    extractedFacts: bundle.extractedFacts,
  });
}

function factFor(bundle: BasicCollectionAuditBundle, fieldPath: string): BasicExtractedFact {
  const fact = bundle.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

function v2Ready(): BasicCollectionAuditBundle {
  const bundle = structuredClone(createBasicCollectionAuditFixture());
  const sourceRegister = bundle.sourceRegister as unknown as Record<string, unknown>;
  sourceRegister.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  sourceRegister.catalogVersion = "basic-source-catalog/v1";
  sourceRegister.catalogSha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  (bundle.extractedFacts as unknown as Record<string, unknown>).schemaVersion =
    BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  addIndicator(bundle, 1, {
    label: { zh: "发电量", en: "Generation" },
    value: "30",
    unit: "TWh",
    year: 2026,
  });
  return bundle;
}

function addIndicator(
  bundle: BasicCollectionAuditBundle,
  index: number,
  indicator: BasicMarketOverviewDraft["keyIndicators"][number],
): void {
  const entries: Array<readonly [string, BasicCollectionJsonValue]> = [
    ["label", { zh: indicator.label.zh, en: indicator.label.en }],
    ["value", indicator.value],
    ["unit", indicator.unit],
    ["year", indicator.year],
  ];
  for (const [field, normalizedValue] of entries) {
    bundle.extractedFacts.facts.push({
      factId: `indicator-${index}-${field}`,
      fieldPath: `marketOverview.keyIndicators[${index}].${field}`,
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
    });
  }
}

function throwingProxy<T extends object>(target: T): {
  readonly proxy: T;
  readonly traps: ReturnType<typeof vi.fn>;
} {
  const traps = vi.fn(() => { throw new Error("reflection trap must not run"); });
  return {
    proxy: new Proxy(target, {
      get: traps,
      getOwnPropertyDescriptor: traps,
      getPrototypeOf: traps,
      ownKeys: traps,
    }),
    traps,
  };
}

describe("assembleBasicMarketOverviewDraft v1 characterization", () => {
  test.each(["normal", "missing", "conflict", "untrusted"] as const)(
    "preserves the %s v1 fixture outcome",
    (scenario) => {
      const bundle = readBasicCollectionAuditFixture(scenario);

      expect(assemble(bundle)).toEqual(
        scenario === "normal" ? bundle.marketOverviewDraft : null,
      );
    },
  );

  test("preserves v1 compatibility when candidate facts contain no indicators", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
      (fact) => !fact.fieldPath.startsWith("marketOverview.keyIndicators["),
    );

    expect(assemble(bundle)).toEqual({
      ...bundle.marketOverviewDraft,
      keyIndicators: [],
    });
  });

  test("uses the legacy snapshot/parser path for exact v1 envelopes", () => {
    const bundle = readBasicCollectionAuditFixture("normal");

    expect(assemble(bundle)).toEqual(bundle.marketOverviewDraft);
    expect(legacySnapshot).toHaveBeenCalledTimes(2);
  });
});

describe("assembleBasicMarketOverviewDraft v2-ready input", () => {
  test("reconstructs ordered, fixed-lock draft from complete exact v2 material", () => {
    const bundle = v2Ready();
    const result = assemble(bundle);

    expect(result).toEqual({
      ...bundle.marketOverviewDraft,
      keyIndicators: [
        bundle.marketOverviewDraft.keyIndicators[0],
        { label: { zh: "发电量", en: "Generation" }, value: "30", unit: "TWh", year: 2026 },
      ],
    });
    expect(result?.keyIndicators.map(({ value }) => value)).toEqual(["20", "30"]);
    expect(result).toMatchObject({
      countryCode: bundle.sourceRegister.countryCode,
      reviewStatus: "draft",
      aiUsable: false,
    });
  });

  test.each([
    ["an oversized nested string", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.overview").evidence[0]!.normalizedValue = "x".repeat(65_537);
    }],
    ["an oversized nested array", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.overview").evidence[0]!.normalizedValue =
        Array.from({ length: 257 }, (_, index) => index);
    }],
  ])("rejects %s through the bounded v2 path without legacy snapshotting", (_name, mutate) => {
    const bundle = v2Ready();
    mutate(bundle);

    expect(assemble(bundle)).toBeNull();
    expect(legacySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    ["a duplicate field path", (bundle: BasicCollectionAuditBundle) => {
      bundle.extractedFacts.facts.push(structuredClone(factFor(bundle, "marketOverview.gdp")));
    }],
    ["a missing static path", (bundle: BasicCollectionAuditBundle) => {
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => fieldPath !== "marketOverview.gdp",
      );
    }],
    ["a non-candidate fact", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.gdp").status = "conflict";
    }],
    ["empty candidate evidence", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.gdp").evidence = [];
    }],
    ["a legacy-only extraction method", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.gdp").extractionMethod = "hermes";
    }],
    ["an unsafe source", (bundle: BasicCollectionAuditBundle) => {
      bundle.sourceRegister.sources[0]!.promptInjectionRisk = "suspected";
    }],
    ["orphan evidence", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.gdp").evidence[0]!.locator = "missing locator";
    }],
    ["inconsistent normalized evidence", (bundle: BasicCollectionAuditBundle) => {
      const fact = factFor(bundle, "marketOverview.gdp");
      fact.evidence.push({
        ...structuredClone(fact.evidence[0]!),
        sourceId: "source-2",
        normalizedValue: 1,
      });
    }],
    ["an incomplete indicator", (bundle: BasicCollectionAuditBundle) => {
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => fieldPath !== "marketOverview.keyIndicators[1].year",
      );
    }],
    ["a gapped indicator", (bundle: BasicCollectionAuditBundle) => {
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => !fieldPath.startsWith("marketOverview.keyIndicators[1]"),
      );
      addIndicator(bundle, 2, { label: { zh: "缺口", en: "Gap" }, value: "1", unit: "GW", year: 2026 });
    }],
    ["zero indicators", (bundle: BasicCollectionAuditBundle) => {
      bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => !fieldPath.startsWith("marketOverview.keyIndicators["),
      );
    }],
    ["mixed country identities", (bundle: BasicCollectionAuditBundle) => {
      (bundle.extractedFacts as unknown as Record<string, unknown>).countryCode = "YY";
    }],
    ["a malformed normalized value", (bundle: BasicCollectionAuditBundle) => {
      factFor(bundle, "marketOverview.gdp").evidence[0]!.normalizedValue = Number.POSITIVE_INFINITY;
    }],
  ])("rejects v2 material with %s", (_name, mutate) => {
    const bundle = v2Ready();
    mutate(bundle);

    expect(assemble(bundle)).toBeNull();
  });
});

describe("assembleBasicMarketOverviewDraft unknown-input boundary", () => {
  test("does not execute a hostile schemaVersion accessor or traverse its envelope", () => {
    const bundle = v2Ready();
    let schemaVersionCalls = 0;
    const sourceRegister = { ...bundle.sourceRegister } as unknown as Record<string, unknown>;
    delete sourceRegister.schemaVersion;
    Object.defineProperty(sourceRegister, "schemaVersion", {
      enumerable: true,
      get() {
        schemaVersionCalls += 1;
        throw new Error("schemaVersion accessor must not run");
      },
    });
    (bundle as unknown as { sourceRegister: unknown }).sourceRegister = sourceRegister;

    expect(assemble(bundle)).toBeNull();
    expect(schemaVersionCalls).toBe(0);
    expect(legacySnapshot).not.toHaveBeenCalled();
  });

  test("rejects accessors, proxies, and cycles without executing accessors", () => {
    const bundle = v2Ready();
    let getterCalls = 0;
    const input = Object.defineProperty({}, "sourceRegister", {
      enumerable: true,
      get() { getterCalls += 1; return bundle.sourceRegister; },
    }) as DraftInput;
    Object.defineProperty(input, "extractedFacts", {
      enumerable: true,
      value: bundle.extractedFacts,
    });

    expect(assembleBasicMarketOverviewDraft(input)).toBeNull();
    expect(getterCalls).toBe(0);

    const proxied = throwingProxy(v2Ready().sourceRegister);
    expect(assembleBasicMarketOverviewDraft({
      sourceRegister: proxied.proxy,
      extractedFacts: v2Ready().extractedFacts,
    })).toBeNull();
    expect(proxied.traps).not.toHaveBeenCalled();

    const cyclic = v2Ready();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    factFor(cyclic, "marketOverview.overview").evidence[0]!.normalizedValue =
      cycle as BasicCollectionJsonValue;
    expect(assemble(cyclic)).toBeNull();
  });
});
