import { describe, expect, test } from "vitest";

import type { BasicSourceRecord } from "./collection/basic-collection-contracts.js";
import type {
  BasicExtractedFactV2,
  BasicSourceRegisterV2,
} from "./collection/basic-collection-v2-contracts.js";
import { materializeBasicDerivedFacts } from "./collection/basic-derived-fact-materializer.js";
import { materializeBasicSourceFactsV2 } from "./collection/basic-v2-fact-materializer.js";

const ERROR = "basic derived fact materialization is invalid";
const DERIVED_PATHS = [
  "country.flagEmoji",
  "country.updatedAt",
  "marketOverview.collectedAt",
  "marketOverview.countryCode",
  "marketOverview.credibility",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.updatedAt",
] as const;

describe("Basic derived fact materialization", () => {
  test("derives exact aggregate facts and merges locators into their source owners", () => {
    const input = completeInput();
    const result = materializeBasicDerivedFacts(input);

    expect(result.facts.map(({ fieldPath }) => fieldPath)).toEqual(DERIVED_PATHS);
    expect(valueAt(result.facts, "country.flagEmoji")).toBe("🇮🇩");
    expect(valueAt(result.facts, "marketOverview.countryCode")).toBe("ID");
    expect(valueAt(result.facts, "marketOverview.source")).toBe("Primary ministry");
    expect(valueAt(result.facts, "marketOverview.sourceUrl"))
      .toBe("https://data.example/source-b");
    expect(valueAt(result.facts, "marketOverview.collectedAt"))
      .toBe("2026-07-13T02:00:00.000Z");
    expect(valueAt(result.facts, "marketOverview.updatedAt"))
      .toBe("2026-07-02T00:00:00.000Z");
    expect(valueAt(result.facts, "country.updatedAt"))
      .toBe("2026-07-02T00:00:00.000Z");
    expect(valueAt(result.facts, "marketOverview.credibility")).toBe("ESTIMATED");

    expect(evidenceAt(result.facts, "country.flagEmoji")).toEqual([{
      sourceId: "source-a",
      locator: "json:/country/id",
      rawValue: "ID",
      normalizedValue: "🇮🇩",
      unit: null,
      year: null,
    }]);
    expect(evidenceAt(result.facts, "marketOverview.countryCode")).toEqual([{
      sourceId: "source-a",
      locator: "json:/country/id",
      rawValue: "ID",
      normalizedValue: "ID",
      unit: null,
      year: null,
    }]);
    expect(evidenceAt(result.facts, "marketOverview.source")).toEqual([{
      sourceId: "source-b",
      locator: "metadata:/sourceName",
      rawValue: "Primary ministry",
      normalizedValue: "Primary ministry",
      unit: null,
      year: null,
    }]);
    expect(evidenceAt(result.facts, "marketOverview.sourceUrl")[0]?.locator)
      .toBe("metadata:/sourceUrl");
    expect(evidenceAt(result.facts, "marketOverview.collectedAt")).toEqual([
      metadataEvidence("source-a", "capture:/retrievedAt", "2026-07-13T01:00:00.000Z", "2026-07-13T02:00:00.000Z"),
      metadataEvidence("source-b", "capture:/retrievedAt", "2026-07-13T02:00:00.000Z", "2026-07-13T02:00:00.000Z"),
    ]);
    expect(evidenceAt(result.facts, "marketOverview.updatedAt")).toEqual([
      metadataEvidence("source-a", "metadata:/publishedAt", "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"),
      metadataEvidence("source-b", "metadata:/publishedAt", "2026-07-02T00:00:00.000Z", "2026-07-02T00:00:00.000Z"),
    ]);
    expect(evidenceAt(result.facts, "marketOverview.credibility")).toEqual([
      metadataEvidence("source-a", "metadata:/credibility", "OFFICIAL", "ESTIMATED"),
      metadataEvidence("source-b", "metadata:/credibility", "ESTIMATED", "ESTIMATED"),
    ]);
    expect(result.facts.every(({ status, extractionMethod, uncertainty }) =>
      status === "candidate" && extractionMethod === "deterministic" && uncertainty === null,
    )).toBe(true);
    expect(result.sourceRegister.sources).toEqual([
      {
        ...input.sourceRegister.sources[0],
        evidenceLocators: [
          "capture:/retrievedAt",
          "json:/country/id",
          "metadata:/credibility",
          "metadata:/publishedAt",
        ],
      },
      {
        ...input.sourceRegister.sources[1],
        evidenceLocators: [
          "capture:/retrievedAt",
          "json:/country/name",
          "metadata:/credibility",
          "metadata:/publishedAt",
          "metadata:/sourceName",
          "metadata:/sourceUrl",
        ],
      },
    ]);
    expect(result.sourceRegister.sources).toHaveLength(2);
    expectDeeplyFrozen(result);
  });

  test("falls back to maximum retrievedAt with nonblank uncertainty when no source is published", () => {
    const input = completeInput({ publishedAt: null });
    const result = materializeBasicDerivedFacts(input);

    for (const path of ["country.updatedAt", "marketOverview.updatedAt"]) {
      const fact = factAt(result.facts, path);
      expect(fact.uncertainty?.trim().length).toBeGreaterThan(0);
      expect(fact.evidence).toEqual([
        metadataEvidence("source-a", "capture:/retrievedAt", "2026-07-13T01:00:00.000Z", "2026-07-13T02:00:00.000Z"),
        metadataEvidence("source-b", "capture:/retrievedAt", "2026-07-13T02:00:00.000Z", "2026-07-13T02:00:00.000Z"),
      ]);
    }
  });

  test("uses only non-null publication owners when some active sources lack publishedAt", () => {
    const input = withSource(completeInput(), "source-b", { publishedAt: null });
    const result = materializeBasicDerivedFacts(input);

    for (const path of ["country.updatedAt", "marketOverview.updatedAt"]) {
      const fact = factAt(result.facts, path);
      expect(fact.uncertainty).toBeNull();
      expect(fact.evidence).toEqual([
        metadataEvidence(
          "source-a",
          "metadata:/publishedAt",
          "2026-07-01T00:00:00.000Z",
          "2026-07-01T00:00:00.000Z",
        ),
      ]);
    }
  });

  test("is insertion-order independent and snapshots mutable inputs", () => {
    const input = completeInput();
    const reversed = {
      ...input,
      sourceRegister: {
        ...input.sourceRegister,
        sources: [...input.sourceRegister.sources].reverse(),
      },
      candidateFacts: [...input.candidateFacts].reverse(),
    };
    const expected = materializeBasicDerivedFacts(input);
    const actual = materializeBasicDerivedFacts(reversed);

    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    (input.sourceRegister.sources[0]!.evidenceLocators as string[]).push("mutated:/later");
    expect(expected.sourceRegister.sources[0]?.evidenceLocators)
      .not.toContain("mutated:/later");
  });

  test("does not access runtime, model, search, socket, child-process, or environment ports", () => {
    const result = withForbiddenRuntimeSentinels(() => materializeBasicDerivedFacts(completeInput()));

    expect(result.facts.map(({ fieldPath }) => fieldPath)).toEqual(DERIVED_PATHS);
    expectDeeplyFrozen(result);
  });

  test.each([
    ["HTTP", "http://data.example/source-a"],
    ["credentials", "https://user:secret@data.example/source-a"],
    ["fragment", "https://data.example/source-a#reviewed"],
    ["surrounding whitespace", "https://data.example/source-a "],
  ] as const)("rejects a source URL with %s", (_name, sourceUrl) => {
    expectInvalid(withSource(completeInput(), "source-a", { sourceUrl }));
  });

  test("retains a reviewed query string in the derived primary source URL", () => {
    const sourceUrl = "https://data.example/source-b?year=2026&format=json";
    const result = materializeBasicDerivedFacts(
      withSource(completeInput(), "source-b", { sourceUrl }),
    );

    expect(valueAt(result.facts, "marketOverview.sourceUrl")).toBe(sourceUrl);
  });

  test.each([
    ["discovery-only", { discoveryOnly: true }],
    ["restricted access", { accessStatus: "restricted" as const }],
    ["unknown access", { accessStatus: "unknown" as const }],
    ["suspected prompt risk", { promptInjectionRisk: "suspected" as const }],
    ["confirmed prompt risk", { promptInjectionRisk: "confirmed" as const }],
  ])("retains production trust rejection for %s sources", (_name, overrides) => {
    expectInvalid(withSource(completeInput(), "source-a", overrides));
  });

  test.each([
    ["no active source", (input: DerivedInput) => ({ ...input, candidateFacts: [] })],
    ["noncandidate country code", (input: DerivedInput) => ({
      ...input,
      candidateFacts: input.candidateFacts.map((fact) => fact.fieldPath === "country.code"
        ? { ...fact, status: "conflict" as const }
        : fact),
    })],
    ["ambiguous country code", (input: DerivedInput) => ({
      ...input,
      candidateFacts: [...input.candidateFacts, input.candidateFacts[0]!],
    })],
    ["mismatched ISO2", (input: DerivedInput) => ({ ...input, countryCode: "MY" })],
    ["register country drift", (input: DerivedInput) => ({
      ...input,
      sourceRegister: { ...input.sourceRegister, countryCode: "MY" },
    })],
    ["inactive primary source", (input: DerivedInput) => ({
      ...input,
      primarySourceId: "source-c",
      sourceRegister: {
        ...input.sourceRegister,
        sources: [...input.sourceRegister.sources, source("source-c")],
      },
    })],
    ["missing source record", (input: DerivedInput) => ({
      ...input,
      sourceRegister: {
        ...input.sourceRegister,
        sources: input.sourceRegister.sources.slice(1),
      },
    })],
    ["invalid retrieval timestamp", (input: DerivedInput) => withSource(input, "source-a", {
      retrievedAt: "2026-07-13T01:00:00+00:00",
    })],
    ["invalid publication timestamp", (input: DerivedInput) => withSource(input, "source-b", {
      publishedAt: "not-a-timestamp",
    })],
    ["unsupported credibility", (input: DerivedInput) => withSource(input, "source-a", {
      credibility: "TRUST_ME" as never,
    })],
    ["unsupported inactive source family", (input: DerivedInput) => ({
      ...input,
      sourceRegister: {
        ...input.sourceRegister,
        sources: [...input.sourceRegister.sources, source("source-c", {
          sourceFamily: "blog" as never,
        })],
      },
    })],
    ["invalid inactive source URL", (input: DerivedInput) => ({
      ...input,
      sourceRegister: {
        ...input.sourceRegister,
        sources: [...input.sourceRegister.sources, source("source-c", {
          sourceUrl: "file:///private/source-c",
        })],
      },
    })],
    ["duplicate source ID", (input: DerivedInput) => ({
      ...input,
      sourceRegister: {
        ...input.sourceRegister,
        sources: [...input.sourceRegister.sources, input.sourceRegister.sources[0]!],
      },
    })],
    ["source locator drift", (input: DerivedInput) => withSource(input, "source-a", {
      evidenceLocators: [],
    })],
    ["duplicate source locators", (input: DerivedInput) => withSource(input, "source-a", {
      evidenceLocators: ["json:/country/id", "json:/country/id"],
    })],
    ["fact ID drift", (input: DerivedInput) => ({
      ...input,
      candidateFacts: input.candidateFacts.map((fact, index) =>
        index === 0 ? { ...fact, factId: "fact-drifted" } : fact),
    })],
    ["fact extraction drift", (input: DerivedInput) => ({
      ...input,
      candidateFacts: input.candidateFacts.map((fact, index) =>
        index === 0 ? { ...fact, extractionMethod: "hermes" as never } : fact),
    })],
    ["operator-supplied derived fact", (input: DerivedInput) => ({
      ...input,
      candidateFacts: [...input.candidateFacts, derivedFact("marketOverview.source")],
    })],
    ["duplicate derived paths", (input: DerivedInput) => ({
      ...input,
      candidateFacts: [
        ...input.candidateFacts,
        derivedFact("marketOverview.source"),
        derivedFact("marketOverview.source"),
      ],
    })],
  ])("rejects %s", (_label, mutate) => {
    expectInvalid(mutate(completeInput()));
  });

  test("rejects ISO2 fact value drift and incomplete ISO2 evidence ownership", () => {
    const input = completeInput();
    const code = input.candidateFacts[0]!;
    expectInvalid({
      ...input,
      candidateFacts: [{
        ...code,
        evidence: [{ ...code.evidence[0]!, normalizedValue: "MY" }],
      }, input.candidateFacts[1]!],
    });
    expectInvalid({
      ...input,
      candidateFacts: [{ ...code, evidence: [] }, input.candidateFacts[1]!],
    });
  });

  test("rejects equal maximum instants with incomparable timestamp representations", () => {
    expectInvalid(withSource(completeInput(), "source-a", {
      retrievedAt: "2026-07-13T02:00:00Z",
    }));
  });

  test("rejects accessor and proxy inputs without leaking their errors", () => {
    const secret = "DERIVED_SECRET_MUST_NOT_LEAK";
    const input = completeInput();
    Object.defineProperty(input, "primarySourceId", {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });
    const error = captureError(() => materializeBasicDerivedFacts(input));
    expect(error?.message).toBe(ERROR);
    expect(error?.message).not.toContain(secret);
    expectInvalid(new Proxy(completeInput(), {}) as DerivedInput);
  });

  test("rejects generic arrays and strings beyond the bounded JSON limits", () => {
    const oversizedArray = completeInput();
    const countryName = oversizedArray.candidateFacts[1]!;
    expectInvalid({
      ...oversizedArray,
      candidateFacts: [oversizedArray.candidateFacts[0]!, {
        ...countryName,
        evidence: [{
          ...countryName.evidence[0]!,
          rawValue: Array.from({ length: 257 }, () => null),
        }],
      }],
    });

    const oversizedString = completeInput();
    const sentinel = `DERIVED_SECRET-${"x".repeat(65_536)}`;
    const error = captureError(() => materializeBasicDerivedFacts({
      ...oversizedString,
      sourceRegister: {
        ...oversizedString.sourceRegister,
        sources: [{
          ...oversizedString.sourceRegister.sources[0]!,
          sourceName: sentinel,
        }, oversizedString.sourceRegister.sources[1]!],
      },
    }));
    expect(error?.message).toBe(ERROR);
    expect(error?.message).not.toContain("DERIVED_SECRET-");
  });

  test("rejects oversized candidate arrays before reading entries", () => {
    const input = completeInput();
    const probe = { executions: 0 };
    const candidateFacts = Array.from({ length: 257 }, () => input.candidateFacts[0]!);
    Object.defineProperty(candidateFacts, "0", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return input.candidateFacts[0]!;
      },
    });

    expectInvalid({ ...input, candidateFacts });
    expect(probe.executions).toBe(0);
  });
});

