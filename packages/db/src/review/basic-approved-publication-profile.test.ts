import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { writeBasicCountryPublicationV3RepositoryFixture } from "../basic-publication-v3-test-fixture.js";
import { loadApprovedPreviousBasicProfileVersioned } from "./basic-approved-publication-profile.js";

describe("approved previous BASIC publication profile", () => {
  test("accepts the complete approved v2 publication through the versioned seam", () => {
    const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

    expect(loadApprovedPreviousBasicProfileVersioned(repoRoot, "indonesia")).toBeNull();
  });

  test("loads the approved profile from a v3 publication", () => {
    const fixture = writeBasicCountryPublicationV3RepositoryFixture();
    try {
      expect(loadApprovedPreviousBasicProfileVersioned(
        fixture.root,
        fixture.countryDirectory,
      )).toEqual(fixture.publication.canonical.marketOverview.basicProfile);
    } finally {
      fixture.cleanup();
    }
  });
});
