import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicCollectionAuditBundleV2,
} from "./collection/basic-collection-v2-contracts.js";
import { parseBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-parser.js";
import {
  snapshotBasicBoundedJsonValue,
  type BasicBoundedArrayLimit,
  type BasicBoundedJsonSnapshot,
} from "./collection/basic-bounded-json.js";

type BudgetedSnapshot = (
  value: unknown,
  arrayLimit: BasicBoundedArrayLimit | undefined,
  budgets: Readonly<{
    maximumObjectProperties?: number;
    maximumTotalNodes?: number;
  }>,
) => BasicBoundedJsonSnapshot;

const snapshotWithBudgets = snapshotBasicBoundedJsonValue as BudgetedSnapshot;

describe("Basic collection audit v2 parser", () => {
  test("reconstructs an exact detached v2 bundle", () => {
    const bundle = createV2Bundle();

    const parsed = parseBasicCollectionAuditBundleV2(bundle);

    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual(bundle);
    expect(parsed.data).not.toBe(bundle);
    expect(parsed.summary).toEqual({
      countryCode: "XZ",
      runId: "run-001",
      sourceCount: 2,
      factCount: 24,
    });
  });

  test.each([
    ["catalogVersion", "", "sourceRegister.catalogVersion"],
    ["catalogVersion", "bad version", "sourceRegister.catalogVersion"],
    ["catalogSha256", "ABC", "sourceRegister.catalogSha256"],
  ] as const)("rejects malformed %s", (key, value, error) => {
    const bundle = createV2Bundle();
    bundle.sourceRegister[key] = value;

    expectInvalid(bundle, error);
  });

  test.each([
    ["HTTP", "http://example.com/source-1"],
    ["credentials", "https://user:secret@example.com/source-1"],
    ["fragment", "https://example.com/source-1#reviewed"],
    ["surrounding whitespace", " https://example.com/source-1"],
  ] as const)("rejects a v2 source URL with %s", (_name, sourceUrl) => {
    const bundle = createV2Bundle();
    bundle.sourceRegister.sources[0]!.sourceUrl = sourceUrl;

    expectInvalid(bundle, "sourceRegister.sources[0].sourceUrl");
  });

  test("allows a query string in a v2 source URL", () => {
    const bundle = createV2Bundle();
    bundle.sourceRegister.sources[0]!.sourceUrl =
      "https://example.com/source-1?year=2026&format=json";

    expect(parseBasicCollectionAuditBundleV2(bundle).data).not.toBeNull();
  });

  test("rejects legacy schemas and legacy-only extraction methods", () => {
    const legacy = createV2Bundle();
    legacy.extractedFacts.schemaVersion = "basic-country-audit/v1" as never;
    expectInvalid(legacy, "extractedFacts.schemaVersion");

    const hermes = createV2Bundle();
    hermes.extractedFacts.facts[0]!.extractionMethod = "hermes" as never;
    expectInvalid(hermes, "extractedFacts.facts[0].extractionMethod");
  });

  test.each([
    ["sourceRegister", "catalogVersion"],
    ["sourceRegister", "catalogSha256"],
  ] as const)("rejects a v1-shaped %s missing %s", (section, key) => {
    const bundle = createV2Bundle() as unknown as Record<string, Record<string, unknown>>;
    delete bundle[section]![key];

    expectInvalid(bundle, section);
  });

  test.each([
    ["extra source key", (bundle: MutableV2Bundle) => {
      Object.assign(bundle.sourceRegister.sources[0]!, { extra: true });
    }],
    ["sparse evidence", (bundle: MutableV2Bundle) => {
      bundle.extractedFacts.facts[0]!.evidence = new Array(1) as never;
    }],
    ["cyclic evidence", (bundle: MutableV2Bundle) => {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      bundle.extractedFacts.facts[0]!.evidence[0]!.rawValue = cycle as never;
    }],
    ["non-finite evidence", (bundle: MutableV2Bundle) => {
      bundle.extractedFacts.facts[0]!.evidence[0]!.normalizedValue = Number.NaN;
    }],
    ["accessor", (bundle: MutableV2Bundle) => {
      Object.defineProperty(bundle.sourceRegister, "runId", {
        enumerable: true,
        get: () => "run-001",
      });
    }],
    ["symbol key", (bundle: MutableV2Bundle) => {
      Object.defineProperty(bundle.reviewReport, Symbol("extra"), {
        enumerable: true,
        value: true,
      });
    }],
  ])("rejects hostile or non-JSON structure: %s", (_name, mutate) => {
    const bundle = createV2Bundle();
    mutate(bundle);
    expectInvalid(bundle, "must");
  });

  test("aggregates identity and draft errors without throwing", () => {
    const bundle = createV2Bundle();
    bundle.extractedFacts.runId = "run-002";
    bundle.marketOverviewDraft.countryCode = "YY";
    bundle.marketOverviewDraft.sourceUrl = "ftp://example.com";

    const parsed = parseBasicCollectionAuditBundleV2(bundle);

    expect(parsed.data).toBeNull();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "extractedFacts.runId must match runId",
      "marketOverviewDraft.countryCode must match sourceRegister.countryCode",
      "marketOverviewDraft.sourceUrl must be an HTTP(S) URL",
    ]));
  });

  test("exposes run and country identity only after successful validation", () => {
    const run = createV2Bundle();
    run.runId = "SECRET-token-cookie-url";
    const runResult = parseBasicCollectionAuditBundleV2(run);
    expect(runResult.data).toBeNull();
    expect(runResult.summary.runId).toBe("");
    expect(runResult.summary.countryCode).toBe("");

    const country = createV2Bundle();
    country.sourceRegister.countryCode = "https://secret.example/?token=COOKIE";
    const countryResult = parseBasicCollectionAuditBundleV2(country);
    expect(countryResult.data).toBeNull();
    expect(countryResult.summary.runId).toBe("");
    expect(countryResult.summary.countryCode).toBe("");
  });

  test.each(["sourceId", "factId"] as const)(
    "reports duplicate %s values by index without echoing the raw ID",
    (kind) => {
      const bundle = createV2Bundle();
      const secret = "SECRET-token-cookie-url-duplicate";
      if (kind === "sourceId") {
        bundle.sourceRegister.sources[0]!.sourceId = secret;
        bundle.sourceRegister.sources[1]!.sourceId = secret;
      } else {
        bundle.extractedFacts.facts[0]!.factId = secret;
        bundle.extractedFacts.facts[1]!.factId = secret;
      }

      const result = parseBasicCollectionAuditBundleV2(bundle);
      expect(result.data).toBeNull();
      expect(result.errors.join("\n")).toMatch(/\[1\].*duplicates.*\[0\]/);
      expect(result.errors.join("\n")).not.toContain(secret);
    },
  );

  test("redacts URL, token, cookie, and raw-value text from parser failures", () => {
    const bundle = createV2Bundle();
    const secret = "SECRET-token-cookie-raw-value";
    bundle.sourceRegister.sources[0]!.sourceUrl =
      `https://example.com/?token=${secret}&cookie=${secret}`;
    Object.defineProperty(bundle.extractedFacts.facts[0]!.evidence[0]!, "rawValue", {
      enumerable: true,
      get() {
        throw new Error(`https://example.com/?token=${secret}`);
      },
    });

    const result = parseBasicCollectionAuditBundleV2(bundle);
    expect(result.data).toBeNull();
    expect(result.errors).toEqual(["bundle must be a bounded JSON value"]);
    expect(result.errors.join("\n")).not.toContain(secret);
    expect(result.errors.join("\n")).not.toContain("https://example.com/");
  });

  test("applies exact object-property and total-node budgets", () => {
    const exactObject = { first: null, second: null };
    expect(snapshotWithBudgets(exactObject, undefined, {
      maximumObjectProperties: 2,
      maximumTotalNodes: 3,
    }).valid).toBe(true);
    expect(snapshotWithBudgets({ ...exactObject, third: null }, undefined, {
      maximumObjectProperties: 2,
      maximumTotalNodes: 4,
    }).valid).toBe(false);

    const fourNodes = { values: [null, null] };
    expect(snapshotWithBudgets(fourNodes, undefined, {
      maximumObjectProperties: 2,
      maximumTotalNodes: 4,
    }).valid).toBe(true);
    expect(snapshotWithBudgets(fourNodes, undefined, {
      maximumObjectProperties: 2,
      maximumTotalNodes: 3,
    }).valid).toBe(false);
  });

  test("preserves default helper behavior while v2 rejects over-wide JSON objects", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`key-${index}`, null]),
    );
    expect(snapshotBasicBoundedJsonValue(wide).valid).toBe(true);

    const bundle = createV2Bundle();
    bundle.extractedFacts.facts[0]!.evidence[0]!.rawValue = wide;
    expectInvalid(bundle, "bounded JSON value");
  });
});

