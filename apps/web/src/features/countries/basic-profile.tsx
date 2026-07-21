import {
  BASIC_PROFILE_CATEGORY_KEYS,
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  type BasicProfileCategoryKey,
} from "@navigator/shared-types/basic-profile";
import type { ModuleResponseRecord } from "@navigator/shared-types/country-api";
import {
  CREDIBILITIES,
  REGIONS,
  type Locale,
} from "@navigator/shared-types/schema";
import { useTranslations } from "next-intl";
import React from "react";

interface LocalizedBasicProfileField {
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

interface LocalizedBasicProfileSource {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  credibility: (typeof CREDIBILITIES)[number];
}

interface LocalizedBasicProfile {
  categories: Readonly<Record<
    BasicProfileCategoryKey,
    { fields: readonly LocalizedBasicProfileField[] }
  >>;
  sources: readonly LocalizedBasicProfileSource[];
  updatedAt: string;
}

interface Props {
  locale: Locale;
  profileValue: ModuleResponseRecord["basicProfile"];
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

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  const candidate = record(value);

  if (candidate === null) return null;
  const candidateKeys = Reflect.ownKeys(candidate);
  if (
    candidateKeys.length !== keys.length ||
    candidateKeys.some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  ) {
    return null;
  }

  return candidate;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nullableNonEmptyString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return nonEmptyString(value) ?? undefined;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (match === null) return false;

  return (
    isValidDateParts(match[1], match[2], match[3]) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    (match[7] === undefined || Number(match[7]) <= 23) &&
    (match[8] === undefined || Number(match[8]) <= 59) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidDateParts(
  yearText: string | undefined,
  monthText: string | undefined,
  dayText: string | undefined,
): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || year < 100 || month < 1 || month > 12) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [
    31, leapYear ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31,
  ] as const;
  return Number.isInteger(day) && day >= 1 && day <= daysByMonth[month - 1]!;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

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
    id === null ||
    publisher === null ||
    title === null ||
    !isHttpUrl(source.url) ||
    publishedAt === undefined ||
    !isRfc3339(source.retrievedAt) ||
    typeof credibility !== "string" ||
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
    key === null ||
    label === null ||
    unit === undefined ||
    reason === undefined ||
    note === undefined ||
    sourceIds === null ||
    !isCalendarDate(field.checkedAt) ||
    (status !== "AVAILABLE" && status !== "NOT_AVAILABLE") ||
    !(year === null || (typeof year === "number" && Number.isInteger(year)))
  ) {
    return null;
  }

  if (
    status === "AVAILABLE" &&
    !(
      (typeof valueAtField === "number" && Number.isFinite(valueAtField)) ||
      nonEmptyString(valueAtField) !== null
    )
  ) {
    return null;
  }

  if (
    (status === "AVAILABLE" && reason !== null) ||
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

export function parseLocalizedBasicProfile(value: unknown): LocalizedBasicProfile | null {
  const profile = exactRecord(value, PROFILE_KEYS);
  if (
    profile === null ||
    profile.schemaVersion !== "basic-market-profile/v2" ||
    !isRfc3339(profile.updatedAt)
  ) {
    return null;
  }

  const sources = parseSources(profile.sources);
  const categoriesRecord = exactRecord(profile.categories, BASIC_PROFILE_CATEGORY_KEYS);
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

function formatProfileDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatFieldValue(value: number | string, locale: Locale): string {
  if (typeof value === "string") {
    const region = REGIONS.find((candidate) => candidate === value);
    return region === undefined ? value : region;
  }

  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function BasicProfileFieldRow({
  field,
  locale,
  regionLabels,
  sourceById,
}: {
  field: LocalizedBasicProfileField;
  locale: Locale;
  regionLabels: ReturnType<typeof useTranslations>;
  sourceById: ReadonlyMap<string, LocalizedBasicProfileSource>;
}) {
  const t = useTranslations("countries.detail.basicProfile");
  const region = typeof field.value === "string"
    ? REGIONS.find((candidate) => candidate === field.value)
    : undefined;
  const value = field.value === null
    ? null
    : region === undefined
      ? formatFieldValue(field.value, locale)
      : regionLabels(region);

  return (
    <div className="basic-profile-field">
      <dt>{field.label}</dt>
      <dd>
        <strong>{field.status === "AVAILABLE" ? t("available") : t("notAvailable")}</strong>
        {value !== null ? <span>{value}</span> : null}
        {field.unit !== null ? <span>{field.unit}</span> : null}
        {field.year !== null ? <span>{t("year", { year: field.year })}</span> : null}
        <span>{t("checkedAt", { date: formatProfileDate(field.checkedAt, locale) })}</span>
        {field.note !== null ? <span>{field.note}</span> : null}
        {field.reason !== null ? <span>{field.reason}</span> : null}
        <span>{t("sources")}</span>
        {field.sourceIds.map((sourceId) => {
          const source = sourceById.get(sourceId);
          if (source === undefined) return null;
          return (
            <a href={source.url} key={source.id} rel="noreferrer noopener" target="_blank">
              {source.title} · {source.publisher}
            </a>
          );
        })}
      </dd>
    </div>
  );
}

function BasicProfileSourceDirectory({
  locale,
  sources,
}: {
  locale: Locale;
  sources: readonly LocalizedBasicProfileSource[];
}) {
  const t = useTranslations("countries.detail.basicProfile");

  return (
    <section className="basic-profile-source-directory" aria-labelledby="basic-profile-sources-title">
      <h4 id="basic-profile-sources-title">{t("sourceDirectory")}</h4>
      <ul>
        {sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} rel="noreferrer noopener" target="_blank">
              {source.title} · {source.publisher}
            </a>
            <span>{t(`credibility.${source.credibility}`)}</span>
            <span>{t("retrievedAt", { date: formatProfileDate(source.retrievedAt, locale) })}</span>
            {source.publishedAt !== null ? (
              <span>{t("publishedAt", { date: formatProfileDate(source.publishedAt, locale) })}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BasicProfileSection({ profileValue, locale }: Props) {
  const profile = parseLocalizedBasicProfile(profileValue);
  const t = useTranslations("countries.detail.basicProfile");
  const regionLabels = useTranslations("countryMeta.region");
  if (profile === null) return null;

  const sourceById = new Map(
    profile.sources.map((source) => [source.id, source]),
  );

  return (
    <section className="basic-profile" aria-labelledby="basic-profile-title">
      <header className="basic-profile-header">
        <div>
          <h3 id="basic-profile-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <span>{t("updated", { date: formatProfileDate(profile.updatedAt, locale) })}</span>
      </header>
      <div className="basic-profile-categories">
        {BASIC_PROFILE_CATEGORY_KEYS.map((categoryKey) => (
          <section className="basic-profile-category" key={categoryKey}>
            <h4>{t(`categories.${categoryKey}`)}</h4>
            <dl>{profile.categories[categoryKey].fields.map((field) => (
              <BasicProfileFieldRow
                field={field}
                key={field.key}
                locale={locale}
                regionLabels={regionLabels}
                sourceById={sourceById}
              />
            ))}</dl>
          </section>
        ))}
      </div>
      <BasicProfileSourceDirectory locale={locale} sources={profile.sources} />
    </section>
  );
}
