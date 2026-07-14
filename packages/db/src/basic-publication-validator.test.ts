import { describe, expect, test } from "vitest";

import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import type {
  BasicCountryPublicationBlockerCode,
  BasicCountryPublicationValidationInput,
} from "./collection/basic-publication-contracts.js";
import {
  validateApprovedBasicCountryPublicationV2,
} from "./collection/basic-publication-validator.js";

type MutableRecord = Record<string, unknown>;
type Mutation = (input: MutableRecord) => void;
type MutationCase = readonly [string, Mutation];

const CANDIDATE_ARTIFACT_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;
const COUNTRY_FIELDS = ["code", "name", "summary", "region", "flagEmoji", "updatedAt"] as const;
const MARKET_FIELDS = [
  "overview",
  "population",
  "gdp",
  "gdpGrowth",
  "energyDemand",
  "renewableTarget",
  "keyIndicators",
  "source",
  "sourceUrl",
  "collectedAt",
  "updatedAt",
  "credibility",
  "reviewStatus",
  "countryCode",
  "industryTags",
  "techTags",
] as const;
const DEEP_MODULES = [
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chineseCompanies",
  "reports",
] as const;

describe("approved Basic v2 publication validator", () => {
  test("returns exact frozen canonical data without byte arrays or parser errors", () => {
    const fixture = createBasicCountryPublicationFixture();
    const before = structuredClone(fixture.validationInput);

    const result = validateApprovedBasicCountryPublicationV2(fixture.validationInput);

    expect(result).toMatchObject({ valid: true, blockerCode: null });
    expect(result.data?.canonical).toEqual(fixture.canonical);
    expect(result.data?.canonical.marketOverview.reviewStatus).toBe("published");
    expect(result.data?.canonical.marketOverview.aiUsable).toBe(false);
    expect(result.data?.canonical.knowledge).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data?.canonical.marketOverview)).toBe(true);
    expect(result.data).not.toHaveProperty("approvalReceiptBytes");
    expect(result.data).not.toHaveProperty("candidateArtifactBytes");
    expect(result).not.toHaveProperty("errors");
    expect(fixture.validationInput).toEqual(before);
  });

  test.each([
    ["manifest shape", (input) => { record(input, "manifest").extra = true; }],
    ["manifest version", (input) => { record(input, "manifest").schemaVersion = "secret-version"; }],
  ] satisfies readonly MutationCase[])("blocks invalid %s first", (_label, mutate) => {
    expectBlocker("MANIFEST_INVALID", mutate);
  });

  test.each([
    ["receipt shape", (input) => { record(input, "approvalReceipt").extra = true; }],
    ["receipt lifecycle", (input) => {
      record(record(input, "approvalReceipt"), "submission").toReviewStatus = "secret-status";
    }],
  ] satisfies readonly MutationCase[])("blocks invalid %s first", (_label, mutate) => {
    expectBlocker("APPROVAL_RECEIPT_INVALID", mutate);
  });

  test("blocks changed approval receipt bytes", () => {
    expectBlocker("APPROVAL_RECEIPT_HASH_MISMATCH", (input) => {
      flipFirstByte(input, "approvalReceiptBytes");
    });
  });

  test.each(CANDIDATE_ARTIFACT_NAMES)("blocks changed %s bytes", (name) => {
    expectBlocker("CANDIDATE_ARTIFACT_HASH_MISMATCH", (input) => {
      const bytes = record(input, "candidateArtifactBytes")[name];
      if (!(bytes instanceof Uint8Array)) throw new Error("fixture bytes missing");
      bytes[0] = (bytes[0] ?? 0) ^ 1;
    });
  });

  test.each([
    ["input directory", (input) => { input.countryDirectory = "other-land"; }],
    ["receipt directory", (input) => { record(input, "approvalReceipt").countryDirectory = "other-land"; }],
    ["receipt country", (input) => { record(input, "approvalReceipt").countryCode = "ZZ"; }],
    ["manifest run", (input) => { record(input, "manifest").activeRunId = "other-run"; }],
    ["receipt run", (input) => { record(input, "approvalReceipt").runId = "other-run"; }],
    ["candidate run", (input) => { record(input, "candidate").runId = "other-run"; }],
    ["audit path", (input) => {
      record(input, "manifest").auditBundlePath = "data/staging/example-land/other-run";
    }],
    ["approval path", (input) => {
      record(input, "manifest").approvalReceiptPath = "data/approvals/example-land/other-run.json";
    }],
  ] satisfies readonly MutationCase[])("blocks %s identity drift", (_label, mutate) => {
    expectBlocker("PUBLICATION_IDENTITY_MISMATCH", mutate);
  });

  test.each([
    ["blocked candidate", (input) => {
      const report = record(record(input, "candidate"), "reviewReport");
      report.status = "blocked";
      report.publicationRecommendation = "do-not-publish";
    }],
    ["mixed-version candidate", (input) => {
      record(record(input, "candidate"), "sourceRegister").schemaVersion = "basic-country-audit/v1";
    }],
    ["malformed candidate", (input) => { input.candidate = null; }],
    ["candidate human decision", (input) => {
      record(record(input, "candidate"), "reviewReport").humanDecision = {
        decision: "approved",
        reviewerId: "secret-reviewer",
        decidedAt: "2026-07-11T00:00:00Z",
        notes: "secret-notes",
      };
    }],
    ["published candidate draft", (input) => {
      record(record(input, "candidate"), "marketOverviewDraft").reviewStatus = "published";
    }],
    ["AI-usable candidate draft", (input) => {
      record(record(input, "candidate"), "marketOverviewDraft").aiUsable = true;
    }],
  ] satisfies readonly MutationCase[])("blocks %s", (_label, mutate) => {
    expectBlocker("CANDIDATE_NOT_READY", mutate);
  });

  test.each([
    ["submission before source retrieval", (input) => {
      record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-09T06:00:00Z";
    }],
    ["submission before draft collection", (input) => {
      record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-08T23:59:59Z";
    }],
    ["decision before submission", (input) => {
      record(input, "approvalReceipt").decidedAt = "2026-07-09T23:59:59Z";
    }],
  ] satisfies readonly MutationCase[])("blocks %s", (_label, mutate) => {
    expectBlocker("APPROVAL_TIMESTAMP_INVALID", mutate);
  });

  test.each(COUNTRY_FIELDS)("blocks canonical country.%s mapping drift", (field) => {
    expectBlocker("CANONICAL_MAPPING_DRIFT", (input) => {
      record(record(input, "canonical"), "country")[field] = alternateValue(
        record(record(input, "canonical"), "country")[field],
      );
    });
  });

  test.each(MARKET_FIELDS)("blocks canonical marketOverview.%s mapping drift", (field) => {
    expectBlocker("CANONICAL_MAPPING_DRIFT", (input) => {
      record(record(input, "canonical"), "marketOverview")[field] = alternateValue(
        record(record(input, "canonical"), "marketOverview")[field],
      );
    });
  });

  test.each([
    ["coverage level", (input) => {
      record(record(input, "canonical"), "country").coverageLevel = "STANDARD";
    }],
    ["module coverage row", (input) => {
      const rows = record(record(input, "canonical"), "country").moduleCoverage;
      if (!Array.isArray(rows)) throw new Error("fixture coverage missing");
      record(rows[1], "coverage row").status = "PARTIAL";
    }],
    ["entry strategy", (input) => {
      record(input, "canonical").entryStrategy = { secret: "deep-value" };
    }],
  ] satisfies readonly MutationCase[])("blocks %s Basic coverage drift", (_label, mutate) => {
    expectBlocker("BASIC_COVERAGE_VIOLATION", mutate);
  });

  test.each(DEEP_MODULES)("blocks non-empty canonical %s", (moduleName) => {
    expectBlocker("BASIC_COVERAGE_VIOLATION", (input) => {
      record(input, "canonical")[moduleName] = [{ secret: "deep-value" }];
    });
  });

  test.each([
    ["AI-usable canonical market overview", (input) => {
      record(record(input, "canonical"), "marketOverview").aiUsable = true;
    }],
    ["canonical knowledge", (input) => {
      record(input, "canonical").knowledge = [{ secret: "knowledge-value" }];
    }],
  ] satisfies readonly MutationCase[])("blocks %s", (_label, mutate) => {
    expectBlocker("AI_BOUNDARY_VIOLATION", mutate);
  });

  test.each([
    ["extra canonical artifact", (input) => {
      array(input, "canonicalArtifactNames").push("secret.json");
    }],
    ["missing canonical artifact", (input) => {
      array(input, "canonicalArtifactNames").pop();
    }],
  ] satisfies readonly MutationCase[])("blocks %s", (_label, mutate) => {
    expectBlocker("PUBLICATION_READ_FAILED", mutate);
  });

  test("uses the specified first-blocker order", () => {
    const ordered: readonly BasicCountryPublicationBlockerCode[] = [
      "MANIFEST_INVALID",
      "APPROVAL_RECEIPT_INVALID",
      "PUBLICATION_IDENTITY_MISMATCH",
      "APPROVAL_RECEIPT_HASH_MISMATCH",
      "CANDIDATE_ARTIFACT_HASH_MISMATCH",
      "CANDIDATE_NOT_READY",
      "APPROVAL_TIMESTAMP_INVALID",
      "CANONICAL_MAPPING_DRIFT",
      "BASIC_COVERAGE_VIOLATION",
      "AI_BOUNDARY_VIOLATION",
      "PUBLICATION_READ_FAILED",
    ];
    const mutations: readonly Mutation[] = [
      (input) => { record(input, "manifest").extra = true; },
      (input) => { record(input, "approvalReceipt").extra = true; },
      (input) => { input.countryDirectory = "other-land"; },
      (input) => { flipFirstByte(input, "approvalReceiptBytes"); },
      (input) => {
        const bytes = record(input, "candidateArtifactBytes")["source-register.json"];
        if (!(bytes instanceof Uint8Array)) throw new Error("fixture bytes missing");
        bytes[0] = (bytes[0] ?? 0) ^ 1;
      },
      (input) => { input.candidate = null; },
      (input) => {
        record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-08T00:00:00Z";
      },
      (input) => { record(record(input, "canonical"), "country").name = { zh: "改", en: "Changed" }; },
      (input) => { record(record(input, "canonical"), "country").coverageLevel = "STANDARD"; },
      (input) => { record(record(input, "canonical"), "marketOverview").aiUsable = true; },
      (input) => { array(input, "canonicalArtifactNames").push("secret.json"); },
    ];

    for (let index = 0; index < ordered.length; index += 1) {
      const fixture = createBasicCountryPublicationFixture();
      const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
      for (const mutate of mutations.slice(index)) mutate(input);
      const result = validateApprovedBasicCountryPublicationV2(
        input as unknown as BasicCountryPublicationValidationInput,
      );
      expect(result.blockerCode).toBe(ordered[index]);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  test("fails closed on hostile input without exposing caller values", () => {
    const result = validateApprovedBasicCountryPublicationV2({
      countryDirectory: "secret-directory",
      manifest: new Proxy({}, { ownKeys: () => { throw new Error("secret-proxy"); } }),
      approvalReceipt: null,
      approvalReceiptBytes: null,
      candidate: null,
      candidateArtifactBytes: null,
      canonical: null,
      canonicalArtifactNames: null,
    });

    expect(result).toEqual({ valid: false, blockerCode: "MANIFEST_INVALID", data: null });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(Object.isFrozen(result)).toBe(true);
  });

  test.each([
    ["manifest", "MANIFEST_INVALID"],
    ["approvalReceipt", "APPROVAL_RECEIPT_INVALID"],
    ["countryDirectory", "PUBLICATION_IDENTITY_MISMATCH"],
    ["approvalReceiptBytes", "APPROVAL_RECEIPT_HASH_MISMATCH"],
    ["candidateArtifactBytes", "CANDIDATE_ARTIFACT_HASH_MISMATCH"],
    ["candidate", "CANDIDATE_NOT_READY"],
    ["canonical", "CANONICAL_MAPPING_DRIFT"],
    ["canonicalArtifactNames", "PUBLICATION_READ_FAILED"],
  ] as const)("maps a throwing %s input getter to its earliest blocker", (key, blockerCode) => {
    const fixture = createBasicCountryPublicationFixture();
    const input = structuredClone(fixture.validationInput);
    Object.defineProperty(input, key, {
      enumerable: true,
      get: () => { throw new Error("secret-getter-value"); },
    });

    const result = validateApprovedBasicCountryPublicationV2(input);

    expect(result).toEqual({ valid: false, blockerCode, data: null });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

function expectBlocker(
  blockerCode: BasicCountryPublicationBlockerCode,
  mutate: Mutation,
): void {
  const fixture = createBasicCountryPublicationFixture();
  const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
  const before = structuredClone(input);
  mutate(input);
  const mutated = structuredClone(input);

  const result = validateApprovedBasicCountryPublicationV2(
    input as unknown as BasicCountryPublicationValidationInput,
  );

  expect(result).toEqual({ valid: false, blockerCode, data: null });
  expect(Object.isFrozen(result)).toBe(true);
  expect(input).toEqual(mutated);
  expect(input).not.toEqual(before);
  expect(JSON.stringify(result)).not.toContain("secret");
}

function record(value: unknown, label: string): MutableRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} fixture record missing`);
  }
  const container = value as MutableRecord;
  const nested = container[label];
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    return nested as MutableRecord;
  }
  return container;
}

function array(value: MutableRecord, key: string): unknown[] {
  const result = value[key];
  if (!Array.isArray(result)) throw new Error(`${key} fixture array missing`);
  return result;
}

function flipFirstByte(input: MutableRecord, key: string): void {
  const bytes = input[key];
  if (!(bytes instanceof Uint8Array)) throw new Error(`${key} fixture bytes missing`);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
}

function alternateValue(value: unknown): unknown {
  if (typeof value === "string") return `${value}-changed`;
  if (typeof value === "number") return value + 1;
  if (value === null) return "https://example.com/changed";
  if (typeof value === "object") return structuredClone(value) instanceof Array
    ? [...structuredClone(value as unknown[]), structuredClone((value as unknown[])[0])]
    : { ...structuredClone(value as MutableRecord), en: "Changed" };
  throw new Error("fixture value cannot be changed");
}
