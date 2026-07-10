import { describe, expect, test } from "vitest";

import type { BasicCollectionJsonValue } from "./collection/basic-collection-contracts.js";
import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

type AuditBundle = ReturnType<typeof createBasicCollectionAuditFixture>;
type UnknownRecord = Record<string, unknown>;

describe("Basic collection audit parser boundaries", () => {
  test.each([
    {
      name: "a symbol own key",
      mutate(bundle: AuditBundle) {
        Object.defineProperty(bundle.sourceRegister.sources[0]!, Symbol("extra"), {
          enumerable: true,
          value: true,
        });
      },
      error: "sourceRegister.sources[0]",
    },
    {
      name: "a sparse evidence array",
      mutate(bundle: AuditBundle) {
        bundle.extractedFacts.facts[0]!.evidence = new Array(1) as never;
      },
      error: "extractedFacts.facts[0].evidence must be a standard JSON array",
    },
    {
      name: "a non-finite JSON value",
      mutate(bundle: AuditBundle) {
        bundle.extractedFacts.facts[0]!.evidence[0]!.rawValue = Number.NaN;
      },
      error: "extractedFacts.facts[0].evidence[0].rawValue",
    },
    {
      name: "a recursive JSON value with a custom prototype",
      mutate(bundle: AuditBundle) {
        const value: UnknownRecord = {};
        value.child = Object.assign(Object.create({ inherited: "not JSON" }), {
          value: "nested",
        });
        bundle.extractedFacts.facts[0]!.evidence[0]!.rawValue = value as never;
      },
      error: "extractedFacts.facts[0].evidence[0].rawValue.child",
    },
    ...(["undefined", "function", "symbol"] as const).map((kind) => ({
      name: `a ${kind} JSON value`,
      mutate(bundle: AuditBundle) {
        const values: Record<(typeof kind), unknown> = {
          undefined,
          function: () => undefined,
          symbol: Symbol("json"),
        };
        bundle.extractedFacts.facts[0]!.evidence[0]!.normalizedValue =
          values[kind] as never;
      },
      error: "extractedFacts.facts[0].evidence[0].normalizedValue",
    })),
  ])("rejects $name", ({ mutate, error }) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    expectInvalid(bundle, error);
  });

  test.each([
    ["2026-02-29T00:00:00Z", "invalid calendar date"],
    ["2026-07-09T00:00:00z", "lowercase timezone marker"],
    ["2026-07-09T00:00Z", "missing seconds"],
    ["2026-07-09T00:00:00+08:00", "timezone offset"],
    ["2026-07-09T00:00:60Z", "leap second"],
    ["2026-07-09T00:00:00.1234Z", "too many fractional digits"],
  ] as const)("rejects %s as a strict UTC timestamp (%s)", (timestamp, _reason) => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.sourceRegister.sources[0]!.retrievedAt = timestamp;

    expectInvalid(bundle, "sourceRegister.sources[0].retrievedAt");
  });

  test.each([
    ["0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF", "uppercase SHA"],
    ["0123", "short SHA"],
  ] as const)("rejects %s (%s)", (contentSha256, _reason) => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.sourceRegister.sources[0]!.contentSha256 = contentSha256;

    expectInvalid(bundle, "sourceRegister.sources[0].contentSha256");
  });

  test.each([
    ["http://example.com/source", "sourceRegister.sources[0].sourceUrl", true],
    ["ftp://example.com/source", "sourceRegister.sources[0].sourceUrl", false],
    ["mailto:source@example.com", "marketOverviewDraft.sourceUrl", false],
    ["not a URL", "marketOverviewDraft.sourceUrl", false],
  ] as const)("accepts only HTTP(S) URLs: %s", (sourceUrl, error, valid) => {
    const bundle = createBasicCollectionAuditFixture();
    if (error.startsWith("sourceRegister")) {
      bundle.sourceRegister.sources[0]!.sourceUrl = sourceUrl;
    } else {
      bundle.marketOverviewDraft.sourceUrl = sourceUrl;
    }

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result.valid).toBe(valid);
    if (!valid) {
      expectInvalid(bundle, error);
    }
  });

  test.each([
    ["country.code", true],
    ["marketOverview.keyIndicators[0].label", true],
    ["marketOverview.keyIndicators[12].year", true],
    ["marketOverview.keyIndicators[01].value", false],
    ["marketOverview.keyIndicators[-1].unit", false],
    ["market-overview.population", false],
    ["marketOverview.reviewStatus", false],
    ["workflow.status", false],
  ] as const)("%s is %s in the fieldPath allowlist", (fieldPath, valid) => {
    const bundle = createBasicCollectionAuditFixture();
    const existingFact = bundle.extractedFacts.facts.find(
      (fact) => fact.fieldPath === fieldPath,
    );
    const testedFact = existingFact ?? {
      ...bundle.extractedFacts.facts[0]!,
      factId: "fact-allowlist",
      fieldPath,
    };
    testedFact.status = "untrusted";
    testedFact.evidence = [{ ...bundle.extractedFacts.facts[0]!.evidence[0]! }];
    if (existingFact === undefined) {
      bundle.extractedFacts.facts.push(testedFact);
    }
    bundle.reviewReport.status = "blocked";
    bundle.reviewReport.publicationRecommendation = "do-not-publish";

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result.valid).toBe(valid);
    if (!valid) {
      expectInvalid(bundle, "extractedFacts.facts[24].fieldPath");
    }
  });

  test.each([
    ["candidate", 0, ["source-1"], false],
    ["missing", 1, ["source-1"], false],
    ["conflict", 1, ["source-1"], false],
    ["conflict", 2, ["source-1", "source-1"], false],
    ["untrusted", 0, ["source-1"], false],
    ["candidate", 1, ["source-1"], true],
    ["missing", 0, [], true],
    ["conflict", 2, ["source-1", "source-2"], true],
    ["untrusted", 1, ["source-1"], true],
  ] as const)(
    "enforces %s evidence cardinality for %i item(s) from %j",
    (status, count, sourceIds, valid) => {
      const bundle = createBasicCollectionAuditFixture();
      const fact = bundle.extractedFacts.facts[0]!;
      fact.status = status;
      fact.evidence = Array.from({ length: count }, (_, index) => ({
        ...fact.evidence[0]!,
        sourceId: sourceIds[index]!,
      }));
      if (valid && status !== "candidate") {
        bundle.reviewReport.status = "blocked";
        bundle.reviewReport.publicationRecommendation = "do-not-publish";
      }

      const result = validateBasicCollectionAuditBundle(bundle);
      expect(result.valid).toBe(valid);
      if (!valid) {
        expectInvalid(bundle, "extractedFacts.facts[0].evidence");
      }
    },
  );

  test.each([
    ["reviewStatus", "published", "draft", "marketOverviewDraft.reviewStatus"],
    ["aiUsable", true, "false", "marketOverviewDraft.aiUsable"],
  ] as const)("requires market overview %s to remain %s", (key, value, _expected, error) => {
    const bundle = createBasicCollectionAuditFixture();
    const draft = bundle.marketOverviewDraft as unknown as UnknownRecord;
    draft[key] = value;

    expectInvalid(bundle, error);
  });

  test.each([
    {
      name: "inherited localized keys",
      mutate(bundle: AuditBundle) {
        bundle.marketOverviewDraft.overview = Object.create({
          zh: "ZH",
          en: "EN",
        }) as never;
      },
      valid: false,
      error: "marketOverviewDraft.overview",
    },
    {
      name: "extra localized key",
      mutate(bundle: AuditBundle) {
        Object.assign(bundle.marketOverviewDraft.overview, { extra: "no" });
      },
      valid: false,
      error: "marketOverviewDraft.overview",
    },
    {
      name: "a missing localized key",
      mutate(bundle: AuditBundle) {
        bundle.marketOverviewDraft.overview = { zh: "ZH" } as never;
      },
      valid: false,
      error: "marketOverviewDraft.overview",
    },
    {
      name: "a single-side fallback",
      mutate(bundle: AuditBundle) {
        bundle.marketOverviewDraft.overview.en = " ";
        syncCandidate(
          bundle,
          "marketOverview.overview",
          { ...bundle.marketOverviewDraft.overview },
        );
      },
      valid: true,
      error: "",
    },
    {
      name: "both localized sides blank",
      mutate(bundle: AuditBundle) {
        bundle.marketOverviewDraft.overview.zh = " ";
        bundle.marketOverviewDraft.overview.en = "\t";
      },
      valid: false,
      error: "marketOverviewDraft.overview",
    },
  ])("handles $name", ({ mutate, valid, error }) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result.valid).toBe(valid);
    if (!valid) {
      expectInvalid(bundle, error);
    }
  });

  test.each([
    ["sourceUrl null is absent", "Official source", false],
    ["sourceUrl null is documented", "Official source; sourceUrl null: not published", true],
  ] as const)("%s", (_, source, valid) => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.marketOverviewDraft.sourceUrl = null;
    bundle.marketOverviewDraft.source = source;
    syncCandidate(bundle, "marketOverview.sourceUrl", null);
    syncCandidate(bundle, "marketOverview.source", source);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result.valid).toBe(valid);
    if (!valid) {
      expectInvalid(bundle, "marketOverviewDraft.source");
    }
  });

  test("reconstructs deep JSON objects and arrays without retaining input references", () => {
    const bundle = createBasicCollectionAuditFixture();
    const rawValue = {
      nested: [{ leaf: ["value", { enabled: true }] }],
    };
    const normalizedValue = [[{ score: 1 }], [{ score: 2 }]];
    const inputEvidence = factFor(bundle, "country.code").evidence[0]!;
    inputEvidence.rawValue = rawValue;
    inputEvidence.normalizedValue = normalizedValue;

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }

    const evidence = factFor(result.data, "country.code").evidence[0]!;
    expect(evidence.rawValue).toEqual(rawValue);
    expect(evidence.normalizedValue).toEqual(normalizedValue);
    expect(evidence.rawValue).not.toBe(rawValue);
    const parsedRawValue = evidence.rawValue as {
      nested: Array<{ leaf: unknown[] }>;
    };
    expect(parsedRawValue.nested).not.toBe(rawValue.nested);
    expect(parsedRawValue.nested[0]).not.toBe(rawValue.nested[0]);
    expect(parsedRawValue.nested[0]!.leaf).not.toBe(rawValue.nested[0]!.leaf);
    expect(parsedRawValue.nested[0]!.leaf[1]).not.toBe(rawValue.nested[0]!.leaf[1]);
    expect(evidence.normalizedValue).not.toBe(normalizedValue);
    expect((evidence.normalizedValue as unknown[])[0]).not.toBe(normalizedValue[0]);
    expect(((evidence.normalizedValue as unknown[])[0] as unknown[])[0]).not.toBe(
      normalizedValue[0]![0],
    );
  });
});

function expectInvalid(value: unknown, expectedError: string): void {
  expect(() => validateBasicCollectionAuditBundle(value)).not.toThrow();
  const result = validateBasicCollectionAuditBundle(value);
  expect(result).toMatchObject({ valid: false, data: null });
  expect(result.errors).toEqual(
    expect.arrayContaining([expect.stringContaining(expectedError)]),
  );
}

function factFor(bundle: AuditBundle, fieldPath: string) {
  const fact = bundle.extractedFacts.facts.find(
    (candidate) => candidate.fieldPath === fieldPath,
  );
  if (fact === undefined) throw new Error(`fixture fact ${fieldPath} is required`);
  return fact;
}

function syncCandidate(
  bundle: AuditBundle,
  fieldPath: string,
  normalizedValue: BasicCollectionJsonValue,
): void {
  for (const evidence of factFor(bundle, fieldPath).evidence) {
    evidence.normalizedValue = normalizedValue;
  }
}
