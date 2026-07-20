import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { writeBasicCandidateArtifactsV3 } from "./cli/basic-candidate-artifact-writer.js";
import { closeBasicCandidateWorkspace, openBasicCandidateWorkspace } from "./cli/basic-candidate-workspace.js";
import {
  assembleProductionBasicProfile,
  captureWorldBankProfileSourceForBatch,
  createFilesystemBasicBatchCache,
  parseProductionCountryInput,
  prepareBasicBatch,
} from "./cli/prepare-basic-batch.js";
import { publishBasicCountry } from "./cli/publish-basic-country.js";
import { writeBasicReviewPack } from "./cli/write-basic-review-pack.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "./collection/adapters/basic-global-source-pack.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { validateApprovedBasicCountryPublicationV3 } from "./collection/basic-publication-validator-v3.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";
import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import {
  artifactBytes, assertCapturedProvenance, assertTamperRejected, CANONICAL_FILES, CANDIDATE_FILES,
  candidateFromArtifacts, canonicalFromFiles, createSyntheticCandidate, isGlobalSourceId,
  loadStrictFixture, reviewedGlobalProfile, snapshot,
} from "./basic-v2-automation-fixture-support.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("strict synthetic BASIC v2 automation fixture flow", () => {
  test("wires production input, global/manual binders, World Bank adapters, and exact-24 assembly", async () => {
    const fixture = loadStrictFixture();
    const countryCode = "ID";
    const captures = new Map(BASIC_GLOBAL_SOURCE_IDS.map((sourceId) => [
      sourceId,
      new TextEncoder().encode(fixture.globalSnapshots[sourceId]),
    ]));
    const manualBytes = manualCapture(countryCode);
    const globalProfile = reviewedGlobalProfile(fixture, countryCode, captures);
    const input = productionCountryInput(countryCode, captures, globalProfile, manualBytes);
    const parsed = parseProductionCountryInput(
      countryCode,
      input,
      captures,
      new Map([["iea-policies", manualBytes]]),
    );

    expect(parsed.reviewedProfile.fields.map(({ category, field }) => `${category}.${field.key}`))
      .toEqual(expect.arrayContaining([
        "policyOverview.summary", "windResource.resourceSummary", "marketSummary.opportunitySummary",
      ]));
    expect(() => parseProductionCountryInput(countryCode, input, captures, new Map()))
      .toThrow("basic batch country input is invalid");
    const tamperedInput = structuredClone(input);
    tamperedInput.globalSourceSha256["global-solar-atlas"] = "0".repeat(64);
    expect(() => parseProductionCountryInput(
      countryCode, tamperedInput, captures, new Map([["iea-policies", manualBytes]]),
    )).toThrow("basic batch country input is invalid");

    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url), "utf8",
    )) as unknown);
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode,
      sourceIds: ["world-bank-electricity-access", "world-bank-gdp-per-capita"],
    });
    const additiveWorldBank = await Promise.all(plan.sources.map((entry) =>
      captureWorldBankProfileSourceForBatch(entry, countryCode, {
        async execute(request) {
          const isPerCapita = request.url.includes("NY.GDP.PCAP.CD");
          const body = new TextEncoder().encode(JSON.stringify([
            { page: 1, pages: 1, per_page: 1, total: 1, sourceid: "2" },
            [{
              indicator: { id: isPerCapita ? "NY.GDP.PCAP.CD" : "EG.ELC.ACCS.ZS" },
              country: { id: countryCode },
              date: "2024",
              value: isPerCapita ? 4_932.1 : 99.4,
            }],
          ]));
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "application/json",
            retrievedAt: "2026-07-20T00:00:00Z",
            redirectChain: [],
            body: (async function* () { yield body; })(),
          };
        },
      }, () => new Date("2026-07-20T00:01:00Z"))
    ));
    expect(additiveWorldBank.map(({ field }) => field.field.key).sort())
      .toEqual(["electricityAccess", "gdpPerCapita"]);

    const profile = assembleProductionBasicProfile({
      baseBundle: v2BaseFixture(),
      additiveWorldBank,
      reviewedProfile: parsed.reviewedProfile,
    });
    const fields = Object.values(profile.categories).flatMap(({ fields: categoryFields }) => categoryFields);
    expect(fields).toHaveLength(24);
    expect(new Set(fields.map(({ key }) => key)).size).toBe(24);
    expect(new Set(fields.flatMap(({ sourceIds }) => sourceIds))).toEqual(new Set([
      "source-1",
      "world-bank-electricity-access",
      "world-bank-gdp-per-capita",
      ...BASIC_GLOBAL_SOURCE_IDS,
      "iea-policies",
    ]));
  });

  test("keeps a three-country v3 batch isolated through human-approved publication", async () => {
    const fixture = loadStrictFixture();
    const root = createRepo();
    const cache = createFilesystemBasicBatchCache(root, fixture.batchId);
    const captured: string[] = [];
    const preparationErrors: string[] = [];
    const batch = await prepareBasicBatch({
      config: { batchId: fixture.batchId, countries: fixture.countries.map(({ countryCode }) => countryCode) },
      globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
      async captureGlobalSource(sourceId) {
        if (!isGlobalSourceId(sourceId)) throw new Error("unexpected global source");
        captured.push(sourceId);
        return new TextEncoder().encode(fixture.globalSnapshots[sourceId]);
      },
      cache,
      async prepareCountry(countryCode, captures) {
        const country = fixture.countries.find((entry) => entry.countryCode === countryCode);
        if (country === undefined) throw new Error("missing strict fixture country");
        assertTamperRejected(fixture, countryCode, captures);
        try {
          const workspace = await openBasicCandidateWorkspace(root);
          try {
            await writeBasicCandidateArtifactsV3({ workspace, candidate: createSyntheticCandidate(
              fixture, country.countryCode, country.countryDirectory, country.runId, captures,
            ) });
          } finally {
            await closeBasicCandidateWorkspace(workspace);
          }
        } catch (error) {
          preparationErrors.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
        return { countryCode, status: "ready" as const };
      },
    });

    expect(captured.sort()).toEqual([...BASIC_GLOBAL_SOURCE_IDS].sort());
    expect(preparationErrors).toEqual([]);
    expect(batch.results).toEqual(fixture.countries.map(({ countryCode }) => ({ countryCode, status: "ready" })));
    await expect(cache.getOrCapture("global-solar-atlas", async () => {
      throw new Error("warm cache must not capture");
    })).resolves.toEqual(new TextEncoder().encode(fixture.globalSnapshots["global-solar-atlas"]));

    for (const country of fixture.countries) {
      const candidateDirectory = join(root, "data", "staging", country.countryDirectory, country.runId);
      expect(readdirSync(candidateDirectory).sort()).toEqual([...CANDIDATE_FILES].sort());
      const candidateBytes = artifactBytes(candidateDirectory, CANDIDATE_FILES);
      const candidateBeforeReview = snapshot(candidateBytes);
      assertCapturedProvenance(fixture, candidateBytes);
      await expect(writeBasicReviewPack({ repoRoot: root, countryCode: country.countryCode, runId: country.runId }))
        .resolves.toEqual({ status: "written", relativeDirectory: `.cache/basic-country/${country.countryCode}/${country.runId}/review` });
      expect(snapshot(artifactBytes(candidateDirectory, CANDIDATE_FILES))).toEqual(candidateBeforeReview);

      const candidate = candidateFromArtifacts(candidateBytes, country.countryDirectory);
      const receipt = suppliedApprovalReceipt(fixture.approval, country, candidateBytes);
      const receiptBytes = encode(receipt);
      const receiptBeforePublication = snapshot({ receipt: receiptBytes });
      const approvalDirectory = join(root, "data", "approvals", country.countryDirectory);
      mkdirSync(approvalDirectory, { recursive: true, mode: 0o700 });
      writeFileSync(join(approvalDirectory, `${country.runId}.json`), receiptBytes, { mode: 0o600 });
      await expect(publishBasicCountry({ repoRoot: root, countryCode: country.countryCode, countryDirectory: country.countryDirectory, runId: country.runId, approvalFile: `data/approvals/${country.countryDirectory}/${country.runId}.json` }))
        .resolves.toMatchObject({ status: "published", postCommitVerified: true });

      expect(snapshot(artifactBytes(candidateDirectory, CANDIDATE_FILES))).toEqual(candidateBeforeReview);
      expect(snapshot({ receipt: new Uint8Array(readFileSync(join(approvalDirectory, `${country.runId}.json`))) })).toEqual(receiptBeforePublication);
      const canonicalDirectory = join(root, "data", country.countryDirectory);
      expect(readdirSync(canonicalDirectory).sort()).toEqual([...CANONICAL_FILES].sort());
      const canonical = canonicalFromFiles(canonicalDirectory);
      expect(validateApprovedBasicCountryPublicationV3({ countryDirectory: country.countryDirectory, manifest: canonical.collectionManifest, approvalReceipt: receipt, approvalReceiptBytes: receiptBytes, candidate, candidateArtifactBytes: candidateBytes, canonical: canonical.data, canonicalArtifactNames: CANONICAL_FILES }))
        .toMatchObject({ valid: true, blockerCode: null });
      expect(canonical.data.country.coverageLevel).toBe("BASIC");
      expect(canonical.data.marketOverview.aiUsable).toBe(false);
      expect(canonical.data.knowledge).toEqual([]);
      expect(canonical.data.country.moduleCoverage.filter((coverage: { moduleKey: string }) => coverage.moduleKey !== "market-overview"))
        .toEqual(Array.from({ length: 9 }, () => expect.objectContaining({ status: "BUILDING", dataCount: 0 })));
    }
    expect(readdirSync(join(root, "data")).sort()).toEqual(["approvals", "staging", ...fixture.countries.map(({ countryDirectory }) => countryDirectory)].sort());
    expect(existsSync(join(root, "data", "knowledge-chunks.json"))).toBe(false);
  });
});

