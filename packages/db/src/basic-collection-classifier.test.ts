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
      firstEvidence(factFor(bundle, "marketOverview.credibility")).normalizedValue =
        "UNVERIFIED";
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

  test("does not fail open when sources, facts, and source checks are empty", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.sourceRegister.sources = [];
    bundle.extractedFacts.facts = [];
    bundle.reviewReport.sourceChecks = [];
    setBlocked(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);

    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual(["MISSING_REQUIRED_FACT"]);
  });

  test("returns MISSING_REQUIRED_FACT when one required path is absent", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.extractedFacts.facts = bundle.extractedFacts.facts.filter(
      ({ fieldPath }) => fieldPath !== "country.summary",
    );
    setBlocked(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);

    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual(["MISSING_REQUIRED_FACT"]);
  });

  test("rejects duplicate extracted-fact field paths as a structural error", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.extractedFacts.facts.push({
      ...firstFact(bundle),
      factId: "fact-duplicate-path",
      evidence: firstFact(bundle).evidence.map((item) => ({ ...item })),
    });

    expectInvalid(
      bundle,
      "extractedFacts.facts[24].fieldPath duplicates extractedFacts.facts[0].fieldPath",
    );
  });

  test("rejects evidence whose locator is not exactly registered by its source", () => {
    const bundle = createBasicCollectionAuditFixture();
    firstSource(bundle).evidenceLocators = ["table 1"];
    firstEvidence(bundle).locator = "table 1 ";

    expectInvalid(
      bundle,
      "extractedFacts.facts[0].evidence[0].locator must match a registered evidenceLocator for source-1",
    );
  });

  test("rejects a candidate normalizedValue that differs from its draft path", () => {
    const bundle = createBasicCollectionAuditFixture();
    const fact = factFor(bundle, "marketOverview.gdp");
    fact.evidence[0]!.normalizedValue = 1;

    expectInvalid(
      bundle,
      "extractedFacts.facts[8].evidence[0].normalizedValue must deeply equal marketOverviewDraft.gdp",
    );
  });

  test("returns UNTRUSTED_INPUT when an evidence source has no passed source check", () => {
    const bundle = createBasicCollectionAuditFixture();
    bundle.reviewReport.sourceChecks = bundle.reviewReport.sourceChecks.filter(
      ({ sourceId }) => sourceId !== "source-1",
    );
    setBlocked(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);

    expect(result).toMatchObject({ valid: true, readyForHumanReview: false });
    expect(result.blockers).toEqual(["UNTRUSTED_INPUT"]);
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
    ["no blocker cross-pairs blocked with request-human-review", (bundle: Fixture) => {
      bundle.reviewReport.status = "blocked";
    }, "reviewReport.status and reviewReport.publicationRecommendation must use an allowed no-blocker pairing", []],
    ["no blocker cross-pairs ready-for-human-review with do-not-publish", (bundle: Fixture) => {
      bundle.reviewReport.publicationRecommendation = "do-not-publish";
    }, "reviewReport.status and reviewReport.publicationRecommendation must use an allowed no-blocker pairing", []],
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

  test("allows a conservative blocked/do-not-publish report without blockers", () => {
    const bundle = createBasicCollectionAuditFixture();
    setBlocked(bundle);

    const result = validateBasicCollectionAuditBundle(bundle);

    expect(result).toMatchObject({
      valid: true,
      blockers: [],
      readyForHumanReview: false,
    });
  });

  test("deduplicates combined blockers in contract order", () => {
    const bundle = createBasicCollectionAuditFixture();
    firstFact(bundle).status = "missing";
    firstFact(bundle).evidence = [];
    const conflictFact = factFor(bundle, "country.code");
    conflictFact.status = "conflict";
    conflictFact.evidence = [
      firstEvidenceFromSource("source-1"),
      firstEvidenceFromSource("source-2"),
    ];
    const untrustedFact = factFor(bundle, "country.name");
    untrustedFact.status = "untrusted";
    untrustedFact.evidence = [firstEvidenceFromSource("source-1")];
    bundle.reviewReport.missingFields = ["country.summary"];
    bundle.reviewReport.conflicts = [
      {
        fieldPath: "country.code",
        factIds: [conflictFact.factId],
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

function factFor(bundle: Fixture, fieldPath: string) {
  const fact = bundle.extractedFacts.facts.find(
    (candidate) => candidate.fieldPath === fieldPath,
  );
  if (fact === undefined) throw new Error(`fixture fact ${fieldPath} is required`);
  return fact;
}

function firstEvidence(bundleOrFact: Fixture | ReturnType<typeof firstFact>) {
  const fact = "extractedFacts" in bundleOrFact
    ? firstFact(bundleOrFact)
    : bundleOrFact;
  const evidence = fact.evidence[0];
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
