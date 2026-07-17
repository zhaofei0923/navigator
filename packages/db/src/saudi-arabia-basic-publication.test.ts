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
const COUNTRY_DIRECTORY = "saudi-arabia";
const RUN_ID = "data-basic-sa-20260717-r2";
const CANDIDATE_HASHES = {
  "source-register.json":
    "b242dc902b7002dc3a2cec1bd87703760d776ada2b5c301329543b1f5945353d",
  "extracted-facts.json":
    "bd0df36ba29453e0d337ad8401310c443ff26686cc8efc06994902b017814072",
  "market-overview.draft.json":
    "2a297d007279afb80baeb316581aca874738ce614443a2a7944ad576e32c6285",
  "review-report.json":
    "c8677f1bac448aa87ec79e35f3ffb9fc5b15c615f2b47ab3072ed588e09e6f9d",
} as const;
const CANONICAL_FILES = [
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const;

describe("Saudi Arabia approved Basic publication", () => {
  test("preserves the approved r2 candidate byte identity", () => {
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

  test("binds the approved r2 receipt to the canonical three-file allowlist", () => {
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

    expect(
      existsSync(
        join(
          REPO_ROOT,
          "data",
          "approvals",
          "saudi-arabia",
          "data-basic-sa-20260717-r1.json",
        ),
      ),
    ).toBe(false);
    expect(readdirSync(canonicalRoot).sort(compareText)).toEqual(CANONICAL_FILES);
    expect(manifest).toEqual({
      schemaVersion: "basic-country-publication-manifest/v2",
      activeRunId: RUN_ID,
      mappingVersion: "basic-country-canonical/v2",
      auditBundlePath: `data/staging/${COUNTRY_DIRECTORY}/${RUN_ID}`,
      approvalReceiptPath:
        `data/approvals/${COUNTRY_DIRECTORY}/${RUN_ID}.json`,
      approvalReceiptSha256:
        "b09aca2ea28e507977ab977246acdf0fc61c17337ddd7646e6b17b516b2ee5bc",
    });
    expect(manifest.activeRunId).toBe("data-basic-sa-20260717-r2");
    expect(sha256(readFileSync(receiptPath))).toBe(
      manifest.approvalReceiptSha256,
    );
    expect(receipt).toMatchObject({
      countryDirectory: "saudi-arabia",
      countryCode: "SA",
      runId: "data-basic-sa-20260717-r2",
      reviewerId: "github:zhaofei0923",
      submission: { submittedAt: "2026-07-17T13:21:53.000Z" },
      decidedAt: "2026-07-17T13:21:53.000Z",
      artifactSha256: CANDIDATE_HASHES,
    });
  });

  test("validates the Saudi canonical bundle as BASIC with no AI or deeper data", () => {
    const result = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.canonical.country).toMatchObject({
      code: "SA",
      name: { en: "Saudi Arabia", zh: "沙特阿拉伯" },
      summary: {
        en: "Saudi Arabia had approximately 92.5 GW of total licensed generation capacity, 6,551 MW of operational renewable project capacity, and 402,628 GWh of electrical energy sent to the network in 2024. Official sources state renewable generation and storage capacity targets for 2030.",
        zh: "沙特阿拉伯2024年许可发电总装机容量约为92.5吉瓦，可再生能源项目投运容量为6,551兆瓦，电网受电量为402,628吉瓦时。官方资料列明了2030年可再生能源发电占比和储能容量目标。",
      },
      region: "middle-east",
      coverageLevel: "BASIC",
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2025-07-14T00:00:00.000Z",
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
        updatedAt: "2025-07-14T00:00:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "SA",
      overview: {
        zh: expect.stringContaining("许可发电总装机容量约为92.5吉瓦"),
        en: expect.stringContaining(
          "Total licensed generation capacity was approximately 92.5 GW",
        ),
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
