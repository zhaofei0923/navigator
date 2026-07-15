import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  buildApprovedBasicCountryPublicationImportPlan,
  parseApprovedBasicCountryPublicationImportArgs,
} from "./seed/approved-basic-country-import.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);

describe("approved Basic country publication import", () => {
  test("builds an isolated country-generic plan from the committed ID publication", () => {
    const plan = buildApprovedBasicCountryPublicationImportPlan(
      REPO_ROOT,
      "indonesia",
    );

    expect(plan.summary).toMatchObject({
      countryCode: "ID",
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
      "id_pol_001",
      "id_know_001",
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