type DerivedInput = Parameters<typeof materializeBasicDerivedFacts>[0];

function completeInput(
  overrides: Readonly<{ publishedAt?: string | null }> = {},
): DerivedInput {
  const sources = [
    source("source-a", {
      sourceName: "Statistics bureau",
      sourceUrl: "https://data.example/source-a",
      retrievedAt: "2026-07-13T01:00:00.000Z",
      publishedAt: overrides.publishedAt === undefined
        ? "2026-07-01T00:00:00.000Z"
        : overrides.publishedAt,
      credibility: "OFFICIAL",
      evidenceLocators: ["json:/country/id"],
    }),
    source("source-b", {
      sourceName: "Primary ministry",
      sourceUrl: "https://data.example/source-b",
      retrievedAt: "2026-07-13T02:00:00.000Z",
      publishedAt: overrides.publishedAt === undefined
        ? "2026-07-02T00:00:00.000Z"
        : overrides.publishedAt,
      credibility: "ESTIMATED",
      evidenceLocators: ["json:/country/name"],
    }),
  ];
  return {
    countryCode: "ID",
    primarySourceId: "source-b",
    sourceRegister: register(sources),
    candidateFacts: [
      sourceFact("source-a", "country.code", "json:/country/id", "ID", "ID"),
      sourceFact(
        "source-b",
        "country.name",
        "json:/country/name",
        "Indonesia",
        { zh: "印度尼西亚", en: "Indonesia" },
        "manual",
      ),
    ],
  };
}

