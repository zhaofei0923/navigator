import { describe, expect, test } from "vitest";

import {
  parseBasicDocumentObservationPlan,
} from "./collection/basic-document-observation-parser.js";

const CATALOG_SHA256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const CONTENT_SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ERROR = "document observation plan is invalid";
const REQUEST_URL_PREFIX = "https://documents.example/";

type MutableRecord = Record<string | symbol, unknown>;

function plan(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "basic-document-observation-plan/v1",
    runId: "run-20260712",
    countryCode: "VN",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    sourceId: "official-energy-policy",
    capture: capture(),
    observations: [
      editorialObservation(),
      sourceFactObservation(),
    ],
    ...overrides,
  };
}

function capture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapterId: "basic-manual-document-capture",
    adapterVersion: "1.0.0",
    requestUrl: "https://documents.example/policy?country=VN",
    retrievedAt: "2026-07-12T04:00:00.000Z",
    contentType: "text/html",
    byteLength: 1_024,
    contentSha256: CONTENT_SHA256,
    ...overrides,
  };
}

function sourceFactObservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    usage: "source-fact",
    fieldPath: "marketOverview.population",
    locator: "html:section=population-table;row=2025",
    rawValue: { source: "official", value: 101_598_527 },
    normalizedValue: 101_598_527,
    unit: "people",
    year: 2025,
    uncertainty: null,
    ...overrides,
  };
}

function editorialObservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    usage: "editorial-evidence",
    fieldPath: "country.summary",
    locator: "html:section=overview",
    rawValue: "Reviewed policy overview",
    ...overrides,
  };
}

function expectInvalid(value: unknown): void {
  expect(() => parseBasicDocumentObservationPlan(value)).toThrow(ERROR);
}

