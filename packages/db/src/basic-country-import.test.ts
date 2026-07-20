import { createHash } from "node:crypto";
import { rmSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  bridgeBasicMarketOverviewDraft,
  promoteBasicHermesJsonEvidence,
  runBasicHermesDiscovery,
} from "./index.js";

import { buildBasicCountryImportPlan } from "./seed/basic-country-import.js";
import { loadBasicCountryBundle } from "./seed/basic-country-loader.js";
import type { JsonRecord } from "./seed/basic-country-types.js";
import { isPlainRecord } from "./seed/basic-country-validation-utils.js";
import { validateBasicCountryBundle } from "./seed/basic-country-validator.js";
import {
  createValidBundle,
  createValidBasicProfile,
  getRecord,
  getRecordArray,
  getRequiredArrayItem,
  writeBasicCountryFiles,
} from "./basic-country-test-fixture.js";
import {
  createBasicCollectionAuditFixture,
  readBasicCollectionAuditFixture,
  type BasicCollectionFixtureScenario,
} from "./basic-collection-test-fixture.js";
import { loadBasicCollectionAuditBundle } from "./collection/basic-collection-loader.js";
import { captureBasicRawSource } from "./collection/basic-raw-capture.js";
import type { BasicSourceTransport } from "./collection/basic-source-adapter-contracts.js";

const RAW_CAPTURE_SENTINEL = "RAW_CAPTURE_SENTINEL_P1_6B";
const HERMES_TITLE_SENTINEL = "SEARXNG_TITLE_SENTINEL";
const HERMES_SNIPPET_SENTINEL = "SEARXNG_SNIPPET_SENTINEL";
const RUNTIME_PATH_SENTINEL = "/repo/.cache/basic-country/data/staging/P1-6C-SENTINEL";
const rawCacheIsolationRoots = new Set<string>();

