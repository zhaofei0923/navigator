import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  buildApprovedBasicCountryPublicationImportPlan,
  isPreparedApprovedBasicCountryImportFromLoader,
  parseApprovedBasicCountryPublicationImportArgs,
  prepareApprovedBasicCountryImport,
} from "./seed/approved-basic-country-import.js";
import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);

describe("approved Basic country publication import", () => {
  test("prepares canonical data and a 12-operation plan from one loader snapshot", () => {
    const publication = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      "indonesia",
    );
    if (!publication.valid) {
      throw new Error("Indonesia fixture publication must be valid");
    }

    let loaderCalls = 0;
    const prepared = prepareApprovedBasicCountryImport(
      REPO_ROOT,
      "indonesia",
      (repoRoot, countryDirectory) => {
        loaderCalls += 1;
        expect(repoRoot).toBe(REPO_ROOT);
        expect(countryDirectory).toBe("indonesia");
        return publication;
      },
    );

    expect(loaderCalls).toBe(1);
    expect(prepared).toMatchObject({
      countryDirectory: "indonesia",
      countryCode: "ID",
      canonical: publication.data.canonical,
    });
    expect(prepared.plan.operations).toHaveLength(12);
  });

  test("brands only deeply frozen values prepared from the approved loader", () => {
    const prepared = prepareApprovedBasicCountryImport(REPO_ROOT, "indonesia");
    const structuralClone = JSON.parse(JSON.stringify(prepared)) as unknown;

    expect(isRecursivelyFrozen(prepared)).toBe(true);
    expect(isPreparedApprovedBasicCountryImportFromLoader(prepared)).toBe(true);
    expect(isPreparedApprovedBasicCountryImportFromLoader(structuralClone)).toBe(
      false,
    );
    expect(isPreparedApprovedBasicCountryImportFromLoader({
      countryDirectory: "indonesia",
      countryCode: "ID",
      canonical: prepared.canonical,
      plan: prepared.plan,
    })).toBe(false);
  });

  test.each([
    ["brazil", "BR"],
    ["indonesia", "ID"],
    ["saudi-arabia", "SA"],
    ["south-africa", "ZA"],
    ["united-arab-emirates", "AE"],
    ["vietnam", "VN"],
  ] as const)("builds an isolated country-generic plan from %s", (directory, code) => {
    const plan = buildApprovedBasicCountryPublicationImportPlan(REPO_ROOT, directory);

    expect(plan.summary).toMatchObject({
      countryCode: code,
      coverageLevel: "BASIC",
      moduleStatuses: {
        "market-overview": "COMPLETE",
        policy: "BUILDING",
        risk: "BUILDING",
        opportunities: "BUILDING",
        projects: "BUILDING",
        partners: "BUILDING",
        "chinese-companies": "BUILDING",
        "entry-strategy": "BUILDING",
        "ai-advisor": "BUILDING",
        reports: "BUILDING",
      },
    });
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country",
      ...Array.from({ length: 10 }, () => "moduleCoverage"),
      "marketOverview",
    ]);
    expect(plan.aiEligibleKnowledgeIds).toEqual([]);

    const serialized = JSON.stringify(plan);
    for (const forbidden of [
      "approvalReceipt",
      "collection-manifest",
      "data/approvals",
      "data/staging",
      "extractedFacts",
      "knowledgeChunk",
      "reviewReport",
      "sourceRegister",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('"reviewStatus":"published"');
    expect(serialized).toContain('"aiUsable":false');
  });

  test("retires the Indonesia Complete-only seed command", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts).not.toHaveProperty("seed:indonesia");
    expect(packageJson.scripts["seed:approved-basic-country"]).toContain(
      "approved-basic-country-import.ts",
    );
    expect(packageJson.scripts["seed:approved-basic-country"]).toContain(
      "--experimental-transform-types",
    );
  });

  test("accepts direct and pnpm-delimited country arguments", () => {
    expect(parseApprovedBasicCountryPublicationImportArgs(["indonesia"])).toBe(
      "indonesia",
    );
    expect(
      parseApprovedBasicCountryPublicationImportArgs(["--", "indonesia"]),
    ).toBe("indonesia");
    expect(parseApprovedBasicCountryPublicationImportArgs([])).toBeUndefined();
    expect(
      parseApprovedBasicCountryPublicationImportArgs(["indonesia", "extra"]),
    ).toBeUndefined();
  });

  test("fails closed when no approved publication exists", () => {
    expect(() =>
      buildApprovedBasicCountryPublicationImportPlan(REPO_ROOT, "missing-country")
    ).toThrow("Approved Basic publication validation failed: PUBLICATION_READ_FAILED");
  });
});

function isRecursivelyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isRecursivelyFrozen);
}
