import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { worldBankCountryAdapter } from "./collection/adapters/world-bank-country.js";
import { WORLD_BANK_CORE_INDICATOR_ADAPTERS } from "./collection/adapters/world-bank-indicators.js";
import type { BasicDeterministicSourceAdapter } from "./collection/basic-source-adapter-contracts.js";

const COUNTRY_FIXTURE = readFixture("world-bank-country-vn.json");
const INDICATOR_CASES = [
  {
    fixture: readFixture("world-bank-population-vn.json"),
    indicator: "SP.POP.TOTL",
    fieldPath: "marketOverview.population",
    unit: "people",
    value: 101598527,
  },
  {
    fixture: readFixture("world-bank-gdp-vn.json"),
    indicator: "NY.GDP.MKTP.CD",
    fieldPath: "marketOverview.gdp",
    unit: "current US$",
    value: 514697215165.065,
  },
  {
    fixture: readFixture("world-bank-gdp-growth-vn.json"),
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
      contentSha256: "7ddd064eb77613024ad050f7b885a61c239c01692ec59ef4b352ed100f2b7525",
    });
    expect(sha256(COUNTRY_FIXTURE.body)).toBe(COUNTRY_FIXTURE.contentSha256);

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
    ["a malformed envelope", Uint8Array.from([123])],
    ["pagination", mutateCountry(({ metadata }) => ({ ...metadata, pages: 2 }))],
    ["an extra country record", mutateCountry(({ metadata, records }) => [metadata, [...records, records[0]]])],
    ["an ISO mismatch", mutateCountry(({ metadata, records }) => [metadata, [{ ...records[0], iso2Code: "ID" }]])],
  ])("rejects %s", (_label, body) => {
    expect(() => worldBankCountryAdapter.extract(adapterInput(body))).toThrow(
      "world bank country response is invalid",
    );
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
    ({ fixture, indicator, fieldPath, unit, value }) => {
      expect(fixture.recordedAt).toBe("2026-07-10T09:40:00Z");
      expect(sha256(fixture.body)).toBe(fixture.contentSha256);

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
    ["pagination", mutateIndicator(({ metadata, records }) => [{ ...metadata, pages: 2 }, records])],
    ["a missing record", mutateIndicator(({ metadata }) => [metadata, []])],
    ["a duplicate record", mutateIndicator(({ metadata, records }) => [metadata, [...records, records[0]]])],
    ["a wrong country", mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], country: { id: "ID" } }]])],
    ["an invalid year", mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], date: "25" }]])],
    ["a non-finite value", mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], value: "NaN" }]])],
    ["an unexpected indicator", mutateIndicator(({ metadata, records }) => [metadata, [{ ...records[0], indicator: { id: "OTHER" } }]])],
    ["malformed source-2 metadata", mutateIndicator(({ metadata, records }) => [{ ...metadata, sourceid: 2 }, records])],
    ["an invalid source-2 update date", mutateIndicator(({ metadata, records }) => [{ ...metadata, lastupdated: "2026-99-99" }, records])],
  ])("rejects %s", (_label, body) => {
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

function readFixture(name: string): FixtureEnvelope {
  const pathname = fileURLToPath(
    new URL(`../fixtures/source-adapters/${name}`, import.meta.url),
  );
  const parsed: unknown = JSON.parse(readFileSync(pathname, "utf8"));
  if (!isFixtureEnvelope(parsed)) {
    throw new Error("fixture envelope is invalid");
  }
  return {
    requestUrl: parsed.requestUrl,
    recordedAt: parsed.recordedAt,
    contentSha256: parsed.contentSha256,
    body: new Uint8Array(Buffer.from(parsed.bodyBase64, "base64")),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
