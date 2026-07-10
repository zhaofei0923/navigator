import { describe, expect, test } from "vitest";

import { createBasicCountryBundle } from "./seed/basic-country-template.js";
import { createReviewedInput } from "./basic-country-test-fixture.js";

describe("Basic country template", () => {
  test("creates a Basic bundle with only market overview coverage", () => {
    const bundle = createBasicCountryBundle(createReviewedInput());

    expect(bundle.canonical.country.coverageLevel).toBe("BASIC");
    expect(bundle.canonical.country.moduleCoverage).toHaveLength(10);
    expect(bundle.canonical.country.moduleCoverage).toContainEqual(
      expect.objectContaining({
        moduleKey: "market-overview",
        status: expect.stringMatching(/PARTIAL|COMPLETE/),
        dataCount: 1,
      }),
    );
    expect(bundle.canonical.entryStrategy).toBeNull();
    expect(bundle.canonical.policy).toEqual([]);
    expect(bundle.canonical.knowledge).toEqual([]);
  });

  test("rejects market overviews that cannot enter a Basic bundle", () => {
    const unpublished = createReviewedInput();
    unpublished.marketOverview.reviewStatus = "draft";
    expect(() => createBasicCountryBundle(unpublished)).toThrow(
      "marketOverview.reviewStatus must be published",
    );

    const unverified = createReviewedInput();
    unverified.marketOverview.credibility = "UNVERIFIED";
    expect(() => createBasicCountryBundle(unverified)).toThrow(
      "marketOverview.credibility must not be UNVERIFIED",
    );

    const aiUsable = createReviewedInput();
    aiUsable.marketOverview.aiUsable = true;
    expect(() => createBasicCountryBundle(aiUsable)).toThrow(
      "marketOverview.aiUsable must be false",
    );
  });
});
