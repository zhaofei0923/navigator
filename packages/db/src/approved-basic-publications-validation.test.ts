import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";
import { validateApprovedBasicCountryPublications } from "./seed/approved-basic-publications-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);

describe("approved Basic publications build validation", () => {
  test("validates every canonical country directory through the publication gate", () => {
    expect(validateApprovedBasicCountryPublications(REPO_ROOT)).toEqual({
      countryDirectories: [
        "brazil",
        "indonesia",
        "saudi-arabia",
        "united-arab-emirates",
        "vietnam",
      ],
      countryCodes: ["BR", "ID", "SA", "AE", "VN"],
    });
  });

  test("fails closed when a canonical directory has no approved publication", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "navigator-publications-"));
    try {
      mkdirSync(join(repoRoot, "data"));
      mkdirSync(join(repoRoot, "data", "unapproved-country"));

      expect(() => validateApprovedBasicCountryPublications(repoRoot)).toThrow(
        "Approved Basic publication validation failed: unapproved-country:PUBLICATION_READ_FAILED",
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("fails closed when two approved directories claim the same ISO2 code", () => {
    const publication = loadApprovedBasicCountryPublicationV2(
      REPO_ROOT,
      "indonesia",
    );
    expect(publication.valid).toBe(true);

    const repoRoot = mkdtempSync(join(tmpdir(), "navigator-publications-"));
    try {
      mkdirSync(join(repoRoot, "data"));
      mkdirSync(join(repoRoot, "data", "country-a"));
      mkdirSync(join(repoRoot, "data", "country-b"));

      expect(() =>
        validateApprovedBasicCountryPublications(
          repoRoot,
          () => publication,
        ),
      ).toThrow("Approved Basic publication country code is duplicated");
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });
});