afterEach(() => {
  for (const root of rawCacheIsolationRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  rawCacheIsolationRoots.clear();
  vi.unstubAllGlobals();
});

describe("Basic country import plan", () => {
  test("builds an isolated Basic Prisma import plan", () => {
    const plan = buildBasicCountryImportPlan(createValidBundle());
    expect(plan.operations).toHaveLength(12);
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country", ...Array.from({ length: 10 }, () => "moduleCoverage"), "marketOverview",
    ]);
    expect(plan.aiEligibleKnowledgeIds).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
    expect(plan.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "knowledgeChunk" }),
    ]));
    expect(JSON.stringify(plan)).not.toMatch(/"id"\s*:/);

    const countryCreate = getRecord(getRecord(plan.operations[0]?.args, "country operation").create, "country create");
    expect(countryCreate.region).toBe("SOUTHEAST_ASIA");
    expect(countryCreate.coverageLevel).toBe("BASIC");
    for (const operation of plan.operations.slice(1, 11)) {
      const args = getRecord(operation.args, "module coverage operation");
      const composite = getRecord(getRecord(args.where, "where").countryCode_moduleKey, "composite key");
      const create = getRecord(args.create, "module coverage create");
      expect(composite.countryCode).toBe("VN");
      expect(composite.moduleKey).toBe(create.moduleKey);
      expect(create.countryCode).toBe("VN");
      expect(create.moduleKey).toMatch(/^[A-Z_]+$/);
      expect(create).not.toHaveProperty("id");
    }
    const marketCreate = getRecord(getRecord(plan.operations[11]?.args, "market operation").create, "market create");
    expect(marketCreate.industryTags).toEqual(["SOLAR"]);
    expect(marketCreate.techTags).toEqual(["PV_MODULE"]);
    expect(marketCreate.basicProfile).toBeNull();
    expect(marketCreate).not.toHaveProperty("id");
  });

  test("preserves a validated BASIC v2 profile in the Prisma import plan", () => {
    const bundle = createValidBundle();
    const profile = createValidBasicProfile();
    getRecord(bundle.canonical.marketOverview, "market overview").basicProfile = profile;

    const plan = buildBasicCountryImportPlan(bundle);
    const marketCreate = getRecord(
      getRecord(plan.operations.at(-1)?.args, "market operation").create,
      "market create",
    );

    expect(marketCreate.basicProfile).toEqual(profile);
    expect(marketCreate.basicProfile).not.toBe(profile);
  });

  test("throws joined validation errors before transforming invalid data", () => {
    const bundle = createValidBundle();
    bundle.canonical.country.coverageLevel = "STANDARD";
    bundle.canonical.marketOverview.aiUsable = true;
    expect(() => buildBasicCountryImportPlan(bundle)).toThrow(
      "country.coverageLevel must be BASIC\nmarket-overview.aiUsable must be false",
    );

    const cyclicBundle = createValidBundle();
    const localized = { zh: "市场概览", en: "Market overview" } as Record<string, unknown>;
    localized.evidence = localized;
    cyclicBundle.canonical.marketOverview.overview = localized;
    const bigintBundle = createValidBundle();
    bigintBundle.canonical.marketOverview.renewableTarget = {
      zh: "可再生能源目标",
      en: "Renewable target",
      evidence: BigInt(1),
    };
    for (const invalidBundle of [cyclicBundle, bigintBundle]) {
      expect(validateBasicCountryBundle(invalidBundle).valid).toBe(false);
      expect(() => buildBasicCountryImportPlan(invalidBundle)).toThrow(
        "must have exactly zh and en own keys",
      );
    }
  });

  test("reconstructs exact canonical localized and indicator objects", () => {
    const plan = buildBasicCountryImportPlan(createValidBundle());
    const countryCreate = getRecord(getRecord(plan.operations[0]?.args, "country operation").create, "country create");
    const marketCreate = getRecord(getRecord(plan.operations[11]?.args, "market operation").create, "market create");
    const indicator = getRequiredArrayItem(
      getRecordArray(marketCreate.keyIndicators, "keyIndicators"), 0, "keyIndicators",
    );
    for (const localized of [
      countryCreate.name, countryCreate.summary, marketCreate.overview,
      marketCreate.energyDemand, marketCreate.renewableTarget, indicator.label,
    ]) {
      expect(Object.keys(getRecord(localized, "localized value")).sort()).toEqual(["en", "zh"]);
    }
    expect(Object.keys(indicator).sort()).toEqual(["label", "unit", "value", "year"]);
    expect(JSON.stringify(plan)).not.toContain("AUDIT_SENTINEL");
  });

  test("does not include committed audit artifacts in the Basic import plan", () => {
    const bundle = createValidBundle();
    const auditFixture = readBasicCollectionAuditFixture("normal");
    bundle.audit.run = {
      runId: auditFixture.runId,
      sourceRegister: asJsonRecord(auditFixture.sourceRegister),
      extractedFacts: asJsonRecord(auditFixture.extractedFacts),
      marketOverviewDraft: asJsonRecord(auditFixture.marketOverviewDraft),
      reviewReport: asJsonRecord(auditFixture.reviewReport),
    };
    bundle.audit.manifest = {
      activeRunId: auditFixture.runId,
      mappingVersion: "basic-v1",
      auditBundlePath: `data/staging/${bundle.countryDirectory}/${auditFixture.runId}`,
    };

    const plan = buildBasicCountryImportPlan(bundle);
    const serializedPlan = JSON.stringify(plan);

    expect(plan.operations).toHaveLength(12);
    expect(plan.operations.map(({ model }) => model)).toEqual([
      "country", ...Array.from({ length: 10 }, () => "moduleCoverage"), "marketOverview",
    ]);
    for (const forbiddenValue of [
      "AUDIT_SENTINEL",
      "sourceRegister",
      "extractedFacts",
      "reviewReport",
      "collection-manifest",
      "data/staging",
      ".cache/basic-country",
    ]) {
      expect(serializedPlan).not.toContain(forbiddenValue);
    }
  });

  test("does not consume real P1-6C runtime results while building the canonical import plan", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const baselineBundle = createValidBundle();
    const artifactBundle = createValidBundle();
    const bridgeFixture = createBasicCollectionAuditFixture();
    const providerDiscovery = {
      schemaVersion: BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
      runId: bridgeFixture.runId,
      countryCode: bridgeFixture.sourceRegister.countryCode,
      candidates: [{
        discoveryId: "candidate-1",
        provider: "searxng",
        query: "Example market policy",
        title: HERMES_TITLE_SENTINEL,
        snippet: `${HERMES_SNIPPET_SENTINEL} ${RUNTIME_PATH_SENTINEL}`,
        url: "https://example.com/runtime-result",
        discoveredAt: "2026-07-10T09:40:00.000Z",
        discoveryOnly: true,
      }],
    };
    const discoveryResult = await runBasicHermesDiscovery({
      countryCode: bridgeFixture.sourceRegister.countryCode,
      runId: bridgeFixture.runId,
      queries: ["Example market policy"],
      maxResults: 1,
    }, {
      async discover() {
        return providerDiscovery;
      },
    });
    expect(discoveryResult.ok).toBe(true);
    if (!discoveryResult.ok) throw new Error("runtime discovery fixture must succeed");

    const promotionFacts = structuredClone(bridgeFixture.extractedFacts);
    for (const fact of promotionFacts.facts) {
      fact.factId = `fact-${createHash("sha256").update(fact.fieldPath, "utf8").digest("hex").slice(0, 16)}`;
    }
    const promotionResult = promoteBasicHermesJsonEvidence({
      base: {
        sourceRegister: structuredClone(bridgeFixture.sourceRegister),
        extractedFacts: promotionFacts,
        receipts: bridgeFixture.sourceRegister.sources.map((source) => ({
          sourceId: source.sourceId,
          contentSha256: source.contentSha256,
          byteLength: 0,
          reused: false,
        })),
      },
      discovery: discoveryResult.data,
      openedSources: [],
    });
    expect(promotionResult.ok).toBe(true);
    if (!promotionResult.ok) throw new Error("runtime promotion fixture must succeed");

    const bridgeResult = await bridgeBasicMarketOverviewDraft({
      sourceRegister: structuredClone(bridgeFixture.sourceRegister),
      extractedFacts: structuredClone(bridgeFixture.extractedFacts),
      model: {
        async complete() {
          return {
            providerExtra: "PROVIDER_RESULT_SENTINEL",
            choices: [{
              finish_reason: "stop",
              message: { content: JSON.stringify(bridgeFixture.marketOverviewDraft) },
            }],
          };
        },
      },
    });
    expect(bridgeResult.ok).toBe(true);
    if (!bridgeResult.ok) throw new Error("runtime draft bridge fixture must succeed");

    const artifacts = asJsonRecord(artifactBundle.audit.run.sourceRegister);
    artifacts.runtimeBridgeResults = {
      hermesDiscoveryResult: discoveryResult,
      hermesEvidencePromotionResult: promotionResult,
      llamaDraftBridgeResult: bridgeResult,
    };
    expect(JSON.stringify(artifacts.runtimeBridgeResults)).toContain(
      HERMES_TITLE_SENTINEL,
    );

    const baselinePlan = buildBasicCountryImportPlan(baselineBundle);
    const artifactPlan = buildBasicCountryImportPlan(artifactBundle);
    const baselineBytes = JSON.stringify(baselinePlan);
    const artifactBytes = JSON.stringify(artifactPlan);

    expect(artifactPlan).toEqual(baselinePlan);
    expect(artifactBytes).toBe(baselineBytes);
    for (const forbidden of [
      "runtimeBridgeResults",
      "hermesDiscoveryResult",
      "hermesEvidencePromotionResult",
      "llamaDraftBridgeResult",
      HERMES_TITLE_SENTINEL,
      HERMES_SNIPPET_SENTINEL,
      RUNTIME_PATH_SENTINEL,
    ]) {
      expect(artifactBytes).not.toContain(forbidden);
    }
    expect(globalFetch).not.toHaveBeenCalled();
  });

  test("keeps generated raw captures outside canonical import and audit loading", async () => {
    const fixture = writeRawCacheIsolationFixture("normal");
    const rawCaptureResult = await captureBasicRawSource(
      rawCacheIsolationInput(fixture.repoRoot),
      rawCacheTransport(),
    );

    const auditBundle = loadBasicCollectionAuditBundle(
      fixture.repoRoot,
      fixture.countryDirectory,
      fixture.runId,
    );
    const importPlan = buildBasicCountryImportPlan(
      loadBasicCountryBundle(fixture.repoRoot, fixture.countryDirectory),
    );
    const serializedAuditBundle = JSON.stringify(auditBundle);
    const serializedImportPlan = JSON.stringify(importPlan);
    const serializedRawCaptureResult = JSON.stringify(rawCaptureResult);

    expect(Object.keys(rawCaptureResult).sort()).toEqual([
      "body",
      "byteLength",
      "contentSha256",
      "contentType",
      "finalUrl",
      "redirectChain",
      "retrievedAt",
      "reused",
      "sourceId",
    ]);
    expect(Object.hasOwn(rawCaptureResult, "cachePath")).toBe(false);
    for (const forbiddenValue of [
      fixture.repoRoot,
      ".cache/basic-country",
      "cachePath",
      "capture.json",
    ]) {
      expect(serializedRawCaptureResult).not.toContain(forbiddenValue);
    }

    for (const serializedValue of [serializedAuditBundle, serializedImportPlan]) {
      expect(serializedValue).not.toContain(RAW_CAPTURE_SENTINEL);
      expect(serializedValue).not.toContain("basic-country-raw-capture/v1");
      expect(serializedValue).not.toContain(
        ".cache/basic-country/XZ/run-001/raw/source/capture.json",
      );
      expect(serializedValue).not.toContain("capture.json");
    }
    expect(importPlan.aiEligibleKnowledgeIds).toEqual([]);
    expect(JSON.stringify(importPlan.aiEligibleKnowledgeIds)).not.toContain(
      RAW_CAPTURE_SENTINEL,
    );
  });
});

