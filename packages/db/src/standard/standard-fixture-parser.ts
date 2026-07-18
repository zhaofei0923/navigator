import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  POLICY_TYPES,
  REVIEW_STATUSES,
  RISK_LEVELS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";

import {
  deepFreezeBasicOfflineValue,
  snapshotBasicOfflineValue,
} from "../collection/basic-offline-value.js";
import {
  expectUtcRfc3339Timestamp,
  hasExactOwnKeys,
  isEnumValue,
} from "../seed/basic-country-validation-utils.js";
import {
  STANDARD_COUNTRY_SYNTHETIC_FIXTURE_SCHEMA_VERSION,
  type StandardCountrySyntheticFixture,
  type StandardFixtureMetadata,
  type StandardFixtureLocalizedText,
  type StandardFixtureOpportunity,
  type StandardFixturePolicy,
  type StandardFixtureRisk,
} from "./standard-fixture-contracts.js";

const ROOT_KEYS = [
  "schemaVersion", "fixtureOnly", "countryCode", "policy", "risk", "opportunities",
] as const;
const METADATA_KEYS = [
  "source", "sourceUrl", "collectedAt", "updatedAt", "credibility",
  "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags",
] as const;
const POLICY_KEYS = [
  "fixtureRecordId", "title", "summary", "body", "policyType", "effectiveDate",
  "authority", ...METADATA_KEYS,
] as const;
const RISK_KEYS = [
  "fixtureRecordId", "title", "category", "level", "description", "mitigation",
  ...METADATA_KEYS,
] as const;
const OPPORTUNITY_KEYS = [
  "fixtureRecordId", "title", "description", "marketSize", "timeWindow",
  ...METADATA_KEYS,
] as const;
const ISO2 = /^[A-Z]{2}$/u;
const FIXTURE_RECORD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_TEXT_LENGTH = 16_384;
const MAX_SHORT_TEXT_LENGTH = 512;
const FORBIDDEN_FIXTURE_PAYLOAD =
  /data\/|approval|publication|prisma|knowledgechunk|embedding|ai-index/iu;

export function parseStandardCountryFixture(
  value: unknown,
): StandardCountrySyntheticFixture {
  try {
    const snapshot = snapshotBasicOfflineValue(value);
    if (!snapshot.valid || !hasExactOwnKeys(snapshot.data, ROOT_KEYS)) invalid();
    if (containsForbiddenFixturePayload(snapshot.data)) invalid();
    const root = snapshot.data;
    if (
      root.schemaVersion !== STANDARD_COUNTRY_SYNTHETIC_FIXTURE_SCHEMA_VERSION ||
      root.fixtureOnly !== true
    ) invalid();
    const countryCode = requireCountryCode(root.countryCode);
    return deepFreezeBasicOfflineValue({
      schemaVersion: STANDARD_COUNTRY_SYNTHETIC_FIXTURE_SCHEMA_VERSION,
      fixtureOnly: true,
      countryCode,
      policy: parseModule(root.policy, POLICY_KEYS, countryCode, parsePolicy),
      risk: parseModule(root.risk, RISK_KEYS, countryCode, parseRisk),
      opportunities: parseModule(
        root.opportunities,
        OPPORTUNITY_KEYS,
        countryCode,
        parseOpportunity,
      ),
    });
  } catch {
    throw new Error("STANDARD_FIXTURE_INVALID");
  }
}

function parsePolicy(
  record: Record<string, unknown>,
  countryCode: string,
): StandardFixturePolicy {
  const metadata = parseMetadata(record, countryCode);
  return {
    fixtureRecordId: requireFixtureRecordId(record.fixtureRecordId),
    title: parseLocalizedText(record.title),
    summary: parseLocalizedText(record.summary),
    body: parseLocalizedText(record.body),
    policyType: requireEnum(record.policyType, POLICY_TYPES),
    effectiveDate: parseNullableTimestamp(record.effectiveDate),
    authority: parseLocalizedText(record.authority),
    ...metadata,
  };
}

function parseRisk(
  record: Record<string, unknown>,
  countryCode: string,
): StandardFixtureRisk {
  const metadata = parseMetadata(record, countryCode);
  if (record.category !== "fixture-category") invalid();
  return {
    fixtureRecordId: requireFixtureRecordId(record.fixtureRecordId),
    title: parseLocalizedText(record.title),
    category: "fixture-category",
    level: requireEnum(record.level, RISK_LEVELS),
    description: parseLocalizedText(record.description),
    mitigation: parseLocalizedText(record.mitigation),
    ...metadata,
  };
}

