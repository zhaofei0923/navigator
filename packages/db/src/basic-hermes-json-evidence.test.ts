import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
} from "./collection/basic-collection-contracts.js";
import {
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
} from "./collection/basic-hermes-llama-contracts.js";
import { promoteBasicHermesJsonEvidence } from "./collection/basic-hermes-json-evidence.js";

const RUN_ID = "run-hermes-evidence-1";
const COUNTRY_CODE = "ID";
const JSON_URL = "https://example.com/data?format=json";
const BODY_VALUE = 42;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function body(value = BODY_VALUE): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ facts: [{ value }] }));
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    discoveryId: "candidate-1",
    provider: "searxng",
    query: "Indonesia solar policy",
    title: "Search title sentinel",
    snippet: "Search snippet sentinel SECRET_SNIPPET",
    url: JSON_URL,
    discoveredAt: "2026-07-10T09:40:00.000Z",
    discoveryOnly: true,
    ...overrides,
  };
}

function discovery(candidates: readonly Record<string, unknown>[] = [candidate()]): Record<string, unknown> {
  return {
    schemaVersion: BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    candidates,
  };
}

function base(): Record<string, unknown> {
  const contentSha256 = "a".repeat(64);
  return {
    sourceRegister: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId: RUN_ID,
      countryCode: COUNTRY_CODE,
      sources: [{
        sourceId: "base-source",
        sourceName: "Base source",
        sourceUrl: "https://base.example/source",
        retrievedAt: "2026-07-10T08:00:00.000Z",
        publishedAt: null,
        contentSha256,
        evidenceLocators: ["json:/code"],
        sourceFamily: "official-statistics",
        accessStatus: "open",
        accessNotes: null,
        credibility: "OFFICIAL",
        discoveryOnly: false,
        promptInjectionRisk: "none",
      }],
    },
    extractedFacts: {
      schemaVersion: BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
      runId: RUN_ID,
      countryCode: COUNTRY_CODE,
      facts: [{
        factId: "fact-base-code",
        fieldPath: "country.code",
        status: "candidate",
        evidence: [{
          sourceId: "base-source",
          locator: "json:/code",
          rawValue: "ID",
          normalizedValue: "ID",
          unit: null,
          year: null,
        }],
        extractionMethod: "deterministic",
        uncertainty: null,
      }],
    },
    receipts: [{
      sourceId: "base-source",
      contentSha256,
      byteLength: 7,
      reused: false,
    }],
  };
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceId: "hermes-source",
    sourceName: "Reviewed statistics portal",
    sourceUrl: JSON_URL,
    sourceFamily: "official-statistics",
    credibility: "VERIFIED",
    accessStatus: "open",
    accessNotes: "Reviewed access note",
    publishedAt: "2026-07-09T00:00:00.000Z",
    promptInjectionRisk: "none",
    approvedOrigins: ["https://example.com"],
    allowedQueryParameters: ["format"],
    ...overrides,
  };
}

function capture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const captured = body();
  return {
    sourceId: "hermes-source",
    contentSha256: sha256(captured),
    byteLength: captured.byteLength,
    reused: false,
    body: captured,
    finalUrl: JSON_URL,
    contentType: "application/json; charset=utf-8",
    retrievedAt: "2026-07-10T09:45:00.000Z",
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fieldPath: "marketOverview.population",
    locator: "json:/facts/0/value",
    rawValue: BODY_VALUE,
    normalizedValue: BODY_VALUE,
    unit: "people",
    year: 2025,
    uncertainty: "reported",
    ...overrides,
  };
}

function opened(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    discoveryId: "candidate-1",
    policy: policy(),
    capture: capture(),
    observations: [observation()],
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base: base(),
    discovery: discovery(),
    openedSources: [opened()],
    ...overrides,
  };
}