function suppliedApprovalReceipt(
  approval: ReturnType<typeof loadStrictFixture>["approval"],
  country: ReturnType<typeof loadStrictFixture>["countries"][number],
  candidateArtifactBytes: Record<(typeof CANDIDATE_FILES)[number], Uint8Array>,
) {
  return {
    schemaVersion: "basic-country-publication-approval/v1" as const,
    countryDirectory: country.countryDirectory, countryCode: country.countryCode, runId: country.runId,
    submission: { fromReviewStatus: "draft" as const, toReviewStatus: "pending" as const, submittedAt: approval.submittedAt },
    decision: "approved" as const, reviewerId: approval.reviewerId, decidedAt: approval.decidedAt,
    authorizedPublication: { coverageLevel: "BASIC" as const, fromReviewStatus: "pending" as const, toReviewStatus: "published" as const, aiUsable: false },
    artifactSha256: Object.fromEntries(CANDIDATE_FILES.map((name) => [name, sha256Hex(candidateArtifactBytes[name])])),
  };
}

function encode(value: unknown): Uint8Array { return new TextEncoder().encode(`${JSON.stringify(value)}\n`); }

function manualCapture(countryCode: string): Uint8Array {
  return encode({
    schemaVersion: "basic-manual-source-capture/v1",
    countryCode,
    sourceId: "iea-policies",
    retrievedAt: "2026-07-20T00:00:00Z",
    evidence: [{
      locator: "policy:renewable-target",
      excerpt: { zh: "合成政策证据", en: "Synthetic policy evidence" },
    }],
  });
}

