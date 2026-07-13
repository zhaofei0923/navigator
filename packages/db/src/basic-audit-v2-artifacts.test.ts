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

  test("returns fresh unaliased bytes after caller mutation", () => {
    const artifacts = createBasicCollectionAuditArtifactsV2(createV2Bundle());
    const expected = serializeBasicCollectionAuditArtifactsV2(artifacts);
    const mutated = serializeBasicCollectionAuditArtifactsV2(artifacts);
    mutated["source-register.json"][0] = 0;
    mutated["review-report.json"][1] = 0;

    const later = serializeBasicCollectionAuditArtifactsV2(artifacts);
    for (const name of NAMES) {
      expect(later[name]).toEqual(expected[name]);
      expect(later[name]).not.toBe(expected[name]);
      expect(later[name]).not.toBe(mutated[name]);
    }
  });

  test("rejects hand-built, spread, and cloned artifact maps", () => {
    const artifacts = createBasicCollectionAuditArtifactsV2(createV2Bundle());
    const candidates: unknown[] = [
      { ...artifacts },
      structuredClone(artifacts),
      Object.fromEntries(NAMES.map((name) => [name, artifacts[name]])),
    ];

    for (const candidate of candidates) {
      expect(() => serializeBasicCollectionAuditArtifactsV2(
        candidate as Parameters<typeof serializeBasicCollectionAuditArtifactsV2>[0],
      )).toThrowError(/^Basic audit v2 artifact serialization failed$/);
    }
  });

  test("rejects hostile unbranded maps without executing serialization hooks", () => {
    const artifacts = createBasicCollectionAuditArtifactsV2(createV2Bundle());
    const probe = { executions: 0 };
    const accessorSource = { ...artifacts["source-register.json"] } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorSource, "runId", {
      enumerable: true,
      get() {
        probe.executions += 1;
        throw new Error("SECRET-token-cookie-url");
      },
    });
    const toJsonSource = {
      ...artifacts["source-register.json"],
      toJSON() {
        probe.executions += 1;
        throw new Error("SECRET-token-cookie-url");
      },
    };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const maps: unknown[] = [
      artifactMap(artifacts, undefined),
      artifactMap(artifacts, accessorSource),
      artifactMap(artifacts, toJsonSource),
      artifactMap(artifacts, cycle),
      artifactMap(artifacts, { oversized: "x".repeat(2 * 1024 * 1024 + 1) }),
      new Proxy({ ...artifacts }, {
        ownKeys(target) {
          probe.executions += 1;
          return Reflect.ownKeys(target);
        },
      }),
    ];

    for (const value of maps) {
      expect(() => serializeBasicCollectionAuditArtifactsV2(
        value as Parameters<typeof serializeBasicCollectionAuditArtifactsV2>[0],
      )).toThrowError(/^Basic audit v2 artifact serialization failed$/);
    }
    expect(probe.executions).toBe(0);
  });

  test("produces byte-identical artifacts for canonical JSON key order", () => {
    const firstBundle = createV2Bundle();
    const secondBundle = createV2Bundle();
    factAt(firstBundle, "country.summary").evidence[0]!.rawValue = {
      zebra: 1,
      alpha: { second: 2, first: 1 },
    };
    factAt(secondBundle, "country.summary").evidence[0]!.rawValue = {
      alpha: { first: 1, second: 2 },
      zebra: 1,
    };

    const first = serializeBasicCollectionAuditArtifactsV2(
      createBasicCollectionAuditArtifactsV2(firstBundle),
    );
    const second = serializeBasicCollectionAuditArtifactsV2(
      createBasicCollectionAuditArtifactsV2(secondBundle),
    );
    for (const name of NAMES) expect(first[name]).toEqual(second[name]);
  });

  test("rejects a validated bundle whose canonical artifact exceeds the byte limit", () => {
    const bundle = createV2Bundle();
    const rawValue = "x".repeat(65_536);
    for (const fact of bundle.extractedFacts.facts) {
      fact.evidence[0]!.rawValue = rawValue;
      fact.evidence.push({
        ...structuredClone(fact.evidence[0]!),
        sourceId: "source-2",
      });
    }

    expect(() => createBasicCollectionAuditArtifactsV2(bundle)).toThrowError(
      /^Basic audit v2 artifact validation failed$/,
    );
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
  bundle.extractedFacts.facts.sort((left, right) =>
    compareText(left.fieldPath, right.fieldPath));
  return bundle;
}

function artifactMap(
  artifacts: ReturnType<typeof createBasicCollectionAuditArtifactsV2>,
  sourceRegister: unknown,
): unknown {
  return {
    "source-register.json": sourceRegister,
    "extracted-facts.json": artifacts["extracted-facts.json"],
    "market-overview.draft.json": artifacts["market-overview.draft.json"],
    "review-report.json": artifacts["review-report.json"],
  };
}

function factAt(bundle: ReturnType<typeof createV2Bundle>, fieldPath: string) {
  const fact = bundle.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  if (fact === undefined) throw new Error("fixture fact is missing");
  return fact;
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
