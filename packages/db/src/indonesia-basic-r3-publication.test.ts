import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadApprovedBasicCountryPublicationVersioned } from "./collection/basic-publication-versioned-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);
const COUNTRY_DIRECTORY = "indonesia";
const RUN_ID = "data-basic-id-20260720-r3";
const APPROVAL_RECEIPT_HASH =
  "b4643bc2a6fec9a5aff10fa74b45b33e9c9c4712f2d958244e1a545beeecfb75";
const CANDIDATE_HASHES = {
  "source-register.json":
    "0ae67bd15962eea524a1ea2479a6cbaba7dafbaf3c8967b9595cf9c0c3eada94",
  "extracted-facts.json":
    "b08fa0ba5c58a7f33074aef3de57cdb6c753a825a3c6acdb7611d654baf326ad",
  "market-overview.draft.json":
    "3804d0349cc611f492bbb74a0aa680ca490dc9c2cf5d18dd2b046bba149f3db3",
  "review-report.json":
    "416b537c6ecb4247050657250cf3148b3877afdada2a94fb739d4eeb54c753b9",
} as const;
const CANONICAL_FILES = [
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const;
const PROFILE_CATEGORIES = [
  "countryBasics",
  "electricityMarket",
  "energyAccess",
  "renewableCapacity",
  "solarResource",
  "windResource",
  "policyOverview",
  "marketSummary",
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
const NOT_AVAILABLE_FIELDS = [
  "electricityMarket.electricityConsumption",
  "electricityMarket.electricityMix",
  "electricityMarket.renewableGenerationShare",
  "electricityMarket.totalGeneration",
  "renewableCapacity.hydroCapacity",
  "renewableCapacity.solarCapacity",
  "renewableCapacity.totalRenewableCapacity",
  "renewableCapacity.windCapacity",
  "solarResource.ghi",
  "solarResource.pvout",
  "solarResource.solarPotentialSummary",
  "windResource.offshoreWindClass",
  "windResource.onshoreWindClass",
  "windResource.resourceSummary",
] as const;
const MARKET_SUMMARY = {
  zh: "对中国新能源企业而言，IEA记录的印尼国家电力总规划可作为跟踪当地电力转型政策的线索。该政策在2025年生效，并记录了到2060年新能源和可再生能源约占能源结构73.6%的目标。进入、融资、项目储备及并网条件仍需以进一步尽调核实。",
  en: "For Chinese new-energy companies, the IEA-recorded National Electricity General Plan is a lead for tracking Indonesia's power-transition policy. It took effect in 2025 and records a target for new and renewable energy to reach about 73.6% of the energy mix by 2060. Market entry, financing, project pipeline, and grid conditions still require further due diligence.",
} as const;

describe("Indonesia approved Basic r3 publication", () => {
  test("binds the immutable r3 candidate and exact approval receipt", () => {
    const candidateRoot = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      RUN_ID,
    );
    const receiptPath = join(
      REPO_ROOT,
      "data",
      "approvals",
      COUNTRY_DIRECTORY,
      `${RUN_ID}.json`,
    );

    expect(readdirSync(candidateRoot).sort(compareText)).toEqual(
      Object.keys(CANDIDATE_HASHES).sort(compareText),
    );
    for (const [name, expectedHash] of Object.entries(CANDIDATE_HASHES)) {
      expect(sha256(readFileSync(join(candidateRoot, name))), name).toBe(
        expectedHash,
      );
    }
    expect(sha256(readFileSync(receiptPath))).toBe(APPROVAL_RECEIPT_HASH);
    expect(readJson(receiptPath)).toEqual({
      schemaVersion: "basic-country-publication-approval/v1",
      countryDirectory: COUNTRY_DIRECTORY,
      countryCode: "ID",
      runId: RUN_ID,
      submission: {
        fromReviewStatus: "draft",
        toReviewStatus: "pending",
        submittedAt: "2026-07-20T13:12:37.000Z",
      },
      decision: "approved",
      reviewerId: "github:zhaofei0923",
      decidedAt: "2026-07-20T13:12:37.000Z",
      authorizedPublication: {
        coverageLevel: "BASIC",
        fromReviewStatus: "pending",
        toReviewStatus: "published",
        aiUsable: false,
      },
      artifactSha256: CANDIDATE_HASHES,
    });
  });

  test("activates only the exact v3 canonical projection", () => {
    const canonicalRoot = join(REPO_ROOT, "data", COUNTRY_DIRECTORY);
    const manifest = readJson(join(canonicalRoot, "collection-manifest.json"));
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

    expect(readdirSync(canonicalRoot).sort(compareText)).toEqual(CANONICAL_FILES);
    expect(manifest).toEqual({
      schemaVersion: "basic-country-publication-manifest/v3",
      activeRunId: RUN_ID,
      mappingVersion: "basic-country-canonical/v3",
      auditBundlePath: `data/staging/${COUNTRY_DIRECTORY}/${RUN_ID}`,
      approvalReceiptPath:
        `data/approvals/${COUNTRY_DIRECTORY}/${RUN_ID}.json`,
      approvalReceiptSha256: APPROVAL_RECEIPT_HASH,
    });
    expect(
      readJson(join(canonicalRoot, "market-overview.json")),
    ).toEqual({ ...draft, reviewStatus: "published" });
    expect(draft).toMatchObject({ reviewStatus: "draft", aiUsable: false });
  });

  test("validates BASIC coverage, bilingual profile, and closed AI boundary", () => {
    const result = loadApprovedBasicCountryPublicationVersioned(
      REPO_ROOT,
      COUNTRY_DIRECTORY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error(`Expected valid publication, received ${result.blockerCode}`);
    }
    expect(result.data.manifest.schemaVersion).toBe(
      "basic-country-publication-manifest/v3",
    );
    expect(result.data.canonical.country).toMatchObject({
      code: "ID",
      coverageLevel: "BASIC",
      name: { zh: "印度尼西亚", en: "Indonesia" },
    });
    expect(result.data.canonical.country.moduleCoverage).toEqual([
      {
        moduleKey: "market-overview",
        status: "COMPLETE",
        dataCount: 1,
        updatedAt: "2026-01-09T00:00:00.000Z",
      },
      ...DEEP_MODULE_KEYS.map((moduleKey) => ({
        moduleKey,
        status: "BUILDING",
        dataCount: 0,
        updatedAt: "2026-01-09T00:00:00.000Z",
      })),
    ]);
    expect(result.data.canonical.marketOverview).toMatchObject({
      reviewStatus: "published",
      aiUsable: false,
      countryCode: "ID",
      basicProfile: {
        schemaVersion: "basic-market-profile/v2",
        updatedAt: "2026-07-20T12:30:00Z",
      },
    });
    const profile = result.data.canonical.marketOverview.basicProfile;
    expect(profile).not.toBeNull();
    expect(profile).toBeDefined();
    if (profile === null || profile === undefined) {
      throw new Error("Expected published Indonesia BASIC profile");
    }
    expect(Object.keys(profile.categories).sort(compareText)).toEqual(
      [...PROFILE_CATEGORIES].sort(compareText),
    );
    expect(profile.categories.marketSummary.fields).toEqual([
      expect.objectContaining({
        key: "opportunitySummary",
        status: "AVAILABLE",
        value: MARKET_SUMMARY,
      }),
    ]);

    const sourcesById = new Map(profile.sources.map((source) => [source.id, source]));
    const unavailableFields = PROFILE_CATEGORIES.flatMap((category) =>
      profile.categories[category].fields
        .filter((field) => field.status === "NOT_AVAILABLE")
        .map((field) => ({ category, field })),
    );
    expect(
      unavailableFields
        .map(({ category, field }) => `${category}.${field.key}`)
        .sort(compareText),
    ).toEqual([...NOT_AVAILABLE_FIELDS]);
    for (const { field } of unavailableFields) {
      expect(field).toMatchObject({
        value: null,
        unit: null,
        year: null,
        sourceIds: expect.arrayContaining([expect.any(String)]),
        reason: { zh: expect.any(String), en: expect.any(String) },
      });
      expect(field.sourceIds).toHaveLength(new Set(field.sourceIds).size);
      for (const sourceId of field.sourceIds) {
        expect(sourcesById.has(sourceId), sourceId).toBe(true);
      }
    }
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
