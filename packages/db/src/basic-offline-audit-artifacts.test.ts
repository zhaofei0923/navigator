import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadBasicCollectionAuditBundle } from "./collection/basic-collection-loader.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";
import { readBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { createBasicCollectionAuditArtifacts } from "./collection/basic-offline-audit-artifacts.js";

const temporaryRoots = new Set<string>();
const ARTIFACT_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

afterEach(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  temporaryRoots.clear();
});

describe("Basic offline audit artifacts", () => {
  test("returns exactly the four loader artifact names in stable order", () => {
    const artifacts = createBasicCollectionAuditArtifacts(
      readBasicCollectionAuditFixture("normal"),
    );

    expect(Object.keys(artifacts)).toEqual([...ARTIFACT_NAMES]);
    expect(Object.getOwnPropertyNames(artifacts)).toEqual([...ARTIFACT_NAMES]);
    expect(Object.getOwnPropertySymbols(artifacts)).toEqual([]);
  });

  test.each(["normal", "missing", "conflict", "untrusted"] as const)(
    "creates a loader-compatible snapshot for %s bundles",
    (scenario) => {
      const bundle = readBasicCollectionAuditFixture(scenario);
      const artifacts = createBasicCollectionAuditArtifacts(bundle);
      const repoRoot = createTemporaryRepoRoot();
      const stagingDirectory = join(
        repoRoot,
        "data",
        "staging",
        bundle.countryDirectory,
        bundle.runId,
      );

      mkdirSync(stagingDirectory, { recursive: true });
      for (const name of ARTIFACT_NAMES) {
        writeFileSync(
          join(stagingDirectory, name),
          `${JSON.stringify(artifacts[name], null, 2)}\n`,
          "utf8",
        );
      }

      expect(
        loadBasicCollectionAuditBundle(
          repoRoot,
          bundle.countryDirectory,
          bundle.runId,
        ),
      ).toEqual(bundle);
    },
  );

  test("rejects invalid input with one fixed non-disclosing error", () => {
    const invalid = {
      ...readBasicCollectionAuditFixture("normal"),
      countryDirectory: "secret-country",
      runId: "secret-run",
      unexpectedPayload: "should-not-leak",
    };

    expect(() => createBasicCollectionAuditArtifacts(invalid)).toThrowError(
      new Error("P1-6D artifact validation failed"),
    );
    expect(() => createBasicCollectionAuditArtifacts(invalid)).toThrowError(
      /^P1-6D artifact validation failed$/,
    );
  });

  test("does not write files while creating artifacts", () => {
    const repoRoot = createTemporaryRepoRoot();
    const before = readdirSync(repoRoot);

    createBasicCollectionAuditArtifacts(readBasicCollectionAuditFixture("normal"));

    expect(readdirSync(repoRoot)).toEqual(before);
  });

  test("returns fresh recursively frozen values independent of input and validation data", () => {
    const input = readBasicCollectionAuditFixture("normal");
    const validation = validateBasicCollectionAuditBundle(input);
    if (!validation.valid) {
      throw new Error("normal fixture unexpectedly failed validation");
    }

    const artifacts = createBasicCollectionAuditArtifacts(input);
    expect(artifacts["source-register.json"]).not.toBe(validation.data.sourceRegister);
    expect(artifacts["source-register.json"].sources).not.toBe(
      validation.data.sourceRegister.sources,
    );
    expect(artifacts["extracted-facts.json"].facts[0]?.evidence).not.toBe(
      validation.data.extractedFacts.facts[0]?.evidence,
    );
    expect(Object.isFrozen(artifacts)).toBe(true);
    expectRecursivelyFrozen(artifacts);

    const originalSourceName = validation.data.sourceRegister.sources[0]!.sourceName;
    input.sourceRegister.sources[0]!.sourceName = "changed input";
    validation.data.sourceRegister.sources[0]!.sourceName = "changed validation data";
    expect(artifacts["source-register.json"].sources[0]!.sourceName).toBe(
      originalSourceName,
    );
  });

  test("resists mutation attempts on the map and nested snapshots", () => {
    const artifacts = createBasicCollectionAuditArtifacts(
      readBasicCollectionAuditFixture("normal"),
    );
    const original = JSON.stringify(artifacts);

    expect(Reflect.set(artifacts, "alias", artifacts["source-register.json"])).toBe(false);
    expect(Reflect.deleteProperty(artifacts, "source-register.json")).toBe(false);
    expect(
      Reflect.defineProperty(artifacts, "manifest", {
        value: {},
        enumerable: true,
      }),
    ).toBe(false);
    expect(
      Reflect.set(artifacts["source-register.json"].sources[0]!, "sourceName", "changed"),
    ).toBe(false);
    expect(JSON.stringify(artifacts)).toBe(original);
  });

  test("turns hostile access failures into the same fixed error", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("payload should not escape");
        },
        ownKeys() {
          throw new Error("path should not escape");
        },
      },
    );

    expect(() => createBasicCollectionAuditArtifacts(hostile)).toThrowError(
      "P1-6D artifact validation failed",
    );
    expect(() => createBasicCollectionAuditArtifacts(hostile)).not.toThrowError(
      /payload|path/,
    );
  });
});

function createTemporaryRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "basic-offline-audit-artifacts-"));
  temporaryRoots.add(repoRoot);
  return repoRoot;
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    expectRecursivelyFrozen(child);
  }
}
