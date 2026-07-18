import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-loader.js";
import { buildBasicCountryImportPlan } from "./basic-country-import.js";
import type { BasicCountryImportPlan } from "./basic-country-import-types.js";
import type {
  BasicCanonicalData,
  BasicCountryBundle,
  JsonRecord,
} from "./basic-country-types.js";
import { isPlainRecord } from "./basic-country-validation-utils.js";

const PREPARED_APPROVED_BASIC_COUNTRY_IMPORTS = new WeakSet<object>();

export interface PreparedApprovedBasicCountryImport {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly canonical: BasicCanonicalData;
  readonly plan: BasicCountryImportPlan;
}

export function prepareApprovedBasicCountryImport(
  repoRoot: string,
  countryDirectory: string,
  loadPublication: typeof loadApprovedBasicCountryPublicationV2 =
    loadApprovedBasicCountryPublicationV2,
): PreparedApprovedBasicCountryImport {
  const publication = loadPublication(repoRoot, countryDirectory);
  if (!publication.valid) {
    throw new Error(
      `Approved Basic publication validation failed: ${publication.blockerCode}`,
    );
  }

  const bundle = createBasicCountryBundle(publication.data);
  const plan = buildBasicCountryImportPlan(bundle);
  const prepared = deepFreezePreparedValue({
    countryDirectory: publication.data.countryDirectory,
    countryCode: plan.summary.countryCode,
    canonical: publication.data.canonical,
    plan,
  });
  PREPARED_APPROVED_BASIC_COUNTRY_IMPORTS.add(prepared);
  return prepared;
}

export function isPreparedApprovedBasicCountryImportFromLoader(
  value: unknown,
): value is PreparedApprovedBasicCountryImport {
  return typeof value === "object" &&
    value !== null &&
    PREPARED_APPROVED_BASIC_COUNTRY_IMPORTS.has(value) &&
    isDeepFrozenPreparedValue(value);
}

export function buildApprovedBasicCountryPublicationImportPlan(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryImportPlan {
  return prepareApprovedBasicCountryImport(repoRoot, countryDirectory).plan;
}

function createBasicCountryBundle(
  publication: Extract<
    ReturnType<typeof loadApprovedBasicCountryPublicationV2>,
    { valid: true }
  >["data"],
): BasicCountryBundle {
  const { candidate, canonical, manifest } = publication;
  const bundle: BasicCountryBundle = {
    countryDirectory: publication.countryDirectory,
    canonical,
    audit: {
      manifest: {
        activeRunId: manifest.activeRunId,
        mappingVersion: manifest.mappingVersion,
        auditBundlePath: manifest.auditBundlePath,
      },
      run: {
        runId: candidate.runId,
        sourceRegister: requireJsonRecord(candidate.sourceRegister),
        extractedFacts: requireJsonRecord(candidate.extractedFacts),
        marketOverviewDraft: requireJsonRecord(candidate.marketOverviewDraft),
        reviewReport: requireJsonRecord(candidate.reviewReport),
      },
    },
  };

  return bundle;
}

export function parseApprovedBasicCountryPublicationImportArgs(
  args: readonly string[],
): string | undefined {
  const normalizedArgs =
    args.length === 2 && args[0] === "--" ? args.slice(1) : args;
  const countryDirectory = normalizedArgs[0];
  return normalizedArgs.length === 1 && countryDirectory !== ""
    ? countryDirectory
    : undefined;
}

function requireJsonRecord(value: unknown): JsonRecord {
  if (!isPlainRecord(value)) {
    throw new Error("Approved Basic publication contains an invalid audit record");
  }
  return value;
}

function deepFreezePreparedValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezePreparedValue(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function isDeepFrozenPreparedValue(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === undefined ||
      !("value" in descriptor) ||
      isDeepFrozenPreparedValue(descriptor.value, seen);
  });
}

function runCli(): void {
  const countryDirectory = parseApprovedBasicCountryPublicationImportArgs(
    process.argv.slice(2),
  );
  if (countryDirectory === undefined) {
    throw new Error("Expected exactly one country directory argument");
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const plan = buildApprovedBasicCountryPublicationImportPlan(
    repoRoot,
    countryDirectory,
  );
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runCli();
}