function asJsonRecord(value: unknown): JsonRecord {
  if (!isPlainRecord(value)) {
    throw new Error("audit artifact must be a plain record");
  }
  return value;
}

function writeRawCacheIsolationFixture(
  scenario: BasicCollectionFixtureScenario,
): {
  repoRoot: string;
  countryDirectory: string;
  runId: string;
} {
  const bundle = createValidBundle();
  const auditBundle = readBasicCollectionAuditFixture(scenario);
  bundle.audit.manifest = {
    activeRunId: auditBundle.runId,
    mappingVersion: "basic-v1",
    auditBundlePath: `data/staging/${bundle.countryDirectory}/${auditBundle.runId}`,
  };
  bundle.audit.run = {
    runId: auditBundle.runId,
    sourceRegister: asJsonRecord(auditBundle.sourceRegister),
    extractedFacts: asJsonRecord(auditBundle.extractedFacts),
    marketOverviewDraft: asJsonRecord(auditBundle.marketOverviewDraft),
    reviewReport: asJsonRecord(auditBundle.reviewReport),
  };
  const files = writeBasicCountryFiles(bundle);
  rawCacheIsolationRoots.add(files.repoRoot);

  return {
    repoRoot: files.repoRoot,
    countryDirectory: bundle.countryDirectory,
    runId: auditBundle.runId,
  };
}

function rawCacheIsolationInput(repoRoot: string) {
  return {
    repoRoot,
    countryCode: "XZ",
    runId: "run-001",
    adapterId: "raw-isolation",
    adapterVersion: "1.0.0",
    sourceId: "source",
    request: {
      method: "GET" as const,
      url: "https://raw.example/capture?format=json",
      accept: "application/json",
      allowedOrigins: ["https://raw.example"],
      allowedQueryParameters: ["format"],
    },
  };
}

function rawCacheTransport(): BasicSourceTransport {
  const body = new TextEncoder().encode(
    `{"marker":"${RAW_CAPTURE_SENTINEL}"}`,
  );
  return {
    async execute() {
      return {
        status: 200,
        finalUrl: "https://raw.example/capture?format=json",
        contentType: "application/json",
        retrievedAt: "2026-07-10T09:40:00.000Z",
        redirectChain: [],
        body: chunks(body),
      };
    },
  };
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield body;
}
