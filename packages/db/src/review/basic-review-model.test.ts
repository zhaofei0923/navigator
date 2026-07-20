import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "../basic-collection-v3-test-fixture.js";
import type { BasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-contracts.js";
import {
  BASIC_REVIEW_SECTION_KEYS,
  createBasicReviewModel,
} from "./basic-review-model.js";

describe("BASIC local review model", () => {
  test("keeps the exact eight-category order and side-by-side bilingual fields", () => {
    const bundle = fixture();
    const model = createBasicReviewModel({
      candidate: bundle, previousProfile: null, candidateArtifactSha256: artifactHashes(),
    });

    expect(model.sections.map(({ key }) => key)).toEqual(BASIC_REVIEW_SECTION_KEYS);
    expect(model.candidateArtifactSha256).toEqual({
      "source-register.json": "1".repeat(64),
      "extracted-facts.json": "2".repeat(64),
      "market-overview.draft.json": "3".repeat(64),
      "review-report.json": "4".repeat(64),
    });
    for (const section of model.sections) {
      expect(section.title.zh).not.toBe("");
      expect(section.title.en).not.toBe("");
      for (const field of section.fields) {
        expect(field.label).toEqual(expect.objectContaining({ zh: expect.any(String), en: expect.any(String) }));
        expect(field.text).toEqual(expect.objectContaining({ zh: expect.any(String), en: expect.any(String) }));
        expect(field.citations.length).toBeGreaterThan(0);
      }
    }
  });

  test("exposes NOT_AVAILABLE checks, unresolved conflicts, previous differences, and checklist", () => {
    const bundle = fixture();
    const current = structuredClone(bundle) as Mutable<BasicCollectionAuditBundleV3>;
    const electricity = current.marketOverviewDraft.basicProfile.categories.energyAccess.fields[0]!;
    electricity.status = "NOT_AVAILABLE";
    electricity.value = null;
    electricity.unit = null;
    electricity.year = null;
    electricity.reason = { zh: "已核查无数据", en: "Checked; no data" };
    current.reviewReport.status = "blocked";
    current.reviewReport.publicationRecommendation = "do-not-publish";
    current.reviewReport.missingFields = [
      "marketOverview.basicProfile.categories.energyAccess.fields.electricityAccess",
    ];
    const conflictFactIds = current.extractedFacts.facts.slice(0, 2).map(({ factId }) => factId);
    current.reviewReport.conflicts = [{
      fieldPath: "marketOverview.basicProfile.categories.electricityMarket.fields.annualElectricitySales",
      factIds: conflictFactIds,
      resolution: "unresolved",
      notes: "<script>conflict</script>",
    }];
    const previous = structuredClone(
      bundle.marketOverviewDraft.basicProfile,
    ) as Mutable<BasicCollectionAuditBundleV3["marketOverviewDraft"]["basicProfile"]>;
    previous.categories.electricityMarket.fields[0]!.value = 99;

    const model = createBasicReviewModel({
      candidate: current, previousProfile: previous, candidateArtifactSha256: artifactHashes(),
    });

    expect(model.missing).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringContaining("electricityAccess"),
      checkedAt: "2026-07-09",
      reason: { zh: "已核查无数据", en: "Checked; no data" },
    }));
    expect(model.conflicts).toEqual([expect.objectContaining({
      notes: "<script>conflict</script>",
      values: conflictFactIds.map((factId) => expect.objectContaining({
        factId, normalizedValues: expect.any(Array),
      })),
    })]);
    expect(model.differences).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringContaining("annualElectricitySales"),
      change: "changed",
    }));
    expect(model.checklist.map(({ key }) => key)).toEqual([
      "sourcesReviewed", "missingReviewed", "conflictsResolved", "bilingualReviewed",
      "basicOnly", "aiIsolated", "humanApprovalRequired",
    ]);
    expect(model.checklist.find(({ key }) => key === "conflictsResolved")?.passed).toBe(false);
  });
});

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

function fixture(): BasicCollectionAuditBundleV3 {
  return createBasicCollectionAuditV3Fixture() as unknown as BasicCollectionAuditBundleV3;
}

function artifactHashes() {
  return {
    "source-register.json": "1".repeat(64),
    "extracted-facts.json": "2".repeat(64),
    "market-overview.draft.json": "3".repeat(64),
    "review-report.json": "4".repeat(64),
  } as const;
}
