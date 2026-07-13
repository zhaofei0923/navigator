import { describe, expect, test } from "vitest";

import {
  parseBasicManualSourceReview,
  parseBasicStructuredSourceReview,
} from "./collection/basic-source-review-parser.js";

const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const STRUCTURED_ERROR = "structured source review is invalid";
const MANUAL_ERROR = "manual source review is invalid";

type MutableRecord = Record<string | symbol, unknown>;

function expected(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-20260712",
    countryCode: "VN",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    deterministicSourceIds: ["energy-csv", "world-bank"],
    manualSourceIds: ["energy-html", "energy-pdf"],
    ...overrides,
  };
}

function structured(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "basic-structured-source-review/v1",
    runId: "run-20260712",
    countryCode: "VN",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    sources: [
      {
        sourceId: "energy-csv",
        sourceCheck: { status: "passed", notes: "CSV mapping reviewed" },
      },
      {
        sourceId: "world-bank",
        sourceCheck: { status: "failed", notes: null },
      },
    ],
    injectionRisks: [
      {
        sourceId: "energy-csv",
        locator: "csv:/rows/0/columns/value",
        severity: "suspected",
        details: "Ignore prior instructions",
      },
      {
        sourceId: "world-bank",
        locator: "json:/records/0/value",
        severity: "confirmed",
        details: "Prompt-like document content",
      },
    ],
    ...overrides,
  };
}

function manual(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "basic-manual-source-review/v1",
    runId: "run-20260712",
    countryCode: "VN",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    sources: [
      {
        sourceId: "energy-html",
        publishedAt: null,
        accessNotes: "Public page reviewed",
        promptInjectionRisk: "suspected",
        sourceCheck: {
          status: "failed",
          notes: "Publication date was not stated on the page",
        },
        injectionRisks: [
          {
            locator: "html:section=tariffs",
            severity: "suspected",
            details: "Instruction-like text in a sidebar",
          },
        ],
      },
      {
        sourceId: "energy-pdf",
        publishedAt: "2026-07-11T00:00:00.000Z",
        accessNotes: null,
        promptInjectionRisk: "none",
        sourceCheck: { status: "passed", notes: null },
        injectionRisks: [],
      },
    ],
    ...overrides,
  };
}

function expectStructuredInvalid(value: unknown, identity = expected()): void {
  expect(() => parseBasicStructuredSourceReview(value, identity as never))
    .toThrow(STRUCTURED_ERROR);
}

function expectManualInvalid(value: unknown, identity = expected()): void {
  expect(() => parseBasicManualSourceReview(value, identity as never))
    .toThrow(MANUAL_ERROR);
}

function unsafeRecord(
  value: Record<string, unknown>,
  kind: "extra" | "missing" | "accessor" | "symbol" | "proxy",
  probe = { executions: 0 },
): unknown {
  const copy = { ...value } as MutableRecord;
  if (kind === "extra") return { ...copy, extra: true };
  if (kind === "missing") {
    delete copy.schemaVersion;
    return copy;
  }
  if (kind === "accessor") {
    Object.defineProperty(copy, "runId", {
      enumerable: true,
      get() {
        probe.executions += 1;
        return "run-20260712";
      },
    });
    return copy;
  }
  if (kind === "symbol") return { ...copy, [Symbol("hidden")]: true };
  return new Proxy(copy, {
    get(target, property, receiver) {
      probe.executions += 1;
      return Reflect.get(target, property, receiver);
    },
  });
}

