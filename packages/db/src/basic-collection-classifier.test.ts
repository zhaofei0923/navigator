import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { validateBasicCollectionAuditBundle } from "./collection/basic-collection-validator.js";

type Fixture = ReturnType<typeof createBasicCollectionAuditFixture>;

describe("Basic collection audit classifier", () => {
  test.each([
    ["an untrusted fact", (bundle: Fixture) => {
      firstFact(bundle).status = "untrusted";
      setBlocked(bundle);
    }],
    ["a discovery-only source", (bundle: Fixture) => {
      firstSource(bundle).discoveryOnly = true;
      setBlocked(bundle);
    }],
    ["a restricted source", (bundle: Fixture) => {
      firstSource(bundle).accessStatus = "restricted";
      setBlocked(bundle);
    }],
    ["a source with unknown access", (bundle: Fixture) => {
      firstSource(bundle).accessStatus = "unknown";
      setBlocked(bundle);
    }],
    ["an unverified source", (bundle: Fixture) => {
      firstSource(bundle).credibility = "UNVERIFIED";
      setBlocked(bundle);
    }],
    ["an unverified market overview draft", (bundle: Fixture) => {
      bundle.marketOverviewDraft.credibility = "UNVERIFIED";
      setBlocked(bundle);
    }],
    ["a suspected source prompt-injection risk", (bundle: Fixture) => {
      firstSource(bundle).promptInjectionRisk = "suspected";
      setBlocked(bundle);
    }],
    ["a confirmed source prompt-injection risk", (bundle: Fixture) => {
      firstSource(bundle).promptInjectionRisk = "confirmed";
      setBlocked(bundle);
    }],
    ["a failed source check", (bundle: Fixture) => {
      bundle.reviewReport.sourceChecks = [
        { sourceId: "source-1", status: "failed", notes: "Integrity failed" },
      ];
      setBlocked(bundle);
    }],
    ["an injection-risk report entry", (bundle: Fixture) => {
      bundle.reviewReport.injectionRisks = [
        {
          sourceId: "source-1",
          locator: "page 1",
          severity: "suspected",
          details: "Instruction-like text detected",
        },
      ];
      setBlocked(bundle);
    }],
  ])("returns UNTRUSTED_INPUT for %s", (_name, mutate) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual(["UNTRUSTED_INPUT"]);
  });

  test.each([
    ["a missing fact", (bundle: Fixture) => {
      firstFact(bundle).status = "missing";
      firstFact(bundle).evidence = [];
      setBlocked(bundle);
    }, "MISSING_REQUIRED_FACT"],
    ["a listed missing field", (bundle: Fixture) => {
      bundle.reviewReport.missingFields = ["country.summary"];
      setBlocked(bundle);
    }, "MISSING_REQUIRED_FACT"],
    ["a conflict fact", (bundle: Fixture) => {
      firstFact(bundle).status = "conflict";
      firstFact(bundle).evidence.push({ ...firstEvidence(bundle), sourceId: "source-2" });
      setBlocked(bundle);
    }, "UNRESOLVED_CONFLICT"],
    ["an unresolved report conflict", (bundle: Fixture) => {
      bundle.reviewReport.conflicts = [
        {
          fieldPath: "marketOverview.population",
          factIds: ["fact-1"],
          resolution: "unresolved",
          notes: "Needs human resolution",
        },
      ];
      setBlocked(bundle);
    }, "UNRESOLVED_CONFLICT"],
  ] as const)("returns %s blocker for %s", (_name, mutate, blocker) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual([blocker]);
  });

  test.each([
    ["evidence", (bundle: Fixture) => {
      firstEvidence(bundle).sourceId = "missing-source";
    }, "extractedFacts.facts[0].evidence[0].sourceId must reference a registered sourceId"],
    ["conflict", (bundle: Fixture) => {
      bundle.reviewReport.conflicts = [
        {
          fieldPath: "marketOverview.population",
          factIds: ["missing-fact"],
          resolution: "resolved",
          notes: "Reference is invalid",
        },
      ];
    }, "reviewReport.conflicts[0].factIds[0] must reference a registered factId"],
    ["source check", (bundle: Fixture) => {
      bundle.reviewReport.sourceChecks = [
        { sourceId: "missing-source", status: "passed", notes: null },
      ];
    }, "reviewReport.sourceChecks[0].sourceId must reference a registered sourceId"],
    ["injection risk", (bundle: Fixture) => {
      bundle.reviewReport.injectionRisks = [
        {
          sourceId: "missing-source",
          locator: "page 1",
          severity: "confirmed",
          details: "Untrusted source reference",
        },
      ];
      setBlocked(bundle);
    }, "reviewReport.injectionRisks[0].sourceId must reference a registered sourceId"],
  ] as const)("rejects an invalid %s source or fact reference", (_name, mutate, error) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    expectInvalid(bundle, error);
  });

  test.each([
    ["no blocker has a blocked status", (bundle: Fixture) => {
      bundle.reviewReport.status = "blocked";
    }, "reviewReport.status must be ready-for-human-review when no blockers exist", []],
    ["no blocker has a do-not-publish recommendation", (bundle: Fixture) => {
      bundle.reviewReport.publicationRecommendation = "do-not-publish";
    }, "reviewReport.publicationRecommendation must be request-human-review when no blockers exist", []],
    ["a blocker has a ready status", (bundle: Fixture) => {
      firstSource(bundle).discoveryOnly = true;
      bundle.reviewReport.publicationRecommendation = "do-not-publish";
    }, "reviewReport.status must be blocked when blockers exist", ["UNTRUSTED_INPUT"]],
    ["a blocker has a request-human-review recommendation", (bundle: Fixture) => {
      firstSource(bundle).discoveryOnly = true;
      bundle.reviewReport.status = "blocked";
    }, "reviewReport.publicationRecommendation must be do-not-publish when blockers exist", ["UNTRUSTED_INPUT"]],
  ] as const)("rejects when %s", (_name, mutate, error, blockers) => {
    const bundle = createBasicCollectionAuditFixture();
    mutate(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result).toMatchObject({ valid: false, data: null, blockers });
    expect(result.errors).toContain(error);
  });

  test("deduplicates combined blockers in contract order", () => {
    const bundle = createBasicCollectionAuditFixture();
    firstFact(bundle).status = "missing";
    firstFact(bundle).evidence = [];
    bundle.extractedFacts.facts.push(
      {
        ...firstFact(bundle),
        factId: "fact-2",
        status: "conflict",
        evidence: [
          { ...firstEvidenceFromSource("source-1"), sourceId: "source-1" },
          { ...firstEvidenceFromSource("source-2"), sourceId: "source-2" },
        ],
      },
      {
        ...firstFact(bundle),
        factId: "fact-3",
        status: "untrusted",
        evidence: [firstEvidenceFromSource("source-1")],
      },
    );
    bundle.reviewReport.missingFields = ["country.summary"];
    bundle.reviewReport.conflicts = [
      {
        fieldPath: "marketOverview.population",
        factIds: ["fact-2"],
        resolution: "unresolved",
        notes: "Needs human resolution",
      },
    ];
    bundle.reviewReport.sourceChecks = [
      { sourceId: "source-1", status: "failed", notes: "Integrity failed" },
    ];
    setBlocked(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);
    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual([
      "MISSING_REQUIRED_FACT",
      "UNRESOLVED_CONFLICT",
      "UNTRUSTED_INPUT",
    ]);
  });
});

function firstSource(bundle: Fixture) {
  const source = bundle.sourceRegister.sources[0];
  if (source === undefined) throw new Error("fixture source is required");
  return source;
}

function firstFact(bundle: Fixture) {
  const fact = bundle.extractedFacts.facts[0];
  if (fact === undefined) throw new Error("fixture fact is required");
  return fact;
}

function firstEvidence(bundle: Fixture) {
  const evidence = firstFact(bundle).evidence[0];
  if (evidence === undefined) throw new Error("fixture evidence is required");
  return evidence;
}

function firstEvidenceFromSource(sourceId: string) {
  return {
    sourceId,
    locator: "table 1",
    rawValue: 1000000,
    normalizedValue: 1000000,
    unit: "people",
    year: 2025,
  };
}

function setBlocked(bundle: Fixture): void {
  bundle.reviewReport.status = "blocked";
  bundle.reviewReport.publicationRecommendation = "do-not-publish";
}

function expectInvalid(value: unknown, error: string): void {
  const result = validateBasicCollectionAuditBundle(value);
  expect(result).toMatchObject({ valid: false, data: null });
  expect(result.errors).toContain(error);
}