function productionCountryInput(
  countryCode: string,
  captures: ReadonlyMap<string, Uint8Array>,
  globalProfile: ReturnType<typeof reviewedGlobalProfile>,
  manualBytes: Uint8Array,
) {
  const checkedAt = "2026-07-20";
  const manualSource = {
    id: "iea-policies",
    publisher: "International Energy Agency",
    title: { zh: "IEA 政策", en: "IEA policies" },
    url: `https://www.iea.org/policies/synthetic-${countryCode}`,
    publishedAt: null,
    retrievedAt: "2026-07-20T00:00:00Z",
    credibility: "OFFICIAL" as const,
  };
  const manualProfile = {
    updatedAt: globalProfile.updatedAt,
    sources: [manualSource],
    auditSources: [{
      sourceId: manualSource.id,
      sourceName: manualSource.publisher,
      sourceUrl: manualSource.url,
      retrievedAt: manualSource.retrievedAt,
      publishedAt: null,
      contentSha256: sha256Hex(manualBytes),
      evidenceLocators: ["policy:renewable-target"],
      sourceFamily: "international-organization" as const,
      accessStatus: "open" as const,
      accessNotes: null,
      credibility: "OFFICIAL" as const,
      discoveryOnly: false,
      promptInjectionRisk: "none" as const,
    }],
    fields: [
      summaryField("policyOverview", "summary", ["iea-policies"], checkedAt),
      summaryField("windResource", "resourceSummary", ["global-wind-atlas"], checkedAt),
      summaryField("marketSummary", "opportunitySummary", ["iea-policies"], checkedAt),
    ],
  };
  return {
    candidateConfigPath: `.cache/basic-country/${countryCode}/candidate-config.json`,
    globalSourceSha256: Object.fromEntries([...captures].map(([sourceId, bytes]) => [sourceId, sha256Hex(bytes)])) as Record<string, string>,
    reviewedGlobalProfile: globalProfile,
    manualProfile,
  };
}

function summaryField(
  category: "policyOverview" | "windResource" | "marketSummary",
  key: "summary" | "resourceSummary" | "opportunitySummary",
  sourceIds: readonly string[],
  checkedAt: string,
) {
  return {
    category,
    field: {
      key,
      label: { zh: `${key} 中文`, en: `${key} English` },
      status: "AVAILABLE" as const,
      value: { zh: `${key} 中文摘要`, en: `${key} English summary` },
      unit: null,
      year: null,
      sourceIds,
      checkedAt,
      reason: null,
      note: null,
    },
  };
}

function v2BaseFixture() {
  const v3 = createBasicCollectionAuditV3Fixture();
  return {
    ...structuredClone(v3),
    sourceRegister: { ...v3.sourceRegister, schemaVersion: "basic-country-audit/v2" },
    extractedFacts: {
      ...v3.extractedFacts,
      schemaVersion: "basic-country-audit/v2",
      facts: v3.extractedFacts.facts.filter(({ fieldPath }) => !fieldPath.startsWith("marketOverview.basicProfile.")),
    },
    marketOverviewDraft: Object.fromEntries(Object.entries(v3.marketOverviewDraft).filter(([key]) => key !== "basicProfile")),
    reviewReport: { ...v3.reviewReport, schemaVersion: "basic-country-audit/v2" },
  } as never;
}

function createRepo(): string {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "basic-v2-automation-"));
  roots.add(root);
  mkdirSync(join(root, "packages", "db"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  writeFileSync(join(root, "packages", "db", "package.json"), JSON.stringify({ name: "@navigator/db" }));
  return root;
}