function register(sources: readonly BasicSourceRecord[]): BasicSourceRegisterV2 {
  return {
    schemaVersion: "basic-country-audit/v2",
    runId: "run-20260713",
    countryCode: "ID",
    catalogVersion: "2026.07.13.editorial-1",
    catalogSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    sources,
  };
}

function source(
  sourceId: string,
  overrides: Partial<BasicSourceRecord> = {},
): BasicSourceRecord {
  return {
    sourceId,
    sourceName: `${sourceId} name`,
    sourceUrl: `https://data.example/${sourceId}`,
    retrievedAt: "2026-07-13T01:00:00.000Z",
    publishedAt: "2026-07-01T00:00:00.000Z",
    contentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    evidenceLocators: ["json:/country/id"],
    sourceFamily: "government",
    accessStatus: "open",
    accessNotes: null,
    credibility: "OFFICIAL",
    discoveryOnly: false,
    promptInjectionRisk: "none",
    ...overrides,
  };
}

function sourceFact(
  sourceId: string,
  fieldPath: string,
  locator: string,
  rawValue: BasicExtractedFactV2["evidence"][number]["rawValue"],
  normalizedValue: BasicExtractedFactV2["evidence"][number]["normalizedValue"],
  extractionMethod: "deterministic" | "manual" = "deterministic",
): BasicExtractedFactV2 {
  return materializeBasicSourceFactsV2([{
    sourceId,
    fieldPath,
    locator,
    rawValue,
    normalizedValue,
    unit: null,
    year: null,
    uncertainty: null,
  }], extractionMethod)[0]!;
}

