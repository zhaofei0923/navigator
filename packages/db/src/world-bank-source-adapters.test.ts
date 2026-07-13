import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { worldBankCountryAdapter } from "./collection/adapters/world-bank-country.js";
import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./collection/adapters/world-bank-indicators.js";
import type { BasicDeterministicSourceAdapter } from "./collection/basic-source-adapter-contracts.js";
import { resolveBasicSourceAdapter } from "./collection/basic-source-adapter-registry.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";

const COUNTRY_SHA256 =
  "7ddd064eb77613024ad050f7b885a61c239c01692ec59ef4b352ed100f2b7525";
const POPULATION_SHA256 =
  "4f1ca6321f935f15850e5ada927c7d6f4a2a2d43b44a3c52b8d85cb899681cdd";
const GDP_SHA256 =
  "8fb1bd9738f682a7ac2e5cadf36afa6565687f30df51355b7cfb3afc4f182386";
const GDP_GROWTH_SHA256 =
  "b8360f2686bf2de0706bd454be394736912f6f91fa199e257089a867e1dcb483";

const COUNTRY_FIXTURE = readVerifiedFixture(
  "world-bank-country-vn.json",
  COUNTRY_SHA256,
);
const INDICATOR_CASES = [
  {
    fixture: readVerifiedFixture(
      "world-bank-population-vn.json",
      POPULATION_SHA256,
    ),
    expectedSha256: POPULATION_SHA256,
    indicator: "SP.POP.TOTL",
    fieldPath: "marketOverview.population",
    unit: "people",
    value: 101598527,
  },
  {
    fixture: readVerifiedFixture("world-bank-gdp-vn.json", GDP_SHA256),
    expectedSha256: GDP_SHA256,
    indicator: "NY.GDP.MKTP.CD",
    fieldPath: "marketOverview.gdp",
    unit: "current US$",
    value: 514697215165.065,
  },
  {
    fixture: readVerifiedFixture(
      "world-bank-gdp-growth-vn.json",
      GDP_GROWTH_SHA256,
    ),
    expectedSha256: GDP_GROWTH_SHA256,
    indicator: "NY.GDP.MKTP.KD.ZG",
    fieldPath: "marketOverview.gdpGrowth",
    unit: "%",
    value: 8.01882998978245,
  },
] as const;

describe("World Bank country adapter", () => {
  test("parses the hash-verified Vietnam country profile without deriving fields", () => {
    expect(COUNTRY_FIXTURE).toMatchObject({
      requestUrl: "https://api.worldbank.org/v2/country/VN?format=json",
      recordedAt: "2026-07-10T09:40:00Z",
      contentSha256: COUNTRY_SHA256,
    });
    expect(COUNTRY_FIXTURE.contentSha256).toBe(COUNTRY_SHA256);
    expect(sha256(COUNTRY_FIXTURE.body)).toBe(COUNTRY_SHA256);

    expect(worldBankCountryAdapter.request("VN")).toEqual({
      method: "GET",
      url: COUNTRY_FIXTURE.requestUrl,
      accept: "application/json",
      allowedOrigins: ["https://api.worldbank.org"],
      allowedQueryParameters: ["format"],
    });
    expect(worldBankCountryAdapter).toMatchObject({
      adapterId: "world-bank-country",
      adapterVersion: "1.0.0",
      sourceId: "world-bank-country",
      sourceName: "World Bank",
      sourceFamily: "international-organization",
      credibility: "OFFICIAL",
    });

    const output = worldBankCountryAdapter.extract(adapterInput(COUNTRY_FIXTURE.body));

    const response: unknown = JSON.parse(new TextDecoder().decode(COUNTRY_FIXTURE.body));
    expect(Array.isArray(response) ? response[0] : null).toMatchObject(
      { page: 1, pages: 1, per_page: "50", total: 1 },
    );
    expect(output).toEqual({
      publishedAt: null,
      promptInjectionRisk: "none",
      accessNotes: null,
      observations: [
        {
          fieldPath: "country.code",
          locator: "json:/1/0/iso2Code",
          rawValue: "VN",
          normalizedValue: "VN",
          unit: null,
          year: null,
          uncertainty: null,
        },
        {
          fieldPath: "country.name",
          locator: "json:/1/0/name",
          rawValue: "Viet Nam",
          normalizedValue: { zh: "", en: "Viet Nam" },
          unit: null,
          year: null,
          uncertainty: null,
        },
      ],
    });
  });

  test.each([
    ["a malformed envelope", () => Uint8Array.from([123])],
    ["pagination", () => mutateCountry(({ metadata }) => ({ ...metadata, pages: 2 }))],
    ["an extra country record", () => mutateCountry(({ metadata, records }) => [metadata, [...records, records[0]]])],
    ["an ISO mismatch", () => mutateCountry(({ metadata, records }) => [metadata, [{ ...records[0], iso2Code: "ID" }]])],
    ["an empty country name", () => mutateCountry(({ metadata, records }) => [metadata, [{ ...records[0], name: "" }]])],
    ["a whitespace-only country name", () => mutateCountry(({ metadata, records }) => [metadata, [{ ...records[0], name: " \t " }]])],
  ])("rejects %s", (_label, createBody) => {
    const body = createBody();
    expect(() => worldBankCountryAdapter.extract(adapterInput(body))).toThrow(
      "world bank country response is invalid",
    );
  });
});

