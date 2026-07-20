import { CREDIBILITIES, type Credibility } from "./schema.js";
import type { LocalizedText } from "./i18n.js";
import {
  LOWER_CAMEL_TOKEN,
  calendarDate,
  exactRecord,
  httpUrl,
  invalidBasicProfile,
  localizedText,
  nonEmptyString,
  nullableInteger,
  nullableLocalizedText,
  nullableNonEmptyString,
  parseProfileValue,
  rfc3339,
} from "./basic-profile-parser-helpers.js";

export const BASIC_PROFILE_SCHEMA_VERSION = "basic-market-profile/v2" as const;

export const BASIC_PROFILE_CATEGORY_KEYS = [
  "countryBasics",
  "electricityMarket",
  "energyAccess",
  "renewableCapacity",
  "solarResource",
  "windResource",
  "policyOverview",
  "marketSummary",
] as const;

export type BasicProfileCategoryKey =
  (typeof BASIC_PROFILE_CATEGORY_KEYS)[number];

export const BASIC_PROFILE_REQUIRED_FIELD_KEYS = Object.freeze({
  countryBasics: Object.freeze([
    "countryCode", "countryName", "region", "population", "gdp",
    "gdpPerCapita", "gdpGrowth",
  ] as const),
  electricityMarket: Object.freeze([
    "totalGeneration", "electricityConsumption", "electricityMix",
    "renewableGenerationShare",
  ] as const),
  energyAccess: Object.freeze(["electricityAccess"] as const),
  renewableCapacity: Object.freeze([
    "totalRenewableCapacity", "solarCapacity", "windCapacity", "hydroCapacity",
  ] as const),
  solarResource: Object.freeze(["ghi", "pvout", "solarPotentialSummary"] as const),
  windResource: Object.freeze([
    "onshoreWindClass", "offshoreWindClass", "resourceSummary",
  ] as const),
  policyOverview: Object.freeze(["summary"] as const),
  marketSummary: Object.freeze(["opportunitySummary"] as const),
}) satisfies Readonly<
  Record<BasicProfileCategoryKey, readonly string[]>
>;

export type BasicProfileRequiredFieldKey<
  Category extends BasicProfileCategoryKey = BasicProfileCategoryKey,
> = (typeof BASIC_PROFILE_REQUIRED_FIELD_KEYS)[Category][number];
export type BasicProfileFieldStatus = "AVAILABLE" | "NOT_AVAILABLE";
export type BasicProfileFieldValue = number | string | LocalizedText | null;

export interface BasicProfileField {
  readonly key: string;
  readonly label: LocalizedText;
  readonly status: BasicProfileFieldStatus;
  readonly value: BasicProfileFieldValue;
  readonly unit: string | null;
  readonly year: number | null;
  readonly sourceIds: readonly string[];
  readonly checkedAt: string;
  readonly reason: LocalizedText | null;
  readonly note: LocalizedText | null;
}

export interface BasicProfileCategory {
  readonly fields: readonly BasicProfileField[];
}

export type BasicProfileCategories = Readonly<Record<
  BasicProfileCategoryKey, BasicProfileCategory
>>;
export interface BasicProfileSource {
  readonly id: string;
  readonly publisher: string;
  readonly title: LocalizedText;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly credibility: Credibility;
}

export interface BasicProfile {
  readonly schemaVersion: typeof BASIC_PROFILE_SCHEMA_VERSION;
  readonly categories: BasicProfileCategories;
  readonly sources: readonly BasicProfileSource[];
  readonly updatedAt: string;
}

const PROFILE_KEYS = ["schemaVersion", "categories", "sources", "updatedAt"] as const;
const CATEGORY_KEYS = ["fields"] as const;
const FIELD_KEYS = [
  "key",
  "label",
  "status",
  "value",
  "unit",
  "year",
  "sourceIds",
  "checkedAt",
  "reason",
  "note",
] as const;
const SOURCE_KEYS = [
  "id",
  "publisher",
  "title",
  "url",
  "publishedAt",
  "retrievedAt",
  "credibility",
] as const;

