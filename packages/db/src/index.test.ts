import { describe, expect, test } from "vitest";

import type {
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
} from "./index.js";
import * as database from "./index.js";
import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_SCHEMA_VERSION,
  BASIC_COLLECTION_BLOCKER_CODES,
  buildBasicCountryImportPlan,
  createBasicCountryBundle,
  loadBasicCollectionAuditBundle,
  loadBasicCountryBundle,
  validateBasicCountryBundle,
  validateBasicCollectionAuditBundle,
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
});
