import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);
const COUNTRY_DIRECTORY = "vietnam";
const RUN_ID = "data-basic-vn-20260715-r3";
const CANDIDATE_HASHES = {
  "source-register.json":
    "9a164b73048b290a2fd964a292158149d722adcd6edc54d4fea1d67f6cb879a3",
  "extracted-facts.json":
    "ca66fb3f8ee67c69ae9f33b4d941bf84209311cee139b68ed0a84d15ea9b99ce",
  "market-overview.draft.json":
    "3aa83f37cf0177e043d3ed0d5493c6193cb68e9f8dd33c75a46958a0079b5a95",
  "review-report.json":
    "163107e63f1ae72288dc10c8ed0770f94f9b93bf3dd896e67f0870f588492a1e",
} as const;
const CANONICAL_FILES = [
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const;

describe("Vietnam approved Basic publication", () => {
  test("preserves the immutable four-file candidate byte identity", () => {
    const candidateRoot = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      RUN_ID,
    );

    expect(readdirSync(candidateRoot).sort(compareText)).toEqual(
      Object.keys(CANDIDATE_HASHES).sort(compareText),
    );
    for (const [name, expectedHash] of Object.entries(CANDIDATE_HASHES)) {
      expect(sha256(readFileSync(join(candidateRoot, name))), name).toBe(
        expectedHash,
      );
    }
  });

  test("binds the approved receipt to the canonical three-file allowlist", () => {
    const canonicalRoot = join(REPO_ROOT, "data", COUNTRY_DIRECTORY);
    const receiptPath = join(
      REPO_ROOT,
      "data",
      "approvals",
      COUNTRY_DIRECTORY,
      `${RUN_ID}.json`,
    );
    const manifest = readJson(join(canonicalRoot, "collection-manifest.json"));
    const receipt = readJson(receiptPath);

    expect(readdirSync(canonicalRoot).sort(compareText)).toEqual(CANONICAL_FILES);
    expect(manifest).toEqual({
      schemaVersion: "basic-country-publication-manifest/v2",
      activeRunId: RUN_ID,
      mappingVersion: "basic-country-canonical/v2",
      auditBundlePath: `data/staging/${COUNTRY_DIRECTORY}/${RUN_ID}`,
      approvalReceiptPath:
        `data/approvals/${COUNTRY_DIRECTORY}/${RUN_ID}.json`,
      approvalReceiptSha256:
        "da457ef9dd8418a8a17b0f94e52504492da4f33fe3cdbb5b48434bf9b110df02",
    });
    expect(sha256(readFileSync(receiptPath))).toBe(
      manifest.approvalReceiptSha256,
    );
    expect(receipt).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      countryCode: "VN",
      runId: RUN_ID,
      reviewerId: "github:zhaofei0923",
      submission: { submittedAt: "2026-07-17T09:31:27.000Z" },
      decidedAt: "2026-07-17T09:31:27.000Z",
      artifactSha256: CANDIDATE_HASHES,
    });
  });

  test("validates the committed publication as BASIC with no AI or deeper data", () => {
    const result = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.canonical.country).toMatchObject({
      code: "VN",
      coverageLevel: "BASIC",
      name: { zh: "越南", en: "Viet Nam" },
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2026-01-08T07:34:00.000Z",
      },
      ...[
        "policy",
        "risk",
        "opportunities",
        "projects",
        "partners",
        "chinese-companies",
        "entry-strategy",
        "ai-advisor",
        "reports",
      ].map((moduleKey) => ({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
        updatedAt: "2026-01-08T07:34:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "VN",
      overview: {
        zh: expect.stringContaining("总装机容量为82,387兆瓦"),
        en: expect.stringContaining("Total installed capacity was 82,387 MW"),
      },
    });
    expect(result.data.canonical).toMatchObject({
      policy: [],
      risk: [],
      opportunities: [],
      projects: [],
      partners: [],
      chineseCompanies: [],
      entryStrategy: null,
      reports: [],
      knowledge: [],
    });
  });
});

function readJson(pathname: string): Record<string, unknown> {
  return JSON.parse(readFileSync(pathname, "utf8")) as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