function derivedFact(fieldPath: string): BasicExtractedFactV2 {
  return {
    factId: "fact-operator-supplied",
    fieldPath,
    status: "candidate",
    evidence: [{
      sourceId: "source-b",
      locator: "metadata:/sourceName",
      rawValue: "Primary ministry",
      normalizedValue: "Primary ministry",
      unit: null,
      year: null,
    }],
    extractionMethod: "deterministic",
    uncertainty: null,
  };
}

function withSource(
  input: DerivedInput,
  sourceId: string,
  overrides: Partial<BasicSourceRecord>,
): DerivedInput {
  return {
    ...input,
    sourceRegister: {
      ...input.sourceRegister,
      sources: input.sourceRegister.sources.map((item) =>
        item.sourceId === sourceId ? { ...item, ...overrides } : item),
    },
  };
}

function factAt(facts: readonly BasicExtractedFactV2[], fieldPath: string) {
  const fact = facts.find((item) => item.fieldPath === fieldPath);
  expect(fact, `missing ${fieldPath}`).toBeDefined();
  return fact!;
}

function evidenceAt(facts: readonly BasicExtractedFactV2[], fieldPath: string) {
  return factAt(facts, fieldPath).evidence;
}

function valueAt(facts: readonly BasicExtractedFactV2[], fieldPath: string) {
  return evidenceAt(facts, fieldPath)[0]?.normalizedValue;
}