function parseOpportunity(
  record: Record<string, unknown>,
  countryCode: string,
): StandardFixtureOpportunity {
  const metadata = parseMetadata(record, countryCode);
  return {
    fixtureRecordId: requireFixtureRecordId(record.fixtureRecordId),
    title: parseLocalizedText(record.title),
    description: parseLocalizedText(record.description),
    marketSize: parseNullableLocalizedText(record.marketSize),
    timeWindow: parseNullableLocalizedText(record.timeWindow),
    ...metadata,
  };
}

function parseMetadata(
  record: Record<string, unknown>,
  countryCode: string,
): StandardFixtureMetadata {
  const source = requireNonBlankString(record.source, MAX_SHORT_TEXT_LENGTH);
  if (!source.toLowerCase().includes("synthetic-fixture")) invalid();
  const sourceUrl = parseFixtureSourceUrl(record.sourceUrl, source);
  const collectedAt = requireTimestamp(record.collectedAt);
  const updatedAt = requireTimestamp(record.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(collectedAt)) invalid();
  if (record.aiUsable !== false || record.countryCode !== countryCode) invalid();
  return {
    source,
    sourceUrl,
    collectedAt,
    updatedAt,
    credibility: requireEnum(record.credibility, CREDIBILITIES),
    reviewStatus: requireEnum(record.reviewStatus, REVIEW_STATUSES),
    aiUsable: false,
    countryCode,
    industryTags: parseEnumArray(record.industryTags, INDUSTRY_TAGS),
    techTags: parseEnumArray(record.techTags, TECH_TAGS),
  };
}

function parseModule<T>(
  value: unknown,
  keys: readonly string[],
  countryCode: string,
  parseRecord: (record: Record<string, unknown>, countryCode: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length !== 1) invalid();
  const ids = new Set<string>();
  return value.map((item) => {
    if (!hasExactOwnKeys(item, keys)) invalid();
    const parsed = parseRecord(item, countryCode);
    const id = requireFixtureRecordId(item.fixtureRecordId);
    if (ids.has(id)) invalid();
    ids.add(id);
    return parsed;
  });
}

function parseLocalizedText(value: unknown): StandardFixtureLocalizedText {
  if (!hasExactOwnKeys(value, ["zh", "en"])) invalid();
  const zh = requireBoundedString(value.zh, MAX_TEXT_LENGTH);
  const en = requireBoundedString(value.en, MAX_TEXT_LENGTH);
  if (zh.trim() === "" && en.trim() === "") invalid();
  if (zh.trim() !== "" && !zh.includes("合成测试夹具")) invalid();
  if (en.trim() !== "" && !en.toLowerCase().includes("synthetic fixture")) invalid();
  return { zh, en };
}

function parseNullableLocalizedText(
  value: unknown,
): StandardFixtureLocalizedText | null {
  return value === null ? null : parseLocalizedText(value);
}

function parseFixtureSourceUrl(value: unknown, source: string): string | null {
  if (value === null) {
    if (!source.toLowerCase().includes("no-url")) invalid();
    return null;
  }
  const text = requireNonBlankString(value, 2_048);
  const url = new URL(text);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname.toLowerCase().endsWith(".invalid") ||
    url.username !== "" || url.password !== "" || url.hash !== ""
  ) invalid();
  return text;
}

function parseNullableTimestamp(value: unknown): string | null {
  return value === null ? null : requireTimestamp(value);
}

function requireTimestamp(value: unknown): string {
  const errors: string[] = [];
  expectUtcRfc3339Timestamp(value, "timestamp", errors);
  if (errors.length > 0 || typeof value !== "string") invalid();
  return value;
}

function requireCountryCode(value: unknown): string {
  if (typeof value !== "string" || !ISO2.test(value)) invalid();
  return value;
}

function requireFixtureRecordId(value: unknown): string {
  const text = requireNonBlankString(value, 128);
  if (!FIXTURE_RECORD_ID.test(text)) invalid();
  return text;
}

function requireBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) invalid();
  return value;
}

function requireNonBlankString(value: unknown, maxLength: number): string {
  const text = requireBoundedString(value, maxLength);
  if (text.trim() === "") invalid();
  return text;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!isEnumValue(value, allowed)) invalid();
  return value;
}

function parseEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value) || value.length > allowed.length) invalid();
  const parsed = value.map((item) => requireEnum(item, allowed));
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed.sort();
}

function containsForbiddenFixturePayload(value: unknown): boolean {
  if (typeof value === "string") return FORBIDDEN_FIXTURE_PAYLOAD.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenFixturePayload);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_FIXTURE_PAYLOAD.test(key) ||
      containsForbiddenFixturePayload(child),
  );
}

function invalid(): never {
  throw new Error("STANDARD_FIXTURE_INVALID");
}
