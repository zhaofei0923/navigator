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
} from "./index.js";
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
  BASIC_COLLECTION_BLOCKER_CODES,
  WORLD_BANK_CORE_INDICATOR_ADAPTERS,
  buildBasicCountryImportPlan,
  bridgeBasicMarketOverviewDraft,
  captureBasicRawSource,
  createBasicSourceTransport,
  createBasicLlamaCppDraftTransport,
  createBasicCountryBundle,
  loadBasicCollectionAuditBundle,
  loadBasicCountryBundle,
  runBasicDeterministicSourceAdapters,
  runBasicHermesDiscovery,
  promoteBasicHermesJsonEvidence,
  validateBasicCountryBundle,
  validateBasicCollectionAuditBundle,
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
    expect(buildBasicCountryImportPlan).toBeTypeOf("function");
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

  test("exports immutable documented P1-6C protocol limits", () => {
    expect(BASIC_HERMES_DISCOVERY_SCHEMA_VERSION).toBe("basic-hermes-discovery/v1");
    expect(BASIC_HERMES_DISCOVERY_TIMEOUT_MS).toBe(300_000);
    expect(BASIC_HERMES_DISCOVERY_MAX_QUERIES).toBe(20);
    expect(BASIC_HERMES_DISCOVERY_MAX_RESULTS).toBe(50);
    expect(BASIC_LLAMA_DRAFT_TIMEOUT_MS).toBe(120_000);
    expect(BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES).toBe(1_048_576);
    expect(BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES).toBe(262_144);
    expect(BASIC_LLAMA_DRAFT_PROTOCOL_VERSION).toBe("basic-country-draft/v1");
    expect(BASIC_LLAMA_DRAFT_OPERATION).toBe("return-exact-draft");
    for (const constant of [
      BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
      BASIC_HERMES_DISCOVERY_TIMEOUT_MS,
      BASIC_HERMES_DISCOVERY_MAX_QUERIES,
      BASIC_HERMES_DISCOVERY_MAX_RESULTS,
      BASIC_LLAMA_DRAFT_TIMEOUT_MS,
      BASIC_LLAMA_DRAFT_MAX_REQUEST_BYTES,
      BASIC_LLAMA_DRAFT_MAX_RESPONSE_BYTES,
      BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
      BASIC_LLAMA_DRAFT_OPERATION,
    ]) {
      expect(Object.isFrozen(constant)).toBe(true);
    }
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
