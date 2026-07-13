import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import { createBasicDeterministicSuccessResult } from "./collection/basic-deterministic-candidate-result.js";
import {
  isBasicCandidateProductionResult,
  runBasicCandidateProduction,
} from "./cli/basic-candidate-production-runner.js";
import * as productionRunnerModule from "./cli/basic-candidate-production-runner.js";

describe("Basic candidate production runner provenance", () => {
  test("brands only a successful result returned by the real production run", async () => {
    const production = await runBasicCandidateProduction(createReadyCandidateInput());
    const direct = await runBasicDeterministicCandidate(createReadyCandidateInput());
    const directFactory = createBasicDeterministicSuccessResult(
      production.validation!,
      production.artifacts!,
    );

    expect(isBasicCandidateProductionResult(production)).toBe(true);
    expect(isBasicCandidateProductionResult(direct)).toBe(false);
    expect(isBasicCandidateProductionResult(directFactory)).toBe(false);
    expect(isBasicCandidateProductionResult(structuredClone(production))).toBe(false);
  });

  test("exposes only the run function and writer predicate package-privately", () => {
    expect(Object.keys(productionRunnerModule).sort()).toEqual([
      "isBasicCandidateProductionResult",
      "runBasicCandidateProduction",
    ]);
  });

  test("does not brand a blocked result returned by the production run", async () => {
    const blocked = await runBasicCandidateProduction({} as never);

    expect(blocked.failedStage).toBe("input");
    expect(isBasicCandidateProductionResult(blocked)).toBe(false);
  });
});

function createReadyCandidateInput() {
  const bundle = structuredClone(createBasicCollectionAuditFixture());
  const sourceRegister = {
    ...bundle.sourceRegister,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    catalogVersion: "catalog-v1",
    catalogSha256: "a".repeat(64),
  };
  const extractedFacts = {
    ...bundle.extractedFacts,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  };
  for (const fact of extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  extractedFacts.facts.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  const materialization = {
    sourceRegister,
    extractedFacts,
    receipts: [],
  } as unknown as BasicDeterministicMaterializationResultV2;
  return {
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner: { run() { return Promise.resolve(materialization); } },
    sourceChecks: bundle.reviewReport.sourceChecks.sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId)),
    injectionRisks: [],
  };
}
