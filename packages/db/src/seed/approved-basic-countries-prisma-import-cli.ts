import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import type { BasicCountryImportResult } from "../runtime/basic-country-import-runtime.js";
import {
  createPrismaBasicCountryImportPort,
  type PrismaBasicCountryClient,
} from "../runtime/prisma-basic-country-import-port.js";
import {
  importAllApprovedBasicCountries,
  prepareAllApprovedBasicCountryImports,
} from "./approved-basic-countries-prisma-import.js";

export const APPROVED_BASIC_COUNTRIES_IMPORT_USAGE =
  "Usage: pnpm --filter @navigator/db import:approved-basic-publications [-- --help]";

export interface ApprovedBasicCountriesPrismaImportCliClient
  extends PrismaBasicCountryClient {
  $disconnect(): Promise<void>;
}

export interface ApprovedBasicCountriesPrismaImportCliDependencies {
  repoRoot: string;
  createClient(): ApprovedBasicCountriesPrismaImportCliClient;
  stdout(line: string): void;
  stderr(line: string): void;
}

export async function runApprovedBasicCountriesPrismaImportCli(
  args: readonly string[],
  dependencies: ApprovedBasicCountriesPrismaImportCliDependencies,
): Promise<number> {
  const normalizedArgs = args.length === 2 && args[0] === "--"
    ? args.slice(1)
    : args;
  if (normalizedArgs.length === 1 && normalizedArgs[0] === "--help") {
    dependencies.stdout(`${APPROVED_BASIC_COUNTRIES_IMPORT_USAGE}\n`);
    return 0;
  }
  if (normalizedArgs.length !== 0) {
    dependencies.stderr(`${APPROVED_BASIC_COUNTRIES_IMPORT_USAGE}\n`);
    return 1;
  }

  let client: ApprovedBasicCountriesPrismaImportCliClient | undefined;
  let results: readonly BasicCountryImportResult[] | undefined;
  let failed = false;
  try {
    const prepared = prepareAllApprovedBasicCountryImports(dependencies.repoRoot);
    client = dependencies.createClient();
    const port = createPrismaBasicCountryImportPort(client);
    results = await importAllApprovedBasicCountries(prepared, port);
  } catch {
    failed = true;
  } finally {
    if (client !== undefined) {
      try {
        await client.$disconnect();
      } catch {
        failed = true;
      }
    }
  }

  if (failed || results === undefined) {
    dependencies.stderr("BASIC_IMPORT_FAILED\n");
    return 1;
  }

  dependencies.stdout(`${JSON.stringify({
    status: "ok",
    countryCount: results.length,
    operationCount: results.reduce(
      (total, result) => total + result.operationCount,
      0,
    ),
  })}\n`);
  return 0;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  process.exitCode = await runApprovedBasicCountriesPrismaImportCli(
    process.argv.slice(2),
    {
      repoRoot,
      createClient: () => new PrismaClient(),
      stdout: (line) => process.stdout.write(line),
      stderr: (line) => process.stderr.write(line),
    },
  );
}
