import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { BasicCollectionAuditBundle } from "./collection/basic-collection-contracts.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";
import {
  type BasicCollectionFixtureScenario,
  readBasicCollectionAuditFixture,
} from "./basic-collection-test-fixture.js";

describe("Basic collection audit loader", () => {
  test.each([
    ["normal", [], true],
    ["missing", ["MISSING_REQUIRED_FACT"], false],
    ["conflict", ["UNRESOLVED_CONFLICT"], false],
    ["untrusted", ["UNTRUSTED_INPUT"], false],
  ] as const)(
    "validates committed %s fixtures deterministically",
    (scenario, blockers, readyForHumanReview) => {
      const firstRead = readBasicCollectionAuditFixture(scenario);
      const secondRead = readBasicCollectionAuditFixture(scenario);
      const result = validateBasicCollectionAuditBundle(firstRead);

      expect(firstRead).toEqual(secondRead);
      expect(result).toMatchObject({
        valid: true,
        blockers,
        readyForHumanReview,
      });
    },
  );

  test("loads only the four documented staging artifacts", async () => {
    const fixture = writeFixtureStaging("normal");
    mkdirSync(join(fixture.repoRoot, "data", fixture.countryDirectory), {
      recursive: true,
    });
    writeFileSync(
      join(fixture.repoRoot, "data", fixture.countryDirectory, "country.json"),
      "not JSON",
      "utf8",
    );
    writeFileSync(
      join(
        fixture.repoRoot,
        "data",
        fixture.countryDirectory,
        "collection-manifest.json",
      ),
      "not JSON",
      "utf8",
    );
    writeFileSync(
      join(fixture.auditDirectory, "collection-manifest.json"),
      "not JSON",
      "utf8",
    );
    mkdirSync(join(fixture.repoRoot, ".cache", "basic-country", "XZ"), {
      recursive: true,
    });
    writeFileSync(
      join(fixture.repoRoot, ".cache", "basic-country", "XZ", "raw.json"),
      "not JSON",
      "utf8",
    );

    const loadBundle = await importBasicCollectionAuditBundleLoader();
    const loaded = loadBundle(
      fixture.repoRoot,
      fixture.countryDirectory,
      fixture.runId,
    );

    expect(loaded).toEqual(fixture.bundle);
  });

  test("returns structurally valid blocked audit bundles", async () => {
    const loadBundle = await importBasicCollectionAuditBundleLoader();

    for (const scenario of ["missing", "conflict", "untrusted"] as const) {
      const fixture = writeFixtureStaging(scenario);
      const loaded = loadBundle(
        fixture.repoRoot,
        fixture.countryDirectory,
        fixture.runId,
      );

      expect(loaded).toEqual(fixture.bundle);
    }
  });

  test("rejects country directory path traversal before reading", async () => {
    const loadBundle = await importBasicCollectionAuditBundleLoader();
    const repoRoot = mkdtempSync(join(tmpdir(), "basic-collection-loader-"));

    expect(() =>
      loadBundle(repoRoot, "../fixture-country", "run-normal"),
    ).toThrow("countryDirectory must be a safe slug");
  });

  test("rejects run id path traversal before reading", async () => {
    const loadBundle = await importBasicCollectionAuditBundleLoader();
    const repoRoot = mkdtempSync(join(tmpdir(), "basic-collection-loader-"));

    expect(() =>
      loadBundle(repoRoot, "fixture-country", "../run-normal"),
    ).toThrow("runId must be a safe run id");
  });

  test("rejects a missing staging artifact", async () => {
    const fixture = writeFixtureStaging("normal");
    rmSync(join(fixture.auditDirectory, "source-register.json"));
    const loadBundle = await importBasicCollectionAuditBundleLoader();

    expect(() =>
      loadBundle(
        fixture.repoRoot,
        fixture.countryDirectory,
        fixture.runId,
      ),
    ).toThrow("Unable to read");
  });

  test("rejects malformed artifact JSON", async () => {
    const fixture = writeFixtureStaging("normal");
    writeFileSync(join(fixture.auditDirectory, "source-register.json"), "{", "utf8");
    const loadBundle = await importBasicCollectionAuditBundleLoader();

    expect(() =>
      loadBundle(
        fixture.repoRoot,
        fixture.countryDirectory,
        fixture.runId,
      ),
    ).toThrow("Unable to read");
  });

  test("rejects artifact identities that do not match the requested run", async () => {
    const fixture = writeFixtureStaging("normal");
    writeJson(join(fixture.auditDirectory, "source-register.json"), {
      ...fixture.bundle.sourceRegister,
      runId: "run-other",
    });
    const loadBundle = await importBasicCollectionAuditBundleLoader();

    expect(() =>
      loadBundle(
        fixture.repoRoot,
        fixture.countryDirectory,
        fixture.runId,
      ),
    ).toThrow("sourceRegister.runId must match runId");
  });
});

async function importBasicCollectionAuditBundleLoader(): Promise<
  (
    repoRoot: string,
    countryDirectory: string,
    runId: string,
  ) => BasicCollectionAuditBundle
> {
  const collectionLoader = await import(
    "./collection/basic-collection-loader.js"
  );
  return collectionLoader.loadBasicCollectionAuditBundle;
}

function writeFixtureStaging(
  scenario: BasicCollectionFixtureScenario,
): {
  repoRoot: string;
  countryDirectory: string;
  runId: string;
  auditDirectory: string;
  bundle: BasicCollectionAuditBundle;
} {
  const bundle = readBasicCollectionAuditFixture(scenario);
  const repoRoot = mkdtempSync(join(tmpdir(), "basic-collection-loader-"));
  const auditDirectory = join(
    repoRoot,
    "data",
    "staging",
    bundle.countryDirectory,
    bundle.runId,
  );

  mkdirSync(auditDirectory, { recursive: true });
  writeJson(join(auditDirectory, "source-register.json"), bundle.sourceRegister);
  writeJson(join(auditDirectory, "extracted-facts.json"), bundle.extractedFacts);
  writeJson(
    join(auditDirectory, "market-overview.draft.json"),
    bundle.marketOverviewDraft,
  );
  writeJson(join(auditDirectory, "review-report.json"), bundle.reviewReport);

  return {
    repoRoot,
    countryDirectory: bundle.countryDirectory,
    runId: bundle.runId,
    auditDirectory,
    bundle,
  };
}

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
