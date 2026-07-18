import type {
  CountryDataSnapshot,
  JsonObject,
} from "@navigator/shared-types/country-runtime";

export class CountryReadNormalizationError extends Error {
  constructor() {
    super("COUNTRY_READ_INVALID_DATA");
    this.name = "CountryReadNormalizationError";
  }
}

export function normalizeCountryReadSnapshot(
  snapshot: CountryDataSnapshot,
): CountryDataSnapshot {
  return {
    ...snapshot,
    policy: normalizeList(snapshot.policy),
    risk: normalizeList(snapshot.risk),
    opportunities: normalizeList(snapshot.opportunities),
    projects: normalizeList(snapshot.projects),
    partners: normalizeList(snapshot.partners),
    chineseCompanies: normalizeList(snapshot.chineseCompanies),
    reports: normalizeList(snapshot.reports),
    knowledge: normalizeList(snapshot.knowledge),
  };
}

function normalizeList(records: readonly JsonObject[]): readonly JsonObject[] {
  const seenIds = new Set<string>();
  const normalized = records.map((record) => {
    const id = normalizedNonBlankString(record.id);
    const updatedAt = normalizedTimestamp(record.updatedAt);
    if (seenIds.has(id)) throw new CountryReadNormalizationError();
    seenIds.add(id);
    return { record, id, updatedAt };
  });

  normalized.sort((left, right) => {
    const updatedDifference = right.updatedAt - left.updatedAt;
    return updatedDifference !== 0
      ? updatedDifference
      : left.id.localeCompare(right.id, "en");
  });
  return normalized.map(({ record }) => record);
}

function normalizedNonBlankString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim() !== value
  ) {
    throw new CountryReadNormalizationError();
  }
  return value;
}

function normalizedTimestamp(value: unknown): number {
  const timestamp = normalizedNonBlankString(value);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new CountryReadNormalizationError();
  return milliseconds;
}
