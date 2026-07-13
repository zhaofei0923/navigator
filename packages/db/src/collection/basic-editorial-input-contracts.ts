import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

export const BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION =
  "basic-country-editorial-input/v1" as const;

export interface BasicEditorialEvidenceInput {
  readonly sourceId: string;
  readonly locator: string;
  readonly rawValue: BasicCollectionJsonValue;
  readonly unit: null;
  readonly year: null;
}

export interface BasicEditorialItemInput {
  readonly fieldPath: string;
  readonly normalizedValue: BasicCollectionJsonValue;
  readonly evidence: readonly BasicEditorialEvidenceInput[];
  readonly uncertainty: string | null;
}

export interface BasicCountryEditorialInput {
  readonly schemaVersion: typeof BASIC_COUNTRY_EDITORIAL_INPUT_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly primarySourceId: string;
  readonly items: readonly BasicEditorialItemInput[];
}
