import { describe, expect, test } from "vitest";

import type {
  BasicBridgeErrorCode,
  BasicBridgeFailure,
  BasicBridgePhase,
  BasicBridgeResult,
  BasicDraftBridgeInput,
  BasicDraftModelPort,
  BasicDeterministicAdapterInput,
  BasicDeterministicAdapterOutput,
  BasicDeterministicObservation,
  BasicDeterministicSourceAdapter,
  BasicRawCaptureInput,
  BasicRawCaptureReceipt,
  BasicRawCaptureResult,
  BasicSourceAdapterRunInput,
  BasicSourceAdapterRunResult,
  BasicSourceFetch,
  BasicSourceFetchResponse,
  BasicSourceRequest,
  BasicSourceTransport,
  BasicSourceTransportResponse,
  BasicCollectionAuditBundle,
  BasicCollectionAuditSummary,
  BasicCollectionAuditValidationResult,
  BasicCollectionBlockerCode,
  BasicCollectionJsonValue,
  BasicCollectionReviewReport,
  BasicDraftKeyIndicator,
  BasicExtractedFact,
  BasicExtractedFacts,
  BasicExtractionMethod,
  BasicFactEvidence,
  BasicFactStatus,
  BasicHumanDecision,
  BasicInjectionRisk,
  BasicMarketOverviewDraft,
  BasicHermesDiscoveryBatch,
  BasicHermesDiscoveryCandidate,
  BasicHermesDiscoveryPort,
  BasicHermesDiscoveryRequest,
  BasicHermesEvidencePromotionInput,
  BasicHermesObservation,
  BasicHermesOpenedJsonSource,
  BasicHermesSourcePolicy,
  BasicLlamaCppDraftRequest,
  BasicLlamaCppFetch,
  BasicLlamaCppFetchResponse,
  BasicLlamaCppTransportOptions,
  BasicPromptInjectionRisk,
  BasicReviewConflict,
  BasicSourceAccessStatus,
  BasicSourceCheck,
  BasicSourceFamily,
  BasicSourceRecord,
  BasicSourceRegister,
  BasicActivationCountPort,
  BasicActivationModel,
  BasicActivationScope,
  BasicCountryActivationPreflightResult,
  BasicCollectionAuditArtifactsV2,
  BasicCollectionAuditBundleV2,
  BasicDeterministicCandidateResult,
  BasicApprovedCountryPublicationV2,
  BasicCountryPublicationApprovalReceipt,
  BasicCountryPublicationBlockerCode,
  BasicCountryPublicationManifestV2,
  BasicCountryPublicationValidationResult,
} from "./index.js";

// @ts-expect-error BasicHermesSourcedObservation is package-private.
import type { BasicHermesSourcedObservation } from "./index.js";
// @ts-expect-error BasicMarketOverviewDraftParseResult is package-private.
import type { BasicMarketOverviewDraftParseResult } from "./index.js";
// @ts-expect-error BasicLlamaSourceSnapshot is package-private.
import type { BasicLlamaSourceSnapshot } from "./index.js";
// @ts-expect-error BasicLlamaEvidenceSnapshot is package-private.
import type { BasicLlamaEvidenceSnapshot } from "./index.js";
// @ts-expect-error BasicLlamaFactSnapshot is package-private.
import type { BasicLlamaFactSnapshot } from "./index.js";
// @ts-expect-error BasicLlamaRegisterSnapshot is package-private.
import type { BasicLlamaRegisterSnapshot } from "./index.js";
// @ts-expect-error BasicLlamaFactsSnapshot is package-private.
import type { BasicLlamaFactsSnapshot } from "./index.js";
// @ts-expect-error BasicLlamaJsonSnapshot is package-private.
import type { BasicLlamaJsonSnapshot } from "./index.js";

