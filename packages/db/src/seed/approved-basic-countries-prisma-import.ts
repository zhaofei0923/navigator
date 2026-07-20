import type { BasicCountryPublicationVersionedValidationResult } from "../collection/basic-publication-contracts.js";
import { loadApprovedBasicCountryPublicationVersioned } from "../collection/basic-publication-versioned-loader.js";
import {
  importPreparedApprovedBasicCountry,
  type BasicCountryImportResult,
  type BasicCountryImportTransactionPort,
} from "../runtime/basic-country-import-runtime.js";
import {
  prepareApprovedBasicCountryImport,
  type PreparedApprovedBasicCountryImport,
} from "./approved-basic-country-import.js";
import { discoverApprovedBasicCountryDirectories } from "./approved-basic-publications-validation.js";

const INVALID_APPROVED_BASIC_PUBLICATION_SET =
  "Approved Basic publication set is invalid";

type ApprovedBasicCountryPublicationLoader = (
  repoRoot: string,
  countryDirectory: string,
) => BasicCountryPublicationVersionedValidationResult;

export function prepareAllApprovedBasicCountryImports(
  repoRoot: string,
  loadPublication: ApprovedBasicCountryPublicationLoader =
    loadApprovedBasicCountryPublicationVersioned,
): readonly PreparedApprovedBasicCountryImport[] {
  const countryDirectories = discoverApprovedBasicCountryDirectories(repoRoot);
  const prepared = countryDirectories.map((countryDirectory) =>
    prepareApprovedBasicCountryImport(repoRoot, countryDirectory, loadPublication)
  );
  const uniqueCountryCodes = new Set(prepared.map(({ countryCode }) => countryCode));
  if (prepared.length === 0 || uniqueCountryCodes.size !== prepared.length) {
    throw new Error(INVALID_APPROVED_BASIC_PUBLICATION_SET);
  }
  return Object.freeze(prepared);
}

export async function importAllApprovedBasicCountries(
  prepared: readonly PreparedApprovedBasicCountryImport[],
  port: BasicCountryImportTransactionPort,
): Promise<readonly BasicCountryImportResult[]> {
  const results: BasicCountryImportResult[] = [];
  for (const country of prepared) {
    results.push(await importPreparedApprovedBasicCountry(country, port));
  }
  return Object.freeze(results);
}