function metadataEvidence(
  sourceId: string,
  locator: string,
  rawValue: string,
  normalizedValue: string,
) {
  return { sourceId, locator, rawValue, normalizedValue, unit: null, year: null };
}

function expectInvalid(input: DerivedInput): void {
  expect(() => materializeBasicDerivedFacts(input)).toThrow(ERROR);
}

function captureError(callback: () => unknown): Error | null {
  try {
    callback();
    return null;
  } catch (error) {
    return error as Error;
  }
}

function withForbiddenRuntimeSentinels<T>(callback: () => T): T {
  const names = ["fetch", "model", "Hermes", "llama", "SearXNG", "search", "socket", "child_process"];
  const globalDescriptors = names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ] as const);
  const environmentDescriptor = Object.getOwnPropertyDescriptor(process, "env");
  const denied = (name: string): never => {
    throw new Error(`forbidden runtime access: ${name}`);
  };

  try {
    for (const [name, descriptor] of globalDescriptors) {
      if (descriptor?.configurable === false) continue;
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => denied(name),
      });
    }
    if (environmentDescriptor?.configurable !== false) {
      Object.defineProperty(process, "env", {
        configurable: true,
        get: () => denied("process.env"),
      });
    }
    return callback();
  } finally {
    for (const [name, descriptor] of globalDescriptors) {
      if (descriptor?.configurable === false) continue;
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
    if (environmentDescriptor?.configurable !== false) {
      if (environmentDescriptor === undefined) Reflect.deleteProperty(process, "env");
      else Object.defineProperty(process, "env", environmentDescriptor);
    }
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
