import type { JsonRecord } from "./basic-country-types.js";

export const LOCALIZED_TEXT_KEYS = ["zh", "en"] as const;
export const KEY_INDICATOR_KEYS = ["label", "value", "unit", "year"] as const;
export const SAFE_COUNTRY_DIRECTORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const UTC_RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const PRISMA_INT_MAX = 2147483647;

export function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasExactOwnKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is JsonRecord {
  if (!isPlainRecord(value)) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    ownKeys.every(
      (key) => typeof key === "string" && expectedKeys.includes(key),
    )
  );
}

export function expectExactOwnKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
  errors: string[],
): value is JsonRecord {
  if (hasExactOwnKeys(value, expectedKeys)) {
    return true;
  }
  errors.push(`${label} must have exactly ${formatKeyList(expectedKeys)} own keys`);
  return false;
}

export function readExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): JsonRecord {
  if (!hasExactOwnKeys(value, expectedKeys)) {
    throw new Error(`${label} must have exactly ${formatKeyList(expectedKeys)} own keys`);
  }
  return value;
}

export function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

export function readFiniteNumber(value: unknown, label: string): number {
  if (!isFiniteNumber(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export function expectNonBlank(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
  }
}

export function expectFiniteNumber(value: unknown, label: string, errors: string[]): void {
  if (!isFiniteNumber(value)) {
    errors.push(`${label} must be a finite number`);
  }
}

export function expectFiniteNumberOrNull(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value !== null && !isFiniteNumber(value)) {
    errors.push(`${label} must be a finite number or null`);
  }
}

export function expectPopulation(value: unknown, errors: string[]): void {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > PRISMA_INT_MAX)
  ) {
    errors.push(
      "market-overview.population must be a non-negative safe integer up to 2147483647 or null",
    );
  }
}

export function expectUtcRfc3339Timestamp(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!isUtcRfc3339Timestamp(value)) {
    errors.push(`${label} must be a strict UTC RFC3339 timestamp`);
  }
}

export function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (!isEnumValue(value, allowed)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}`);
  }
}

export function validateEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${label} must be a string array`);
    return;
  }
  for (const item of value) {
    if (!isEnumValue(item, allowed)) {
      errors.push(`${label} contains unsupported value ${item}`);
    }
  }
}

export function isEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatKeyList(keys: readonly string[]): string {
  if (keys.length === 2) {
    return `${keys[0]} and ${keys[1]}`;
  }
  return `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUtcRfc3339Timestamp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const match = UTC_RFC3339_TIMESTAMP.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  return (
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <= daysInMonth(numericYear, numericMonth) &&
    numericHour <= 23 &&
    numericMinute <= 59 &&
    numericSecond <= 59
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
