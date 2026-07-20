import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createBasicCollectionAuditFixture,
  createBasicCollectionAuditV2Fixture,
} from "./basic-collection-test-fixture.js";
import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import type { BasicCollectionAuditArtifactName } from "./collection/basic-offline-audit-artifacts.js";
import {
  loadBasicCollectionAuditBundleVersioned,
  validateBasicCollectionAuditArtifactValuesVersioned,
} from "./collection/basic-collection-versioned-loader.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("versioned Basic collection audit v3 loader", () => {
  test("dispatches pure v3 while preserving unchanged v1 and v2 loading", () => {
    const v1 = createBasicCollectionAuditFixture();
    const v2 = createBasicCollectionAuditV2Fixture();
    const v3 = createBasicCollectionAuditV3Fixture();

    expect(dispatch(v1)).toEqual(v1);
    expect(dispatch(v2)).toEqual(v2);
    expect(dispatch(v3)).toEqual(v3);
  });

  test.each([
    ["v2 source register", "sourceRegister"],
    ["v2 extracted facts", "extractedFacts"],
    ["v2 review report", "reviewReport"],
  ] as const)("rejects mixed v3 material with a %s", (_label, key) => {
    const v3 = createBasicCollectionAuditV3Fixture();
    const v2 = createBasicCollectionAuditV2Fixture();
    const mixed = { ...v3, [key]: v2[key] };

    expect(() => dispatch(mixed)).toThrowError(
      /^Basic collection audit artifact versions must not be mixed$/,
    );
  });

  test("loads only the exact four candidate filenames for v3", () => {
    const v3 = createBasicCollectionAuditV3Fixture();
    const root = writeBundle(v3);
    expect(loadBasicCollectionAuditBundleVersioned(
      root,
      v3.countryDirectory,
      v3.runId,
    )).toEqual(v3);

    writeFileSync(join(stagingDirectory(root, v3), "profile.json"), "{}", "utf8");
    expect(() => loadBasicCollectionAuditBundleVersioned(
      root,
      v3.countryDirectory,
      v3.runId,
    )).toThrowError(/^Basic collection audit artifacts could not be read$/);
  });
});

interface StagingBundle {
  readonly countryDirectory: string;
  readonly runId: string;
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly marketOverviewDraft: unknown;
  readonly reviewReport: unknown;
}

function dispatch(bundle: StagingBundle) {
  return validateBasicCollectionAuditArtifactValuesVersioned(
    bundle.countryDirectory,
    bundle.runId,
    artifactValues(bundle),
  );
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
  const root = mkdtempSync(join(tmpdir(), "basic-v3-loader-"));
  roots.add(root);
  const directory = stagingDirectory(root, bundle);
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifactValues(bundle))) {
    writeFileSync(join(directory, name), JSON.stringify(value), "utf8");
  }
  return root;
}

function stagingDirectory(root: string, bundle: StagingBundle): string {
  return join(root, "data", "staging", bundle.countryDirectory, bundle.runId);
}
