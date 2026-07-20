import { isAbsolute, join, normalize, parse, sep } from "node:path";

import { SAFE_COUNTRY_DIRECTORY } from "../seed/basic-country-validation-utils.js";
import {
  BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION,
  type BasicCountryPublicationVersionedValidationResult,
} from "./basic-publication-contracts.js";
import { loadApprovedBasicCountryPublicationV2 } from "./basic-publication-loader.js";
import { loadApprovedBasicCountryPublicationV3 } from "./basic-publication-loader-v3.js";
import { readBasicStableJsonFileSet } from "./basic-stable-json-file-set.js";

const CANONICAL_ARTIFACT_NAMES = Object.freeze([
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const);
const PUBLICATION_READ_FAILED: BasicCountryPublicationVersionedValidationResult =
  Object.freeze({
    valid: false,
    blockerCode: "PUBLICATION_READ_FAILED",
    data: null,
  });

export function loadApprovedBasicCountryPublicationVersioned(
  repoRoot: string,
  countryDirectory: string,
): BasicCountryPublicationVersionedValidationResult {
  if (
    typeof repoRoot !== "string" ||
    typeof countryDirectory !== "string" ||
    !isNormalizedAbsolutePath(repoRoot) ||
    !SAFE_COUNTRY_DIRECTORY.test(countryDirectory)
  ) return PUBLICATION_READ_FAILED;

  try {
    const canonicalDirectory = join(repoRoot, "data", countryDirectory);
    const manifest = readBasicStableJsonFileSet({
      files: {
        manifest: join(canonicalDirectory, "collection-manifest.json"),
      },
      exactDirectories: [{
        pathname: canonicalDirectory,
        entries: CANONICAL_ARTIFACT_NAMES,
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    }).manifest.value;
    const schemaVersion = readManifestSchemaVersion(manifest);
    if (schemaVersion === BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION) {
      return loadApprovedBasicCountryPublicationV2(repoRoot, countryDirectory);
    }
    if (schemaVersion === BASIC_COUNTRY_PUBLICATION_MANIFEST_V3_SCHEMA_VERSION) {
      return loadApprovedBasicCountryPublicationV3(repoRoot, countryDirectory);
    }
    return PUBLICATION_READ_FAILED;
  } catch {
    return PUBLICATION_READ_FAILED;
  }
}

function readManifestSchemaVersion(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null;
  return Object.prototype.hasOwnProperty.call(value, "schemaVersion")
    ? Reflect.get(value, "schemaVersion")
    : null;
}

function isNormalizedAbsolutePath(pathname: string): boolean {
  const root = parse(pathname).root;
  return pathname !== "" &&
    !pathname.includes("\0") &&
    isAbsolute(pathname) &&
    normalize(pathname) === pathname &&
    (pathname === root || !pathname.endsWith(sep));
}
