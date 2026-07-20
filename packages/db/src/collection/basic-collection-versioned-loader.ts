import { isAbsolute, join, relative, resolve, sep } from "node:path";

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
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV3,
} from "./basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";
import { validateBasicCollectionAuditBundleV3 } from "./basic-collection-v3-validator.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import { BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES } from "./basic-publication-contracts.js";
import { readBasicStableJsonFileSet } from "./basic-stable-json-file-set.js";

const READ_ERROR = "Basic collection audit artifacts could not be read";
const MIXED_ERROR = "Basic collection audit artifact versions must not be mixed";
const INVALID_ERROR = "Basic collection audit bundle is invalid";
const ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);

type AuditSchemaVersion =
  | typeof BASIC_COLLECTION_AUDIT_SCHEMA_VERSION
  | typeof BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION
  | typeof BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION;

export function loadBasicCollectionAuditBundleVersioned(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2 |
  BasicCollectionAuditBundleV3 {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("runId must be a safe run id");
  }

  const artifacts = readArtifacts(repoRoot, countryDirectory, runId);
  return validateBasicCollectionAuditArtifactValuesVersioned(
    countryDirectory,
    runId,
    artifacts,
  );
}

export function validateBasicCollectionAuditArtifactValuesVersioned(
  countryDirectory: string,
  runId: string,
  artifacts: Readonly<Record<BasicCollectionAuditArtifactName, unknown>>,
): BasicCollectionAuditBundle | BasicCollectionAuditBundleV2 |
  BasicCollectionAuditBundleV3 {
  const sourceRegister = artifacts["source-register.json"];
  const extractedFacts = artifacts["extracted-facts.json"];
  const marketOverviewDraft = artifacts["market-overview.draft.json"];
  const reviewReport = artifacts["review-report.json"];
  const versions = [
    schemaVersionOf(sourceRegister),
    schemaVersionOf(extractedFacts),
    schemaVersionOf(reviewReport),
  ];
  if (versions.some((version) => version === null)) throw new Error(INVALID_ERROR);
  if (!versions.every((version) => version === versions[0])) {
    throw new Error(MIXED_ERROR);
  }

  const bundle = {
    countryDirectory,
    runId,
    sourceRegister,
    extractedFacts,
    marketOverviewDraft,
    reviewReport,
  };
  if (versions[0] === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION) {
    const validation = validateBasicCollectionAuditBundle(bundle);
    if (!validation.valid) throw new Error(INVALID_ERROR);
    return validation.data;
  }
  if (versions[0] === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION) {
    const validation = validateBasicCollectionAuditBundleV2(bundle);
    if (!validation.valid) throw new Error(INVALID_ERROR);
    return validation.data;
  }
  const validation = validateBasicCollectionAuditBundleV3(bundle);
  if (!validation.valid) throw new Error(INVALID_ERROR);
  return validation.data;
}

function readArtifacts(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): Readonly<Record<BasicCollectionAuditArtifactName, unknown>> {
  try {
    const directory = auditDirectory(repoRoot, countryDirectory, runId);
    const files: Readonly<Record<BasicCollectionAuditArtifactName, string>> = {
      "source-register.json": join(directory, "source-register.json"),
      "extracted-facts.json": join(directory, "extracted-facts.json"),
      "market-overview.draft.json": join(
        directory,
        "market-overview.draft.json",
      ),
      "review-report.json": join(directory, "review-report.json"),
    };
    const reads = readBasicStableJsonFileSet({
      files,
      exactDirectories: [{ pathname: directory, entries: ARTIFACT_NAMES }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });
    return Object.freeze({
      "source-register.json": reads["source-register.json"].value,
      "extracted-facts.json": reads["extracted-facts.json"].value,
      "market-overview.draft.json": reads["market-overview.draft.json"].value,
      "review-report.json": reads["review-report.json"].value,
    });
  } catch {
    throw new Error(READ_ERROR);
  }
}

function auditDirectory(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): string {
  if (!isAbsolute(repoRoot) || repoRoot.includes("\0")) {
    throw new Error(READ_ERROR);
  }
  const root = resolve(repoRoot);
  const directory = resolve(root, "data", "staging", countryDirectory, runId);
  const child = relative(root, directory);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(READ_ERROR);
  }
  return directory;
}

function schemaVersionOf(value: unknown): AuditSchemaVersion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return null;
  return descriptor.value === BASIC_COLLECTION_AUDIT_SCHEMA_VERSION ||
    descriptor.value === BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION ||
    descriptor.value === BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION
    ? descriptor.value
    : null;
}
