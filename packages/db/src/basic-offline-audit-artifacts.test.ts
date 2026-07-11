import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadBasicCollectionAuditBundle } from "./collection/basic-collection-loader.js";
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

  test("returns fresh recursively frozen values independent across calls and from input", () => {
    const input = readBasicCollectionAuditFixture("normal");
    const first = createBasicCollectionAuditArtifacts(input);
    const second = createBasicCollectionAuditArtifacts(input);

    expect(first).not.toBe(second);
    expect(first["source-register.json"]).not.toBe(second["source-register.json"]);
    expect(first["source-register.json"].sources).not.toBe(
      second["source-register.json"].sources,
    );
    expect(first["source-register.json"].sources[0]).not.toBe(
      second["source-register.json"].sources[0],
    );
    expect(first["source-register.json"]).not.toBe(input.sourceRegister);
    expect(first["source-register.json"].sources).not.toBe(
      input.sourceRegister.sources,
    );
    expect(first["source-register.json"].sources[0]).not.toBe(
      input.sourceRegister.sources[0],
    );
    expect(Object.isFrozen(first)).toBe(true);
    expectRecursivelyFrozen(first);
    expectRecursivelyFrozen(second);

    const originalSourceName = input.sourceRegister.sources[0]!.sourceName;
    input.sourceRegister.sources[0]!.sourceName = "changed input";
    expect(first["source-register.json"].sources[0]!.sourceName).toBe(
      originalSourceName,
    );
    expect(second["source-register.json"].sources[0]!.sourceName).toBe(
      originalSourceName,
    );
  });

  test("resists mutation attempts on the map and nested snapshots", () => {
    const artifacts = createBasicCollectionAuditArtifacts(
      readBasicCollectionAuditFixture("normal"),
    );
    const nested = artifacts["source-register.json"].sources[0]!;
    const original = JSON.stringify(artifacts);

    expect(Reflect.set(artifacts, "alias", artifacts["source-register.json"])).toBe(false);
    expect(() =>
      Object.assign(artifacts, { alias: artifacts["source-register.json"] }),
    ).toThrow(TypeError);
    expect(Reflect.deleteProperty(artifacts, "source-register.json")).toBe(false);
    expect(
      Reflect.defineProperty(artifacts, "manifest", {
        value: {},
        enumerable: true,
      }),
    ).toBe(false);
    expect(
      Reflect.set(nested, "sourceName", "changed"),
    ).toBe(false);
    expect(Reflect.deleteProperty(nested, "sourceName")).toBe(false);
    expect(
      Reflect.defineProperty(nested, "sourceName", {
        value: "changed",
        enumerable: true,
      }),
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
