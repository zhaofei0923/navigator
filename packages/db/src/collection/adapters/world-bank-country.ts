import type {
  BasicDeterministicAdapterInput,
  BasicDeterministicAdapterOutput,
  BasicDeterministicSourceAdapter,
  BasicSourceRequest,
} from "../basic-source-adapter-contracts.js";

export const WORLD_BANK_ALLOWED_ORIGINS = Object.freeze([
  "https://api.worldbank.org",
] as const);

export const worldBankCountryAdapter: BasicDeterministicSourceAdapter = {
  adapterId: "world-bank-country",
  adapterVersion: "1.0.0",
  sourceId: "world-bank-country",
  sourceName: "World Bank",
  sourceFamily: "international-organization",
  credibility: "OFFICIAL",
  request(countryCode): BasicSourceRequest {
    const iso2 = requireIso2(countryCode);
    return {
      method: "GET",
      url: `https://api.worldbank.org/v2/country/${iso2}?format=json`,
      accept: "application/json",
      allowedOrigins: WORLD_BANK_ALLOWED_ORIGINS,
      allowedQueryParameters: ["format"],
    };
  },
  extract(input): BasicDeterministicAdapterOutput {
    const countryCode = requireIso2(input.countryCode);
    const envelope = parseResponse(input.body);
    if (envelope === null) {
      throw new Error("world bank country response is invalid");
    }
    const [metadata, records] = envelope;
    if (
      ownNumber(metadata, "page") !== 1 ||
      ownNumber(metadata, "pages") !== 1 ||
      ownString(metadata, "per_page") !== "50" ||
      ownNumber(metadata, "total") !== 1 ||
      records.length !== 1
    ) {
      throw new Error("world bank country response is invalid");
    }
    const record = records[0];
    if (record === undefined) {
      throw new Error("world bank country response is invalid");
    }
    const sourceCode = ownString(record, "iso2Code");
    const sourceName = ownString(record, "name");
    if (
      sourceCode !== countryCode ||
      sourceName === null ||
      sourceName.trim() === ""
    ) {
      throw new Error("world bank country response is invalid");
    }
    return {
      publishedAt: null,
      promptInjectionRisk: "none",
      accessNotes: null,
      observations: [
        {
          fieldPath: "country.code",
          locator: "json:/1/0/iso2Code",
          rawValue: sourceCode,
          normalizedValue: sourceCode,
          unit: null,
          year: null,
          uncertainty: null,
        },
        {
          fieldPath: "country.name",
          locator: "json:/1/0/name",
          rawValue: sourceName,
          normalizedValue: { zh: "", en: sourceName },
          unit: null,
          year: null,
          uncertainty: null,
        },
      ],
    };
  },
};

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

function ownString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return Object.hasOwn(record, key) && typeof value === "string" ? value : null;
}

function ownNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return Object.hasOwn(record, key) && typeof value === "number" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