// @ts-expect-error snapshotBasicHermesDiscoveryCandidate is package-private.
type SnapshotBasicHermesDiscoveryCandidateLeak = typeof import("./index.js")["snapshotBasicHermesDiscoveryCandidate"];
// @ts-expect-error canonicalBasicHermesDiscoveryUrl is package-private.
type CanonicalBasicHermesDiscoveryUrlLeak = typeof import("./index.js")["canonicalBasicHermesDiscoveryUrl"];
// @ts-expect-error materializeBasicHermesFacts is package-private.
type MaterializeBasicHermesFactsLeak = typeof import("./index.js")["materializeBasicHermesFacts"];
// @ts-expect-error factId is package-private.
type FactIdLeak = typeof import("./index.js")["factId"];
// @ts-expect-error parseCapturedJson is package-private.
type ParseCapturedJsonLeak = typeof import("./index.js")["parseCapturedJson"];
// @ts-expect-error pointer is package-private.
type PointerLeak = typeof import("./index.js")["pointer"];
// @ts-expect-error source is package-private.
type SourceMapperLeak = typeof import("./index.js")["source"];
// @ts-expect-error parseBasicMarketOverviewDraft is package-private.
type ParseBasicMarketOverviewDraftLeak = typeof import("./index.js")["parseBasicMarketOverviewDraft"];
// @ts-expect-error parseBasicMarketOverviewDraftForAudit is package-private.
type ParseBasicMarketOverviewDraftForAuditLeak = typeof import("./index.js")["parseBasicMarketOverviewDraftForAudit"];
// @ts-expect-error BASIC_LLAMA_DRAFT_JSON_SCHEMA is package-private.
type BasicLlamaDraftJsonSchemaLeak = typeof import("./index.js")["BASIC_LLAMA_DRAFT_JSON_SCHEMA"];
// @ts-expect-error parseBasicLlamaRegisterSnapshot is package-private.
type ParseBasicLlamaRegisterSnapshotLeak = typeof import("./index.js")["parseBasicLlamaRegisterSnapshot"];
// @ts-expect-error parseBasicLlamaFactsSnapshot is package-private.
type ParseBasicLlamaFactsSnapshotLeak = typeof import("./index.js")["parseBasicLlamaFactsSnapshot"];
// @ts-expect-error parseBasicLlamaIndicatorPath is package-private.
type ParseBasicLlamaIndicatorPathLeak = typeof import("./index.js")["parseBasicLlamaIndicatorPath"];
// @ts-expect-error readBasicLlamaExactRuntimeRecord is package-private.
type ReadBasicLlamaExactRuntimeRecordLeak = typeof import("./index.js")["readBasicLlamaExactRuntimeRecord"];
// @ts-expect-error readBasicLlamaStandardArray is package-private.
type ReadBasicLlamaStandardArrayLeak = typeof import("./index.js")["readBasicLlamaStandardArray"];
// @ts-expect-error snapshotBasicLlamaJson is package-private.
type SnapshotBasicLlamaJsonLeak = typeof import("./index.js")["snapshotBasicLlamaJson"];
// @ts-expect-error deepFreezeBasicLlamaValue is package-private.
type DeepFreezeBasicLlamaValueLeak = typeof import("./index.js")["deepFreezeBasicLlamaValue"];
// @ts-expect-error createRequest is package-private.
type CreateRequestLeak = typeof import("./index.js")["createRequest"];
// @ts-expect-error parseResponse is package-private.
type ParseResponseLeak = typeof import("./index.js")["parseResponse"];
// @ts-expect-error extractContent is package-private.
type ExtractContentLeak = typeof import("./index.js")["extractContent"];
// @ts-expect-error BasicCollectionBridgeError is package-private.
type BasicCollectionBridgeErrorLeak = typeof import("./index.js")["BasicCollectionBridgeError"];
// @ts-expect-error BasicDeterministicCandidateInput is package-private.
import type { BasicDeterministicCandidateInput } from "./index.js";
// @ts-expect-error BasicDeterministicRunnerPort is package-private.
import type { BasicDeterministicRunnerPort } from "./index.js";
// @ts-expect-error BasicCollectionAuditAssemblyInputV2 is package-private.
import type { BasicCollectionAuditAssemblyInputV2 } from "./index.js";
// @ts-expect-error BasicCollectionAuditSerializedArtifactsV2 is package-private.
import type { BasicCollectionAuditSerializedArtifactsV2 } from "./index.js";
// @ts-expect-error BasicDeterministicMaterializationResultV2 is package-private.
import type { BasicDeterministicMaterializationResultV2 } from "./index.js";
// @ts-expect-error BasicCollectionAuditValidationResultV2 is package-private.
import type { BasicCollectionAuditValidationResultV2 } from "./index.js";
// @ts-expect-error BasicCollectionReviewReportV2 is package-private.
import type { BasicCollectionReviewReportV2 } from "./index.js";
// @ts-expect-error BasicDeterministicBoundaryVerdict is package-private.
import type { BasicDeterministicBoundaryVerdict } from "./index.js";
// @ts-expect-error BasicDeterministicCandidateStage is package-private.
import type { BasicDeterministicCandidateStage } from "./index.js";
// @ts-expect-error BasicDeterministicStageName is package-private.
import type { BasicDeterministicStageName } from "./index.js";
// @ts-expect-error BasicDeterministicStageOutcome is package-private.
import type { BasicDeterministicStageOutcome } from "./index.js";
// @ts-expect-error parseBasicCountryPublicationApproval is package-private.
type ParseBasicCountryPublicationApprovalLeak = typeof import("./index.js")["parseBasicCountryPublicationApproval"];
// @ts-expect-error parseBasicCountryPublicationManifestV2 is package-private.
type ParseBasicCountryPublicationManifestV2Leak = typeof import("./index.js")["parseBasicCountryPublicationManifestV2"];
// @ts-expect-error sha256Hex is package-private.
type Sha256HexLeak = typeof import("./index.js")["sha256Hex"];
// @ts-expect-error equalSha256Hex is package-private.
type EqualSha256HexLeak = typeof import("./index.js")["equalSha256Hex"];
// @ts-expect-error readBasicStableJsonFileSet is package-private.
type ReadBasicStableJsonFileSetLeak = typeof import("./index.js")["readBasicStableJsonFileSet"];
// @ts-expect-error materializeBasicCanonicalFromApprovedCandidateV2 is package-private.
type MaterializeBasicCanonicalFromApprovedCandidateV2Leak = typeof import("./index.js")["materializeBasicCanonicalFromApprovedCandidateV2"];
// @ts-expect-error createBasicCountryPublicationFixture is package-private.
type CreateBasicCountryPublicationFixtureLeak = typeof import("./index.js")["createBasicCountryPublicationFixture"];
// @ts-expect-error createBasicCountryPublicationFailure is package-private.
type CreateBasicCountryPublicationFailureLeak = typeof import("./index.js")["createBasicCountryPublicationFailure"];
// @ts-expect-error validateBasicCollectionAuditArtifactValuesVersioned is package-private.
type ValidateBasicCollectionAuditArtifactValuesVersionedLeak = typeof import("./index.js")["validateBasicCollectionAuditArtifactValuesVersioned"];
// @ts-expect-error parseBasicStrictJsonText is package-private.
type ParseBasicStrictJsonTextLeak = typeof import("./index.js")["parseBasicStrictJsonText"];
// @ts-expect-error hasOnlyUnicodeScalarJsonStrings is package-private.
type HasOnlyUnicodeScalarJsonStringsLeak = typeof import("./index.js")["hasOnlyUnicodeScalarJsonStrings"];
// @ts-expect-error isBasicStrictJsonUnicodeScalarError is package-private.
type IsBasicStrictJsonUnicodeScalarErrorLeak = typeof import("./index.js")["isBasicStrictJsonUnicodeScalarError"];

