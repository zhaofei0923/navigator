import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

export const BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION =
  "basic-document-observation-plan/v1" as const;

export type BasicDocumentObservation =
  | {
      readonly usage: "source-fact";
      readonly fieldPath: string;
      readonly locator: string;
      readonly rawValue: BasicCollectionJsonValue;
      readonly normalizedValue: BasicCollectionJsonValue;
      readonly unit: string | null;
      readonly year: number | null;
      readonly uncertainty: string | null;
    }
  | {
      readonly usage: "editorial-evidence";
      readonly fieldPath: string;
      readonly locator: string;
      readonly rawValue: BasicCollectionJsonValue;
    };

export interface BasicDocumentObservationCapture {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly requestUrl: string;
  readonly retrievedAt: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly contentSha256: string;
}

export interface BasicDocumentObservationPlan {
  readonly schemaVersion: typeof BASIC_DOCUMENT_OBSERVATION_PLAN_SCHEMA_VERSION;
  readonly runId: string;
  readonly countryCode: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly sourceId: string;
  readonly capture: BasicDocumentObservationCapture;
  readonly observations: readonly BasicDocumentObservation[];
}
