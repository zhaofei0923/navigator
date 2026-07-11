import { describe, expect, test } from "vitest";

import {
  BASIC_COUNTRY_CANONICAL_MAPPING_VERSION,
  createBasicCountryBundleFromApprovedAudit,
  validateApprovedBasicCountryPublication,
  type BasicApprovedCountryPublicationInput,
} from "./index.js";
import type { BasicCountryBundle, JsonRecord } from "./seed/basic-country-types.js";
import {
  createApprovedAuditBundle,
  createReviewedInput,
  createUnapprovedBundle,
  createValidBundle,
  getModuleCoverage,
  getRecord,
} from "./basic-country-test-fixture.js";

describe("approved Basic country publication", () => {
  test("accepts only the approved canonical Basic country bundle", () => {
    expect(
      validateApprovedBasicCountryPublication(createValidBundle()),
    ).toMatchObject({
      valid: true,
      errors: [],
      summary: { coverageLevel: "BASIC" },
    });
    expect(
      validateApprovedBasicCountryPublication(createUnapprovedBundle()).valid,
    ).toBe(false);
  });

  test.each([
    ["source register", "sourceRegister"],
    ["extracted facts", "extractedFacts"],
    ["market draft", "marketOverviewDraft"],
    ["review report", "reviewReport"],
  ] as const)("rejects a malformed %s audit object", (_label, field) => {
    const bundle = createValidBundle();
    bundle.audit.run[field] = { unexpected: true };
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test.each([
    ["MISSING_REQUIRED_FACT", "missing"],
    ["UNRESOLVED_CONFLICT", "conflict"],
    ["UNTRUSTED_INPUT", "untrusted"],
  ] as const)("rejects the %s blocker", (_blocker, status) => {
    const bundle = createValidBundle();
    firstFact(bundle).status = status;
    blockReview(bundle);
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test("rejects conservative blocked/do-not-publish without blockers", () => {
    const bundle = createValidBundle();
    blockReview(bundle);
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test.each([null, {
    decision: "rejected",
    reviewerId: "fixture-reviewer",
    decidedAt: "2026-07-11T00:00:00Z",
    notes: "Rejected fixture",
  }])("rejects a non-approved human decision", (humanDecision) => {
    const bundle = createValidBundle();
    reviewReport(bundle).humanDecision = humanDecision;
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test("rejects an unsupported canonical mapping version", () => {
    const bundle = createValidBundle();
    bundle.audit.manifest.mappingVersion = "basic-country-canonical/v2";
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test.each([
    ["directory", (bundle: BasicCountryBundle) => {
      bundle.countryDirectory = "thailand";
    }],
    ["source country", (bundle: BasicCountryBundle) => {
      auditRecord(bundle, "sourceRegister").countryCode = "TH";
    }],
    ["facts country", (bundle: BasicCountryBundle) => {
      auditRecord(bundle, "extractedFacts").countryCode = "TH";
    }],
    ["draft country", (bundle: BasicCountryBundle) => {
      auditRecord(bundle, "marketOverviewDraft").countryCode = "TH";
    }],
    ["review country", (bundle: BasicCountryBundle) => {
      reviewReport(bundle).countryCode = "TH";
    }],
    ["loader run", (bundle: BasicCountryBundle) => {
      bundle.audit.run.runId = "run-02";
    }],
    ["source run", (bundle: BasicCountryBundle) => {
      auditRecord(bundle, "sourceRegister").runId = "run-02";
    }],
    ["facts run", (bundle: BasicCountryBundle) => {
      auditRecord(bundle, "extractedFacts").runId = "run-02";
    }],
    ["review run", (bundle: BasicCountryBundle) => {
      reviewReport(bundle).runId = "run-02";
    }],
  ] as const)("rejects cross-%s identity", (_label, mutate) => {
    const bundle = createValidBundle();
    mutate(bundle);
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test("rejects duplicate and non-candidate country facts", () => {
    const duplicate = createValidBundle();
    const facts = factsArray(duplicate);
    facts.push({ ...firstFact(duplicate), factId: "duplicate-country-code" });
    expect(validateApprovedBasicCountryPublication(duplicate).valid).toBe(false);

    const nonCandidate = createValidBundle();
    firstFact(nonCandidate).status = "missing";
    blockReview(nonCandidate);
    expect(validateApprovedBasicCountryPublication(nonCandidate).valid).toBe(false);
  });

  test.each([
    ["code", "TH"],
    ["name", { zh: "泰国", en: "Thailand" }],
    ["summary", { zh: "不同摘要", en: "Different summary" }],
    ["region", "south-asia"],
    ["flagEmoji", "TH"],
    ["updatedAt", "2026-07-12T00:00:00.000Z"],
  ] as const)("rejects canonical country.%s drift", (field, value) => {
    const bundle = createValidBundle();
    bundle.canonical.country[field] = value;
    if (field === "code") {
      bundle.canonical.marketOverview.countryCode = value;
    }
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test.each([
    ["overview", { zh: "不同概览", en: "Different overview" }],
    ["population", 100000001],
    ["gdp", 400000000001],
    ["gdpGrowth", 5.3],
    ["energyDemand", { zh: "不同需求", en: "Different demand" }],
    ["renewableTarget", { zh: "不同目标", en: "Different target" }],
    ["keyIndicators", [{
      label: { zh: "装机容量", en: "Installed capacity" },
      value: "21",
      unit: "GW",
      year: 2025,
    }]],
    ["source", "Different official source"],
    ["sourceUrl", "https://example.com/different"],
    ["collectedAt", "2026-07-08T00:00:00.000Z"],
    ["updatedAt", "2026-07-12T00:00:00.000Z"],
    ["credibility", "HIGH"],
    ["reviewStatus", "pending"],
    ["aiUsable", true],
    ["countryCode", "TH"],
    ["industryTags", ["wind"]],
    ["techTags", ["inverter"]],
  ] as const)("rejects canonical market-overview.%s drift", (field, value) => {
    const bundle = createValidBundle();
    bundle.canonical.marketOverview[field] = value;
    expect(validateApprovedBasicCountryPublication(bundle).valid).toBe(false);
  });

  test("deterministically maps an approved audit without mutating it", () => {
    const input = createPublicationInput();
    const before = structuredClone(input);
    const first = createBasicCountryBundleFromApprovedAudit(input);
    const second = createBasicCountryBundleFromApprovedAudit(input);

    expect(input).toEqual(before);
    expect(first).toEqual(second);
    expect(first).toEqual(createValidBundle());
    expect(first.canonical.country.coverageLevel).toBe("BASIC");
    expect(getModuleCoverage(first)).toHaveLength(10);

    const canonicalDraft = structuredClone(first.canonical.marketOverview);
    canonicalDraft.reviewStatus = "draft";
    expect(canonicalDraft).toEqual(input.auditBundle.marketOverviewDraft);
    expect(first.canonical.marketOverview.aiUsable).toBe(false);
    expect(first.canonical.marketOverview.industryTags).toEqual(["solar"]);
    expect(first.canonical.marketOverview.techTags).toEqual(["pv-module"]);
    expect(first.canonical.marketOverview.collectedAt).toBe(
      "2026-07-09T00:00:00.000Z",
    );
    expect(first.canonical.marketOverview.updatedAt).toBe(
      "2026-07-10T00:00:00.000Z",
    );
  });

  test("the generator rejects unapproved and identity-mismatched inputs", () => {
    const unapproved = createPublicationInput();
    unapproved.auditBundle.reviewReport.humanDecision = null;
    expect(() => createBasicCountryBundleFromApprovedAudit(unapproved)).toThrow();

    const mismatched = createPublicationInput();
    mismatched.auditBundle.sourceRegister.countryCode = "TH";
    expect(() => createBasicCountryBundleFromApprovedAudit(mismatched)).toThrow();
  });

  test("fails closed with stable redacted errors for hostile inputs", () => {
    const secret = "RAW_EVIDENCE_SECRET";
    const drifted = createValidBundle();
    firstFact(drifted).evidence = [{
      sourceId: "source-1",
      locator: "table 1",
      rawValue: secret,
      normalizedValue: secret,
      unit: null,
      year: null,
    }];
    const driftResult = validateApprovedBasicCountryPublication(drifted);
    expect(driftResult.valid).toBe(false);
    expect(driftResult.errors.join("\n")).not.toContain(secret);

    const uncloneable = createValidBundle();
    auditRecord(uncloneable, "sourceRegister").runtime = () => secret;
    const first = validateApprovedBasicCountryPublication(uncloneable);
    const second = validateApprovedBasicCountryPublication(uncloneable);
    expect(first).toEqual(second);
    expect(first.valid).toBe(false);
    expect(first.errors.join("\n")).not.toContain(secret);

    const hostile = new Proxy({}, { ownKeys() { throw new Error(secret); } });
    const hostileResult = validateApprovedBasicCountryPublication(hostile);
    expect(hostileResult.valid).toBe(false);
    expect(hostileResult.errors.join("\n")).not.toContain(secret);

    const hostileInput = createPublicationInput();
    Object.assign(hostileInput.manifest, { runtime: () => secret });
    expect(() => createBasicCountryBundleFromApprovedAudit(hostileInput)).toThrow(
      "approved audit input must be safely snapshotable",
    );
  });

  test.each([
    ["accessor", addAccessorExtra],
    ["non-enumerable key", addNonEnumerableExtra],
    ["symbol key", addSymbolExtra],
  ] as const)("the generator rejects an original graph with an unsafe %s", (
    _label,
    addUnsafeExtra,
  ) => {
    const input = createPublicationInput();
    const unsafe = addUnsafeExtra(input);

    let errorMessage = "";
    try {
      createBasicCountryBundleFromApprovedAudit(input);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      errorMessage = (error as Error).message;
    }
    expect(errorMessage).toBe("approved audit input must be safely snapshotable");
    expect(unsafe.getterCount()).toBe(0);
    expect(errorMessage).not.toContain(unsafe.secret);
  });

  test.each([
    ["accessor", addAccessorExtra],
    ["non-enumerable key", addNonEnumerableExtra],
    ["symbol key", addSymbolExtra],
  ] as const)("the validator rejects an original graph with an unsafe %s", (
    _label,
    addUnsafeExtra,
  ) => {
    const bundle = createValidBundle();
    const unsafe = addUnsafeExtra(bundle);

    const result = validateApprovedBasicCountryPublication(bundle);

    expect(result.valid).toBe(false);
    expect(unsafe.getterCount()).toBe(0);
    expect(result.errors.join("\n")).not.toContain(unsafe.secret);
  });

  test("publishes the documented mapping version", () => {
    expect(BASIC_COUNTRY_CANONICAL_MAPPING_VERSION).toBe(
      "basic-country-canonical/v1",
    );
  });
});

function createPublicationInput(): BasicApprovedCountryPublicationInput {
  return {
    countryDirectory: "vietnam",
    manifest: structuredClone(createReviewedInput().manifest),
    auditBundle: createApprovedAuditBundle(),
  };
}

function auditRecord(bundle: BasicCountryBundle, field: string): JsonRecord {
  return getRecord(bundle.audit.run[field as keyof typeof bundle.audit.run], field);
}

function reviewReport(bundle: BasicCountryBundle): JsonRecord {
  return auditRecord(bundle, "reviewReport");
}

function factsArray(bundle: BasicCountryBundle): JsonRecord[] {
  const facts = auditRecord(bundle, "extractedFacts").facts;
  if (!Array.isArray(facts)) throw new Error("facts must be an array");
  facts.forEach((fact) => getRecord(fact, "fact"));
  return facts as JsonRecord[];
}

function firstFact(bundle: BasicCountryBundle): JsonRecord {
  const fact = factsArray(bundle)[0];
  if (fact === undefined) throw new Error("first fact is required");
  return fact;
}

function blockReview(bundle: BasicCountryBundle): void {
  const report = reviewReport(bundle);
  report.status = "blocked";
  report.publicationRecommendation = "do-not-publish";
}

interface UnsafeExtraProbe {
  secret: string;
  getterCount(): number;
}

function addAccessorExtra(value: object): UnsafeExtraProbe {
  const secret = "ACCESSOR_SECRET";
  let count = 0;
  Object.defineProperty(value, "runtime", {
    enumerable: true,
    get() {
      count += 1;
      return secret;
    },
  });
  return {
    secret,
    getterCount: () => count,
  };
}

function addNonEnumerableExtra(value: object): UnsafeExtraProbe {
  const secret = "NON_ENUMERABLE_SECRET";
  Object.defineProperty(value, "runtime", {
    enumerable: false,
    value: secret,
  });
  return {
    secret,
    getterCount: () => 0,
  };
}

function addSymbolExtra(value: object): UnsafeExtraProbe {
  const secret = "SYMBOL_SECRET";
  Object.defineProperty(value, Symbol(secret), {
    enumerable: true,
    value: secret,
  });
  return {
    secret,
    getterCount: () => 0,
  };
}
