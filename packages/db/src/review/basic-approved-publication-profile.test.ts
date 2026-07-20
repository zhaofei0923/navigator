import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { loadApprovedPreviousBasicProfileVersioned } from "./basic-approved-publication-profile.js";

describe("approved previous BASIC publication profile", () => {
  test("accepts the complete approved v2 publication through the versioned seam", () => {
    const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

    expect(loadApprovedPreviousBasicProfileVersioned(repoRoot, "indonesia")).toBeNull();
  });
});
