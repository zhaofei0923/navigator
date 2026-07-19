import { DatabaseUnavailableError } from "@navigator/db/country-read-runtime";
import type { JsonValue } from "@navigator/shared-types/country-runtime";

import {
  getCountryCacheKeyOwnership,
  type CountryCacheKeyOwnership,
} from "./cache-key.js";
import {
  isOwnedByListOrCountry,
  isReadonlyCacheEntryFresh,
  validateReadonlyCacheOptions,
} from "./readonly-response-cache-config.js";
import {
  cloneReadonlyCacheValue,
  serializeReadonlyCacheSuccess,
} from "./readonly-response-cache-json.js";

const MIB = 1024 * 1024;
const MAX_ITEM_BYTES = MIB;
const MAX_TOTAL_BYTES = 16 * MIB;

export const READONLY_RESPONSE_CACHE = Symbol("READONLY_RESPONSE_CACHE");

export interface CachedRead<T> {
  readonly value: T;
  readonly state: "hit" | "miss" | "stale";
}

export interface CacheableHttpSuccess<T extends JsonValue> {
  readonly status: 200;
  readonly value: T;
}

export interface ReadonlyResponseCache {
  getOrLoad<T extends JsonValue>(
    key: string,
    loader: () => Promise<CacheableHttpSuccess<T>>,
  ): Promise<CachedRead<T>>;
  invalidateCountry(countryCode: string): void;
  clear(): void;
}

export interface ReadonlyResponseCacheOptions {
  readonly ttlSeconds: number;
  readonly staleIfErrorSeconds: number;
  readonly maxEntries: number;
  readonly now?: (() => number) | undefined;
}

interface CacheEntry {
  readonly bytes: number;
  readonly cachedAt: number;
  readonly ownership: CountryCacheKeyOwnership | null;
  readonly serialized: string;
}

interface GenerationSnapshot {
  readonly global: number;
  readonly ownership: CountryCacheKeyOwnership | null;
  readonly scoped: number;
}

interface LoadOutcome {
  readonly serialized: string;
  readonly state: "miss" | "stale";
}

interface Flight {
  readonly generation: GenerationSnapshot;
  readonly promise: Promise<LoadOutcome>;
}

