import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const readerProbe = vi.hoisted(() => ({
  afterManifestRead: null as (() => void) | null,
  manifestReads: 0,
}));

vi.mock("./collection/basic-stable-json-file-set.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./collection/basic-stable-json-file-set.js")
  >();
  return {
    ...actual,
    readBasicStableJsonFileSet(
      request: Parameters<typeof actual.readBasicStableJsonFileSet>[0],
    ) {
      const result = actual.readBasicStableJsonFileSet(request);
      if (Object.keys(request.files).length === 1) {
        readerProbe.manifestReads += 1;
        const hook = readerProbe.afterManifestRead;
        readerProbe.afterManifestRead = null;
        hook?.();
      }
      return result;
    },
  };
});

import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import { createBasicCountryPublicationV3Fixture } from "./basic-publication-v3-test-fixture.js";
import type { BasicCollectionAuditArtifactName } from "./collection/basic-offline-audit-artifacts.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationManifestV2,
  BasicCountryPublicationManifestV3,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { loadApprovedBasicCountryPublicationVersioned } from "./collection/basic-publication-versioned-loader.js";

const roots = new Set<string>();
const CANDIDATE_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[];

afterEach(() => {
  readerProbe.afterManifestRead = null;
  readerProbe.manifestReads = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("versioned approved BASIC publication loader", () => {
  test("dispatches an exact v2 publication without widening its manifest literal", () => {
    const fixture = writeRepository(createBasicCountryPublicationFixture());

    expect(loadApprovedBasicCountryPublicationVersioned(
      fixture.root,
      fixture.countryDirectory,
    )).toMatchObject({
      valid: true,
      data: {
        manifest: {
          schemaVersion: "basic-country-publication-manifest/v2",
        },
      },
    });
  });

  test("dispatches an exact v3 publication without widening its manifest literal", () => {
    const fixture = writeRepository(createBasicCountryPublicationV3Fixture());

    expect(loadApprovedBasicCountryPublicationVersioned(
      fixture.root,
      fixture.countryDirectory,
    )).toMatchObject({
      valid: true,
      data: {
        manifest: {
          schemaVersion: "basic-country-publication-manifest/v3",
        },
      },
    });
  });

  test("fails closed on an unsupported manifest version", () => {
    const fixture = writeRepository(createBasicCountryPublicationV3Fixture());
    writeJson(fixture.manifestPath, {
      ...fixture.manifest,
      schemaVersion: "basic-country-publication-manifest/v4",
    });

    expect(loadApprovedBasicCountryPublicationVersioned(
      fixture.root,
      fixture.countryDirectory,
    )).toEqual(publicationFailure());
  });

  test.each([
    ["v2 manifest with v3 candidate", "v2", "v3"],
    ["v3 manifest with v2 candidate", "v3", "v2"],
  ] as const)("fails closed on a %s", (_case, manifestVersion, candidateVersion) => {
    const manifestFixture = manifestVersion === "v2"
      ? createBasicCountryPublicationFixture()
      : createBasicCountryPublicationV3Fixture();
    const candidateFixture = candidateVersion === "v2"
      ? createBasicCountryPublicationFixture()
      : createBasicCountryPublicationV3Fixture();
    const fixture = writeRepository(manifestFixture);
    replaceCandidate(fixture, candidateFixture.candidateArtifactBytes);

    expect(loadApprovedBasicCountryPublicationVersioned(
      fixture.root,
      fixture.countryDirectory,
    )).toEqual(publicationFailure());
  });

  test("rejects phase-one manifest byte drift before the selected loader phase two", () => {
    const fixture = writeRepository(createBasicCountryPublicationV3Fixture());
    readerProbe.afterManifestRead = () => {
      readerProbe.afterManifestRead = () => {
        writeFileSync(
          fixture.manifestPath,
          ` ${JSON.stringify(fixture.manifest)}\n`,
          "utf8",
        );
      };
    };

    expect(loadApprovedBasicCountryPublicationVersioned(
      fixture.root,
      fixture.countryDirectory,
    )).toEqual(publicationFailure());
    expect(readerProbe.manifestReads).toBe(2);
  });
});

type PublicationFixture =
  | ReturnType<typeof createBasicCountryPublicationFixture>
  | ReturnType<typeof createBasicCountryPublicationV3Fixture>;

interface RepositoryFixture {
  readonly root: string;
  readonly countryDirectory: string;
  readonly manifest: BasicCountryPublicationManifestV2 | BasicCountryPublicationManifestV3;
  readonly manifestPath: string;
  readonly approvalPath: string;
  readonly candidateDirectory: string;
}

function writeRepository(publication: PublicationFixture): RepositoryFixture {
  const root = mkdtempSync(join(tmpdir(), "basic-publication-versioned-"));
  roots.add(root);
  const countryDirectory = publication.approvalReceipt.countryDirectory;
  const runId = publication.approvalReceipt.runId;
  const canonicalDirectory = join(root, "data", countryDirectory);
  const candidateDirectory = join(root, "data", "staging", countryDirectory, runId);
  const approvalDirectory = join(root, "data", "approvals", countryDirectory);
  mkdirSync(canonicalDirectory, { recursive: true });
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(approvalDirectory, { recursive: true });

  const manifestPath = join(canonicalDirectory, "collection-manifest.json");
  const approvalPath = join(approvalDirectory, `${runId}.json`);
  writeJson(manifestPath, publication.manifest);
  writeJson(join(canonicalDirectory, "country.json"), publication.canonical.country);
  writeJson(
    join(canonicalDirectory, "market-overview.json"),
    publication.canonical.marketOverview,
  );
  writeFileSync(approvalPath, publication.approvalReceiptBytes);
  for (const name of CANDIDATE_NAMES) {
    writeFileSync(join(candidateDirectory, name), publication.candidateArtifactBytes[name]);
  }
  return {
    root,
    countryDirectory,
    manifest: publication.manifest,
    manifestPath,
    approvalPath,
    candidateDirectory,
  };
}

function replaceCandidate(
  fixture: RepositoryFixture,
  candidateBytes: Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>,
): void {
  for (const name of CANDIDATE_NAMES) {
    writeFileSync(join(fixture.candidateDirectory, name), candidateBytes[name]);
  }
  const approval = JSON.parse(
    new TextDecoder().decode(readBytes(fixture.approvalPath)),
  ) as BasicCountryPublicationApprovalReceipt;
  const updatedApproval = {
    ...approval,
    artifactSha256: Object.fromEntries(CANDIDATE_NAMES.map((name) => [
      name,
      sha256Hex(candidateBytes[name]),
    ])),
  };
  const approvalBytes = new TextEncoder().encode(`${JSON.stringify(updatedApproval)}\n`);
  writeFileSync(fixture.approvalPath, approvalBytes);
  writeJson(fixture.manifestPath, {
    ...fixture.manifest,
    approvalReceiptSha256: sha256Hex(approvalBytes),
  });
}

function readBytes(pathname: string): Uint8Array {
  return new Uint8Array(readFileSync(pathname));
}

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

function publicationFailure() {
  return Object.freeze({
    valid: false as const,
    blockerCode: "PUBLICATION_READ_FAILED" as const,
    data: null,
  });
}
