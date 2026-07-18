import { loadApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-loader.js";
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

export function prepareAllApprovedBasicCountryImports(
  repoRoot: string,
  loadPublication: typeof loadApprovedBasicCountryPublicationV2 =
    loadApprovedBasicCountryPublicationV2,
): readonly PreparedApprovedBasicCountryImport[] {
  const countryDirectories = discoverApprovedBasicCountryDirectories(repoRoot);
  return Object.freeze(countryDirectories.map((countryDirectory) =>
    prepareApprovedBasicCountryImport(repoRoot, countryDirectory, loadPublication)
  ));
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
