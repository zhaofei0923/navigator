import { describe, expect, test } from "vitest";

import { isBasicReviewPackTemporaryName } from "./basic-review-pack-temp-cleanup.js";

describe("BASIC review pack temporary cleanup boundary", () => {
  test("accepts only the private random review temporary name format", () => {
    expect(isBasicReviewPackTemporaryName(
      ".review-123e4567-e89b-42d3-a456-426614174000.tmp",
    )).toBe(true);
    expect(isBasicReviewPackTemporaryName("review")).toBe(false);
    expect(isBasicReviewPackTemporaryName(".review-known.tmp")).toBe(false);
    expect(isBasicReviewPackTemporaryName("../.review-123e4567-e89b-42d3-a456-426614174000.tmp"))
      .toBe(false);
  });
});