function expectFailure(value: unknown) {
  const result = promoteBasicHermesJsonEvidence(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected bridge failure");
  return result.error;
}

describe("Hermes JSON evidence promotion", () => {
  test("proves JSON pointers and creates stable frozen source, fact, and receipt output", () => {
    const result = promoteBasicHermesJsonEvidence(input());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.sourceRegister.sources.map((item) => item.sourceId)).toEqual([
      "base-source", "hermes-source",
    ]);
    expect(result.data.extractedFacts.facts.map((item) => item.fieldPath)).toEqual([
      "country.code", "marketOverview.population",
    ]);
    expect(result.data.receipts).toEqual([{
      sourceId: "base-source", contentSha256: "a".repeat(64), byteLength: 7, reused: false,
    }, {
      sourceId: "hermes-source", contentSha256: sha256(body()), byteLength: body().byteLength, reused: false,
    }]);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.sourceRegister.sources[1])).toBe(true);
    expect(Object.isFrozen(result.data.extractedFacts.facts[1]!.evidence)).toBe(true);
  });

  test("drops discovery text, raw bodies, cache paths, policies, and AI or canonical fields", () => {
    const result = promoteBasicHermesJsonEvidence(input());
    expect(result.ok).toBe(true);
    const encoded = JSON.stringify(result);
    for (const forbidden of ["SECRET_SNIPPET", "Search title sentinel", "approvedOrigins", "allowedQueryParameters", "cache", "body", "staging", "canonical", "aiUsable"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  test("maps every source field exclusively from reviewed policy and verified capture", () => {
    const result = promoteBasicHermesJsonEvidence(input({ discovery: discovery([candidate({ title: "Unreviewed title", provider: "searxng" })]) }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.sourceRegister.sources[1]).toEqual({
      sourceId: "hermes-source", sourceName: "Reviewed statistics portal", sourceUrl: JSON_URL,
      retrievedAt: "2026-07-10T09:45:00.000Z", publishedAt: "2026-07-09T00:00:00.000Z",
      contentSha256: sha256(body()), evidenceLocators: ["json:/facts/0/value"],
      sourceFamily: "official-statistics", accessStatus: "open", accessNotes: "Reviewed access note",
      credibility: "VERIFIED", discoveryOnly: false, promptInjectionRisk: "none",
    });
  });

  test.each([
    ["candidate-policy URL mismatch", () => input({ openedSources: [opened({ policy: policy({ sourceUrl: "https://example.com/other?format=json" }) })] })],
    ["unapproved origin", () => input({ openedSources: [opened({ policy: policy({ approvedOrigins: ["https://other.example"] }) })] })],
    ["credential URL", () => input({ discovery: discovery([candidate({ url: "https://user:password@example.com/data?format=json" })]) })],
    ["unsafe literal origin", () => input({ discovery: discovery([candidate({ url: "https://127.0.0.1/data?format=json" })]), openedSources: [opened({ policy: policy({ sourceUrl: "https://127.0.0.1/data?format=json", approvedOrigins: ["https://127.0.0.1"] }), capture: capture({ finalUrl: "https://127.0.0.1/data?format=json" }) })] })],
    ["final URL redirect", () => input({ openedSources: [opened({ capture: capture({ finalUrl: "https://example.com/redirect?format=json" }) })] })],
  ])("rejects %s", (_label, create) => {
    expect(expectFailure(create()).code).toMatch(/SOURCE_CAPTURE_INVALID|EVIDENCE_INVALID/);
  });

  test.each([
    ["unknown candidate query", () => input({ discovery: discovery([candidate({ url: "https://example.com/data?format=json&extra=1" })]) })],
    ["duplicate candidate query", () => input({ discovery: discovery([candidate({ url: "https://example.com/data?format=json&format=other" })]) })],
    ["unknown policy query", () => input({ openedSources: [opened({ policy: policy({ sourceUrl: "https://example.com/data?format=json&extra=1" }) })] })],
    ["duplicate policy query", () => input({ openedSources: [opened({ policy: policy({ sourceUrl: "https://example.com/data?format=json&format=other" }) })] })],
    ["unknown final query", () => input({ openedSources: [opened({ capture: capture({ finalUrl: "https://example.com/data?format=json&extra=1" }) })] })],
    ["duplicate reviewed origins", () => input({ openedSources: [opened({ policy: policy({ approvedOrigins: ["https://example.com", "https://example.com"] }) })] })],
    ["duplicate reviewed query names", () => input({ openedSources: [opened({ policy: policy({ allowedQueryParameters: ["format", "format"] }) })] })],
  ])("rejects %s", (_label, create) => {
    expect(expectFailure(create()).code).toMatch(/SOURCE_CAPTURE_INVALID|EVIDENCE_INVALID/);
  });

  test.each([
    ["bad capture source ID", () => input({ openedSources: [opened({ capture: capture({ sourceId: "other-source" }) })] })],
    ["bad capture hash", () => input({ openedSources: [opened({ capture: capture({ contentSha256: "b".repeat(64) }) })] })],
    ["bad capture byte length", () => input({ openedSources: [opened({ capture: capture({ byteLength: 1 }) })] })],
    ["non-JSON MIME", () => input({ openedSources: [opened({ capture: capture({ contentType: "text/html" }) })] })],
    ["bad capture timestamp", () => input({ openedSources: [opened({ capture: capture({ retrievedAt: "invalid" }) })] })],
  ])("rejects %s", (_label, create) => {
    expect(expectFailure(create()).code).toBe("SOURCE_CAPTURE_INVALID");
  });

  test.each([
    ["invalid JSON", () => {
      const malformed = new TextEncoder().encode("{");
      return input({ openedSources: [opened({ capture: capture({ body: malformed, contentSha256: sha256(malformed), byteLength: malformed.byteLength }) })] });
    }],
    ["raw value mismatch", () => input({ openedSources: [opened({ observations: [observation({ rawValue: 99 })] })] })],
    ["pointer escapes its body", () => input({ openedSources: [opened({ observations: [observation({ locator: "json:/facts/01/value" })] })] })],
    ["missing pointer", () => input({ openedSources: [opened({ observations: [observation({ locator: "json:/missing" })] })] })],
    ["inherited pointer", () => input({ openedSources: [opened({ observations: [observation({ locator: "json:/facts/0/__proto__/value" })] })] })],
    ["nonfinite normalized value", () => input({ openedSources: [opened({ observations: [observation({ normalizedValue: Number.NaN })] })] })],
  ])("rejects %s", (_label, create) => {
    expect(expectFailure(create()).code).toBe("EVIDENCE_INVALID");
  });

  test.each([
    ["unknown field path", { fieldPath: "marketOverview.unknown" }],
    ["invalid unit", { unit: "" }],
    ["invalid year", { year: Number.POSITIVE_INFINITY }],
    ["invalid uncertainty", { uncertainty: "" }],
  ])("rejects observation with %s", (_label, change) => {
    expect(expectFailure(input({ openedSources: [opened({ observations: [observation(change)] })] })).code).toBe("EVIDENCE_INVALID");
  });

  test("rejects an opened source without observations or mapped policy/capture fields", () => {
    expect(expectFailure(input({ openedSources: [opened({ observations: [] })] })).code).toBe("EVIDENCE_INVALID");
    expect(expectFailure(input({ openedSources: [opened({ policy: { ...policy(), sourceName: undefined } })] })).code).toBe("EVIDENCE_INVALID");
  });

  test("rejects duplicate source IDs, base identities, and deterministic-Hermes field overlaps", () => {
    expect(expectFailure(input({ openedSources: [opened(), opened({ discoveryId: "candidate-1" })] })).code).toBe("EVIDENCE_INVALID");
    expect(expectFailure(input({ base: { ...base(), extractedFacts: { ...(base().extractedFacts as Record<string, unknown>), countryCode: "MY" } } })).code).toBe("EVIDENCE_INVALID");
    expect(expectFailure(input({ openedSources: [opened({ observations: [observation({ fieldPath: "country.code", rawValue: BODY_VALUE })] })] })).code).toBe("EVIDENCE_INVALID");
  });

  test("rejects multiple tuples from the same source and materializes equal tuples as a candidate", () => {
    const invalid = input({ openedSources: [opened({ observations: [observation(), observation({ rawValue: BODY_VALUE, normalizedValue: 43 })] })] });
    expect(expectFailure(invalid).code).toBe("EVIDENCE_INVALID");

    const second = opened({
      discoveryId: "candidate-2",
      policy: policy({ sourceId: "hermes-source-2", sourceUrl: "https://example.com/other?format=json" }),
      capture: capture({ sourceId: "hermes-source-2", finalUrl: "https://example.com/other?format=json" }),
    });
    const result = promoteBasicHermesJsonEvidence(input({ discovery: discovery([candidate(), candidate({ discoveryId: "candidate-2", url: "https://example.com/other?format=json" })]), openedSources: [opened(), second] }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.extractedFacts.facts[1]).toMatchObject({ status: "candidate", extractionMethod: "hermes" });
  });

  test("materializes differing tuples as conflict and preserves untrusted sources", () => {
    const second = opened({
      discoveryId: "candidate-2",
      policy: policy({ sourceId: "hermes-source-2", sourceUrl: "https://example.com/other?format=json", accessStatus: "restricted" }),
      capture: capture({ sourceId: "hermes-source-2", finalUrl: "https://example.com/other?format=json" }),
      observations: [observation({ rawValue: BODY_VALUE, normalizedValue: 43 })],
    });
    const result = promoteBasicHermesJsonEvidence(input({ discovery: discovery([candidate(), candidate({ discoveryId: "candidate-2", url: "https://example.com/other?format=json" })]), openedSources: [opened(), second] }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.extractedFacts.facts[1]).toMatchObject({ status: "conflict" });
  });

  test.each([
    ["restricted", { accessStatus: "restricted" }],
    ["unknown", { accessStatus: "unknown" }],
    ["unverified", { credibility: "UNVERIFIED" }],
    ["injection risk", { promptInjectionRisk: "suspected" }],
  ])("materializes equal tuples from a %s source as untrusted", (_label, change) => {
    const result = promoteBasicHermesJsonEvidence(input({ openedSources: [opened({ policy: policy(change) })] }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.extractedFacts.facts[1]).toMatchObject({ status: "untrusted" });
  });

  test("uses P1-6B SHA-256 fact IDs and rechecks uniqueness after merge", () => {
    const result = promoteBasicHermesJsonEvidence(input());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.extractedFacts.facts[1]?.factId).toBe(`fact-${createHash("sha256").update("marketOverview.population", "utf8").digest("hex").slice(0, 16)}`);
    expect(new Set(result.data.extractedFacts.facts.map((item) => item.factId)).size).toBe(result.data.extractedFacts.facts.length);
  });

  test("snapshots caller values before returning the deeply frozen result", () => {
    const mutable = input();
    const result = promoteBasicHermesJsonEvidence(mutable);
    (mutable.openedSources as Record<string, unknown>[])[0]!.policy = policy({ sourceName: "Mutated" });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.sourceRegister.sources[1]?.sourceName).toBe("Reviewed statistics portal");
    expect(() => { result.data.sourceRegister.sources[1]!.sourceName = "nope"; }).toThrow();
  });
});
