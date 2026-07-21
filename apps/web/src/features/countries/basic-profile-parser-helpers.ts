export function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
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

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function nullableNonEmptyString(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  return nonEmptyString(value) ?? undefined;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isRfc3339(value: unknown): value is string {
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

export function isHttpUrl(value: unknown): value is string {
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
