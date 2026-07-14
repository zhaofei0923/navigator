import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const fsProbe = vi.hoisted(() => ({
  legacyReadFileCalls: 0,
  onRead: null as (() => void) | null,
  readHookCalls: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync(...args: Parameters<typeof actual.readFileSync>) {
      fsProbe.legacyReadFileCalls += 1;
      return Reflect.apply(actual.readFileSync, undefined, args) as ReturnType<
        typeof actual.readFileSync
      >;
    },
    readSync(...args: Parameters<typeof actual.readSync>) {
      const result = Reflect.apply(actual.readSync, undefined, args) as number;
      fsProbe.readHookCalls += 1;
      const hook = fsProbe.onRead;
      fsProbe.onRead = null;
      hook?.();
      return result;
    },
  };
});

import {
  createBasicCollectionAuditFixture,
  createBasicCollectionAuditV2Fixture,
} from "./basic-collection-test-fixture.js";
import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import type { BasicCollectionAuditArtifactName } from "./collection/basic-offline-audit-artifacts.js";
import { BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES } from "./collection/basic-publication-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
} from "./collection/basic-collection-v2-contracts.js";
import {
  loadBasicCollectionAuditBundleVersioned,
  validateBasicCollectionAuditArtifactValuesVersioned,
} from "./collection/basic-collection-versioned-loader.js";

const roots = new Set<string>();

afterEach(() => {
  fsProbe.legacyReadFileCalls = 0;
  fsProbe.onRead = null;
  fsProbe.readHookCalls = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("versioned Basic collection audit loader", () => {
  test("dispatches pure v1 and v2 artifact values without filesystem reads", () => {
    const v1 = createBasicCollectionAuditFixture();
    expect(validateBasicCollectionAuditArtifactValuesVersioned(
      v1.countryDirectory,
      v1.runId,
      artifactValues(v1),
    )).toEqual(v1);

    const v2 = createV2Bundle();
    expect(validateBasicCollectionAuditArtifactValuesVersioned(
      v2.countryDirectory,
      v2.runId,
      artifactValues(v2),
    )).toEqual(v2);
    expect(fsProbe.readHookCalls).toBe(0);
    expect(fsProbe.legacyReadFileCalls).toBe(0);
  });

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

  test.each(["repo root", "staging ancestor", "artifact target"] as const)(
    "rejects a symlinked %s without exposing filesystem details",
    (kind) => {
      const bundle = createV2Bundle();
      const root = writeBundle(bundle);
      let loadRoot = root;

      if (kind === "repo root") {
        const container = mkdtempSync(join(tmpdir(), "basic-versioned-link-"));
        roots.add(container);
        loadRoot = join(container, "repo-link");
        symlinkSync(root, loadRoot, "dir");
      } else if (kind === "staging ancestor") {
        const directory = stagingDirectory(root, bundle);
        const displaced = `${directory}-real`;
        renameSync(directory, displaced);
        symlinkSync(displaced, directory, "dir");
      } else {
        const pathname = join(
          stagingDirectory(root, bundle),
          "source-register.json",
        );
        const displaced = `${pathname}.real`;
        renameSync(pathname, displaced);
        symlinkSync(displaced, pathname, "file");
      }

      const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
        loadRoot,
        bundle.countryDirectory,
        bundle.runId,
      ));
      expect(message).toBe("Basic collection audit artifacts could not be read");
      expect(message).not.toMatch(/symlink|ELOOP|source-register|basic-versioned/);
    },
  );

  test("rejects an oversized artifact before attempting to read its bytes", () => {
    const bundle = createV2Bundle();
    const root = writeBundle(bundle);
    writeFileSync(
      join(stagingDirectory(root, bundle), "source-register.json"),
      Buffer.alloc(BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES + 1, 0x20),
    );

    const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(message).toBe("Basic collection audit artifacts could not be read");
    expect(fsProbe.legacyReadFileCalls).toBe(0);
    expect(fsProbe.readHookCalls).toBe(0);
  });

  test("rejects special-file artifact targets before opening them", () => {
    const bundle = createV2Bundle();
    const root = writeBundle(bundle);
    const pathname = join(
      stagingDirectory(root, bundle),
      "source-register.json",
    );
    rmSync(pathname);
    mkdirSync(pathname);

    const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(message).toBe("Basic collection audit artifacts could not be read");
    expect(fsProbe.legacyReadFileCalls).toBe(0);
    expect(fsProbe.readHookCalls).toBe(0);
  });

  test("rejects an extra staging entry outside the four-file allowlist", () => {
    const bundle = createV2Bundle();
    const root = writeBundle(bundle);
    writeFileSync(
      join(stagingDirectory(root, bundle), "unexpected.json"),
      "{}",
      "utf8",
    );

    const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(message).toBe("Basic collection audit artifacts could not be read");
    expect(message).not.toMatch(/unexpected|basic-versioned/);
  });

  test("rejects an artifact pathname replaced while its descriptor is read", () => {
    const bundle = createV2Bundle();
    const root = writeBundle(bundle);
    const pathname = join(
      stagingDirectory(root, bundle),
      "source-register.json",
    );
    const replacement = join(root, "replacement.json");
    writeJson(replacement, bundle.sourceRegister);
    fsProbe.onRead = () => renameSync(replacement, pathname);

    const message = thrownMessage(() => loadBasicCollectionAuditBundleVersioned(
      root,
      bundle.countryDirectory,
      bundle.runId,
    ));
    expect(fsProbe.readHookCalls).toBeGreaterThan(0);
    expect(message).toBe("Basic collection audit artifacts could not be read");
    expect(message).not.toMatch(/replacement|source-register|basic-versioned/);
  });
});

function createV2Bundle() {
  return structuredClone(createBasicCollectionAuditV2Fixture()) as DeepMutable<
    BasicCollectionAuditBundleV2
  >;
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

interface StagingBundle {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly marketOverviewDraft: unknown;
  readonly reviewReport: unknown;
}

function artifactValues(
  bundle: StagingBundle,
): Readonly<Record<BasicCollectionAuditArtifactName, unknown>> {
  return {
    "source-register.json": bundle.sourceRegister,
    "extracted-facts.json": bundle.extractedFacts,
    "market-overview.draft.json": bundle.marketOverviewDraft,
    "review-report.json": bundle.reviewReport,
  };
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
