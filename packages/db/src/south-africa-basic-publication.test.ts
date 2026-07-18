import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);
const COUNTRY_DIRECTORY = "south-africa";
const RUN_ID = "data-basic-za-20260718-r2";
const REJECTED_RUN_ID = "data-basic-za-20260717-r1";
const APPROVAL_RECEIPT_HASH =
  "5e82bf08c86218c9b141d17b9f17bbadf7ca1a6f5634058abafb89e14e065e56";
const CANDIDATE_HASHES = {
  "source-register.json":
    "7a99e47484e038a708201981035da50de7309f09ede5ab235ad4f32151001e3f",
  "extracted-facts.json":
    "dc8387ad8569037d799e59b0be8502647bf2719d7b9395962d56901f9df1250c",
  "market-overview.draft.json":
    "16ea4b33672b0c5ff4ad025eca1ca8d2ca0ceb36f95bf8c8f8d7da93c6b91536",
  "review-report.json":
    "f73b93f10e3dc0d40eac7f918745bde855f11d49fed5a0259ea2fefa27e92a33",
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

describe("South Africa approved Basic publication", () => {
  test("preserves the approved r2 candidate byte identity and rejected r1 boundary", () => {
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
    expect(
      existsSync(
        join(
          REPO_ROOT,
          "data",
          "approvals",
          COUNTRY_DIRECTORY,
          `${REJECTED_RUN_ID}.json`,
        ),
      ),
    ).toBe(false);
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
      countryCode: "ZA",
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

  test("promotes only the canonical review status", () => {
    const draft = readJson(
      join(
        REPO_ROOT,
        "data",
        "staging",
        COUNTRY_DIRECTORY,
        RUN_ID,
        "market-overview.draft.json",
      ),
    );
    const canonicalMarket = readJson(
      join(REPO_ROOT, "data", COUNTRY_DIRECTORY, "market-overview.json"),
    );

    expect(canonicalMarket).toEqual({ ...draft, reviewStatus: "published" });
    expect(canonicalMarket).toMatchObject({
      aiUsable: false,
      techTags: ["onshore-wind"],
    });
  });

  test("validates South Africa as BASIC without scope drift, AI, or deeper data", () => {
    const result = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.canonical.country).toMatchObject({
      code: "ZA",
      name: { en: "South Africa", zh: "南非" },
      summary: {
        en: expect.stringContaining("195,702 GWh of Eskom-only energy sent out"),
        zh: expect.stringContaining("Eskom口径送出电量为195,702吉瓦时"),
      },
      region: "africa",
      updatedAt: "2025-10-28T00:00:00.000Z",
      coverageLevel: "BASIC",
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2025-10-28T00:00:00.000Z",
      },
      ...DEEP_MODULE_KEYS.map((moduleKey) => ({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
        updatedAt: "2025-10-28T00:00:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "ZA",
      updatedAt: "2025-10-28T00:00:00.000Z",
      industryTags: ["grid", "solar", "storage", "wind"],
      techTags: ["onshore-wind"],
      keyIndicators: [
        expect.objectContaining({ value: "189.7", unit: "TWh", year: 2025 }),
        expect.objectContaining({ value: "195702", unit: "GWh", year: 2025 }),
        expect.objectContaining({ value: "43041", unit: "MW", year: 2042 }),
      ],
    });
    expect(result.data.canonical.marketOverview.overview).toEqual({
      en: expect.stringContaining(
        "includes installed, under-construction, and deemed-online-in-2025 capacity",
      ),
      zh: expect.stringContaining("包括已投运、在建及视为于2025年投运的容量"),
    });
    expect(result.data.canonical.marketOverview.renewableTarget).toEqual({
      en: expect.stringContaining("not built or procured capacity"),
      zh: expect.stringContaining("不代表已建成或已采购容量"),
    });
    const publishedFactsAndCopy = JSON.stringify({
      country: result.data.canonical.country,
      marketOverview: result.data.canonical.marketOverview,
    });
    expect(publishedFactsAndCopy).not.toContain("自发");
    expect(publishedFactsAndCopy).not.toContain("net of pumping");
    expect(publishedFactsAndCopy).not.toContain("excluding wheeling");
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
