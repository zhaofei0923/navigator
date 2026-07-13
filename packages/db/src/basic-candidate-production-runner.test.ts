import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import { createBasicDeterministicSuccessResult } from "./collection/basic-deterministic-candidate-result.js";
import {
  isBasicCandidateProductionResult,
} from "./cli/basic-candidate-production-runner.js";
import * as productionRunnerModule from "./cli/basic-candidate-production-runner.js";

describe("Basic candidate production runner provenance", () => {
  test("does not expose a generic production wrapper that can brand arbitrary input", async () => {
    const direct = await runBasicDeterministicCandidate(createReadyCandidateInput());
    const directFactory = createBasicDeterministicSuccessResult(
      direct.validation!,
      direct.artifacts!,
    );

    expect(direct.failedStage).toBeNull();
    expect(isBasicCandidateProductionResult(direct)).toBe(false);
    expect(isBasicCandidateProductionResult(directFactory)).toBe(false);
    expect(isBasicCandidateProductionResult(structuredClone(direct))).toBe(false);
    expect(productionRunnerModule).not.toHaveProperty("runBasicCandidateProduction");
  });

  test("exposes only the writer predicate package-privately", () => {
    expect(Object.keys(productionRunnerModule).sort()).toEqual([
      "isBasicCandidateProductionResult",
    ]);
  });
});

function createReadyCandidateInput() {
  const bundle = structuredClone(createBasicCollectionAuditV2Fixture());
  const { sourceRegister, extractedFacts } = bundle;
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
    sourceChecks: [...bundle.reviewReport.sourceChecks].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId)),
    injectionRisks: [],
  };
}
