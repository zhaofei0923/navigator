export interface WorldBankBasicProfileRequest {
  readonly url: string;
  readonly headers: Readonly<{ Accept: "application/json" }>;
}

export interface WorldBankBasicProfileAdapter {
  readonly sourceId: string;
  readonly indicator: string;
  readonly profileField: string;
  request(countryCode: string): WorldBankBasicProfileRequest;
  extract(input: Readonly<{
    countryCode: string;
    retrievedAt: string;
    body: Uint8Array;
  }>): Readonly<{
    sourceId: string;
    category: "countryBasics" | "energyAccess";
    key: string;
    status: "AVAILABLE" | "NOT_AVAILABLE";
    value: number | null;
    unit: string | null;
    year: number | null;
    checkedAt: string;
    locator: "json:/1/0/value";
    reason: Readonly<{ zh: string; en: string }> | null;
  }>;
}

const DEFINITIONS = [
  ["world-bank-population", "SP.POP.TOTL", "population", "countryBasics", "people"],
  ["world-bank-gdp", "NY.GDP.MKTP.CD", "gdp", "countryBasics", "current US$"],
  ["world-bank-gdp-per-capita", "NY.GDP.PCAP.CD", "gdpPerCapita", "countryBasics", "current US$ per person"],
  ["world-bank-gdp-growth", "NY.GDP.MKTP.KD.ZG", "gdpGrowth", "countryBasics", "%"],
  ["world-bank-electricity-access", "EG.ELC.ACCS.ZS", "electricityAccess", "energyAccess", "%"],
] as const;

export const WORLD_BANK_BASIC_PROFILE_ADAPTERS: readonly WorldBankBasicProfileAdapter[] =
  Object.freeze(DEFINITIONS.map(([sourceId, indicator, profileField, category, unit]) => Object.freeze({
    sourceId,
    indicator,
    profileField,
    request(countryCode: string): WorldBankBasicProfileRequest {
      if (!/^[A-Z]{2}$/.test(countryCode)) {
        throw new Error("world bank BASIC profile request is invalid");
      }
      return Object.freeze({
        url: `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?source=2&format=json&mrv=1&per_page=1`,
        headers: Object.freeze({ Accept: "application/json" as const }),
      });
    },
    extract(input: Readonly<{ countryCode: string; retrievedAt: string; body: Uint8Array }>) {
      try {
        if (!/^[A-Z]{2}$/.test(input.countryCode) || !/^\d{4}-\d{2}-\d{2}T/.test(input.retrievedAt)) invalid();
        const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.body));
        if (!Array.isArray(parsed) || parsed.length !== 2 || !isRecord(parsed[0]) ||
          !Array.isArray(parsed[1]) || parsed[1].length !== 1 || !isRecord(parsed[1][0])) invalid();
        const metadata = parsed[0];
        const record = parsed[1][0];
        if (
          metadata.page !== 1 || metadata.pages !== 1 || metadata.per_page !== 1 ||
          metadata.total !== 1 || metadata.sourceid !== "2" ||
          !isRecord(record.indicator) || record.indicator.id !== indicator ||
          !isRecord(record.country) || record.country.id !== input.countryCode ||
          typeof record.date !== "string" || !/^[1-9]\d{3}$/.test(record.date) ||
          !(record.value === null || (typeof record.value === "number" && Number.isFinite(record.value)))
        ) invalid();
        const unavailable = record.value === null;
        return Object.freeze({
          sourceId,
          category,
          key: profileField,
          status: unavailable ? "NOT_AVAILABLE" as const : "AVAILABLE" as const,
          value: record.value as number | null,
          unit: unavailable ? null : unit,
          year: unavailable ? null : Number(record.date),
          checkedAt: input.retrievedAt.slice(0, 10),
          locator: "json:/1/0/value" as const,
          reason: unavailable ? Object.freeze({
            zh: "World Bank 已核查，但最近记录无可用数值",
            en: "World Bank was checked, but the latest record has no available value",
          }) : null,
        });
      } catch {
        throw new Error("world bank BASIC profile response is invalid");
      }
    },
  })));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("invalid");
}
