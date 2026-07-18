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
const COUNTRY_DIRECTORY = "brazil";
const RUN_ID = "data-basic-br-20260718-r2";
const REJECTED_RUN_ID = "data-basic-br-20260717-r1";
const APPROVAL_RECEIPT_HASH =
  "47136fb4516cc6d7a2fe4c104542f184c8190201ba6e5b772b796d55f215cf01";
const CANDIDATE_HASHES = {
  "source-register.json":
    "22b7800d29ad39408e62c2c84d78c643b3d70ed081dca528a15708c895bfced5",
  "extracted-facts.json":
    "6c8cb2023f9b2e41afc06bc6d129db7289d7b6b81b2af8171f3eeac3681918d2",
  "market-overview.draft.json":
    "2fcfa2d31c616ec99876a268330fd0c73e07e63c6a1fd1b0402de7927c1099e2",
  "review-report.json":
    "645e074ba71650fa250d792245fe0397f0f0b678292abce71744350c2fc3511e",
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

describe("Brazil approved Basic publication", () => {
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
      countryCode: "BR",
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
    expect(canonicalMarket).toMatchObject({ aiUsable: false, techTags: [] });
  });

  test("validates Brazil as BASIC without disputed figures, AI, or deeper data", () => {
    const result = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.canonical.country).toMatchObject({
      code: "BR",
      name: { en: "Brazil", zh: "巴西" },
      summary: {
        en: expect.stringContaining(
          "final electricity consumption grew 2.7% year on year in 2025",
        ),
        zh: expect.stringContaining("2025年最终电力消费同比增长2.7%"),
      },
      region: "latin-america",
      coverageLevel: "BASIC",
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
      ...DEEP_MODULE_KEYS.map((moduleKey) => ({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
        updatedAt: "2026-06-03T00:00:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "BR",
      energyDemand: {
        en: "Final electricity consumption grew 2.7% year on year in 2025.",
        zh: "2025年最终电力消费同比增长2.7%。",
      },
      renewableTarget: {
        en: "Brazil's stated target is to maintain a high share of renewable energy in the national energy matrix by 2030. This is a qualitative target, not a numeric target and not specific to the electricity matrix.",
        zh: "巴西提出到2030年维持可再生能源在全国能源矩阵中的高占比。这是定性目标，不是数值目标，也不特指电力矩阵。",
      },
      keyIndicators: [
        expect.objectContaining({ value: "2.7", unit: "%", year: 2025 }),
        expect.objectContaining({ value: "64793", unit: "MW", year: 2025 }),
        expect.objectContaining({ value: "34707", unit: "MW", year: 2025 }),
      ],
      techTags: [],
    });
    const publishedFactsAndCopy = JSON.stringify({
      country: result.data.canonical.country,
      marketOverview: result.data.canonical.marketOverview,
    });
    expect(publishedFactsAndCopy).not.toMatch(/20\.4|86\.8|86\.6/);
    expect(publishedFactsAndCopy).not.toMatch(/legal obligation/i);
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