describe("World Bank adapter documentation", () => {
  test("keeps mrv and null-observation semantics consistent", () => {
    const design = readRepoDocument(
      "docs/superpowers/specs/2026-07-10-basic-source-adapters-design.md",
    );
    const runtime = readRepoDocument("docs/basic-country-source-adapters.md");
    const plan = readRepoDocument(
      "docs/superpowers/plans/2026-07-10-basic-source-adapters-plan.md",
    );

    expect(design).not.toContain(
      "supports JSON, ISO country queries, most-recent non-empty values",
    );
    expect(design).toContain(
      "The `mrv` parameter means most recent values; it does not promise most-recent non-empty values.",
    );
    expect(design).not.toContain("A null WDI record is omitted");
    expect(design).toContain(
      "A null WDI record produces one candidate observation",
    );
    expect(runtime).not.toContain("`null` WDI record 被省略");
    expect(runtime).toContain(
      "`null` WDI record 必须产生一个 `candidate` observation",
    );
    expect(plan).toContain(
      "A synthetic null `value` must emit raw and normalized `null` without guessing.",
    );
  });
});

describe("World Bank catalog bindings", () => {
  test("preserves requests and keeps fixture observations inside catalog field paths", () => {
    const catalogPath = fileURLToPath(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
    );
    const catalogValue: unknown = JSON.parse(readFileSync(catalogPath, "utf8"));
    const catalog = parseBasicSourceCatalog(catalogValue);
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: [
        "world-bank-country",
        "world-bank-gdp",
        "world-bank-gdp-growth",
        "world-bank-population",
      ],
    });
    const fixtures = new Map<string, Uint8Array>([
      ["world-bank-country", COUNTRY_FIXTURE.body],
      ...INDICATOR_CASES.map(({ indicator, fixture }) => [
        adapterFor(indicator).sourceId,
        fixture.body,
      ] as const),
    ]);

    for (const entry of plan.sources) {
      const adapter = resolveBasicSourceAdapter(entry, "VN");
      expect(entry.request).toEqual(adapter.request("VN"));
      const body = fixtures.get(entry.source.sourceId);
      if (body === undefined) throw new Error("catalog fixture is missing");
      const observations = adapter.extract(adapterInput(body)).observations;
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every(({ fieldPath }) =>
        entry.source.fieldPaths.includes(fieldPath))).toBe(true);
    }
  });
});

describe("World Bank core indicator adapters", () => {
  test("exports the three fixed WDI adapters", () => {
    expect(WORLD_BANK_CORE_INDICATOR_ADAPTERS).toHaveLength(3);
    expect(WORLD_BANK_CORE_INDICATOR_ADAPTERS.map((adapter) => adapter.sourceId)).toEqual([
      "world-bank-population",
      "world-bank-gdp",
      "world-bank-gdp-growth",
    ]);
  });

  test.each(INDICATOR_CASES)(
    "parses the hash-verified $indicator WDI fixture",
    ({ fixture, expectedSha256, indicator, fieldPath, unit, value }) => {
      expect(fixture.recordedAt).toBe("2026-07-10T09:40:00Z");
      expect(fixture.contentSha256).toBe(expectedSha256);
      expect(sha256(fixture.body)).toBe(expectedSha256);

      const adapter = adapterFor(indicator);
      expect(adapter.request("VN")).toEqual({
        method: "GET",
        url: fixture.requestUrl,
        accept: "application/json",
        allowedOrigins: ["https://api.worldbank.org"],
        allowedQueryParameters: ["source", "format", "mrv", "per_page"],
      });
      const response: unknown = JSON.parse(new TextDecoder().decode(fixture.body));
      expect(Array.isArray(response) ? response[0] : null).toMatchObject(
        {
          page: 1,
          pages: 1,
          per_page: 1,
          total: 1,
          sourceid: "2",
          lastupdated: "2026-07-01",
        },
      );
      expect(adapter.extract(adapterInput(fixture.body))).toEqual({
        publishedAt: null,
        promptInjectionRisk: "none",
        accessNotes: null,
        observations: [
          {
            fieldPath,
            locator: "json:/1/0/value",
            rawValue: value,
            normalizedValue: value,
            unit,
            year: 2025,
            uncertainty: null,
          },
        ],
      });
    },
  );

  test.each([
    ["pagination", () => mutateIndicator(({ metadata, records }) => [{ ...metadata, pages: 2 }, records])],
    ["a missing record", () => mutateIndicator(({ metadata }) => [metadata, []])],
    ["a duplicate record", () => mutateIndicator(({ metadata, records }) => [metadata, [...records, records[0]]])],
    ["a wrong country", () => mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], country: { id: "ID" } }]])],
    ["an invalid year", () => mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], date: "25" }]])],
    ["a non-finite numeric value", () => replaceJsonToken(INDICATOR_CASES[0].fixture.body, '"value":101598527', '"value":1e400')],
    ["an unexpected indicator", () => mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], indicator: { id: "OTHER" } }]])],
    ["malformed source-2 metadata", () => mutateIndicator(({ metadata, records }) => [{ ...metadata, sourceid: 2 }, records])],
    ["an invalid source-2 update date", () => mutateIndicator(({ metadata, records }) => [{ ...metadata, lastupdated: "2026-99-99" }, records])],
  ])("rejects %s", (_label, createBody) => {
    const body = createBody();
    expect(() => adapterFor("SP.POP.TOTL").extract(adapterInput(body))).toThrow(
      "world bank indicator response is invalid",
    );
  });

  test("preserves a supported null indicator value", () => {
    const body = mutateIndicator(({ metadata, records }) => [
      metadata,
      [{ ...records[0], value: null }],
    ]);

    expect(adapterFor("SP.POP.TOTL").extract(adapterInput(body)).observations).toEqual([
      expect.objectContaining({ rawValue: null, normalizedValue: null }),
    ]);
  });
});

