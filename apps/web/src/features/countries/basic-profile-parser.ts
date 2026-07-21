import {
  BASIC_PROFILE_CATEGORY_KEYS,
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  type BasicProfileCategoryKey,
} from "@navigator/shared-types/basic-profile";
import { CREDIBILITIES } from "@navigator/shared-types/schema";

import {
  exactRecord,
  isCalendarDate,
  isHttpUrl,
  isRfc3339,
  nonEmptyString,
  nullableNonEmptyString,
} from "./basic-profile-parser-helpers.js";

export interface LocalizedBasicProfileField {
  key: string;
  label: string;
  status: "AVAILABLE" | "NOT_AVAILABLE";
  value: number | string | null;
  unit: string | null;
  year: number | null;
  sourceIds: readonly string[];
  checkedAt: string;
  reason: string | null;
  note: string | null;
}

export interface LocalizedBasicProfileSource {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  credibility: (typeof CREDIBILITIES)[number];
}

export interface LocalizedBasicProfile {
  categories: Readonly<Record<
    BasicProfileCategoryKey,
    { fields: readonly LocalizedBasicProfileField[] }
  >>;
  sources: readonly LocalizedBasicProfileSource[];
  updatedAt: string;
}

const PROFILE_KEYS = ["schemaVersion", "categories", "sources", "updatedAt"] as const;
const CATEGORY_KEYS = ["fields"] as const;
const FIELD_KEYS = [
  "key", "label", "status", "value", "unit", "year", "sourceIds",
  "checkedAt", "reason", "note",
] as const;
const SOURCE_KEYS = [
  "id", "publisher", "title", "url", "publishedAt", "retrievedAt",
  "credibility",
] as const;

function parseSource(value: unknown): LocalizedBasicProfileSource | null {
  const source = exactRecord(value, SOURCE_KEYS);
  if (source === null) return null;

  const id = nonEmptyString(source.id);
  const publisher = nonEmptyString(source.publisher);
  const title = nonEmptyString(source.title);
  const publishedAt = source.publishedAt === null
    ? null
    : isRfc3339(source.publishedAt)
      ? source.publishedAt
      : undefined;
  const credibility = source.credibility;

  if (
    id === null || publisher === null || title === null ||
    !isHttpUrl(source.url) || publishedAt === undefined ||
    !isRfc3339(source.retrievedAt) || typeof credibility !== "string" ||
    !CREDIBILITIES.includes(credibility as (typeof CREDIBILITIES)[number])
  ) {
    return null;
  }

  return {
    id,
    publisher,
    title,
    url: source.url,
    publishedAt,
    retrievedAt: source.retrievedAt,
    credibility: credibility as (typeof CREDIBILITIES)[number],
  };
}

function parseSources(value: unknown): readonly LocalizedBasicProfileSource[] | null {
  if (!Array.isArray(value)) return null;

  const ids = new Set<string>();
  const sources: LocalizedBasicProfileSource[] = [];
  for (const valueAtIndex of value) {
    const source = parseSource(valueAtIndex);
    if (source === null || ids.has(source.id)) return null;
    ids.add(source.id);
    sources.push(source);
  }
  return sources;
}

function parseSourceIds(
  value: unknown,
  knownSourceIds: ReadonlySet<string>,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const sourceIds = value.map(nonEmptyString);
  if (
    sourceIds.some((sourceId) => sourceId === null) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    return null;
  }

  const resolvedIds = sourceIds as string[];
  return resolvedIds.every((sourceId) => knownSourceIds.has(sourceId))
    ? resolvedIds
    : null;
}

function parseField(
  value: unknown,
  knownSourceIds: ReadonlySet<string>,
): LocalizedBasicProfileField | null {
  const field = exactRecord(value, FIELD_KEYS);
  if (field === null) return null;

  const key = nonEmptyString(field.key);
  const label = nonEmptyString(field.label);
  const unit = nullableNonEmptyString(field.unit);
  const reason = nullableNonEmptyString(field.reason);
  const note = nullableNonEmptyString(field.note);
  const status = field.status;
  const valueAtField = field.value;
  const year = field.year;
  const sourceIds = parseSourceIds(field.sourceIds, knownSourceIds);

  if (
    key === null || label === null || unit === undefined ||
    reason === undefined || note === undefined || sourceIds === null ||
    !isCalendarDate(field.checkedAt) ||
    (status !== "AVAILABLE" && status !== "NOT_AVAILABLE") ||
    !(year === null || (typeof year === "number" && Number.isInteger(year)))
  ) {
    return null;
  }

  const availableValue =
    (typeof valueAtField === "number" && Number.isFinite(valueAtField)) ||
    nonEmptyString(valueAtField) !== null;
  if (
    (status === "AVAILABLE" && (!availableValue || reason !== null)) ||
    (status === "NOT_AVAILABLE" &&
      (valueAtField !== null || unit !== null || year !== null || reason === null))
  ) {
    return null;
  }

  return {
    key,
    label,
    status,
    value: valueAtField as number | string | null,
    unit,
    year,
    sourceIds,
    checkedAt: field.checkedAt,
    reason,
    note,
  };
}

function parseCategory(
  value: unknown,
  categoryKey: BasicProfileCategoryKey,
  knownSourceIds: ReadonlySet<string>,
): { fields: readonly LocalizedBasicProfileField[] } | null {
  const category = exactRecord(value, CATEGORY_KEYS);
  if (category === null || !Array.isArray(category.fields)) return null;

  const fields: LocalizedBasicProfileField[] = [];
  const keys = new Set<string>();
  for (const valueAtIndex of category.fields) {
    const field = parseField(valueAtIndex, knownSourceIds);
    if (field === null || keys.has(field.key)) return null;
    keys.add(field.key);
    fields.push(field);
  }

  const requiredKeys = BASIC_PROFILE_REQUIRED_FIELD_KEYS[categoryKey];
  if (
    fields.length !== requiredKeys.length ||
    requiredKeys.some((key) => !keys.has(key))
  ) {
    return null;
  }
  return { fields };
}

export function parseLocalizedBasicProfile(
  value: unknown,
): LocalizedBasicProfile | null {
  const profile = exactRecord(value, PROFILE_KEYS);
  if (
    profile === null ||
    profile.schemaVersion !== "basic-market-profile/v2" ||
    !isRfc3339(profile.updatedAt)
  ) {
    return null;
  }

  const sources = parseSources(profile.sources);
  const categoriesRecord = exactRecord(
    profile.categories,
    BASIC_PROFILE_CATEGORY_KEYS,
  );
  if (sources === null || categoriesRecord === null) return null;

  const knownSourceIds = new Set(sources.map((source) => source.id));
  const categories: Partial<Record<
    BasicProfileCategoryKey,
    { fields: readonly LocalizedBasicProfileField[] }
  >> = {};
  for (const categoryKey of BASIC_PROFILE_CATEGORY_KEYS) {
    const category = parseCategory(
      categoriesRecord[categoryKey],
      categoryKey,
      knownSourceIds,
    );
    if (category === null) return null;
    categories[categoryKey] = category;
  }

  return {
    categories: categories as LocalizedBasicProfile["categories"],
    sources,
    updatedAt: profile.updatedAt,
  };
}
