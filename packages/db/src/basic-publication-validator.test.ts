import { describe, expect, test } from "vitest";

import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import type {
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationBlockerCode,
  BasicCountryPublicationValidationInput,
} from "./collection/basic-publication-contracts.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
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
    ["receipt shape", (input) => {
      record(input, "approvalReceipt").extra = true;
      refreshReceiptBytes(input);
    }],
    ["receipt lifecycle", (input) => {
      record(record(input, "approvalReceipt"), "submission").toReviewStatus = "secret-status";
      refreshReceiptBytes(input);
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
    ["extra", (input: MutableRecord) => {
      record(input, "candidateArtifactBytes")["unexpected.json"] = new Uint8Array();
    }],
    ["missing", (input: MutableRecord) => {
      delete record(input, "candidateArtifactBytes")["source-register.json"];
    }],
  ] satisfies readonly MutationCase[])("blocks a candidate byte map with an %s key set", (
    _label,
    mutate,
  ) => {
    expectBlocker("CANDIDATE_ARTIFACT_HASH_MISMATCH", mutate);
  });

  test.each([
    ["input directory", (input) => { input.countryDirectory = "other-land"; }],
    ["receipt directory", (input) => {
      record(input, "approvalReceipt").countryDirectory = "other-land";
      refreshReceiptBytes(input);
    }],
    ["receipt country", (input) => {
      record(input, "approvalReceipt").countryCode = "ZZ";
      refreshReceiptBytes(input);
    }],
    ["manifest run", (input) => { record(input, "manifest").activeRunId = "other-run"; }],
    ["receipt run", (input) => {
      record(input, "approvalReceipt").runId = "other-run";
      refreshReceiptBytes(input);
    }],
    ["candidate run", (input) => {
      record(input, "candidate").runId = "other-run";
      refreshCandidateApproval(input);
    }],
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
      refreshCandidateApproval(input);
    }],
    ["mixed-version candidate", (input) => {
      record(record(input, "candidate"), "sourceRegister").schemaVersion = "basic-country-audit/v1";
      refreshCandidateApproval(input);
    }],
    ["malformed candidate", (input) => {
      setCandidateArtifactBytes(input, "source-register.json", new TextEncoder().encode("{"));
      refreshApprovalForCandidateBytes(input);
    }],
    ["candidate human decision", (input) => {
      record(record(input, "candidate"), "reviewReport").humanDecision = {
        decision: "approved",
        reviewerId: "secret-reviewer",
        decidedAt: "2026-07-11T00:00:00Z",
        notes: "secret-notes",
      };
      refreshCandidateApproval(input);
    }],
    ["published candidate draft", (input) => {
      record(record(input, "candidate"), "marketOverviewDraft").reviewStatus = "published";
      refreshCandidateApproval(input);
    }],
    ["AI-usable candidate draft", (input) => {
      record(record(input, "candidate"), "marketOverviewDraft").aiUsable = true;
      refreshCandidateApproval(input);
    }],
  ] satisfies readonly MutationCase[])("blocks %s", (_label, mutate) => {
    expectBlocker("CANDIDATE_NOT_READY", mutate);
  });

  test.each([
    ["submission before source retrieval", (input) => {
      record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-09T06:00:00Z";
      refreshReceiptBytes(input);
    }],
    ["submission before draft collection", (input) => {
      record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-08T23:59:59Z";
      refreshReceiptBytes(input);
    }],
    ["decision before submission", (input) => {
      record(input, "approvalReceipt").decidedAt = "2026-07-09T23:59:59Z";
      refreshReceiptBytes(input);
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

  test("rejects a supplied receipt whose reviewer differs from the approved bytes", () => {
    expectBlocker("APPROVAL_RECEIPT_HASH_MISMATCH", (input) => {
      record(input, "approvalReceipt").reviewerId = "secret-substituted-reviewer";
    });
  });

  test("rejects a supplied candidate and matching canonical that differ from approved bytes", () => {
    expectBlocker("CANDIDATE_ARTIFACT_HASH_MISMATCH", (input) => {
      const replacement = { zh: "替换摘要", en: "Substituted summary" };
      const fact = candidateFact(input, "country.summary");
      const evidence = array(fact, "evidence");
      for (const item of evidence) {
        const value = record(item, "summary evidence");
        value.rawValue = structuredClone(replacement);
        value.normalizedValue = structuredClone(replacement);
      }
      record(record(input, "canonical"), "country").summary = replacement;
    });
  });

  test.each([
    ["truncated JSON", new TextEncoder().encode("{")],
    ["invalid UTF-8", new Uint8Array([0xff])],
  ] as const)("maps manifest-bound receipt bytes with %s to receipt invalid", (_label, malformed) => {
    expectBlocker("APPROVAL_RECEIPT_INVALID", (input) => {
      input.approvalReceiptBytes = malformed;
      record(input, "manifest").approvalReceiptSha256 = sha256Hex(malformed);
    });
  });

  test.each([
    ["truncated JSON", new TextEncoder().encode("{")],
    ["invalid UTF-8", new Uint8Array([0xff])],
  ] as const)("maps receipt-bound candidate bytes with %s to candidate not ready", (_label, malformed) => {
    expectBlocker("CANDIDATE_NOT_READY", (input) => {
      setCandidateArtifactBytes(
        input,
        "market-overview.draft.json",
        malformed,
      );
      refreshApprovalForCandidateBytes(input);
    });
  });

  test.each([
    ["cycle", (input: MutableRecord) => {
      const cycle: MutableRecord = {};
      cycle.self = cycle;
      candidateFact(input, "country.summary").uncertainty = cycle;
    }],
    ["nested accessor", (input: MutableRecord) => {
      Object.defineProperty(candidateFact(input, "country.summary"), "uncertainty", {
        enumerable: true,
        get: () => "secret-accessor",
      });
    }],
    ["nested proxy", (input: MutableRecord) => {
      candidateFact(input, "country.summary").uncertainty = new Proxy({}, {
        ownKeys: () => { throw new Error("secret-proxy"); },
      });
    }],
  ] satisfies readonly MutationCase[])(
    "rejects a supplied candidate containing a %s against valid approved bytes",
    (_label, mutate) => {
      const fixture = createBasicCountryPublicationFixture();
      const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
      mutate(input);

      const result = validateApprovedBasicCountryPublicationV2(
        input as unknown as BasicCountryPublicationValidationInput,
      );

      expect(result).toEqual({
        valid: false,
        blockerCode: "CANDIDATE_ARTIFACT_HASH_MISMATCH",
        data: null,
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    },
  );

  test.each([
    ["cycle", (canonical: MutableRecord) => { canonical.self = canonical; }],
    ["nested accessor", (canonical: MutableRecord) => {
      Object.defineProperty(record(canonical, "country"), "summary", {
        enumerable: true,
        get: () => ({ zh: "秘密", en: "Secret" }),
      });
    }],
    ["nested proxy", (canonical: MutableRecord) => {
      record(canonical, "country").summary = new Proxy({}, {
        ownKeys: () => { throw new Error("secret-proxy"); },
      });
    }],
  ] satisfies readonly (readonly [string, (canonical: MutableRecord) => void])[])(
    "maps canonical %s input to mapping drift without throwing",
    (_label, mutate) => {
      const fixture = createBasicCountryPublicationFixture();
      const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
      mutate(record(input, "canonical"));

      const result = validateApprovedBasicCountryPublicationV2(
        input as unknown as BasicCountryPublicationValidationInput,
      );

      expect(result).toEqual({
        valid: false,
        blockerCode: "CANONICAL_MAPPING_DRIFT",
        data: null,
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    },
  );

  test("copies Uint8Array subviews before validation and does not retain byte aliases", () => {
    const fixture = createBasicCountryPublicationFixture();
    const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
    const receiptSubview = subviewOf(bytes(input.approvalReceiptBytes, "receipt bytes"));
    input.approvalReceiptBytes = receiptSubview.view;
    const candidateBackings: Uint8Array[] = [];
    for (const name of CANDIDATE_ARTIFACT_NAMES) {
      const item = subviewOf(candidateBytes(input, name));
      candidateBackings.push(item.backing);
      setCandidateArtifactBytes(input, name, item.view);
    }

    const first = validateApprovedBasicCountryPublicationV2(
      input as unknown as BasicCountryPublicationValidationInput,
    );
    candidateBackings[0]![1] = (candidateBackings[0]![1] ?? 0) ^ 1;

    expect(first.valid).toBe(true);
    expect(first.data?.candidate).toEqual(fixture.candidate);
    expect(validateApprovedBasicCountryPublicationV2(
      input as unknown as BasicCountryPublicationValidationInput,
    ).blockerCode).toBe("CANDIDATE_ARTIFACT_HASH_MISMATCH");
  });

  test.each([
    ["detached receipt", "APPROVAL_RECEIPT_HASH_MISMATCH", (input: MutableRecord) => {
      input.approvalReceiptBytes = detachedView(bytes(input.approvalReceiptBytes, "receipt"));
    }],
    ["detached candidate", "CANDIDATE_ARTIFACT_HASH_MISMATCH", (input: MutableRecord) => {
      setCandidateArtifactBytes(
        input,
        "source-register.json",
        detachedView(candidateBytes(input, "source-register.json")),
      );
    }],
    ["shared receipt", "APPROVAL_RECEIPT_HASH_MISMATCH", (input: MutableRecord) => {
      input.approvalReceiptBytes = sharedView(bytes(input.approvalReceiptBytes, "receipt"));
    }],
    ["shared candidate", "CANDIDATE_ARTIFACT_HASH_MISMATCH", (input: MutableRecord) => {
      setCandidateArtifactBytes(
        input,
        "source-register.json",
        sharedView(candidateBytes(input, "source-register.json")),
      );
    }],
  ] as const)("rejects a %s byte view", (_label, blockerCode, mutate) => {
    const fixture = createBasicCountryPublicationFixture();
    const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
    mutate(input);

    const result = validateApprovedBasicCountryPublicationV2(
      input as unknown as BasicCountryPublicationValidationInput,
    );

    expect(result).toEqual({ valid: false, blockerCode, data: null });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("accepts semantically equal receipt and candidate JSON with reordered object keys", () => {
    const fixture = createBasicCountryPublicationFixture();
    const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
    for (const name of CANDIDATE_ARTIFACT_NAMES) {
      const value = JSON.parse(new TextDecoder().decode(candidateBytes(input, name))) as unknown;
      setCandidateArtifactBytes(input, name, encodeJson(reverseRecord(record(value, name))));
    }
    refreshApprovalForCandidateBytes(input);
    input.approvalReceiptBytes = encodeJson(reverseRecord(record(input, "approvalReceipt")));
    record(input, "manifest").approvalReceiptSha256 = sha256Hex(
      bytes(input.approvalReceiptBytes, "receipt"),
    );

    expect(validateApprovedBasicCountryPublicationV2(
      input as unknown as BasicCountryPublicationValidationInput,
    ).valid).toBe(true);
  });

  test("treats canonical -0 as distinct from approved positive-zero candidate data", () => {
    expectBlocker("CANONICAL_MAPPING_DRIFT", (input) => {
      record(record(input, "candidate"), "marketOverviewDraft").gdp = 0;
      const fact = candidateFact(input, "marketOverview.gdp");
      for (const item of array(fact, "evidence")) {
        const evidence = record(item, "gdp evidence");
        evidence.rawValue = 0;
        evidence.normalizedValue = 0;
      }
      refreshCandidateApproval(input);
      record(record(input, "canonical"), "marketOverview").gdp = -0;
    });
  });

  test.each([
    ["duplicate", (input: MutableRecord) => {
      array(record(record(input, "candidate"), "extractedFacts"), "facts")
        .push(structuredClone(candidateFact(input, "country.summary")));
    }],
    ["empty", (input: MutableRecord) => {
      candidateFact(input, "country.summary").evidence = [];
    }],
    ["divergent", (input: MutableRecord) => {
      const fact = candidateFact(input, "country.summary");
      const first = record(array(fact, "evidence")[0], "country evidence");
      array(fact, "evidence").push({
        ...structuredClone(first),
        sourceId: "source-2",
        normalizedValue: { zh: "分歧", en: "Divergent" },
      });
    }],
  ] satisfies readonly MutationCase[])("blocks %s country evidence", (_label, mutate) => {
    expectBlocker("CANDIDATE_NOT_READY", (input) => {
      mutate(input);
      refreshCandidateApproval(input);
    });
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
      (input) => {
        record(input, "approvalReceipt").extra = true;
        refreshReceiptBytes(input);
      },
      (input) => { input.countryDirectory = "other-land"; },
      (input) => { flipFirstByte(input, "approvalReceiptBytes"); },
      (input) => {
        const bytes = record(input, "candidateArtifactBytes")["source-register.json"];
        if (!(bytes instanceof Uint8Array)) throw new Error("fixture bytes missing");
        bytes[0] = (bytes[0] ?? 0) ^ 1;
      },
      (input) => {
        const report = record(record(input, "candidate"), "reviewReport");
        report.status = "blocked";
        report.publicationRecommendation = "do-not-publish";
        refreshCandidateApproval(input);
      },
      (input) => {
        record(record(input, "approvalReceipt"), "submission").submittedAt = "2026-07-08T00:00:00Z";
        refreshReceiptBytes(input);
      },
      (input) => { record(record(input, "canonical"), "country").name = { zh: "改", en: "Changed" }; },
      (input) => { record(record(input, "canonical"), "country").coverageLevel = "STANDARD"; },
      (input) => { record(record(input, "canonical"), "marketOverview").aiUsable = true; },
      (input) => { array(input, "canonicalArtifactNames").push("secret.json"); },
    ];

    for (let index = 0; index < ordered.length; index += 1) {
      const fixture = createBasicCountryPublicationFixture();
      const input = structuredClone(fixture.validationInput) as unknown as MutableRecord;
      for (const mutate of [...mutations.slice(index)].reverse()) mutate(input);
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
    ["candidate", "CANDIDATE_ARTIFACT_HASH_MISMATCH"],
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

function refreshCandidateApproval(input: MutableRecord): void {
  const candidate = record(input, "candidate");
  input.candidateArtifactBytes = {
    "source-register.json": encodeJson(candidate.sourceRegister),
    "extracted-facts.json": encodeJson(candidate.extractedFacts),
    "market-overview.draft.json": encodeJson(candidate.marketOverviewDraft),
    "review-report.json": encodeJson(candidate.reviewReport),
  };
  refreshApprovalForCandidateBytes(input);
}

function refreshApprovalForCandidateBytes(input: MutableRecord): void {
  const hashes = Object.fromEntries(CANDIDATE_ARTIFACT_NAMES.map((name) => [
    name,
    sha256Hex(candidateBytes(input, name)),
  ])) as BasicCountryPublicationApprovalReceipt["artifactSha256"];
  record(input, "approvalReceipt").artifactSha256 = hashes;
  refreshReceiptBytes(input);
}

function refreshReceiptBytes(input: MutableRecord): void {
  const receiptBytes = encodeJson(input.approvalReceipt);
  input.approvalReceiptBytes = receiptBytes;
  record(input, "manifest").approvalReceiptSha256 = sha256Hex(receiptBytes);
}

function encodeJson(value: unknown): Uint8Array {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("fixture JSON is not serializable");
  return new TextEncoder().encode(`${serialized}\n`);
}

function candidateBytes(
  input: MutableRecord,
  name: typeof CANDIDATE_ARTIFACT_NAMES[number],
): Uint8Array {
  return bytes(record(input, "candidateArtifactBytes")[name], name);
}

function setCandidateArtifactBytes(
  input: MutableRecord,
  name: typeof CANDIDATE_ARTIFACT_NAMES[number],
  value: Uint8Array,
): void {
  record(input, "candidateArtifactBytes")[name] = value;
}

function bytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} fixture bytes missing`);
  return value;
}

function candidateFact(input: MutableRecord, fieldPath: string): MutableRecord {
  const facts = array(record(record(input, "candidate"), "extractedFacts"), "facts");
  const fact = facts.find((item) => record(item, "fact").fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`${fieldPath} fixture fact missing`);
  return record(fact, fieldPath);
}

function subviewOf(value: Uint8Array): Readonly<{
  backing: Uint8Array;
  view: Uint8Array;
}> {
  const backing = new Uint8Array(value.byteLength + 2);
  backing.set(value, 1);
  return { backing, view: backing.subarray(1, value.byteLength + 1) };
}

function detachedView(value: Uint8Array): Uint8Array {
  const view = new Uint8Array(value);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
}

function sharedView(value: Uint8Array): Uint8Array {
  const view = new Uint8Array(new SharedArrayBuffer(value.byteLength));
  view.set(value);
  return view;
}

function reverseRecord(value: MutableRecord): MutableRecord {
  return Object.fromEntries(Object.entries(value).reverse());
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