export function parseBasicProfile(value: unknown): BasicProfile | null {
  if (value === null || value === undefined) return null;

  try {
    const profile = exactRecord(value, PROFILE_KEYS);
    if (profile.schemaVersion !== BASIC_PROFILE_SCHEMA_VERSION) invalidBasicProfile();

    const sources = parseSources(profile.sources);
    const sourceIds = new Set(sources.map(({ id }) => id));
    const categories = parseCategories(profile.categories, sourceIds);
    const updatedAt = rfc3339(profile.updatedAt);

    return {
      schemaVersion: BASIC_PROFILE_SCHEMA_VERSION,
      categories,
      sources,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function parseCategories(value: unknown, sourceIds: ReadonlySet<string>): BasicProfileCategories {
  const record = exactRecord(value, BASIC_PROFILE_CATEGORY_KEYS);
  const entries = BASIC_PROFILE_CATEGORY_KEYS.map((categoryKey) => [
    categoryKey,
    parseCategory(categoryKey, record[categoryKey], sourceIds),
  ] as const);
  return Object.fromEntries(entries) as BasicProfileCategories;
}

function parseCategory(
  categoryKey: BasicProfileCategoryKey, value: unknown,
  sourceIds: ReadonlySet<string>,
): BasicProfileCategory {
  const record = exactRecord(value, CATEGORY_KEYS);
  if (!Array.isArray(record.fields)) invalidBasicProfile();

  const keys = new Set<string>();
  const fields = record.fields.map((field) => {
    const parsed = parseField(field, sourceIds);
    if (keys.has(parsed.key)) invalidBasicProfile();
    keys.add(parsed.key);
    return parsed;
  });
  const requiredKeys = BASIC_PROFILE_REQUIRED_FIELD_KEYS[categoryKey];
  if (
    fields.length !== requiredKeys.length ||
    requiredKeys.some((key) => !keys.has(key))
  ) invalidBasicProfile();
  return { fields };
}

function parseField(value: unknown, knownSourceIds: ReadonlySet<string>): BasicProfileField {
  const record = exactRecord(value, FIELD_KEYS);
  const key = record.key;
  if (typeof key !== "string" || !LOWER_CAMEL_TOKEN.test(key)) invalidBasicProfile();

  const label = localizedText(record.label, false);
  const status = record.status;
  if (status !== "AVAILABLE" && status !== "NOT_AVAILABLE") invalidBasicProfile();
  const fieldValue = parseProfileValue(record.value);
  const unit = nullableNonEmptyString(record.unit);
  const year = nullableInteger(record.year);
  const sourceIds = referencedSourceIds(record.sourceIds, knownSourceIds);
  const checkedAt = calendarDate(record.checkedAt);
  const reason = nullableLocalizedText(record.reason, status === "NOT_AVAILABLE");
  const note = nullableLocalizedText(record.note, false);

  if (
    (status === "AVAILABLE" && (fieldValue === null || reason !== null)) ||
    (status === "NOT_AVAILABLE" &&
      (fieldValue !== null || unit !== null || year !== null || reason === null))
  ) invalidBasicProfile();

  return {
    key,
    label,
    status,
    value: fieldValue,
    unit,
    year,
    sourceIds,
    checkedAt,
    reason,
    note,
  };
}

function parseSources(value: unknown): readonly BasicProfileSource[] {
  if (!Array.isArray(value)) invalidBasicProfile();
  const ids = new Set<string>();
  return value.map((source) => {
    const record = exactRecord(source, SOURCE_KEYS);
    const id = nonEmptyString(record.id);
    if (ids.has(id)) invalidBasicProfile();
    ids.add(id);
    const credibility = record.credibility;
    if (!CREDIBILITIES.includes(credibility as Credibility)) invalidBasicProfile();

    return {
      id,
      publisher: nonEmptyString(record.publisher),
      title: localizedText(record.title, false),
      url: httpUrl(record.url),
      publishedAt: record.publishedAt === null ? null : rfc3339(record.publishedAt),
      retrievedAt: rfc3339(record.retrievedAt),
      credibility: credibility as Credibility,
    };
  });
}

function referencedSourceIds(
  value: unknown,
  knownSourceIds: ReadonlySet<string>,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) invalidBasicProfile();
  const ids = value.map(nonEmptyString);
  if (new Set(ids).size !== ids.length) invalidBasicProfile();
  if (ids.some((id) => !knownSourceIds.has(id))) invalidBasicProfile();
  return ids;
}
