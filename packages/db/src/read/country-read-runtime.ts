import { PrismaClient } from "@prisma/client";
import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import { createApprovedPublicationCountryReadRepository } from "./approved-publication-country-read-repository.js";
import {
  createPrismaCountryReadRepository,
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

export function createPrismaCountryReadRuntime(options: {
  readonly databaseUrl: string;
}): CountryReadRuntime {
  if (
    typeof options.databaseUrl !== "string" ||
    options.databaseUrl.trim() === ""
  ) {
    throw new Error("COUNTRY_READ_RUNTIME_CONFIG_INVALID");
  }

  let client: PrismaClient;
  try {
    client = new PrismaClient({
      datasourceUrl: options.databaseUrl,
    });
  } catch {
    throw runtimeError("COUNTRY_READ_RUNTIME_INIT_FAILED");
  }
  const repository = createPrismaCountryReadRepository(client);
  let closePromise: Promise<void> | null = null;

  return Object.freeze({
    repository,
    async ping(pingOptions: CountryReadPingOptions): Promise<void> {
      assertPingOptions(pingOptions);
      if (closePromise !== null) throw new Error("COUNTRY_READ_RUNTIME_CLOSED");
      try {
        await client.$transaction(
          async (transaction) => {
            await transaction.country.count({ where: {} });
          },
          {
            maxWait: pingOptions.maxWaitMs,
            timeout: pingOptions.timeoutMs,
          },
        );
      } catch {
        throw runtimeError("COUNTRY_READ_PING_FAILED");
      }
    },
    close(): Promise<void> {
      if (closePromise === null) {
        try {
          closePromise = client.$disconnect().catch(() => {
            throw runtimeError("COUNTRY_READ_CLOSE_FAILED");
          });
        } catch {
          closePromise = Promise.reject(runtimeError("COUNTRY_READ_CLOSE_FAILED"));
        }
      }
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

function runtimeError(code: string): Error {
  return new Error(code);
}
