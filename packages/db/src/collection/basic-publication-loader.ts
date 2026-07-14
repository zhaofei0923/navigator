import { isAbsolute, join, normalize, parse, sep } from "node:path";

import { SAFE_COUNTRY_DIRECTORY } from "../seed/basic-country-validation-utils.js";
import { BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION } from "./basic-collection-v2-contracts.js";
import { validateBasicCollectionAuditArtifactValuesVersioned } from "./basic-collection-versioned-loader.js";
import type { BasicCollectionAuditArtifactName } from "./basic-offline-audit-artifacts.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  type BasicCountryPublicationValidationResult,
} from "./basic-publication-contracts.js";
import { parseBasicCountryPublicationManifestV2 } from "./basic-publication-parser.js";
import {
  createBasicCountryPublicationFailure,
  validateApprovedBasicCountryPublicationV2,
} from "./basic-publication-validator.js";
import { readBasicStableJsonFileSet } from "./basic-stable-json-file-set.js";

const CANONICAL_ARTIFACT_NAMES = Object.freeze([
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const);
const CANDIDATE_ARTIFACT_NAMES = Object.freeze([
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[]);
const MANIFEST_INVALID = createBasicCountryPublicationFailure("MANIFEST_INVALID");
const PUBLICATION_IDENTITY_MISMATCH = createBasicCountryPublicationFailure(
  "PUBLICATION_IDENTITY_MISMATCH",
);
const PUBLICATION_READ_FAILED = createBasicCountryPublicationFailure(
  "PUBLICATION_READ_FAILED",
);

export function loadApprovedBasicCountryPublicationV2(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryPublicationValidationResult {
  if (
    typeof repoRoot !== "string" ||
    typeof countryDirectory !== "string" ||
    !isNormalizedAbsolutePath(repoRoot) ||
    !SAFE_COUNTRY_DIRECTORY.test(countryDirectory)
  ) return PUBLICATION_READ_FAILED;

  try {
    const canonicalDirectory = join(repoRoot, "data", countryDirectory);
    const manifestPath = join(canonicalDirectory, "collection-manifest.json");
    const phaseOne = readBasicStableJsonFileSet({
      files: { manifest: manifestPath },
      exactDirectories: [{
        pathname: canonicalDirectory,
        entries: CANONICAL_ARTIFACT_NAMES,
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });
    const manifestResult = parseBasicCountryPublicationManifestV2(
      phaseOne.manifest.value,
    );
    if (manifestResult.data === null) return MANIFEST_INVALID;

    const manifest = manifestResult.data;
    const expectedAuditBundlePath =
      `data/staging/${countryDirectory}/${manifest.activeRunId}`;
    const expectedApprovalReceiptPath =
      `data/approvals/${countryDirectory}/${manifest.activeRunId}.json`;
    if (
      manifest.auditBundlePath !== expectedAuditBundlePath ||
      manifest.approvalReceiptPath !== expectedApprovalReceiptPath
    ) return PUBLICATION_IDENTITY_MISMATCH;

    const candidateDirectory = join(
      repoRoot,
      "data",
      "staging",
      countryDirectory,
      manifest.activeRunId,
    );
    const approvalReceiptPath = join(
      repoRoot,
      "data",
      "approvals",
      countryDirectory,
      `${manifest.activeRunId}.json`,
    );
    const phaseTwo = readBasicStableJsonFileSet({
      files: {
        manifest: manifestPath,
        country: join(canonicalDirectory, "country.json"),
        marketOverview: join(canonicalDirectory, "market-overview.json"),
        approvalReceipt: approvalReceiptPath,
        "source-register.json": join(candidateDirectory, "source-register.json"),
        "extracted-facts.json": join(candidateDirectory, "extracted-facts.json"),
        "market-overview.draft.json": join(
          candidateDirectory,
          "market-overview.draft.json",
        ),
        "review-report.json": join(candidateDirectory, "review-report.json"),
      },
      exactDirectories: [
        {
          pathname: canonicalDirectory,
          entries: CANONICAL_ARTIFACT_NAMES,
        },
        {
          pathname: candidateDirectory,
          entries: CANDIDATE_ARTIFACT_NAMES,
        },
      ],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });
    if (!equalBytes(phaseOne.manifest.bytes, phaseTwo.manifest.bytes)) {
      return PUBLICATION_READ_FAILED;
    }

    const candidateValues = Object.fromEntries(
      CANDIDATE_ARTIFACT_NAMES.map((name) => [name, phaseTwo[name].value]),
    ) as Readonly<Record<BasicCollectionAuditArtifactName, unknown>>;
    const candidate = validateBasicCollectionAuditArtifactValuesVersioned(
      countryDirectory,
      manifest.activeRunId,
      candidateValues,
    );
    if (
      candidate.sourceRegister.schemaVersion !==
        BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION
    ) throw new Error("Unsupported publication candidate version");

    const candidateArtifactBytes = Object.fromEntries(
      CANDIDATE_ARTIFACT_NAMES.map((name) => [name, phaseTwo[name].bytes]),
    ) as Readonly<Record<BasicCollectionAuditArtifactName, Uint8Array>>;
    return validateApprovedBasicCountryPublicationV2({
      countryDirectory,
      manifest: phaseTwo.manifest.value,
      approvalReceipt: phaseTwo.approvalReceipt.value,
      approvalReceiptBytes: phaseTwo.approvalReceipt.bytes,
      candidate,
      candidateArtifactBytes,
      canonical: {
        country: phaseTwo.country.value,
        marketOverview: phaseTwo.marketOverview.value,
        policy: [],
        risk: [],
        opportunities: [],
        projects: [],
        partners: [],
        chineseCompanies: [],
        entryStrategy: null,
        reports: [],
        knowledge: [],
      },
      canonicalArtifactNames: CANONICAL_ARTIFACT_NAMES,
    });
  } catch {
    return PUBLICATION_READ_FAILED;
  }
}

function isNormalizedAbsolutePath(pathname: string): boolean {
  const root = parse(pathname).root;
  return pathname !== "" &&
    !pathname.includes("\0") &&
    isAbsolute(pathname) &&
    normalize(pathname) === pathname &&
    (pathname === root || !pathname.endsWith(sep));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
