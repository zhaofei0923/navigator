import { isDeepStrictEqual, types } from "node:util";

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
    assertSafeJsonGraph(input);
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
    assertSafeJsonGraph(bundle);
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

function assertSafeJsonGraph(value: unknown): void {
  inspectSafeJsonValue(value, new WeakSet<object>(), new WeakSet<object>());
}

function inspectSafeJsonValue(
  value: unknown,
  active: WeakSet<object>,
  inspected: WeakSet<object>,
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error();
    return;
  }
  if (typeof value !== "object" || types.isProxy(value)) {
    throw new Error();
  }
  if (active.has(value)) throw new Error();
  if (inspected.has(value)) return;

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (array && prototype !== Array.prototype) ||
    (!array && prototype !== Object.prototype)
  ) {
    throw new Error();
  }

  active.add(value);
  const keys = Reflect.ownKeys(value);
  let arrayIndexCount = 0;
  for (const key of keys) {
    if (typeof key === "symbol") throw new Error();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error();
    }
    if (array && key === "length") continue;
    if (!descriptor.enumerable) throw new Error();
    if (array) {
      if (!isArrayIndexKey(key)) throw new Error();
      arrayIndexCount += 1;
    }
    inspectSafeJsonValue(descriptor.value, active, inspected);
  }
  if (array && arrayIndexCount !== value.length) throw new Error();
  active.delete(value);
  inspected.add(value);
}

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 4_294_967_295 &&
    String(index) === key
  );
}
