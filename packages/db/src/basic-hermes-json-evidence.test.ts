import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
} from "./collection/basic-collection-contracts.js";
import {
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
} from "./collection/basic-hermes-llama-contracts.js";
import { promoteBasicHermesJsonEvidence } from "./collection/basic-hermes-json-evidence.js";
import { captureBasicRawSource } from "./collection/basic-raw-capture.js";
import type { BasicSourceTransport } from "./collection/basic-source-adapter-contracts.js";

const RUN_ID = "run-hermes-evidence-1";
const COUNTRY_CODE = "ID";
const JSON_URL = "https://example.com/data?format=json";
const BODY_VALUE = 42;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function body(value: unknown = BODY_VALUE): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ facts: [{ value }] }));
}

function inputForDiscoveryUrl(url: string): Record<string, unknown> {
  return input({
    discovery: discovery([candidate({ url })]),
    openedSources: [opened({
      policy: policy({ sourceUrl: url, approvedOrigins: [new URL(url).origin] }),
      capture: capture({ finalUrl: url }),
    })],
  });
}

function hostileJsonObject(kind: "symbol" | "non-enumerable" | "accessor"): object {
  const value = {};
  const key: PropertyKey = kind === "symbol" ? Symbol("hidden") : "hidden";
  Object.defineProperty(value, key, kind === "accessor"
    ? { get: () => "hidden", configurable: true }
    : { value: "hidden", configurable: true, enumerable: kind === "symbol" });
  return value;
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
        factId: `fact-${createHash("sha256").update("country.code", "utf8").digest("hex").slice(0, 16)}`,
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
    redirectChain: [],
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

function baseRecords(value: Record<string, unknown>): {
  source: Record<string, unknown>;
  fact: Record<string, unknown>;
  receipt: Record<string, unknown>;
} {
  const baseValue = value.base as Record<string, unknown>;
  const register = baseValue.sourceRegister as Record<string, unknown>;
  const extracted = baseValue.extractedFacts as Record<string, unknown>;
  return {
    source: (register.sources as Record<string, unknown>[])[0]!,
    fact: (extracted.facts as Record<string, unknown>[])[0]!,
    receipt: (baseValue.receipts as Record<string, unknown>[])[0]!,
  };
}

function baseOnly(
  mutate: (source: Record<string, unknown>, fact: Record<string, unknown>) => void,
): Record<string, unknown> {
  const value = input({ openedSources: [] });
  const { source, fact } = baseRecords(value);
  mutate(source, fact);
  return value;
}

function deterministicConflictBase(): Record<string, unknown> {
  const value = baseOnly(() => undefined);
  const { source, fact, receipt } = baseRecords(value);
  const baseValue = value.base as Record<string, unknown>;
  const register = baseValue.sourceRegister as Record<string, unknown>;
  const sources = register.sources as Record<string, unknown>[];
  const receipts = baseValue.receipts as Record<string, unknown>[];
  const evidence = fact.evidence as Record<string, unknown>[];
  sources.push({ ...source, sourceId: "base-source-2", sourceUrl: "https://base-two.example/source" });
  receipts.push({ ...receipt, sourceId: "base-source-2" });
  evidence.push({ ...evidence[0]!, sourceId: "base-source-2", rawValue: "MY", normalizedValue: "MY" });
  fact.status = "conflict";
  return value;
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

  test("serializes equivalent nested evidence deterministically across caller key and observation order", () => {
    const canonical = { alpha: { a: 1, z: 2 }, items: [{ a: 3, z: 4 }], omega: 5 };
    const permuted = { omega: 5, items: [{ z: 4, a: 3 }], alpha: { z: 2, a: 1 } };
    const captured = body(canonical);
    const promote = (observations: readonly Record<string, unknown>[]) =>
      promoteBasicHermesJsonEvidence(input({ openedSources: [opened({
        capture: capture({ body: captured, byteLength: captured.byteLength, contentSha256: sha256(captured) }),
        observations,
      })] }));
    const first = promote([
      observation({ rawValue: canonical, normalizedValue: permuted }),
      observation({ rawValue: permuted, normalizedValue: canonical }),
    ]);
    const second = promote([
      observation({ rawValue: permuted, normalizedValue: canonical }),
      observation({ rawValue: canonical, normalizedValue: permuted }),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (!first.ok) return;
    const evidence = first.data.extractedFacts.facts.find(
      (fact) => fact.fieldPath === "marketOverview.population",
    )?.evidence[0];
    const raw = evidence?.rawValue as { alpha: object; items: object[] };
    const normalized = evidence?.normalizedValue as { alpha: object; items: object[] };
    expect(Object.keys(raw)).toEqual(["alpha", "items", "omega"]);
    expect(Object.keys(raw.alpha)).toEqual(["a", "z"]);
    expect(Object.keys(raw.items[0]!)).toEqual(["a", "z"]);
    expect(Object.keys(normalized)).toEqual(["alpha", "items", "omega"]);
    expect(Object.keys(normalized.alpha)).toEqual(["a", "z"]);
  });

  test("preserves a verified A-to-B-to-A raw redirect chain but refuses its promotion", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "basic-hermes-redirect-"));
    const redirectUrl = "https://redirect.example/data?format=json";
    const verifiedChain = [redirectUrl, JSON_URL];
    const captured = body();
    const rawInput = {
      repoRoot,
      countryCode: COUNTRY_CODE,
      runId: RUN_ID,
      adapterId: "hermes-json",
      adapterVersion: "1.0.0",
      sourceId: "hermes-source",
      request: {
        method: "GET" as const,
        url: JSON_URL,
        accept: "application/json",
        allowedOrigins: ["https://example.com", "https://redirect.example"],
        allowedQueryParameters: ["format"],
      },
    };
    const transport: BasicSourceTransport = {
      async execute() {
        return {
          status: 200,
          finalUrl: JSON_URL,
          redirectChain: verifiedChain,
          contentType: "application/json",
          retrievedAt: "2026-07-10T09:45:00.000Z",
          body: chunks(captured),
        };
      },
    };

    try {
      const first = await captureBasicRawSource(rawInput, transport);
      expect(first.redirectChain).toEqual([redirectUrl, JSON_URL]);
      expect(first.redirectChain).not.toBe(verifiedChain);
      expect(Object.isFrozen(first.redirectChain)).toBe(true);
      verifiedChain[0] = "https://mutated.example/data?format=json";
      expect(first.redirectChain).toEqual([redirectUrl, JSON_URL]);
      expect(Reflect.set(first, "redirectChain", [])).toBe(false);
      expect(first.redirectChain).toEqual([redirectUrl, JSON_URL]);

      const cached = await captureBasicRawSource(rawInput, {
        async execute() {
          throw new Error("verified cache reuse must not execute transport");
        },
      });
      expect(cached).toMatchObject({ reused: true, redirectChain: [redirectUrl, JSON_URL] });
      expect(cached.redirectChain).not.toBe(first.redirectChain);
      expect(Object.isFrozen(cached.redirectChain)).toBe(true);

      expect(expectFailure(input({ openedSources: [opened({ capture: first })] }))).toEqual({
        code: "SOURCE_CAPTURE_INVALID",
        phase: "source",
        retryable: false,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test.each([
    ["application/json", true],
    ["application/problem+json", true],
    ["application/vnd.hermes+json; charset=utf-8", true],
    ["application/json; charset=\"utf-8\"", true],
    ["x+json", false],
    ["+json", false],
    ["application/+json", false],
    ["application/", false],
    ["/json", false],
    ["application /json", false],
    ["application/json; char set=utf-8", false],
    ["application/json;", false],
  ])("accepts only complete JSON capture media types: %s", (contentType, accepted) => {
    const result = promoteBasicHermesJsonEvidence(input({
      openedSources: [opened({ capture: capture({ contentType }) })],
    }));
    expect(result.ok).toBe(accepted);
  });

  test("requires the exact P1-6C capture shape to include an empty redirect chain", () => {
    const missingChain = capture();
    delete missingChain.redirectChain;
    expect(expectFailure(input({ openedSources: [opened({ capture: missingChain })] }))).toEqual({
      code: "SOURCE_CAPTURE_INVALID",
      phase: "source",
      retryable: false,
    });
  });

  test.each([
    ["HTTP source URL", (source: Record<string, unknown>, _fact: Record<string, unknown>) => { source.sourceUrl = "http://base.example/source"; }],
    ["credential source URL", (source: Record<string, unknown>, _fact: Record<string, unknown>) => { source.sourceUrl = "https://user:password@base.example/source"; }],
    ["whitespace source URL", (source: Record<string, unknown>, _fact: Record<string, unknown>) => { source.sourceUrl = " https://base.example/source "; }],
    ["restricted source", (source: Record<string, unknown>, _fact: Record<string, unknown>) => { source.accessStatus = "restricted"; }],
    ["discovery-only source", (source: Record<string, unknown>, _fact: Record<string, unknown>) => { source.discoveryOnly = true; }],
    ["Hermes base fact method", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.extractionMethod = "hermes"; }],
    ["manual base fact method", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.extractionMethod = "manual"; }],
    ["missing base fact status", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.status = "missing"; fact.evidence = []; }],
    ["untrusted base fact status", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.status = "untrusted"; }],
    ["wrong P1-6B fact ID", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.factId = "fact-not-a-field-hash"; }],
    ["whitespace base fact path", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.fieldPath = " country.code "; }],
    ["outer-whitespace uncertainty", (_source: Record<string, unknown>, fact: Record<string, unknown>) => { fact.uncertainty = " reported "; }],
  ] as const)("rejects a base result with %s", (_label, mutate) => {
    expect(expectFailure(baseOnly(mutate)).code).toBe("EVIDENCE_INVALID");
  });

  test("rejects whitespace base source identities without normalizing receipts or evidence", () => {
    const value = baseOnly(() => undefined);
    const { source, fact, receipt } = baseRecords(value);
    source.sourceId = " base-source ";
    receipt.sourceId = " base-source ";
    (fact.evidence as Record<string, unknown>[])[0]!.sourceId = " base-source ";

    expect(expectFailure(value).code).toBe("EVIDENCE_INVALID");
  });

  test.each([
    ["candidate", baseOnly(() => undefined)],
    ["conflict", deterministicConflictBase()],
  ] as const)("accepts a deterministic P1-6B %s base", (_label, baseValue) => {
    expect(promoteBasicHermesJsonEvidence(baseValue)).toMatchObject({ ok: true });
  });

  test.each([
    ["UNVERIFIED credibility", (source: Record<string, unknown>) => { source.credibility = "UNVERIFIED"; }],
    ["suspected injection risk", (source: Record<string, unknown>) => { source.promptInjectionRisk = "suspected"; }],
    ["confirmed injection risk", (source: Record<string, unknown>) => { source.promptInjectionRisk = "confirmed"; }],
  ] as const)("accepts genuine P1-6B base metadata with %s", (_label, mutate) => {
    const value = baseOnly((source) => mutate(source));
    expect(promoteBasicHermesJsonEvidence(value)).toMatchObject({ ok: true });
  });

  test.each([
    ["policy source ID", () => input({ openedSources: [opened({ policy: policy({ sourceId: " hermes-source " }), capture: capture({ sourceId: " hermes-source " }) })] })],
    ["policy URL", () => input({ openedSources: [opened({ policy: policy({ sourceUrl: ` ${JSON_URL} ` }), capture: capture({ finalUrl: ` ${JSON_URL} ` }) })] })],
    ["reviewed origin", () => input({ openedSources: [opened({ policy: policy({ approvedOrigins: [" https://example.com "] }) })] })],
    ["reviewed query name", () => input({ openedSources: [opened({ policy: policy({ allowedQueryParameters: [" format "] }) })] })],
    ["observation field path", () => input({ openedSources: [opened({ observations: [observation({ fieldPath: " marketOverview.population " })] })] })],
    ["observation JSON pointer", () => input({ openedSources: [opened({ observations: [observation({ locator: " json:/facts/0/value " })] })] })],
  ] as const)("rejects surrounding whitespace in %s instead of normalizing it", (_label, create) => {
    expect(expectFailure(create()).code).toMatch(/SOURCE_CAPTURE_INVALID|EVIDENCE_INVALID/);
  });

  test("preserves human-readable policy strings and trims Hermes uncertainty", () => {
    const result = promoteBasicHermesJsonEvidence(input({
      openedSources: [opened({
        policy: policy({ sourceName: " Reviewed portal ", accessNotes: " Reviewed access note " }),
        observations: [observation({ uncertainty: " reported " })],
      })],
    }));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.sourceRegister.sources[1]).toMatchObject({
      sourceName: " Reviewed portal ",
      accessNotes: " Reviewed access note ",
    });
    expect(result.data.extractedFacts.facts[1]?.uncertainty).toBe("reported");
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

  test("accepts the Task 2 discovery ID boundary", () => {
    const result = promoteBasicHermesJsonEvidence(input({
      discovery: discovery([candidate({ discoveryId: "a".repeat(128) })]),
      openedSources: [opened({ discoveryId: "a".repeat(128) })],
    }));

    expect(result.ok).toBe(true);
  });

  test("accepts an empty discovery title like Task 2", () => {
    const result = promoteBasicHermesJsonEvidence(input({
      discovery: discovery([candidate({ title: "" })]),
    }));

    expect(result.ok).toBe(true);
  });

  test("rejects a discovery ID beyond the Task 2 boundary", () => {
    expect(expectFailure(input({
      discovery: discovery([candidate({ discoveryId: "a".repeat(129) })]),
      openedSources: [opened({ discoveryId: "a".repeat(129) })],
    })).code).toBe("EVIDENCE_INVALID");
  });

  test.each([
    "2026-02-29T00:00:00Z",
    "2026-02-28T24:00:00Z",
    "2026-02-28T00:00:00+08:00",
    "2026-02-28T00:00:00.1234Z",
  ])("revalidates discovery timestamp %s with the strict Task 2 rules", (discoveredAt) => {
    expect(expectFailure(input({
      discovery: discovery([candidate({ discoveredAt })]),
    })).code).toBe("EVIDENCE_INVALID");
  });

  test.each([
    "https://[::]/data?format=json",
    "https://[fc00::1]/data?format=json",
    "https://[fe80::1]/data?format=json",
    "https://[ff02::1]/data?format=json",
    "https://[::ffff:127.0.0.1]/data?format=json",
    "https://[::127.0.0.1]/data?format=json",
  ])("rejects Task 2 unsafe IPv6 discovery URL %s", (url) => {
    expect(expectFailure(inputForDiscoveryUrl(url)).code).toBe("EVIDENCE_INVALID");
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

  test("rejects reuse of a discovery ID with a different reviewed source ID", () => {
    const second = opened({
      policy: policy({ sourceId: "hermes-source-2" }),
      capture: capture({ sourceId: "hermes-source-2" }),
    });

    expect(expectFailure(input({ openedSources: [opened(), second] })).code).toBe("EVIDENCE_INVALID");
  });

  test("rejects base evidence whose locator is absent from its registered source", () => {
    const malformedBase = base();
    const extractedFacts = malformedBase.extractedFacts as Record<string, unknown>;
    const facts = extractedFacts.facts as Array<Record<string, unknown>>;
    const evidence = facts[0]!.evidence as Array<Record<string, unknown>>;
    evidence[0]!.locator = "json:/unregistered";

    expect(expectFailure(input({ base: malformedBase })).code).toBe("EVIDENCE_INVALID");
  });

  test.each([
    ["rawValue", "symbol"],
    ["rawValue", "non-enumerable"],
    ["rawValue", "accessor"],
    ["normalizedValue", "symbol"],
    ["normalizedValue", "non-enumerable"],
    ["normalizedValue", "accessor"],
  ] as const)("rejects a hostile %s %s property", (field, kind) => {
    const hostile = hostileJsonObject(kind);
    const captured = field === "rawValue" ? body({}) : body();
    const changedObservation = field === "rawValue"
      ? observation({ rawValue: hostile })
      : observation({ normalizedValue: hostile });
    const value = input({ openedSources: [opened({
      capture: capture({ body: captured, byteLength: captured.byteLength, contentSha256: sha256(captured) }),
      observations: [changedObservation],
    })] });

    expect(expectFailure(value).code).toBe("EVIDENCE_INVALID");
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

async function* chunks(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield value;
}