function unsafeRecord(
  value: Record<string, unknown>,
  kind: "accessor" | "proxy" | "symbol",
  probe = { executions: 0 },
): unknown {
  const copy = { ...value } as MutableRecord;
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

describe("Basic document observation plan parser", () => {
  test("reconstructs exact HTML capture and both observation variants", () => {
    const input = plan();

    const result = parseBasicDocumentObservationPlan(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.capture).not.toBe(input.capture);
    expect(result.observations).not.toBe(input.observations);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.capture)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    expect(Object.isFrozen(result.observations[0])).toBe(true);
    expect(Object.isFrozen(result.observations[1])).toBe(true);
  });

  test("preserves reconstructed raw JSON while canonicalizing generic object keys", () => {
    const value = plan({
      observations: [
        editorialObservation({ rawValue: { zebra: [true, null], alpha: { y: 1, x: 2 } } }),
        sourceFactObservation({ rawValue: { zebra: 2, alpha: 1 } }),
      ],
    });

    const result = parseBasicDocumentObservationPlan(value);
    const [editorial, sourceFact] = result.observations;

    expect(editorial?.rawValue).toEqual({ alpha: { x: 2, y: 1 }, zebra: [true, null] });
    expect(sourceFact?.rawValue).toEqual({ alpha: 1, zebra: 2 });
    expect(Object.keys(editorial?.rawValue as object)).toEqual(["alpha", "zebra"]);
    expect(Object.isFrozen(editorial?.rawValue)).toBe(true);
    expect(Object.isFrozen(sourceFact?.rawValue)).toBe(true);
  });

  test("accepts PDF locators only for a PDF capture", () => {
    const result = parseBasicDocumentObservationPlan(plan({
      capture: capture({ contentType: "application/pdf" }),
      observations: [
        editorialObservation({ locator: "pdf:page=1#policy-overview" }),
        sourceFactObservation({ locator: "pdf:page=2#population-table" }),
      ],
    }));

    expect(result.capture.contentType).toBe("application/pdf");
    expect(result.observations.map(({ locator }) => locator)).toEqual([
      "pdf:page=1#policy-overview",
      "pdf:page=2#population-table",
    ]);
  });

  test("rejects a malformed capture content type", () => {
    expectInvalid(plan({ capture: capture({ contentType: "text/html;" }) }));
  });

  test.each([
    ["surrounding whitespace", " https://documents.example/policy"],
    ["non-canonical origin", "https://documents.example"],
    [
      "an 8193-byte URL",
      `${REQUEST_URL_PREFIX}${"a".repeat(8_193 - REQUEST_URL_PREFIX.length)}`,
    ],
  ])("rejects a capture request URL with %s", (_label, requestUrl) => {
    expectInvalid(plan({ capture: capture({ requestUrl }) }));
  });

  test.each([
    ["extra top-level key", (value: Record<string, unknown>) => ({ ...value, extra: true })],
    ["missing top-level key", (value: Record<string, unknown>) => {
      const copy = { ...value };
      delete copy.sourceId;
      return copy;
    }],
    ["extra capture key", (value: Record<string, unknown>) => ({
      ...value,
      capture: { ...(value.capture as object), extra: true },
    })],
    ["missing capture key", (value: Record<string, unknown>) => {
      const captureValue = { ...(value.capture as Record<string, unknown>) };
      delete captureValue.byteLength;
      return { ...value, capture: captureValue };
    }],
  ])("rejects %s", (_label, mutate) => {
    expectInvalid(mutate(plan()));
  });

  test.each(["accessor", "proxy", "symbol"] as const)(
    "rejects a top-level %s without executing it",
    (kind) => {
      const probe = { executions: 0 };

      expectInvalid(unsafeRecord(plan(), kind, probe));

      expect(probe.executions).toBe(0);
    },
  );

  test.each([
    ["extra source-fact key", [
      editorialObservation(),
      sourceFactObservation({ extra: true }),
    ]],
    ["extra editorial key", [
      editorialObservation({ normalizedValue: "not permitted" }),
      sourceFactObservation(),
    ]],
    ["missing source-fact key", [
      editorialObservation(),
      (() => {
        const observation = sourceFactObservation();
        delete observation.year;
        return observation;
      })(),
    ]],
    ["missing editorial key", [
      (() => {
        const observation = editorialObservation();
        delete observation.rawValue;
        return observation;
      })(),
      sourceFactObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["empty observations", []],
    ["duplicate observation identity", [
      editorialObservation(),
      editorialObservation(),
      sourceFactObservation(),
    ]],
    ["unsorted observations", [
      sourceFactObservation(),
      editorialObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["source fact on an editorial path", [
      editorialObservation(),
      sourceFactObservation({ fieldPath: "marketOverview.overview" }),
    ]],
    ["editorial evidence on a source-backed path", [
      editorialObservation({ fieldPath: "marketOverview.population" }),
      sourceFactObservation(),
    ]],
    ["hybrid name as a source fact", [
      editorialObservation(),
      sourceFactObservation({ fieldPath: "country.name" }),
    ]],
    ["derived path as editorial evidence", [
      editorialObservation({ fieldPath: "country.updatedAt" }),
      sourceFactObservation(),
    ]],
  ])("rejects %s", (_label, observations) => {
    expectInvalid(plan({ observations }));
  });

  test.each([
    ["non-finite raw JSON", { rawValue: Number.NaN }],
    ["non-finite normalized JSON", { normalizedValue: Number.POSITIVE_INFINITY }],
    ["blank unit", { unit: "  " }],
    ["non-finite year", { year: Number.NaN }],
    ["blank uncertainty", { uncertainty: "\t" }],
  ])("rejects a source fact with %s", (_label, overrides) => {
    expectInvalid(plan({ observations: [
      editorialObservation(),
      sourceFactObservation(overrides),
    ] }));
  });

  test.each([
    ["HTML locator on a PDF capture", "application/pdf", "html:section=overview"],
    ["PDF locator on an HTML capture", "text/html", "pdf:page=1#overview"],
    ["page zero", "application/pdf", "pdf:page=0#overview"],
    ["blank PDF anchor", "application/pdf", "pdf:page=1#  "],
    ["blank HTML location", "text/html", "html:  "],
    ["HTML trailing whitespace", "text/html", "html:section=overview "],
    ["PDF trailing whitespace", "application/pdf", "pdf:page=1#overview "],
    ["NUL HTML location", "text/html", "html:section=over\0view"],
    ["NUL PDF anchor", "application/pdf", "pdf:page=1#over\0view"],
    ["C0 HTML location", "text/html", "html:section=over\u001Fview"],
    ["C0 PDF anchor", "application/pdf", "pdf:page=1#over\u001Fview"],
    ["DEL HTML location", "text/html", "html:section=over\u007Fview"],
    ["DEL PDF anchor", "application/pdf", "pdf:page=1#over\u007Fview"],
    ["URL location", "text/html", "html:https://search.example/?q=policy"],
    ["search location", "text/html", "html:search=renewable policy"],
    ["metadata location", "text/html", "html:metadata:/publishedAt"],
    ["capture location", "text/html", "html:capture:/retrievedAt"],
  ])("rejects %s", (_label, contentType, locator) => {
    expectInvalid(plan({
      capture: capture({ contentType }),
      observations: [
        editorialObservation({ locator }),
        sourceFactObservation({ locator: contentType === "application/pdf"
          ? "pdf:page=2#population-table"
          : "html:section=population-table" }),
      ],
    }));
  });

  test("accepts a 65536-byte JSON object key", () => {
    const key = "a".repeat(65_536);
    const result = parseBasicDocumentObservationPlan(plan({ observations: [
      editorialObservation({ rawValue: { [key]: "reviewed" } }),
      sourceFactObservation(),
    ] }));

    expect(result.observations[0]?.rawValue).toEqual({ [key]: "reviewed" });
  });

  test.each([
    ["an overlong key", "a".repeat(65_537)],
    ["an ill-formed Unicode key", "\uD800"],
  ])("rejects a JSON object with %s", (_label, key) => {
    expectInvalid(plan({ observations: [
      editorialObservation({ rawValue: { [key]: "reviewed" } }),
      sourceFactObservation(),
    ] }));
  });

  test("rejects cyclic, sparse, deep, oversized, and overlong input values", () => {
    const cyclic = plan();
    cyclic.cycle = cyclic;
    const sparse = plan({ observations: new Array(2) });
    const deep = plan({ observations: nestedArrays(65, "DOCUMENT_DEPTH_MUST_NOT_LEAK") });
    const oversized = plan({ observations: Array.from(
      { length: 257 },
      (_, index) => editorialObservation({
        fieldPath: `marketOverview.keyIndicators[${index}].label`,
        locator: `html:section=indicator-${index}`,
      }),
    ) });
    const overlong = plan({ observations: [
      editorialObservation({ rawValue: `${"x".repeat(65_536)}x` }),
      sourceFactObservation(),
    ] });

    expectInvalid(cyclic);
    expectInvalid(sparse);
    expectInvalid(deep);
    expectInvalid(oversized);
    expectInvalid(overlong);
  });

  test("returns a stable redacted error without inspecting document bytes", () => {
    const sentinel = "DOCUMENT_CONTENT_MUST_NOT_LEAK";
    const value = plan({ observations: nestedArrays(65, sentinel) });

    try {
      parseBasicDocumentObservationPlan(value);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });

  test("returns a stable redacted error without leaking rejected values", () => {
    const sentinel = "DOCUMENT_PLAN_VALUE_MUST_NOT_LEAK";
    const value = plan({ capture: capture({
      requestUrl: `${REQUEST_URL_PREFIX}${sentinel} `,
    }) });

    try {
      parseBasicDocumentObservationPlan(value);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(ERROR);
      expect((error as Error).message).not.toContain(sentinel);
    }
  });
});