type MutableV2Bundle = Omit<
  BasicCollectionAuditBundle,
  "sourceRegister" | "extractedFacts" | "reviewReport"
> & {
  sourceRegister: Omit<BasicCollectionAuditBundle["sourceRegister"], "schemaVersion"> & {
    schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
    catalogVersion: string;
    catalogSha256: string;
  };
  extractedFacts: Omit<BasicCollectionAuditBundle["extractedFacts"], "schemaVersion"> & {
    schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  };
  reviewReport: Omit<BasicCollectionAuditBundle["reviewReport"], "schemaVersion"> & {
    schemaVersion: typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  };
};

function createV2Bundle(): MutableV2Bundle {
  const bundle = structuredClone(createBasicCollectionAuditFixture()) as unknown as MutableV2Bundle;
  bundle.sourceRegister.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  bundle.sourceRegister.catalogVersion = "catalog-v1";
  bundle.sourceRegister.catalogSha256 =
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  bundle.extractedFacts.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  bundle.reviewReport.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;
  for (const fact of bundle.extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  bundle.extractedFacts.facts.sort((left, right) =>
    compareText(left.fieldPath, right.fieldPath));
  return bundle;
}

function expectInvalid(value: unknown, expectedError: string): void {
  expect(() => parseBasicCollectionAuditBundleV2(value)).not.toThrow();
  const result = parseBasicCollectionAuditBundleV2(value);
  expect(result.data).toBeNull();
  expect(result.errors).toEqual(
    expect.arrayContaining([expect.stringContaining(expectedError)]),
  );
}

void (null as BasicCollectionAuditBundleV2 | null);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
