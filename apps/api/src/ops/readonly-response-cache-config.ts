import type { CountryCacheKeyOwnership } from "./cache-key.js";

interface ReadonlyCacheOptionsInput {
  readonly maxEntries: number;
  readonly now?: (() => number) | undefined;
  readonly staleIfErrorSeconds: number;
  readonly ttlSeconds: number;
}

interface ValidatedReadonlyCacheOptions {
  readonly maxEntries: number;
  readonly now: () => number;
  readonly staleIfErrorSeconds: number;
  readonly ttlSeconds: number;
}

export function validateReadonlyCacheOptions(
  options: ReadonlyCacheOptionsInput,
): ValidatedReadonlyCacheOptions {
  try {
    if (options === null || typeof options !== "object") {
      throw new Error("READ_CACHE_OPTIONS_INVALID");
    }
    const ttlSeconds = options.ttlSeconds;
    const staleIfErrorSeconds = options.staleIfErrorSeconds;
    const maxEntries = options.maxEntries;
    const now = options.now;
    if (
      !isIntegerInRange(ttlSeconds, 1, 300) ||
      !isIntegerInRange(staleIfErrorSeconds, 0, 600) ||
      !isIntegerInRange(maxEntries, 10, 10_000) ||
      (now !== undefined && typeof now !== "function")
    ) {
      throw new Error("READ_CACHE_OPTIONS_INVALID");
    }
    return {
      maxEntries,
      now: now ?? Date.now,
      staleIfErrorSeconds,
      ttlSeconds,
    };
  } catch {
    throw new Error("READ_CACHE_OPTIONS_INVALID");
  }
}

export function isReadonlyCacheEntryFresh(
  cachedAt: number,
  now: number,
  ttlMilliseconds: number,
): boolean {
  const age = now - cachedAt;
  return age >= 0 && age < ttlMilliseconds;
}

export function isOwnedByListOrCountry(
  ownership: CountryCacheKeyOwnership | null,
  countryCode: string,
): boolean {
  return (
    ownership?.route === "list" ||
    (ownership !== null && ownership.countryCode === countryCode)
  );
}

function isIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
