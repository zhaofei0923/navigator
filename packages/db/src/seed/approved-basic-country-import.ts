import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-loader.js";
import { buildBasicCountryImportPlan } from "./basic-country-import.js";
import type { BasicCountryImportPlan } from "./basic-country-import-types.js";
import type { BasicCountryBundle, JsonRecord } from "./basic-country-types.js";
import { isPlainRecord } from "./basic-country-validation-utils.js";

export function buildApprovedBasicCountryPublicationImportPlan(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryImportPlan {
  const publication = loadApprovedBasicCountryPublicationV2(
    repoRoot,
    countryDirectory,
  );
  if (!publication.valid) {
    throw new Error(
      `Approved Basic publication validation failed: ${publication.blockerCode}`,
    );
  }

  const { candidate, canonical, manifest } = publication.data;
  const bundle: BasicCountryBundle = {
    countryDirectory: publication.data.countryDirectory,
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

  return buildBasicCountryImportPlan(bundle);
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