function nestedArrays(depth: number, leaf: unknown): unknown {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

describe("Basic structured source review parser", () => {
  test("reconstructs exact source checks and risks with recursive freezing", () => {
    const input = structured();
    const result = parseBasicStructuredSourceReview(input, expected() as never);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.sources).not.toBe(input.sources);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(Object.isFrozen(result.sources[0])).toBe(true);
    expect(Object.isFrozen(result.sources[0]?.sourceCheck)).toBe(true);
    expect(Object.isFrozen(result.injectionRisks)).toBe(true);
    expect(Object.isFrozen(result.injectionRisks[0])).toBe(true);
  });

  test("preserves reviewed source-check notes verbatim", () => {
    const note = "  Reviewed exactly as entered.  ";
    const value = structured();
    ((value.sources as Record<string, unknown>[])[0]?.sourceCheck as MutableRecord)
      .notes = note;

    const result = parseBasicStructuredSourceReview(value, expected() as never);

    expect(result.sources[0]?.sourceCheck.notes).toBe(note);
  });

  test.each([
    "extra",
    "missing",
    "accessor",
    "symbol",
    "proxy",
  ] as const)("rejects a top-level %s without executing it", (kind) => {
    const probe = { executions: 0 };
    expectStructuredInvalid(unsafeRecord(structured(), kind, probe));
    expect(probe.executions).toBe(0);
  });

  test("rejects cyclic, sparse, deep, and non-finite input values", () => {
    const cyclic = structured();
    cyclic.cycle = cyclic;
    const sparse = structured();
    sparse.sources = new Array(1);
    const deep = structured({
      sources: nestedArrays(65, "REVIEW_DEPTH_MUST_NOT_LEAK"),
    });
    const nonFinite = structured({ sources: [Number.NaN] });

    expectStructuredInvalid(cyclic);
    expectStructuredInvalid(sparse);
    expectStructuredInvalid(deep);
    expectStructuredInvalid(nonFinite);
  });

  test("rejects a 65-level nested review value without leaking it", () => {
    const sentinel = "REVIEW_DEPTH_MUST_NOT_LEAK";
    const value = structured({ sources: nestedArrays(65, sentinel) });

    try {
      parseBasicStructuredSourceReview(value, expected() as never);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(STRUCTURED_ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });

  test.each([
    ["schema", "schemaVersion", "basic-manual-source-review/v1"],
    ["run", "runId", "run-other"],
    ["country", "countryCode", "ID"],
    ["catalog version", "catalogVersion", "2026.07.13"],
    ["catalog digest", "catalogSha256", "0".repeat(64)],
  ])("rejects a mismatched %s identity", (_label, key, replacement) => {
    expectStructuredInvalid(structured({ [key]: replacement }));
  });

  test.each([
    ["empty source coverage", []],
    ["unknown source", [{ sourceId: "unknown", sourceCheck: { status: "passed", notes: null } }]],
    ["missing source", [{ sourceId: "energy-csv", sourceCheck: { status: "passed", notes: null } }]],
    ["unsorted sources", [
      { sourceId: "world-bank", sourceCheck: { status: "passed", notes: null } },
      { sourceId: "energy-csv", sourceCheck: { status: "passed", notes: null } },
    ]],
    ["duplicate source", [
      { sourceId: "energy-csv", sourceCheck: { status: "passed", notes: null } },
      { sourceId: "energy-csv", sourceCheck: { status: "failed", notes: null } },
    ]],
  ])("rejects %s coverage", (_label, sources) => {
    expectStructuredInvalid(structured({ sources }));
  });

  test.each([
    ["invalid check status", { status: "pending", notes: null }],
    ["blank check note", { status: "passed", notes: "  " }],
    ["non-string check note", { status: "passed", notes: 1 }],
  ])("rejects %s", (_label, sourceCheck) => {
    const value = structured();
    (value.sources as Record<string, unknown>[])[0]!.sourceCheck = sourceCheck;
    expectStructuredInvalid(value);
  });

  test.each([
    ["unknown risk source", [{ ...structuredRisk(), sourceId: "unknown" }]],
    ["blank risk locator", [{ ...structuredRisk(), locator: " " }]],
    ["malformed JSON locator", [{ ...structuredRisk(), locator: "json:/bad~2token" }]],
    ["malformed CSV locator", [{ ...structuredRisk(), locator: "csv:/rows/01/columns/value" }]],
    ["invalid risk severity", [{ ...structuredRisk(), severity: "none" }]],
    ["blank risk details", [{ ...structuredRisk(), details: "  " }]],
  ])("rejects %s", (_label, injectionRisks) => {
    expectStructuredInvalid(structured({ injectionRisks }));
  });

  test("preserves unsorted duplicate reviewed risks", () => {
    const injectionRisks = [
      { ...structuredRisk(), sourceId: "world-bank", locator: "json:/z" },
      structuredRisk(),
      structuredRisk(),
    ];

    const result = parseBasicStructuredSourceReview(
      structured({ injectionRisks }),
      expected() as never,
    );

    expect(result.injectionRisks).toEqual(injectionRisks);
  });

  test("accepts a root JSON pointer without asserting source fact membership", () => {
    const result = parseBasicStructuredSourceReview(structured({
      injectionRisks: [{
        sourceId: "energy-csv",
        locator: "json:",
        severity: "suspected",
        details: "Reviewed root-level content",
      }],
    }), expected() as never);

    expect(result.injectionRisks[0]?.locator).toBe("json:");
  });

  test("accepts exactly 256 risk rows", () => {
    const injectionRisks = risks(256);

    const result = parseBasicStructuredSourceReview(
      structured({ injectionRisks }),
      expected() as never,
    );

    expect(result.injectionRisks).toEqual(injectionRisks);
  });

  test("rejects 257 risk rows", () => {
    expectStructuredInvalid(structured({ injectionRisks: risks(257) }));
  });

  test.each([
    ["review sources", (value: Record<string, unknown>) => { value.sources = sourceChecks(65); }, expected({ deterministicSourceIds: sourceIds(65) })],
  ])("rejects the %s resource limit", (_label, change, identity) => {
    const value = structured();
    change(value);
    expectStructuredInvalid(value, identity);
  });

  test("accepts a 65,536-byte UTF-8 risk detail", () => {
    const details = "\u{1F642}".repeat(16_384);
    const injectionRisks = [{ ...structuredRisk(), details }];

    const result = parseBasicStructuredSourceReview(
      structured({ injectionRisks }),
      expected() as never,
    );

    expect(result.injectionRisks[0]?.details).toBe(details);
  });

  test("rejects a 65,537-byte UTF-8 risk detail", () => {
    const details = `${"\u{1F642}".repeat(16_384)}x`;
    expectStructuredInvalid(structured({
      injectionRisks: [{ ...structuredRisk(), details }],
    }));
  });
});

describe("Basic manual source review parser", () => {
  test("reconstructs exact manual review input with recursive freezing", () => {
    const input = manual();
    const result = parseBasicManualSourceReview(input, expected() as never);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(Object.isFrozen(result.sources[0])).toBe(true);
    expect(Object.isFrozen(result.sources[0]?.sourceCheck)).toBe(true);
    expect(Object.isFrozen(result.sources[0]?.injectionRisks)).toBe(true);
    expect(Object.isFrozen(result.sources[0]?.injectionRisks[0])).toBe(true);
  });

  test("accepts failed checks because preflight owns blocking", () => {
    const result = parseBasicManualSourceReview(manual(), expected() as never);

    expect(result.sources[0]?.sourceCheck.status).toBe("failed");
  });

  test.each([
    "extra",
    "missing",
    "accessor",
    "symbol",
    "proxy",
  ] as const)("rejects a top-level %s without executing it", (kind) => {
    const probe = { executions: 0 };
    expectManualInvalid(unsafeRecord(manual(), kind, probe));
    expect(probe.executions).toBe(0);
  });

  test.each([
    ["schema", "schemaVersion", "basic-structured-source-review/v1"],
    ["run", "runId", "run-other"],
    ["country", "countryCode", "ID"],
    ["catalog version", "catalogVersion", "2026.07.13"],
    ["catalog digest", "catalogSha256", "0".repeat(64)],
  ])("rejects a mismatched %s identity", (_label, key, replacement) => {
    expectManualInvalid(manual({ [key]: replacement }));
  });

  test.each([
    ["empty source coverage", []],
    ["unknown source", [manualSource("unknown")]],
    ["missing source", [manualSource("energy-html")]],
    ["unsorted sources", [manualSource("energy-pdf"), manualSource("energy-html")]],
    ["duplicate source", [manualSource("energy-html"), manualSource("energy-html")]],
  ])("rejects %s coverage", (_label, sources) => {
    expectManualInvalid(manual({ sources }));
  });

  test.each([
    ["non-UTC publication timestamp", "2026-07-11T00:00:00+00:00"],
    ["invalid calendar timestamp", "2026-02-29T00:00:00.000Z"],
    ["blank access notes", "  "],
    ["missing prompt injection risk", undefined],
    ["invalid prompt injection risk", "unknown"],
  ])("rejects %s", (_label, replacement) => {
    const value = manual();
    const source = (value.sources as Record<string, unknown>[])[0]!;
    if (_label.includes("publication")) source.publishedAt = replacement;
    else if (_label.includes("access")) source.accessNotes = replacement;
    else source.promptInjectionRisk = replacement;
    expectManualInvalid(value);
  });

  test("requires a nonblank source-check note when publication date is null", () => {
    const value = manual();
    ((value.sources as Record<string, unknown>[])[0]?.sourceCheck as MutableRecord)
      .notes = " ";
    expectManualInvalid(value);
  });

  test.each([
    ["none with a local risk", "none", [manualRisk("suspected")]],
    ["suspected without a matching risk", "suspected", [manualRisk("confirmed")]],
    ["confirmed without a matching risk", "confirmed", [manualRisk("suspected")]],
    ["blank local locator", "suspected", [{ ...manualRisk("suspected"), locator: " " }]],
    ["malformed HTML locator", "suspected", [{ ...manualRisk("suspected"), locator: "html:" }]],
    ["malformed PDF locator", "suspected", [{ ...manualRisk("suspected"), locator: "pdf:page=0#anchor" }]],
    ["blank local details", "suspected", [{ ...manualRisk("suspected"), details: " " }]],
  ])("rejects %s", (_label, promptInjectionRisk, injectionRisks) => {
    const value = manual();
    const source = (value.sources as Record<string, unknown>[])[0]!;
    source.promptInjectionRisk = promptInjectionRisk;
    source.injectionRisks = injectionRisks;
    expectManualInvalid(value);
  });

  test("permits additional supported local risks with their own severities", () => {
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.injectionRisks = [
      manualRisk("confirmed", "html:section=advisory"),
      manualRisk("suspected", "pdf:page=2#appendix"),
    ];
    (value.sources as Record<string, unknown>[])[0]!.promptInjectionRisk =
      "confirmed";

    const result = parseBasicManualSourceReview(value, expected() as never);

    expect(result.sources[0]?.injectionRisks).toHaveLength(2);
  });

  test("preserves unsorted duplicate reviewed local risks", () => {
    const injectionRisks = [
      manualRisk("confirmed", "pdf:page=2#appendix"),
      manualRisk("suspected", "html:section=overview"),
      manualRisk("suspected", "html:section=overview"),
    ];
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.promptInjectionRisk = "confirmed";
    (value.sources as Record<string, unknown>[])[0]!.injectionRisks = injectionRisks;

    const result = parseBasicManualSourceReview(value, expected() as never);

    expect(result.sources[0]?.injectionRisks).toEqual(injectionRisks);
  });

  test("rejects overlap between deterministic and manual source identities", () => {
    const identity = expected({
      deterministicSourceIds: ["energy-csv", "energy-html", "world-bank"],
    });
    expectStructuredInvalid(structured(), identity);
    expectManualInvalid(manual(), identity);
  });

  test("accepts exactly 256 local risks", () => {
    const injectionRisks = manualRisks(256);
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.injectionRisks = injectionRisks;
    (value.sources as Record<string, unknown>[])[0]!.promptInjectionRisk = "suspected";

    const result = parseBasicManualSourceReview(value, expected() as never);

    expect(result.sources[0]?.injectionRisks).toEqual(injectionRisks);
  });

  test("rejects 257 local risks", () => {
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.injectionRisks = manualRisks(257);
    (value.sources as Record<string, unknown>[])[0]!.promptInjectionRisk = "suspected";

    expectManualInvalid(value);
  });

  test("rejects 65 manual reviews", () => {
    const value = manual();
    value.sources = manualSources(65);
    expectManualInvalid(value, expected({ manualSourceIds: sourceIds(65) }));
  });

  test("accepts a 65,536-byte UTF-8 access note", () => {
    const accessNotes = "\u{1F642}".repeat(16_384);
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.accessNotes = accessNotes;

    const result = parseBasicManualSourceReview(value, expected() as never);

    expect(result.sources[0]?.accessNotes).toBe(accessNotes);
  });

  test("rejects a 65,537-byte UTF-8 access note", () => {
    const value = manual();
    (value.sources as Record<string, unknown>[])[0]!.accessNotes =
      `${"\u{1F642}".repeat(16_384)}x`;
    expectManualInvalid(value);
  });
});

describe("Basic source review identity expectations", () => {
  test.each([
    ["accessor", (identity: MutableRecord) => Object.defineProperty(identity, "runId", { enumerable: true, get: () => "run-20260712" })],
    ["symbol", (identity: MutableRecord) => { identity[Symbol("hidden")] = true; }],
    ["proxy", (identity: MutableRecord) => new Proxy(identity, {})],
    ["unsorted deterministic IDs", (identity: MutableRecord) => { identity.deterministicSourceIds = ["world-bank", "energy-csv"]; }],
    ["duplicate manual IDs", (identity: MutableRecord) => { identity.manualSourceIds = ["energy-html", "energy-html"]; }],
  ])("rejects an invalid expectation: %s", (_label, change) => {
    const identity = expected() as MutableRecord;
    const changed = change(identity) ?? identity;
    expectStructuredInvalid(structured(), changed);
    expectManualInvalid(manual(), changed);
  });

  test("does not echo reviewed notes, locators, or details in errors", () => {
    const sentinel = "REVIEW_CONTENT_MUST_NOT_LEAK";
    const value = structured({
      injectionRisks: [{
        sourceId: "unknown",
        locator: `json:/${sentinel}`,
        severity: "suspected",
        details: sentinel,
      }],
    });

    for (const parse of [
      () => parseBasicStructuredSourceReview(value, expected() as never),
      () => parseBasicManualSourceReview(manual({ runId: sentinel }), expected() as never),
    ]) {
      try {
        parse();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(sentinel);
      }
    }
  });
});

function structuredRisk(): Record<string, unknown> {
  return {
    sourceId: "energy-csv",
    locator: "csv:/rows/0/columns/value",
    severity: "suspected",
    details: "Instruction-like content",
  };
}

function manualRisk(
  severity: "suspected" | "confirmed",
  locator = "html:section=overview",
): Record<string, unknown> {
  return { locator, severity, details: "Instruction-like content" };
}

function manualSource(sourceId: string): Record<string, unknown> {
  return {
    sourceId,
    publishedAt: "2026-07-11T00:00:00.000Z",
    accessNotes: null,
    promptInjectionRisk: "none",
    sourceCheck: { status: "passed", notes: null },
    injectionRisks: [],
  };
}

function sourceIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `source-${String(index).padStart(3, "0")}`);
}

function sourceChecks(count: number): Record<string, unknown>[] {
  return sourceIds(count).map((sourceId) => ({
    sourceId,
    sourceCheck: { status: "passed", notes: null },
  }));
}

function risks(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: "energy-csv",
    locator: `csv:/rows/${index}/columns/value`,
    severity: "suspected",
    details: `Risk ${String(index).padStart(3, "0")}`,
  }));
}

function manualSources(count: number): Record<string, unknown>[] {
  return sourceIds(count).map(manualSource);
}

function manualRisks(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => manualRisk(
    "suspected",
    `html:section=${String(index).padStart(3, "0")}`,
  ));
}
