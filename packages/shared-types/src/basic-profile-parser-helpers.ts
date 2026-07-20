import type { LocalizedText } from "./i18n.js";

const LOCALIZED_TEXT_KEYS = ["zh", "en"] as const;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export const LOWER_CAMEL_TOKEN = /^[a-z][A-Za-z0-9]*$/;

export function parseProfileValue(
  value: unknown,
): number | string | LocalizedText | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidBasicProfile();
    return value;
  }
  if (typeof value === "string") return nonEmptyString(value);
  return localizedText(value, false);
}

export function nullableNonEmptyString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value);
}

export function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalidBasicProfile();
  return value;
}

export function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) invalidBasicProfile();
  return value;
}

export function nullableLocalizedText(
  value: unknown,
  nonEmpty: boolean,
): LocalizedText | null {
  return value === null ? null : localizedText(value, nonEmpty);
}

export function localizedText(value: unknown, nonEmpty: boolean): LocalizedText {
  const record = exactRecord(value, LOCALIZED_TEXT_KEYS);
  if (typeof record.zh !== "string" || typeof record.en !== "string") {
    invalidBasicProfile();
  }
  if (nonEmpty && (record.zh.trim() === "" || record.en.trim() === "")) {
    invalidBasicProfile();
  }
  return { zh: record.zh, en: record.en };
}

export function httpUrl(value: unknown): string {
  const text = nonEmptyString(value);
  const parsed = new URL(text);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname === "" || parsed.username !== "" || parsed.password !== ""
  ) invalidBasicProfile();
  return text;
}

export function calendarDate(value: unknown): string {
  if (typeof value !== "string") invalidBasicProfile();
  const match = CALENDAR_DATE.exec(value);
  if (match === null || !validDateParts(match[1], match[2], match[3])) {
    invalidBasicProfile();
  }
  return value;
}

export function rfc3339(value: unknown): string {
  if (typeof value !== "string") invalidBasicProfile();
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
  ) invalidBasicProfile();
  return value;
}

function validDateParts(
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

export function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidBasicProfile();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) invalidBasicProfile();
  return value as Record<Keys[number], unknown>;
}

export function invalidBasicProfile(): never {
  throw new Error("invalid BASIC profile");
}
