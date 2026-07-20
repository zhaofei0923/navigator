import { describe, expect, test } from "vitest";

import { createBasicCountryPublicationV3Fixture } from "./basic-publication-v3-test-fixture.js";
import {
  parseBasicCountryPublicationManifestV3,
} from "./collection/basic-publication-parser.js";
import {
  validateApprovedBasicCountryPublicationV3,
} from "./collection/basic-publication-validator-v3.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";

describe("approved Basic v3 publication validator", () => {
  test("accepts the exact four-file v3 candidate and preserves its profile", () => {
    const fixture = createBasicCountryPublicationV3Fixture();

    const result = validateApprovedBasicCountryPublicationV3(
      fixture.validationInput,
    );

    expect(result).toMatchObject({ valid: true, blockerCode: null });
    expect(result.data?.canonical.marketOverview.basicProfile).toEqual(
      fixture.candidate.marketOverviewDraft.basicProfile,
    );
    expect(result.data?.canonical.marketOverview.reviewStatus).toBe("published");
    expect(result.data?.canonical.marketOverview.aiUsable).toBe(false);
    expect(result.data?.canonical.knowledge).toEqual([]);
  });

  test("parses only the exact v3 manifest literals", () => {
    const fixture = createBasicCountryPublicationV3Fixture();
    expect(parseBasicCountryPublicationManifestV3(fixture.manifest).data)
      .toEqual(fixture.manifest);
    expect(parseBasicCountryPublicationManifestV3({
      ...fixture.manifest,
      mappingVersion: "basic-country-canonical/v2",
    }).data).toBeNull();
  });

  test("binds receipt hashes to the exact v3 candidate bytes", () => {
    const fixture = createBasicCountryPublicationV3Fixture();
    const bytes = structuredClone(fixture.candidateArtifactBytes);
    bytes["market-overview.draft.json"][0] =
      (bytes["market-overview.draft.json"][0] ?? 0) ^ 1;

    expect(validateApprovedBasicCountryPublicationV3({
      ...fixture.validationInput,
      candidateArtifactBytes: bytes,
    })).toMatchObject({
      valid: false,
      blockerCode: "CANDIDATE_ARTIFACT_HASH_MISMATCH",
    });
  });

  test("requires the approved v3 candidate itself to remain draft and AI-isolated", () => {
    const fixture = createBasicCountryPublicationV3Fixture();
    const candidate = structuredClone(fixture.candidate);
    const market = candidate.marketOverviewDraft as unknown as Record<string, unknown>;
    market.reviewStatus = "published";
    const candidateArtifactBytes = {
      ...fixture.candidateArtifactBytes,
      "market-overview.draft.json": new TextEncoder().encode(
        `${JSON.stringify(candidate.marketOverviewDraft)}\n`,
      ),
    };
    const approvalReceipt = structuredClone(fixture.approvalReceipt);
    (approvalReceipt.artifactSha256 as Record<string, string>)[
      "market-overview.draft.json"
    ] = sha256Hex(candidateArtifactBytes["market-overview.draft.json"]);
    const approvalReceiptBytes = new TextEncoder().encode(
      `${JSON.stringify(approvalReceipt)}\n`,
    );
    const manifest = {
      ...fixture.manifest,
      approvalReceiptSha256: sha256Hex(approvalReceiptBytes),
    };

    expect(validateApprovedBasicCountryPublicationV3({
      ...fixture.validationInput,
      manifest,
      approvalReceipt,
      approvalReceiptBytes,
      candidate,
      candidateArtifactBytes,
    })).toMatchObject({ valid: false, blockerCode: "CANDIDATE_NOT_READY" });
  });

  test("blocks profile mapping drift", () => {
    const fixture = createBasicCountryPublicationV3Fixture();
    const canonical = structuredClone(fixture.canonical);
    const profile = canonical.marketOverview.basicProfile as unknown as
      Record<string, unknown>;
    profile.updatedAt = "2026-07-12T00:00:00Z";

    expect(validateApprovedBasicCountryPublicationV3({
      ...fixture.validationInput,
      canonical,
    })).toMatchObject({ valid: false, blockerCode: "CANONICAL_MAPPING_DRIFT" });
  });

  test.each([
    ["non-BASIC coverage", (canonical: Record<string, unknown>) => {
      (canonical.country as Record<string, unknown>).coverageLevel = "STANDARD";
    }, "BASIC_COVERAGE_VIOLATION"],
    ["deep module", (canonical: Record<string, unknown>) => {
      canonical.policy = [{ id: "forbidden" }];
    }, "BASIC_COVERAGE_VIOLATION"],
    ["AI usable", (canonical: Record<string, unknown>) => {
      (canonical.marketOverview as Record<string, unknown>).aiUsable = true;
    }, "AI_BOUNDARY_VIOLATION"],
    ["knowledge", (canonical: Record<string, unknown>) => {
      canonical.knowledge = [{ id: "forbidden" }];
    }, "AI_BOUNDARY_VIOLATION"],
  ] as const)("blocks %s", (_label, mutate, blockerCode) => {
    const fixture = createBasicCountryPublicationV3Fixture();
    const canonical = structuredClone(fixture.canonical);
    mutate(canonical as unknown as Record<string, unknown>);
    expect(validateApprovedBasicCountryPublicationV3({
      ...fixture.validationInput,
      canonical,
    })).toMatchObject({ valid: false, blockerCode });
  });

  test("keeps all canonical artifacts constrained to the exact three files", () => {
    const fixture = createBasicCountryPublicationV3Fixture();
    expect(validateApprovedBasicCountryPublicationV3({
      ...fixture.validationInput,
      canonicalArtifactNames: [
        "collection-manifest.json",
        "country.json",
        "market-overview.json",
        "policy.json",
      ],
    })).toMatchObject({ valid: false, blockerCode: "PUBLICATION_READ_FAILED" });
  });
});