import * as database from "./index.js";
import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_HERMES_DISCOVERY_MAX_QUERIES,
  BASIC_HERMES_DISCOVERY_MAX_RESULTS,
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  BASIC_HERMES_DISCOVERY_TIMEOUT_MS,
  BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES,
  BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES,
  BASIC_LLAMA_DRAFT_OPERATION,
  BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
  BASIC_LLAMA_DRAFT_TIMEOUT_MS,
  BASIC_RAW_CAPTURE_MAX_BYTES,
  BASIC_RAW_CAPTURE_SCHEMA_VERSION,
  BASIC_SOURCE_MAX_REDIRECTS,
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  BASIC_COLLECTION_BLOCKER_CODES,
  BASIC_COUNTRY_CANONICAL_MAPPING_VERSION,
  BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION,
  BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES,
  BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION,
  BASIC_DETERMINISTIC_STAGE_NAMES,
  WORLD_BANK_CORE_INDICATOR_ADAPTERS,
  buildApprovedBasicCountryPublicationImportPlan,
  bridgeBasicMarketOverviewDraft,
  captureBasicRawSource,
  createBasicSourceTransport,
  createBasicLlamaCppDraftTransport,
  createBasicCountryBundle,
  loadBasicCollectionAuditBundle,
  loadBasicCollectionAuditBundleVersioned,
  loadApprovedBasicCountryPublicationV2,
  loadBasicCountryBundle,
  preflightBasicCountryActivation,
  runBasicDeterministicCandidate,
  runBasicDeterministicSourceAdapters,
  runBasicHermesDiscovery,
  promoteBasicHermesJsonEvidence,
  validateBasicCountryBundle,
  validateBasicCollectionAuditBundle,
  validateApprovedBasicCountryPublicationV2,
  worldBankCountryAdapter,
  workspaceName,
} from "./index.js";

