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
const COUNTRY_DIRECTORY = "united-arab-emirates";
const RUN_ID = "data-basic-ae-20260717-r1";
const APPROVAL_RECEIPT_HASH =
  "41b2f9c18e27a77c3129125cb50d3d88fa7405ffb8729e3e97f593efab3341f4";
const CANDIDATE_HASHES = {
  "source-register.json":
    "2430b3c80beb1d33de61aa0af82174d4c8a5d66ead95c38b4e6390e3f5cfd842",
  "extracted-facts.json":
    "f26bea5b799e2b5e3014b90783438d28f292424e4a927504992cb1f3384639e7",
  "market-overview.draft.json":
    "aa8ca2e01f0240abc7923cae991bf981a9d8982ff155c8ff9684b31db3255bfe",
  "review-report.json":
    "35da3331817a19d59b5b7c0ca01036117ff10095cff5be863171367e3f504b5c",
} as const;
const CANONICAL_FILES = [
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const;
const DEEP_MODULE_KEYS = [
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "entry-strategy",
  "ai-advisor",
  "reports",
] as const;

describe("United Arab Emirates approved Basic publication", () => {
  test("preserves the approved r1 candidate byte identity", () => {
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

  test("binds the approval receipt to the canonical three-file allowlist", () => {
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
      approvalReceiptSha256: APPROVAL_RECEIPT_HASH,
    });
    expect(sha256(readFileSync(receiptPath))).toBe(APPROVAL_RECEIPT_HASH);
    expect(receipt).toEqual({
      schemaVersion: "basic-country-publication-approval/v1",
      countryDirectory: COUNTRY_DIRECTORY,
      countryCode: "AE",
      runId: RUN_ID,
      submission: {
        fromReviewStatus: "draft",
        toReviewStatus: "pending",
        submittedAt: "2026-07-18T02:51:43.000Z",
      },
      decision: "approved",
      reviewerId: "github:zhaofei0923",
      decidedAt: "2026-07-18T02:51:43.000Z",
      authorizedPublication: {
        coverageLevel: "BASIC",
        fromReviewStatus: "pending",
        toReviewStatus: "published",
        aiUsable: false,
      },
      artifactSha256: CANDIDATE_HASHES,
    });
  });

  test("validates the UAE canonical bundle as BASIC with no AI or deeper data", () => {
    const result = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.canonical.country).toMatchObject({
      code: "AE",
      name: { en: "United Arab Emirates", zh: "阿拉伯联合酋长国" },
      summary: {
        en: "The United Arab Emirates' Barakah Nuclear Energy Plant generates 40 TWh per year and provides up to 25% of the country's electricity; the grid-connected UAE Wind Program has 103.5 MW of wind capacity. The updated UAE Energy Strategy 2050 states renewable and clean-energy targets for 2030.",
        zh: "阿拉伯联合酋长国的巴拉卡核电站每年发电40太瓦时，可提供该国高达25%的电力；并网的阿联酋风电项目风电容量为103.5兆瓦。更新后的《阿联酋能源战略2050》列明了2030年可再生能源和清洁能源目标。",
      },
      region: "middle-east",
      coverageLevel: "BASIC",
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2024-12-30T00:00:00.000Z",
      },
      ...DEEP_MODULE_KEYS.map((moduleKey) => ({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
        updatedAt: "2024-12-30T00:00:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "AE",
      overview: {
        zh: expect.stringContaining("每年发电40太瓦时"),
        en: expect.stringContaining("generates 40 TWh per year"),
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
