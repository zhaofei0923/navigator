import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  BasicCollectionManifest,
  BasicCountryBundle,
  JsonRecord,
} from "./basic-country-types.js";
import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
  isPlainRecord,
  readString,
} from "./basic-country-validation-utils.js";

export function loadBasicCountryBundle(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryBundle {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }

  const countryRoot = join(repoRoot, "data", countryDirectory);
  const manifest = readManifest(
    readJsonRecord(join(countryRoot, "collection-manifest.json")),
    countryDirectory,
  );
  const auditRoot = join(repoRoot, manifest.auditBundlePath);

  return {
    countryDirectory,
    canonical: {
      country: readJsonRecord(join(countryRoot, "country.json")),
      marketOverview: readJsonRecord(join(countryRoot, "market-overview.json")),
      policy: readOptionalRecordArray(join(countryRoot, "policy.json")),
      risk: readOptionalRecordArray(join(countryRoot, "risk.json")),
      opportunities: readOptionalRecordArray(join(countryRoot, "opportunities.json")),
      projects: readOptionalRecordArray(join(countryRoot, "projects.json")),
      partners: readOptionalRecordArray(join(countryRoot, "partners.json")),
      chineseCompanies: readOptionalRecordArray(
        join(countryRoot, "chinese-companies.json"),
      ),
      entryStrategy: readOptionalRecord(join(countryRoot, "entry-strategy.json")),
      reports: readOptionalRecordArray(join(countryRoot, "reports.json")),
      knowledge: readOptionalRecordArray(join(countryRoot, "knowledge", "chunks.json")),
    },
    audit: {
      manifest,
      run: {
        runId: manifest.activeRunId,
        sourceRegister: readJsonRecord(join(auditRoot, "source-register.json")),
        extractedFacts: readJsonRecord(join(auditRoot, "extracted-facts.json")),
        marketOverviewDraft: readJsonRecord(
          join(auditRoot, "market-overview.draft.json"),
        ),
        reviewReport: readJsonRecord(join(auditRoot, "review-report.json")),
      },
    },
  };
}

function readManifest(
  value: JsonRecord,
  countryDirectory: string,
): BasicCollectionManifest {
  const activeRunId = readString(value.activeRunId, "activeRunId");
  if (!SAFE_RUN_ID.test(activeRunId)) {
    throw new Error("activeRunId must be a safe run id");
  }
  const auditBundlePath = readString(value.auditBundlePath, "auditBundlePath");
  const expectedPath = `data/staging/${countryDirectory}/${activeRunId}`;
  if (auditBundlePath !== expectedPath) {
    throw new Error(`auditBundlePath must equal ${expectedPath}`);
  }
  return {
    activeRunId,
    mappingVersion: readString(value.mappingVersion, "mappingVersion"),
    auditBundlePath,
  };
}

function readOptionalRecordArray(pathname: string): JsonRecord[] {
  if (!existsSync(pathname)) {
    return [];
  }
  const value = readJson(pathname);
  if (!Array.isArray(value) || !value.every(isPlainRecord)) {
    throw new Error(`${pathname} must contain an object array`);
  }
  return value;
}

function readOptionalRecord(pathname: string): JsonRecord | null {
  return existsSync(pathname) ? readJsonRecord(pathname) : null;
}

function readJsonRecord(pathname: string): JsonRecord {
  const value = readJson(pathname);
  if (!isPlainRecord(value)) {
    throw new Error(`${pathname} must contain an object`);
  }
  return value;
}

function readJson(pathname: string): unknown {
  try {
    return JSON.parse(readFileSync(pathname, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${pathname}: ${message}`);
  }
}
