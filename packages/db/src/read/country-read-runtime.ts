import { PrismaClient } from "@prisma/client";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import { createApprovedPublicationCountryReadRepository } from "./approved-publication-country-read-repository.js";
import {
  createPrismaCountryReadRepository,
  type PrismaCountryReadClient,
} from "./prisma-country-read-repository.js";

export interface CountryReadRuntime {
  readonly repository: CountryReadRepository;
  ping(options: {
    readonly maxWaitMs: number;
    readonly timeoutMs: number;
  }): Promise<void>;
  close(): Promise<void>;
}

interface CountryReadPingOptions {
  readonly maxWaitMs: number;
  readonly timeoutMs: number;
}

interface PrismaRuntimeTransaction {
  readonly country: {
    count(args: {
      readonly where: Readonly<Record<string, never>>;
    }): Promise<number>;
  };
}

interface PrismaRuntimeClient extends PrismaCountryReadClient {
  $transaction<T>(
    callback: (transaction: PrismaRuntimeTransaction) => Promise<T>,
    options: { readonly maxWait: number; readonly timeout: number },
  ): Promise<T>;
  $disconnect(): Promise<void>;
}

export function createPrismaCountryReadRuntime(options: {
  readonly databaseUrl: string;
}): CountryReadRuntime {
  if (
    typeof options.databaseUrl !== "string" ||
    options.databaseUrl.trim() === ""
  ) {
    throw new Error("COUNTRY_READ_RUNTIME_CONFIG_INVALID");
  }

  const client = new PrismaClient({
    datasourceUrl: options.databaseUrl,
  }) as unknown as PrismaRuntimeClient;
  const repository = createPrismaCountryReadRepository(client);
  let closePromise: Promise<void> | null = null;

  return Object.freeze({
    repository,
    async ping(pingOptions: CountryReadPingOptions): Promise<void> {
      assertPingOptions(pingOptions);
      if (closePromise !== null) throw new Error("COUNTRY_READ_RUNTIME_CLOSED");
      await client.$transaction(
        async (transaction) => {
          await transaction.country.count({ where: {} });
        },
        {
          maxWait: pingOptions.maxWaitMs,
          timeout: pingOptions.timeoutMs,
        },
      );
    },
    close(): Promise<void> {
      closePromise ??= client.$disconnect();
      return closePromise;
    },
  });
}

export function createApprovedPublicationCountryReadRuntime(options: {
  readonly repositoryRoot: string;
}): CountryReadRuntime {
  const repository = createApprovedPublicationCountryReadRepository(options);
  const closeResult = Promise.resolve();

  return Object.freeze({
    repository,
    async ping(pingOptions: CountryReadPingOptions): Promise<void> {
      assertPingOptions(pingOptions);
      const snapshots = await repository.list();
      if (
        snapshots.length === 0 ||
        !isRecursivelyFrozen(snapshots) ||
        new Set(snapshots.map((snapshot) => snapshot.country.code)).size !==
          snapshots.length
      ) {
        throw new Error("APPROVED_PUBLICATION_RUNTIME_INVALID");
      }
    },
    close(): Promise<void> {
      return closeResult;
    },
  });
}

function assertPingOptions(options: {
  readonly maxWaitMs: number;
  readonly timeoutMs: number;
}): void {
  if (
    !Number.isSafeInteger(options.maxWaitMs) ||
    options.maxWaitMs <= 0 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0
  ) {
    throw new Error("COUNTRY_READ_PING_OPTIONS_INVALID");
  }
}

function isRecursivelyFrozen(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}
