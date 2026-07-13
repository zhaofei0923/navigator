import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import type {
  BasicCollectionJsonValue,
  BasicInjectionRisk,
  BasicSourceCheck,
} from "./collection/basic-collection-contracts.js";
import type {
  BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { serializeBasicCollectionAuditArtifactsV2 } from "./collection/basic-audit-v2-artifacts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";

const FIXTURE_KEYS = [
  "countryDirectory",
  "countryCode",
  "runId",
  "catalogVersion",
  "catalogSha256",
  "materialization",
  "sourceChecks",
  "injectionRisks",
] as const;

interface CandidateFixture {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly runId: string;
  readonly catalogVersion: string;
  readonly catalogSha256: string;
  readonly materialization: BasicDeterministicMaterializationResultV2;
  readonly sourceChecks: readonly BasicSourceCheck[];
  readonly injectionRisks: readonly BasicInjectionRisk[];
}

describe("synthetic ID-shaped deterministic candidate integration", () => {
  test("builds byte-stable ready v2 artifacts without runtime capabilities", async () => {
    const fixture = loadFixture();
    expect(Object.keys(fixture)).toEqual(FIXTURE_KEYS);
    expect(fixture.countryCode).toBe("ID");
    expect(fixture.injectionRisks).toEqual([]);
    expect(fixture.materialization.sourceRegister.sources.map(({ sourceId }) => sourceId))
      .toEqual(["fixture-deterministic", "fixture-manual"]);
    expect(fixture.materialization.receipts.map(({ sourceId }) => sourceId))
      .toEqual(["fixture-deterministic", "fixture-manual"]);
    expect(fixture.sourceChecks).toEqual([
      expect.objectContaining({ sourceId: "fixture-deterministic", status: "passed" }),
      expect.objectContaining({ sourceId: "fixture-manual", status: "passed" }),
    ]);
    expect(new Set(fixture.materialization.extractedFacts.facts.map(
      ({ extractionMethod }) => extractionMethod,
    ))).toEqual(new Set(["deterministic", "manual"]));

    const forbidden = vi.fn(() => {
      throw new Error("forbidden runtime capability");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = forbidden as typeof fetch;
    try {
      const first = await run(fixture);
      const second = await run(permuteFixture(fixture));

      expect(first.failedStage).toBeNull();
      expect(first.validation).toMatchObject({
        valid: true,
        readyForHumanReview: true,
        blockers: [],
      });
      expect(first.artifacts).not.toBeNull();
      expect(second.artifacts).not.toBeNull();
      expect(serialized(first)).toEqual(serialized(second));

      const artifacts = first.artifacts!;
      for (const name of [
        "source-register.json",
        "extracted-facts.json",
        "review-report.json",
      ] as const) {
        expect(artifacts[name].schemaVersion).toBe("basic-country-audit/v2");
      }
      expect(artifacts["market-overview.draft.json"]).not.toHaveProperty("schemaVersion");
      expect(artifacts["market-overview.draft.json"]).not.toHaveProperty("runId");
      expect(artifacts["review-report.json"]).toMatchObject({
        status: "ready-for-human-review",
        humanDecision: null,
      });
      expect(artifacts["extracted-facts.json"].facts).toHaveLength(24);
      expect(artifacts["market-overview.draft.json"].keyIndicators[0]).toEqual({
        label: {
          zh: "\u5408\u6210\u5939\u5177\u6307\u6807",
          en: "Synthetic fixture indicator",
        },
        value: "fixture-333",
        unit: "fixture-unit",
        year: 2099,
      });
      expect(artifacts["market-overview.draft.json"]).toMatchObject({
        source: "Synthetic fixture-only reviewed document",
        sourceUrl: "https://fixture-only.invalid/id-shape/manual-document",
      });
      expect(first.boundaryVerdict).toEqual({
        rawCache: "not-produced",
        stagingWrite: "not-attempted",
        manifest: "not-produced",
        canonicalWrite: "not-attempted",
        prismaWrite: "not-attempted",
        coverageDerivation: "not-attempted",
        publishAction: "not-attempted",
        knowledgeChunkCount: 0,
        aiUsableTrueCount: 0,
        aiEligibleKnowledgeIds: [],
      });
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function loadFixture(): CandidateFixture {
  const pathname = fileURLToPath(new URL(
    "../fixtures/basic-collection-v2/id-ready.json",
    import.meta.url,
  ));
  return JSON.parse(readFileSync(pathname, "utf8")) as CandidateFixture;
}

async function run(fixture: CandidateFixture) {
  return runBasicDeterministicCandidate({
    countryDirectory: fixture.countryDirectory,
    countryCode: fixture.countryCode,
    runId: fixture.runId,
    catalogVersion: fixture.catalogVersion,
    catalogSha256: fixture.catalogSha256,
    runner: Object.freeze({
      run() {
        return Promise.resolve(fixture.materialization);
      },
    }),
    sourceChecks: fixture.sourceChecks,
    injectionRisks: fixture.injectionRisks,
  });
}

function serialized(result: Awaited<ReturnType<typeof run>>) {
  const artifacts = result.artifacts;
  if (artifacts === null) throw new Error("expected ready artifacts");
  return Object.fromEntries(Object.entries(
    serializeBasicCollectionAuditArtifactsV2(artifacts),
  ).map(([name, bytes]) => [name, Buffer.from(bytes).toString("hex")]));
}

function permuteFixture(fixture: CandidateFixture): CandidateFixture {
  return reverseObjectKeys(fixture as unknown as BasicCollectionJsonValue) as unknown as CandidateFixture;
}

function reverseObjectKeys(value: BasicCollectionJsonValue): BasicCollectionJsonValue {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [
    key,
    reverseObjectKeys(value[key]!),
  ]));
}