interface FixtureEnvelope {
  requestUrl: string;
  recordedAt: string;
  contentSha256: string;
  body: Uint8Array;
}

interface ParsedFixtureEnvelope {
  requestUrl: string;
  recordedAt: string;
  contentSha256: string;
  bodyBase64: string;
}

function readVerifiedFixture(
  name: string,
  expectedSha256: string,
): FixtureEnvelope {
  const pathname = fileURLToPath(
    new URL(`../fixtures/source-adapters/${name}`, import.meta.url),
  );
  const parsed: unknown = JSON.parse(readFileSync(pathname, "utf8"));
  if (!isFixtureEnvelope(parsed)) {
    throw new Error("fixture envelope is invalid");
  }
  const body = new Uint8Array(Buffer.from(parsed.bodyBase64, "base64"));
  if (
    parsed.contentSha256 !== expectedSha256 ||
    sha256(body) !== expectedSha256
  ) {
    throw new Error("fixture body digest is invalid");
  }
  return {
    requestUrl: parsed.requestUrl,
    recordedAt: parsed.recordedAt,
    contentSha256: parsed.contentSha256,
    body,
  };
}

function readRepoDocument(pathname: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../${pathname}`, import.meta.url)),
    "utf8",
  );
}

function isFixtureEnvelope(value: unknown): value is ParsedFixtureEnvelope {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    Object.hasOwn(value, "requestUrl") &&
    typeof value.requestUrl === "string" &&
    Object.hasOwn(value, "recordedAt") &&
    typeof value.recordedAt === "string" &&
    Object.hasOwn(value, "contentSha256") &&
    typeof value.contentSha256 === "string" &&
    Object.hasOwn(value, "bodyBase64") &&
    typeof value.bodyBase64 === "string"
  );
}

function adapterFor(indicator: string): BasicDeterministicSourceAdapter {
  const adapter = WORLD_BANK_CORE_INDICATOR_ADAPTERS.find((candidate) =>
    candidate.request("VN").url.includes(`/indicator/${indicator}?`),
  );
  if (adapter === undefined) {
    throw new Error("indicator adapter is missing");
  }
  return adapter;
}

function adapterInput(body: Uint8Array) {
  return {
    countryCode: "VN",
    requestUrl: "https://api.worldbank.org/v2/country/VN?format=json",
    finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
    contentType: "application/json",
    retrievedAt: "2026-07-10T09:40:00Z",
    body,
  };
}

function mutateCountry(
  mutation: (source: { metadata: Record<string, unknown>; records: Record<string, unknown>[] }) => unknown,
): Uint8Array {
  return mutateEnvelope(COUNTRY_FIXTURE.body, mutation);
}

function mutateIndicator(
  mutation: (source: { metadata: Record<string, unknown>; records: Record<string, unknown>[] }) => unknown,
): Uint8Array {
  return mutateEnvelope(INDICATOR_CASES[0].fixture.body, mutation);
}

function mutateEnvelope(
  body: Uint8Array,
  mutation: (source: { metadata: Record<string, unknown>; records: Record<string, unknown>[] }) => unknown,
): Uint8Array {
  const value: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!Array.isArray(value) || !isRecord(value[0]) || !Array.isArray(value[1])) {
    throw new Error("fixture body is invalid");
  }
  return new TextEncoder().encode(
    JSON.stringify(
      mutation({
        metadata: value[0],
        records: value[1].filter(isRecord),
      }),
    ),
  );
}

function replaceJsonToken(
  body: Uint8Array,
  sourceToken: string,
  replacementToken: string,
): Uint8Array {
  const text = new TextDecoder().decode(body);
  const tokenIndex = text.indexOf(sourceToken);
  if (tokenIndex < 0 || tokenIndex !== text.lastIndexOf(sourceToken)) {
    throw new Error("fixture JSON token is invalid");
  }
  return new TextEncoder().encode(
    `${text.slice(0, tokenIndex)}${replacementToken}${text.slice(tokenIndex + sourceToken.length)}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
