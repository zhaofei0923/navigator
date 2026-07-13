import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
} from "./collection/basic-collection-v2-contracts.js";
import {
  createBasicCollectionAuditArtifactsV2,
  serializeBasicCollectionAuditArtifactsV2,
} from "./collection/basic-audit-v2-artifacts.js";

const NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

describe("Basic audit v2 artifacts", () => {
  test("creates exactly four recursively frozen detached artifacts in fixed order", () => {
    const bundle = createV2Bundle();

    const artifacts = createBasicCollectionAuditArtifactsV2(bundle);

    expect(Object.keys(artifacts)).toEqual(NAMES);
    expect(artifacts["source-register.json"]).toEqual(bundle.sourceRegister);
    expect(artifacts["extracted-facts.json"]).toEqual(bundle.extractedFacts);
    expect(artifacts["market-overview.draft.json"]).toEqual(bundle.marketOverviewDraft);
    expect(artifacts["review-report.json"]).toEqual(bundle.reviewReport);
    expect(artifacts["source-register.json"]).not.toBe(bundle.sourceRegister);
    expectRecursivelyFrozen(artifacts);
  });

  test("serializes each artifact as compact UTF-8 JSON with one newline", () => {
    const artifacts = createBasicCollectionAuditArtifactsV2(createV2Bundle());

    const serialized = serializeBasicCollectionAuditArtifactsV2(artifacts);

    expect(Object.keys(serialized)).toEqual(NAMES);
    expect(Object.isFrozen(serialized)).toBe(true);
    for (const name of NAMES) {
      expect(serialized[name]).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(serialized[name])).toBe(
        `${JSON.stringify(artifacts[name])}\n`,
      );
    }
  });

  test("is deterministic across calls and does not retain input references", () => {
    const bundle = createV2Bundle();
    const first = serializeBasicCollectionAuditArtifactsV2(
      createBasicCollectionAuditArtifactsV2(bundle),
    );
    const second = serializeBasicCollectionAuditArtifactsV2(
      createBasicCollectionAuditArtifactsV2(bundle),
    );

    for (const name of NAMES) expect(first[name]).toEqual(second[name]);
    bundle.sourceRegister.sources[0]!.sourceName = "mutated";
    expect(new TextDecoder().decode(first["source-register.json"])).not.toContain("mutated");
  });

  test("rejects invalid values and hostile inputs with fixed errors", () => {
    const invalid = Object.assign(createV2Bundle(), {
      token: "secret-token",
      sourceUrl: "https://example.com/?cookie=secret",
    });
    expect(() => createBasicCollectionAuditArtifactsV2(invalid)).toThrowError(
      /^Basic audit v2 artifact validation failed$/,
    );

    const hostile = new Proxy({}, {
      ownKeys() { throw new Error("/absolute/path secret-token"); },
    });
    expect(() => createBasicCollectionAuditArtifactsV2(hostile)).toThrowError(
      /^Basic audit v2 artifact validation failed$/,
    );
  });
});

function createV2Bundle() {
  const bundle = structuredClone(createBasicCollectionAuditFixture()) as unknown as Omit<
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
  return bundle;
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}