describe("@navigator/db", () => {
  test("exports its workspace marker", () => {
    expect(workspaceName).toBe("@navigator/db");
  });

  test("exports the Basic country seed API", () => {
    expect(createBasicCountryBundle).toBeTypeOf("function");
    expect(loadBasicCountryBundle).toBeTypeOf("function");
    expect(validateBasicCountryBundle).toBeTypeOf("function");
    expect(buildApprovedBasicCountryPublicationImportPlan).toBeTypeOf(
      "function",
    );
  });

  test("exports the read-only Basic activation preflight API", () => {
    expect(preflightBasicCountryActivation).toBeTypeOf("function");
    const typeWitness: [
      BasicActivationModel,
      BasicActivationScope,
      BasicActivationCountPort,
      BasicCountryActivationPreflightResult,
    ] | null = null;
    expect(typeWitness).toBeNull();
  });

  test("exports the Basic collection audit API", () => {
    expect(database.loadBasicCollectionAuditBundle).toBeTypeOf("function");
    expect(loadBasicCollectionAuditBundle).toBeTypeOf("function");
    expect(validateBasicCollectionAuditBundle).toBeTypeOf("function");
    expect(BASIC_COLLECTION_AUDIT_SCHEMA_VERSION).toBe(
      "basic-country-audit/v1",
    );
    expect(BASIC_COLLECTION_BLOCKER_CODES).toEqual([
      "MISSING_REQUIRED_FACT",
      "UNRESOLVED_CONFLICT",
      "UNTRUSTED_INPUT",
    ]);
  });

  test("exports exactly the approved deterministic v2 runtime surface", () => {
    expect(runBasicDeterministicCandidate).toBeTypeOf("function");
    expect(loadBasicCollectionAuditBundleVersioned).toBeTypeOf("function");
    expect(BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION).toBe(
      "basic-country-audit/v2",
    );
    expect(BASIC_DETERMINISTIC_STAGE_NAMES).toEqual([
      "input",
      "runner",
      "preflight",
      "draft-assemble",
      "audit-assemble",
      "validate",
      "artifacts",
      "boundary",
    ]);

    const deterministicV2Exports = Object.keys(database).filter((name) =>
      name === "BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION" ||
      name === "BASIC_DETERMINISTIC_STAGE_NAMES" ||
      name.includes("BasicDeterministicCandidate") ||
      name.endsWith("Versioned"));
    expect(deterministicV2Exports.sort()).toEqual([
      "BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION",
      "BASIC_DETERMINISTIC_STAGE_NAMES",
      "loadBasicCollectionAuditBundleVersioned",
      "runBasicDeterministicCandidate",
    ]);
  });

  test("exports exactly the approved Basic v2 publication runtime surface", () => {
    expect(BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION).toBe(
      "basic-country-publication-approval/v1",
    );
    expect(BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION).toBe(
      "basic-country-publication-manifest/v2",
    );
    expect(BASIC_COUNTRY_CANONICAL_MAPPING_VERSION).toBe(
      "basic-country-canonical/v2",
    );
    expect(BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES).toEqual([
      "MANIFEST_INVALID",
      "APPROVAL_RECEIPT_INVALID",
      "APPROVAL_RECEIPT_HASH_MISMATCH",
      "CANDIDATE_ARTIFACT_HASH_MISMATCH",
      "PUBLICATION_IDENTITY_MISMATCH",
      "CANDIDATE_NOT_READY",
      "APPROVAL_TIMESTAMP_INVALID",
      "CANONICAL_MAPPING_DRIFT",
      "BASIC_COVERAGE_VIOLATION",
      "AI_BOUNDARY_VIOLATION",
      "PUBLICATION_READ_FAILED",
    ]);
    expect(validateApprovedBasicCountryPublicationV2).toBeTypeOf("function");
    expect(loadApprovedBasicCountryPublicationV2).toBeTypeOf("function");

    const publicationRuntimeExports = Object.keys(database)
      .filter((name) =>
        name.startsWith("BASIC_COUNTRY_PUBLICATION_") ||
        name === "BASIC_COUNTRY_CANONICAL_MAPPING_VERSION" ||
        name === "validateApprovedBasicCountryPublicationV2" ||
        name === "loadApprovedBasicCountryPublicationV2"
      )
      .sort();
    expect(publicationRuntimeExports).toEqual([
      "BASIC_COUNTRY_CANONICAL_MAPPING_VERSION",
      "BASIC_COUNTRY_PUBLICATION_APPROVAL_SCHEMA_VERSION",
      "BASIC_COUNTRY_PUBLICATION_BLOCKER_CODES",
      "BASIC_COUNTRY_PUBLICATION_MANIFEST_SCHEMA_VERSION",
      "loadApprovedBasicCountryPublicationV2",
      "validateApprovedBasicCountryPublicationV2",
    ]);
  });

  test("exports only the consumer-facing Basic v2 publication types", () => {
    const publicPublicationTypeWitness: [
      BasicCountryPublicationApprovalReceipt,
      BasicCountryPublicationManifestV2,
      BasicCountryPublicationBlockerCode,
      BasicApprovedCountryPublicationV2,
      BasicCountryPublicationValidationResult,
    ] | null = null;

    expect(publicPublicationTypeWitness).toBeNull();
  });

  test("keeps Basic v2 publication implementation helpers package-private", () => {
    for (const internalName of [
      "parseBasicCountryPublicationApproval",
      "parseBasicCountryPublicationManifestV2",
      "sha256Hex",
      "equalSha256Hex",
      "readBasicStableJsonFileSet",
      "materializeBasicCanonicalFromApprovedCandidateV2",
      "createBasicCountryPublicationFixture",
      "createBasicCountryPublicationFailure",
      "validateBasicCollectionAuditArtifactValuesVersioned",
      "parseBasicStrictJsonText",
      "hasOnlyUnicodeScalarJsonStrings",
      "isBasicStrictJsonUnicodeScalarError",
    ]) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("keeps deterministic v2 composition internals package-private", () => {
    for (const internalName of [
      "assembleBasicCollectionAuditBundleV2",
      "assembleBasicMarketOverviewDraft",
      "classifyBasicV2FieldPath",
      "composeBasicCountryCandidate",
      "createBasicCollectionAuditArtifactsV2",
      "createBasicSourceExecutionPlan",
      "loadBasicCandidateConfig",
      "materializeBasicDocumentEvidence",
      "materializeBasicReviewedRunV2",
      "openBasicCandidateWorkspace",
      "parseBasicCountryEditorialInput",
      "parseBasicDocumentObservationPlan",
      "parseBasicManualSourceReview",
      "parseBasicSourceCatalog",
      "parseBasicStructuredSourceReview",
      "preflightBasicDeterministicCollection",
      "runBasicCandidateProduction",
      "runBasicSourceExecutionPlanV2",
      "serializeBasicCollectionAuditArtifactsV2",
      "validateBasicCollectionAuditBundleV2",
      "writeBasicCandidateArtifacts",
    ]) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("exports the reviewed deterministic source adapter API", () => {
    expect(createBasicSourceTransport).toBeTypeOf("function");
    expect(captureBasicRawSource).toBeTypeOf("function");
    expect(runBasicDeterministicSourceAdapters).toBeTypeOf("function");
    expect(worldBankCountryAdapter).toMatchObject({
      sourceId: "world-bank-country",
    });
    expect(WORLD_BANK_CORE_INDICATOR_ADAPTERS).toHaveLength(3);
    expect(BASIC_RAW_CAPTURE_SCHEMA_VERSION).toBe(
      "basic-country-raw-capture/v1",
    );
    expect(BASIC_RAW_CAPTURE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(BASIC_SOURCE_MAX_REDIRECTS).toBe(3);
  });

  test("does not expose raw-cache internals from the package barrel", () => {
    for (const internalName of [
      "prepareSourceDirectory",
      "publishCapture",
      "publishNoClobber",
      "readVerifiedCapture",
      "isBasicSourceRequestAllowed",
      "isBasicSourceResponseAllowed",
      "snapshotBasicSourceRequest",
      "snapshotBasicRawCaptureInput",
      "snapshotBasicSourceTransportResponse",
      "materializeBasicSourceFacts",
    ]) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("runtime-freezes the public Basic collection blocker codes", () => {
    expect(Object.isFrozen(BASIC_COLLECTION_BLOCKER_CODES)).toBe(true);
  });

  test("throws on public blocker-code mutation and preserves classification", () => {
    const mutableCodes = BASIC_COLLECTION_BLOCKER_CODES as unknown as string[];
    const originalCode = mutableCodes[0];

    try {
      expect(() => {
        mutableCodes[0] = "MUTATED_BY_CALLER";
      }).toThrow(TypeError);
    } finally {
      if (!Object.isFrozen(BASIC_COLLECTION_BLOCKER_CODES)) {
        mutableCodes[0] = originalCode!;
      }
    }

    expect(BASIC_COLLECTION_BLOCKER_CODES[0]).toBe("MISSING_REQUIRED_FACT");
    const bundle = createBasicCollectionAuditFixture();
    bundle.extractedFacts.facts = [];
    bundle.reviewReport.status = "blocked";
    bundle.reviewReport.publicationRecommendation = "do-not-publish";
    expect(validateBasicCollectionAuditBundle(bundle).blockers).toEqual([
      "MISSING_REQUIRED_FACT",
    ]);
  });

  test("makes every Basic collection contract type public", () => {
    const publicContractTypeWitness: [
      BasicCollectionAuditBundle,
      BasicCollectionAuditSummary,
      BasicCollectionAuditValidationResult,
      BasicCollectionBlockerCode,
      BasicCollectionJsonValue,
      BasicCollectionReviewReport,
      BasicDraftKeyIndicator,
      BasicExtractedFact,
      BasicExtractedFacts,
      BasicExtractionMethod,
      BasicFactEvidence,
      BasicFactStatus,
      BasicHumanDecision,
      BasicInjectionRisk,
      BasicMarketOverviewDraft,
      BasicPromptInjectionRisk,
      BasicReviewConflict,
      BasicSourceAccessStatus,
      BasicSourceCheck,
      BasicSourceFamily,
      BasicSourceRecord,
      BasicSourceRegister,
    ] | null = null;

    expect(publicContractTypeWitness).toBeNull();
  });

  test("exports only the consumer-facing deterministic v2 contract types", () => {
    const publicDeterministicV2TypeWitness: [
      BasicCollectionAuditArtifactsV2,
      BasicCollectionAuditBundleV2,
      BasicDeterministicCandidateResult,
    ] | null = null;

    expect(publicDeterministicV2TypeWitness).toBeNull();
  });

  test("makes every reviewed source adapter contract type public", () => {
    const publicSourceAdapterTypeWitness: [
      BasicSourceFetchResponse,
      BasicSourceFetch,
      BasicSourceRequest,
      BasicSourceTransportResponse,
      BasicSourceTransport,
      BasicDeterministicObservation,
      BasicDeterministicAdapterOutput,
      BasicDeterministicAdapterInput,
      BasicDeterministicSourceAdapter,
      BasicRawCaptureReceipt,
      BasicRawCaptureInput,
      BasicRawCaptureResult,
      BasicSourceAdapterRunInput,
      BasicSourceAdapterRunResult,
    ] | null = null;

    expect(publicSourceAdapterTypeWitness).toBeNull();
  });

  test("exports exactly the documented P1-6C runtime bridge surface", () => {
    const bridgeRuntimeExports = Object.keys(database)
      .filter((name) =>
        name.startsWith("BASIC_HERMES_") ||
        name.startsWith("BASIC_LLAMA_") ||
        name.includes("Hermes") ||
        name.includes("Llama") ||
        name === "bridgeBasicMarketOverviewDraft",
      )
      .sort();

    expect(bridgeRuntimeExports).toEqual([
      "BASIC_HERMES_DISCOVERY_MAX_QUERIES",
      "BASIC_HERMES_DISCOVERY_MAX_RESULTS",
      "BASIC_HERMES_DISCOVERY_SCHEMA_VERSION",
      "BASIC_HERMES_DISCOVERY_TIMEOUT_MS",
      "BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES",
      "BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES",
      "BASIC_LLAMA_DRAFT_OPERATION",
      "BASIC_LLAMA_DRAFT_PROTOCOL_VERSION",
      "BASIC_LLAMA_DRAFT_TIMEOUT_MS",
      "bridgeBasicMarketOverviewDraft",
      "createBasicLlamaCppDraftTransport",
      "promoteBasicHermesJsonEvidence",
      "runBasicHermesDiscovery",
    ]);
    expect(runBasicHermesDiscovery).toBeTypeOf("function");
    expect(promoteBasicHermesJsonEvidence).toBeTypeOf("function");
    expect(createBasicLlamaCppDraftTransport).toBeTypeOf("function");
    expect(bridgeBasicMarketOverviewDraft).toBeTypeOf("function");
  });

  test("exports the exact documented P1-6C protocol limits", () => {
    expect(BASIC_HERMES_DISCOVERY_SCHEMA_VERSION).toBe("basic-hermes-discovery/v1");
    expect(BASIC_HERMES_DISCOVERY_TIMEOUT_MS).toBe(300_000);
    expect(BASIC_HERMES_DISCOVERY_MAX_QUERIES).toBe(20);
    expect(BASIC_HERMES_DISCOVERY_MAX_RESULTS).toBe(50);
    expect(BASIC_LLAMA_DRAFT_TIMEOUT_MS).toBe(120_000);
    expect(BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES).toBe(1_048_576);
    expect(BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES).toBe(262_144);
    expect(BASIC_LLAMA_DRAFT_PROTOCOL_VERSION).toBe("basic-country-draft/v1");
    expect(BASIC_LLAMA_DRAFT_OPERATION).toBe("return-exact-draft");
  });

  test("keeps P1-6C parser and bridge implementation helpers private", () => {
    for (const internalName of [
      "snapshotBasicHermesDiscoveryCandidate",
      "canonicalBasicHermesDiscoveryUrl",
      "BasicHermesSourcedObservation",
      "materializeBasicHermesFacts",
      "factId",
      "parseCapturedJson",
      "pointer",
      "source",
      "BasicMarketOverviewDraftParseResult",
      "parseBasicMarketOverviewDraft",
      "parseBasicMarketOverviewDraftForAudit",
      "BASIC_LLAMA_DRAFT_JSON_SCHEMA",
      "BasicLlamaSourceSnapshot",
      "BasicLlamaEvidenceSnapshot",
      "BasicLlamaFactSnapshot",
      "BasicLlamaRegisterSnapshot",
      "BasicLlamaFactsSnapshot",
      "BasicLlamaJsonSnapshot",
      "parseBasicLlamaRegisterSnapshot",
      "parseBasicLlamaFactsSnapshot",
      "parseBasicLlamaIndicatorPath",
      "readBasicLlamaExactRuntimeRecord",
      "readBasicLlamaStandardArray",
      "snapshotBasicLlamaJson",
      "deepFreezeBasicLlamaValue",
      "createRequest",
      "parseResponse",
      "extractContent",
      "BasicCollectionBridgeError",
    ]) {
      expect(database).not.toHaveProperty(internalName);
    }
  });

  test("makes every documented P1-6C bridge contract type public", () => {
    const publicBridgeContractTypeWitness: [
      BasicHermesDiscoveryRequest,
      BasicHermesDiscoveryPort,
      BasicHermesDiscoveryCandidate,
      BasicHermesDiscoveryBatch,
      BasicHermesSourcePolicy,
      BasicHermesObservation,
      BasicHermesOpenedJsonSource,
      BasicHermesEvidencePromotionInput,
      BasicLlamaCppDraftRequest,
      BasicDraftModelPort,
      BasicDraftBridgeInput,
      BasicLlamaCppFetchResponse,
      BasicLlamaCppFetch,
      BasicLlamaCppTransportOptions,
      BasicBridgeErrorCode,
      BasicBridgePhase,
      BasicBridgeFailure,
      BasicBridgeResult<BasicMarketOverviewDraft>,
    ] | null = null;

    expect(publicBridgeContractTypeWitness).toBeNull();
  });
});
