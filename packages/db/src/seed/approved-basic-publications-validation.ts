import { readdirSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { BasicCountryPublicationVersionedValidationResult } from "../collection/basic-publication-contracts.js";
import { loadApprovedBasicCountryPublicationVersioned } from "../collection/basic-publication-versioned-loader.js";
import { SAFE_COUNTRY_DIRECTORY } from "./basic-country-validation-utils.js";

const RESERVED_DATA_DIRECTORIES = new Set(["approvals", "staging"]);

type ApprovedBasicCountryPublicationLoader = (
  repoRoot: string,
  countryDirectory: string,
) => BasicCountryPublicationVersionedValidationResult;

export interface ApprovedBasicPublicationsValidationResult {
  readonly countryDirectories: readonly string[];
  readonly countryCodes: readonly string[];
}

export function discoverApprovedBasicCountryDirectories(
  repoRoot: string,
): readonly string[] {
  if (!isNormalizedAbsolutePath(repoRoot)) {
    throw new Error("Approved Basic publications repository root is invalid");
  }

  const countryDirectories = readdirSync(join(repoRoot, "data"), {
    withFileTypes: true,
  })
    .filter((entry) => {
      if (
        entry.name.startsWith(".") ||
        RESERVED_DATA_DIRECTORIES.has(entry.name)
      ) {
        return false;
      }
      if (entry.isSymbolicLink()) {
        throw new Error("Approved Basic publications data directory is invalid");
      }
      return entry.isDirectory();
    })
    .map((entry) => entry.name)
    .sort(compareText);

  for (const countryDirectory of countryDirectories) {
    if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
      throw new Error("Approved Basic publication directory is invalid");
    }
  }

  return Object.freeze(countryDirectories);
}

export function validateApprovedBasicCountryPublications(
  repoRoot: string,
  loadPublication: ApprovedBasicCountryPublicationLoader =
    loadApprovedBasicCountryPublicationVersioned,
): ApprovedBasicPublicationsValidationResult {
  const countryDirectories = discoverApprovedBasicCountryDirectories(repoRoot);

  if (countryDirectories.length === 0) {
    throw new Error("No approved Basic country publications found");
  }

  const seenCountryCodes = new Set<string>();
  const countryCodes = countryDirectories.map((countryDirectory) => {
    const publication = loadPublication(repoRoot, countryDirectory);
    if (!publication.valid) {
      throw new Error(
        `Approved Basic publication validation failed: ${countryDirectory}:${publication.blockerCode}`,
      );
    }
    const countryCode = publication.data.canonical.country.code;
    if (typeof countryCode !== "string") {
      throw new Error("Approved Basic publication country code is invalid");
    }
    if (seenCountryCodes.has(countryCode)) {
      throw new Error("Approved Basic publication country code is duplicated");
    }
    seenCountryCodes.add(countryCode);
    return countryCode;
  });

  return Object.freeze({
    countryDirectories: Object.freeze(countryDirectories),
    countryCodes: Object.freeze(countryCodes),
  });
}

function isNormalizedAbsolutePath(pathname: string): boolean {
  const root = parse(pathname).root;
  return pathname !== "" &&
    !pathname.includes("\0") &&
    isAbsolute(pathname) &&
    normalize(pathname) === pathname &&
    (pathname === root || !pathname.endsWith(sep));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runCli(): void {
  if (process.argv.length !== 2) {
    throw new Error("Expected no arguments");
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const result = validateApprovedBasicCountryPublications(repoRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  try {
    runCli();
  } catch {
    process.stderr.write("approved Basic publications invalid\n");
    process.exitCode = 1;
  }
}