class InMemoryReadonlyResponseCache implements ReadonlyResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly flights = new Map<string, Flight>();
  private readonly countryGenerations = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly staleIfErrorMilliseconds: number;
  private readonly ttlMilliseconds: number;
  private globalGeneration = 0;
  private listGeneration = 0;
  private totalBytes = 0;

  constructor(options: ReadonlyResponseCacheOptions) {
    const validated = validateReadonlyCacheOptions(options);
    this.maxEntries = validated.maxEntries;
    this.now = validated.now;
    this.staleIfErrorMilliseconds = validated.staleIfErrorSeconds * 1_000;
    this.ttlMilliseconds = validated.ttlSeconds * 1_000;
  }

  async getOrLoad<T extends JsonValue>(
    key: string,
    loader: () => Promise<CacheableHttpSuccess<T>>,
  ): Promise<CachedRead<T>> {
    const entry = this.entries.get(key);
    const currentTime = this.readClock();
    if (
      entry !== undefined &&
      isReadonlyCacheEntryFresh(entry.cachedAt, currentTime, this.ttlMilliseconds)
    ) {
      this.touch(key, entry);
      return {
        state: "hit",
        value: cloneReadonlyCacheValue<T>(entry.serialized),
      };
    }

    const existingFlight = this.flights.get(key);
    if (existingFlight !== undefined) {
      return cloneOutcome<T>(await existingFlight.promise);
    }

    const generation = this.captureGeneration(key);
    let flight: Flight | undefined;
    const promise = this.load(key, entry, generation, loader).finally(() => {
      if (flight !== undefined && this.flights.get(key) === flight) {
        this.flights.delete(key);
      }
    });
    flight = { generation, promise };
    this.flights.set(key, flight);
    return cloneOutcome<T>(await promise);
  }

  invalidateCountry(countryCode: string): void {
    const normalizedCode = countryCode.trim().toUpperCase();
    this.listGeneration += 1;
    this.countryGenerations.set(
      normalizedCode,
      this.getCountryGeneration(normalizedCode) + 1,
    );

    for (const [key, entry] of this.entries) {
      if (isOwnedByListOrCountry(entry.ownership, normalizedCode)) {
        this.deleteEntry(key, entry);
      }
    }
    for (const [key, flight] of this.flights) {
      if (isOwnedByListOrCountry(flight.generation.ownership, normalizedCode)) {
        this.flights.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.flights.clear();
    this.totalBytes = 0;
    this.globalGeneration += 1;
  }

  private async load<T extends JsonValue>(
    key: string,
    staleEntry: CacheEntry | undefined,
    generation: GenerationSnapshot,
    loader: () => Promise<CacheableHttpSuccess<T>>,
  ): Promise<LoadOutcome> {
    try {
      const response = await loader();
      const { bytes, serialized } = serializeReadonlyCacheSuccess(response);

      if (bytes > MAX_ITEM_BYTES) {
        this.deleteEntryIfSame(key, staleEntry);
        return { serialized, state: "miss" };
      }
      if (this.isCurrentGeneration(generation)) {
        this.store(key, serialized, bytes, generation.ownership);
      }
      return { serialized, state: "miss" };
    } catch (error) {
      if (
        error instanceof DatabaseUnavailableError &&
        staleEntry !== undefined &&
        this.isCurrentGeneration(generation) &&
        this.entries.get(key) === staleEntry &&
        this.canServeStale(staleEntry)
      ) {
        this.touch(key, staleEntry);
        return { serialized: staleEntry.serialized, state: "stale" };
      }
      this.deleteEntryIfSame(key, staleEntry);
      throw error;
    }
  }

  private canServeStale(entry: CacheEntry): boolean {
    if (this.staleIfErrorMilliseconds === 0) return false;
    const age = this.readClock() - entry.cachedAt;
    return (
      age >= this.ttlMilliseconds &&
      age <= this.ttlMilliseconds + this.staleIfErrorMilliseconds
    );
  }

  private captureGeneration(key: string): GenerationSnapshot {
    const ownership = getCountryCacheKeyOwnership(key);
    return {
      global: this.globalGeneration,
      ownership,
      scoped:
        ownership?.route === "list"
          ? this.listGeneration
          : ownership === null
            ? 0
            : this.getCountryGeneration(ownership.countryCode),
    };
  }

  private isCurrentGeneration(generation: GenerationSnapshot): boolean {
    if (generation.global !== this.globalGeneration) return false;
    if (generation.ownership?.route === "list") {
      return generation.scoped === this.listGeneration;
    }
    if (generation.ownership === null) return generation.scoped === 0;
    return (
      generation.scoped ===
      this.getCountryGeneration(generation.ownership.countryCode)
    );
  }

  private getCountryGeneration(countryCode: string): number {
    return this.countryGenerations.get(countryCode) ?? 0;
  }

  private store(
    key: string,
    serialized: string,
    bytes: number,
    ownership: CountryCacheKeyOwnership | null,
  ): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) this.deleteEntry(key, existing);
    const entry = {
      bytes,
      cachedAt: this.readClock(),
      ownership,
      serialized,
    } satisfies CacheEntry;
    this.entries.set(key, entry);
    this.totalBytes += bytes;

    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > MAX_TOTAL_BYTES
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest !== undefined) this.deleteEntry(oldestKey, oldest);
    }
  }

  private touch(key: string, entry: CacheEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private deleteEntryIfSame(
    key: string,
    entry: CacheEntry | undefined,
  ): void {
    if (entry !== undefined && this.entries.get(key) === entry) {
      this.deleteEntry(key, entry);
    }
  }

  private deleteEntry(key: string, entry: CacheEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }

  private readClock(): number {
    try {
      const current = this.now();
      if (!Number.isFinite(current)) throw new Error("READ_CACHE_OPTIONS_INVALID");
      return current;
    } catch {
      throw new Error("READ_CACHE_OPTIONS_INVALID");
    }
  }
}

export function createReadonlyResponseCache(
  options: ReadonlyResponseCacheOptions,
): ReadonlyResponseCache {
  return new InMemoryReadonlyResponseCache(options);
}

function cloneOutcome<T extends JsonValue>(outcome: LoadOutcome): CachedRead<T> {
  return {
    state: outcome.state,
    value: cloneReadonlyCacheValue<T>(outcome.serialized),
  };
}
