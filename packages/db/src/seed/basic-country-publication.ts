import { isDeepStrictEqual } from "node:util";

import type { BasicCollectionAuditBundle } from "../collection/basic-collection-contracts.js";
import { validateBasicCollectionAuditBundle } from "../collection/basic-collection-validator.js";
import {
  BASIC_COUNTRY_CANONICAL_MAPPING_VERSION,
  mapBasicCountryCanonicalPublication,
} from "./basic-country-publication-mapping.js";
import type {
  BasicCollectionManifest,
  BasicCountryBundle,
  BasicCountryValidationResult,
} from "./basic-country-types.js";
import { isPlainRecord } from "./basic-country-validation-utils.js";
import { validateBasicCountryBundle } from "./basic-country-validator.js";

export { BASIC_COUNTRY_CANONICAL_MAPPING_VERSION };

export interface BasicApprovedCountryPublicationInput {
  countryDirectory: string;
  manifest: BasicCollectionManifest;
  auditBundle: BasicCollectionAuditBundle;
}

const SNAPSHOT_ERROR = "publication bundle must be safely snapshotable";
const INPUT_SNAPSHOT_ERROR = "approved audit input must be safely snapshotable";
const APPROVAL_ERROR = "audit bundle is not approved for Basic publication";
const DRIFT_ERROR = "canonical bundle does not match its approved audit mapping";

export function createBasicCountryBundleFromApprovedAudit(
  input: BasicApprovedCountryPublicationInput,
): BasicCountryBundle {
  let snapshot: BasicApprovedCountryPublicationInput;
  try {
    snapshot = structuredClone(input);
  } catch {
    throw new Error(INPUT_SNAPSHOT_ERROR);
  }

  try {
    assertPublicationInput(snapshot);
    const auditValidation = validateBasicCollectionAuditBundle(
      snapshot.auditBundle,
    );
    if (!auditValidation.valid || !isApproved(auditValidation.data)) {
      throw new Error(APPROVAL_ERROR);
    }
    const bundle = mapBasicCountryCanonicalPublication({
      countryDirectory: snapshot.countryDirectory,
      manifest: snapshot.manifest,
      auditBundle: auditValidation.data,
    });
    if (!validateBasicCountryBundle(bundle).valid) {
      throw new Error(APPROVAL_ERROR);
    }
    return bundle;
  } catch {
    throw new Error(APPROVAL_ERROR);
  }
}

export function validateApprovedBasicCountryPublication(
  bundle: unknown,
): BasicCountryValidationResult {
  let snapshot: unknown;
  try {
    snapshot = structuredClone(bundle);
  } catch {
    return invalid(SNAPSHOT_ERROR);
  }

  const structural = validateBasicCountryBundle(snapshot);
  if (!structural.valid) {
    return structural;
  }

  try {
    const typedBundle = snapshot as BasicCountryBundle;
    const expected = createBasicCountryBundleFromApprovedAudit({
      countryDirectory: typedBundle.countryDirectory,
      manifest: typedBundle.audit.manifest,
      auditBundle: reconstructAuditBundle(typedBundle),
    });
    if (!isDeepStrictEqual(typedBundle, expected)) {
      return { ...structural, valid: false, errors: [DRIFT_ERROR] };
    }
    return structural;
  } catch {
    return { ...structural, valid: false, errors: [APPROVAL_ERROR] };
  }
}

function assertPublicationInput(
  input: BasicApprovedCountryPublicationInput,
): void {
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, ["countryDirectory", "manifest", "auditBundle"]) ||
    typeof input.countryDirectory !== "string" ||
    !isPlainRecord(input.manifest) ||
    !hasExactKeys(input.manifest, [
      "activeRunId",
      "mappingVersion",
      "auditBundlePath",
    ]) ||
    input.manifest.mappingVersion !== BASIC_COUNTRY_CANONICAL_MAPPING_VERSION
  ) {
    throw new Error(APPROVAL_ERROR);
  }
}

function isApproved(auditBundle: BasicCollectionAuditBundle): boolean {
  const validation = validateBasicCollectionAuditBundle(auditBundle);
  const report = auditBundle.reviewReport;
  return (
    validation.valid &&
    validation.blockers.length === 0 &&
    validation.readyForHumanReview &&
    report.status === "ready-for-human-review" &&
    report.publicationRecommendation === "request-human-review" &&
    report.humanDecision?.decision === "approved"
  );
}

function reconstructAuditBundle(
  bundle: BasicCountryBundle,
): BasicCollectionAuditBundle {
  return {
    countryDirectory: bundle.countryDirectory,
    runId: bundle.audit.run.runId,
    sourceRegister: bundle.audit.run.sourceRegister,
    extractedFacts: bundle.audit.run.extractedFacts,
    marketOverviewDraft: bundle.audit.run.marketOverviewDraft,
    reviewReport: bundle.audit.run.reviewReport,
  } as unknown as BasicCollectionAuditBundle;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    [...keys].sort().every((key, index) => actual[index] === key)
  );
}

function invalid(error: string): BasicCountryValidationResult {
  return {
    valid: false,
    errors: [error],
    summary: { countryCode: "", coverageLevel: "", moduleStatuses: {} },
  };
}
