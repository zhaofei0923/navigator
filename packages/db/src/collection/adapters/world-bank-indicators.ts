import type {
  BasicDeterministicAdapterInput,
  BasicDeterministicAdapterOutput,
  BasicDeterministicSourceAdapter,
  BasicSourceRequest,
} from "../basic-source-adapter-contracts.js";
import { WORLD_BANK_ALLOWED_ORIGINS } from "./world-bank-country.js";

interface IndicatorDefinition {
  sourceId: string;
  indicator: string;
  fieldPath: "marketOverview.population" | "marketOverview.gdp" | "marketOverview.gdpGrowth";
  unit: "people" | "current US$" | "%";
}

const INDICATORS = [
  {
    sourceId: "world-bank-population",
    indicator: "SP.POP.TOTL",
    fieldPath: "marketOverview.population",
    unit: "people",
  },
  {
    sourceId: "world-bank-gdp",
    indicator: "NY.GDP.MKTP.CD",
    fieldPath: "marketOverview.gdp",
    unit: "current US$",
  },
  {
    sourceId: "world-bank-gdp-growth",
    indicator: "NY.GDP.MKTP.KD.ZG",
    fieldPath: "marketOverview.gdpGrowth",
    unit: "%",
  },
] as const satisfies readonly IndicatorDefinition[];

export const WORLD_BANK_CORE_INDICATOR_ADAPTERS = Object.freeze(
  INDICATORS.map(createIndicatorAdapter),
);

function createIndicatorAdapter(
  definition: IndicatorDefinition,
): BasicDeterministicSourceAdapter {
  return {
    adapterId: definition.sourceId,
    adapterVersion: "1.0.0",
    sourceId: definition.sourceId,
    sourceName: "World Bank",
    sourceFamily: "international-organization",
    credibility: "OFFICIAL",
    request(countryCode): BasicSourceRequest {
      const iso2 = requireIso2(countryCode);
      return {
        method: "GET",
        url: `https://api.worldbank.org/v2/country/${iso2}/indicator/${definition.indicator}?source=2&format=json&mrv=1&per_page=1`,
        accept: "application/json",
        allowedOrigins: WORLD_BANK_ALLOWED_ORIGINS,
        allowedQueryParameters: ["source", "format", "mrv", "per_page"],
      };
    },
    extract(input): BasicDeterministicAdapterOutput {
      const countryCode = requireIso2(input.countryCode);
      const envelope = parseResponse(input.body);
      if (envelope === null) {
        throw new Error("world bank indicator response is invalid");
      }
      const [metadata, records] = envelope;
      if (!hasExpectedMetadata(metadata) || records.length !== 1) {
        throw new Error("world bank indicator response is invalid");
      }
      const record = records[0];
      if (record === undefined) {
        throw new Error("world bank indicator response is invalid");
      }
      const indicator = ownStringRecordValue(record, "indicator", "id");
      const recordCountry = ownStringRecordValue(record, "country", "id");
      const year = ownString(record, "date");
      const value = ownNumberOrNull(record, "value");
      if (
        indicator !== definition.indicator ||
        recordCountry !== countryCode ||
        year === null ||
        !/^[1-9][0-9]{3}$/.test(year) ||
        value === undefined
      ) {
        throw new Error("world bank indicator response is invalid");
      }
      return {
        publishedAt: null,
        promptInjectionRisk: "none",
        accessNotes: null,
        observations: [
          {
            fieldPath: definition.fieldPath,
            locator: "json:/1/0/value",
            rawValue: value,
            normalizedValue: value,
            unit: definition.unit,
            year: Number(year),
            uncertainty: null,
          },
        ],
      };
    },
  };
}

function requireIso2(value: string): string {
  if (!/^[A-Z]{2}$/.test(value)) {
    throw new Error("world bank country code is invalid");
  }
  return value;
}

function parseResponse(body: Uint8Array): [Record<string, unknown>, Record<string, unknown>[]] | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !isRecord(value[0]) ||
      !Array.isArray(value[1]) ||
      !value[1].every(isRecord)
    ) {
      return null;
    }
    return [value[0], value[1]];
  } catch {
    return null;
  }
}

function hasExpectedMetadata(metadata: Record<string, unknown>): boolean {
  return (
    ownNumber(metadata, "page") === 1 &&
    ownNumber(metadata, "pages") === 1 &&
    ownNumber(metadata, "per_page") === 1 &&
    ownNumber(metadata, "total") === 1 &&
    ownString(metadata, "sourceid") === "2" &&
    isIsoDate(ownString(metadata, "lastupdated"))
  );
}

function ownStringRecordValue(
  record: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): string | null {
  const parent = record[parentKey];
  return Object.hasOwn(record, parentKey) && isRecord(parent)
    ? ownString(parent, childKey)
    : null;
}

function ownString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return Object.hasOwn(record, key) && typeof value === "string" ? value : null;
}

function ownNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return Object.hasOwn(record, key) && typeof value === "number" ? value : null;
}

function ownNumberOrNull(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isIsoDate(value: string | null): boolean {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
