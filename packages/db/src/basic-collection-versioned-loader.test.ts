import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
} from "./collection/basic-collection-v2-contracts.js";
import { loadBasicCollectionAuditBundleVersioned } from "./collection/basic-collection-versioned-loader.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("versioned Basic collection audit loader", () => {
  test("loads pure v1 and pure v2 directories", () => {
    const v1 = createBasicCollectionAuditFixture();
    const v1Root = writeBundle(v1);
    expect(loadBasicCollectionAuditBundleVersioned(
      v1Root,
      v1.countryDirectory,
      v1.runId,
    )).toEqual(v1);

    const v2 = createV2Bundle();
    const v2Root = writeBundle(v2);
    expect(loadBasicCollectionAuditBundleVersioned(
      v2Root,
      v2.countryDirectory,
      v2.runId,
    )).toEqual(v2);
  });

  test.each([1, 2, 3, 4, 5, 6])(
    "rejects mixed envelope permutation %i before schema validation",
    (mask) => {
      const legacy = createBasicCollectionAuditFixture();
      const modern = createV2Bundle();
      const mixed = {
        ...legacy,
        sourceRegister: (mask & 1) === 0
          ? legacy.sourceRegister
          : modern.sourceRegister,
        extractedFacts: (mask & 2) === 0
          ? legacy.extractedFacts
          : modern.extractedFacts,
        reviewReport: (mask & 4) === 0
          ? legacy.reviewReport
          : modern.reviewReport,
      };
      const root = writeBundle(mixed);

      expect(() => loadBasicCollectionAuditBundleVersioned(
        root,
        mixed.countryDirectory,
        mixed.runId,
      )).toThrowError(/^Basic collection audit artifact versions must not be mixed$/);
    },
  );

  test("rejects v1 keys under a v2 schema and v2 keys under a v1 schema", () => {
    const v1Keys = createBasicCollectionAuditFixture();
    v1Keys.sourceRegister.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION as never;
    v1Keys.extractedFacts.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION as never;
    v1Keys.reviewReport.schemaVersion = BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION as never;
    const firstRoot = writeBundle(v1Keys);
    expect(() => loadBasicCollectionAuditBundleVersioned(
      firstRoot,
      v1Keys.countryDirectory,
      v1Keys.runId,
    )).toThrowError(/^Basic collection audit bundle is invalid$/);

    const v2Keys = createV2Bundle();
    v2Keys.sourceRegister.schemaVersion = "basic-country-audit/v1" as never;
    v2Keys.extractedFacts.schemaVersion = "basic-country-audit/v1" as never;
    v2Keys.reviewReport.schemaVersion = "basic-country-audit/v1" as never;
    const secondRoot = writeBundle(v2Keys);
    expect(() => loadBasicCollectionAuditBundleVersioned(
      secondRoot,
      v2Keys.countryDirectory,
      v2Keys.runId,
    )).toThrowError(/^Basic collection audit bundle is invalid$/);
  });

  test.each([
    ["missing", (directory: string) => rmSync(join(directory, "source-register.json"))],
    ["malformed", (directory: string) => writeFileSync(join(directory, "source-register.json"), "{", "utf8")],
  ])("redacts paths and filesystem details for a %s artifact", (_name, mutate) => {
    const bundle = createV2Bundle();
    const root = writeBundle(bundle);
    const directory = stagingDirectory(root, bundle);
    mutate(directory);

    const capture = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(capture).toBe("Basic collection audit artifacts could not be read");
    expect(capture).not.toContain(root);
    expect(capture).not.toMatch(/ENOENT|Unexpected token|source-register\.json/);
  });

  test("redacts invalid payload values and URL query data", () => {
    const bundle = createV2Bundle();
    Object.assign(bundle.sourceRegister, {
      token: "secret-token",
      cookie: "session-cookie",
      query: "credential=secret",
    });
    const root = writeBundle(bundle);

    const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(message).toBe("Basic collection audit bundle is invalid");
    expect(message).not.toMatch(/secret|cookie|credential|\/tmp\//);
  });

  test("validates safe path components before reading", () => {
    const root = mkdtempSync(join(tmpdir(), "basic-versioned-loader-safe-"));
    roots.add(root);
    expect(() => loadBasicCollectionAuditBundleVersioned(root, "../country", "run-001"))
      .toThrowError(/^countryDirectory must be a safe slug$/);
    expect(() => loadBasicCollectionAuditBundleVersioned(root, "country", "../run"))
      .toThrowError(/^runId must be a safe run id$/);
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

interface StagingBundle {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly marketOverviewDraft: unknown;
  readonly reviewReport: unknown;
}

function writeBundle(bundle: StagingBundle): string {
  const root = mkdtempSync(join(tmpdir(), "basic-versioned-loader-"));
  roots.add(root);
  const directory = stagingDirectory(root, bundle);
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, "source-register.json"), bundle.sourceRegister);
  writeJson(join(directory, "extracted-facts.json"), bundle.extractedFacts);
  writeJson(join(directory, "market-overview.draft.json"), bundle.marketOverviewDraft);
  writeJson(join(directory, "review-report.json"), bundle.reviewReport);
  return root;
}

function stagingDirectory(root: string, bundle: StagingBundle): string {
  return join(root, "data", "staging", bundle.countryDirectory, bundle.runId);
}

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

function thrownMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected operation to throw");
}
