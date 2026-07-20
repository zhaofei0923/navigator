import { CREDIBILITIES, type Credibility } from "./schema.js";
import type { LocalizedText } from "./i18n.js";

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
  BasicProfileCategoryKey,
  BasicProfileCategory
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
const LOCALIZED_TEXT_KEYS = ["zh", "en"] as const;
const LOWER_CAMEL_TOKEN = /^[a-z][A-Za-z0-9]*$/;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function parseBasicProfile(value: unknown): BasicProfile | null {
  if (value === null || value === undefined) return null;

  try {
    const profile = exactRecord(value, PROFILE_KEYS);
    if (profile.schemaVersion !== BASIC_PROFILE_SCHEMA_VERSION) invalid();

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
    parseCategory(record[categoryKey], sourceIds),
  ] as const);
  return Object.fromEntries(entries) as BasicProfileCategories;
}

function parseCategory(value: unknown, sourceIds: ReadonlySet<string>): BasicProfileCategory {
  const record = exactRecord(value, CATEGORY_KEYS);
  if (!Array.isArray(record.fields)) invalid();

  const keys = new Set<string>();
  const fields = record.fields.map((field) => {
    const parsed = parseField(field, sourceIds);
    if (keys.has(parsed.key)) invalid();
    keys.add(parsed.key);
    return parsed;
  });
  return { fields };
}

function parseField(value: unknown, knownSourceIds: ReadonlySet<string>): BasicProfileField {
  const record = exactRecord(value, FIELD_KEYS);
  const key = record.key;
  if (typeof key !== "string" || !LOWER_CAMEL_TOKEN.test(key)) invalid();

  const label = localizedText(record.label, false);
  const status = record.status;
  if (status !== "AVAILABLE" && status !== "NOT_AVAILABLE") invalid();
  const fieldValue = profileValue(record.value);
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
  ) invalid();

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
  if (!Array.isArray(value)) invalid();
  const ids = new Set<string>();
  return value.map((source) => {
    const record = exactRecord(source, SOURCE_KEYS);
    const id = nonEmptyString(record.id);
    if (ids.has(id)) invalid();
    ids.add(id);
    const credibility = record.credibility;
    if (!CREDIBILITIES.includes(credibility as Credibility)) invalid();

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
  if (!Array.isArray(value) || value.length === 0) invalid();
  const ids = value.map(nonEmptyString);
  if (new Set(ids).size !== ids.length) invalid();
  if (ids.some((id) => !knownSourceIds.has(id))) invalid();
  return ids;
}

function profileValue(value: unknown): BasicProfileFieldValue {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (typeof value === "string") return nonEmptyString(value);
  return localizedText(value, false);
}

function nullableNonEmptyString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value);
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalid();
  return value;
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) invalid();
  return value;
}

function nullableLocalizedText(value: unknown, nonEmpty: boolean): LocalizedText | null {
  return value === null ? null : localizedText(value, nonEmpty);
}

function localizedText(value: unknown, nonEmpty: boolean): LocalizedText {
  const record = exactRecord(value, LOCALIZED_TEXT_KEYS);
  if (typeof record.zh !== "string" || typeof record.en !== "string") invalid();
  if (nonEmpty && (record.zh.trim() === "" || record.en.trim() === "")) invalid();
  return { zh: record.zh, en: record.en };
}

function httpUrl(value: unknown): string {
  const text = nonEmptyString(value);
  const parsed = new URL(text);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname === "" || parsed.username !== "" || parsed.password !== ""
  ) invalid();
  return text;
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string") invalid();
  const match = CALENDAR_DATE.exec(value);
  if (match === null || !validDateParts(match[1], match[2], match[3])) invalid();
  return value;
}

function rfc3339(value: unknown): string {
  if (typeof value !== "string") invalid();
  const match = RFC3339.exec(value);
  if (
    match === null ||
    !validDateParts(match[1], match[2], match[3]) ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    (match[7] !== undefined && Number(match[7]) > 23) ||
    (match[8] !== undefined && Number(match[8]) > 59) ||
    !Number.isFinite(Date.parse(value))
  ) invalid();
  return value;
}

function validDateParts(
  yearText: string | undefined, monthText: string | undefined,
  dayText: string | undefined,
): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown, keys: Keys,
): Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalid();
  return value as Record<Keys[number], unknown>;
}

function invalid(): never {
  throw new Error("invalid BASIC profile");
}
