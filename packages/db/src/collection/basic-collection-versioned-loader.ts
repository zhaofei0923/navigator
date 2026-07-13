import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  type BasicCollectionAuditBundle,
} from "./basic-collection-contracts.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV2,
} from "./basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";

const READ_ERROR = "Basic collection audit artifacts could not be read";
const MIXED_ERROR = "Basic collection audit artifact versions must not be mixed";
const INVALID_ERROR = "Basic collection audit bundle is invalid";

type AuditSchemaVersion =
  | typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION
  | typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION;

export function loadBasicCollectionAuditBundleVersioned(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2 {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("runId must be a safe run id");
  }

  const artifacts = readArtifacts(repoRoot, countryDirectory, runId);
  const versions = [
    schemaVersionOf(artifacts.sourceRegister),
    schemaVersionOf(artifacts.extractedFacts),
    schemaVersionOf(artifacts.reviewReport),
  ];
  if (versions.some((version) => version === null)) throw new Error(INVALID_ERROR);
  if (!versions.every((version) => version === versions[0])) {
    throw new Error(MIXED_ERROR);
  }

  const bundle = { countryDirectory, runId, ...artifacts };
  if (versions[0] === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) {
    const validation = validateBasicCollectionAuditBundle(bundle);
    if (!validation.valid) throw new Error(INVALID_ERROR);
    return validation.data;
  }
  const validation = validateBasicCollectionAuditBundleV2(bundle);
  if (!validation.valid) throw new Error(INVALID_ERROR);
  return validation.data;
}

function readArtifacts(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): {
  readonly sourceRegister: unknown;
  readonly extractedFacts: unknown;
  readonly marketOverviewDraft: unknown;
  readonly reviewReport: unknown;
} {
  try {
    const directory = join(repoRoot, "data", "staging", countryDirectory, runId);
    return {
      sourceRegister: readJson(join(directory, "source-register.json")),
      extractedFacts: readJson(join(directory, "extracted-facts.json")),
      marketOverviewDraft: readJson(join(directory, "market-overview.draft.json")),
      reviewReport: readJson(join(directory, "review-report.json")),
    };
  } catch {
    throw new Error(READ_ERROR);
  }
}

function readJson(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, "utf8")) as unknown;
}

function schemaVersionOf(value: unknown): AuditSchemaVersion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return null;
  return descriptor.value === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION ||
    descriptor.value === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION
    ? descriptor.value
    : null;
}
