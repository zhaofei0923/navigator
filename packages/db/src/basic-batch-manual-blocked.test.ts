import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createFilesystemBasicBatchCache,
  parseProductionCountryInput,
  prepareBasicBatch,
  readReviewedManualProfileCaptures,
} from "./cli/prepare-basic-batch.js";
import {
  BasicBatchExpectedBlockError,
  readBasicBatchCountryInput,
} from "./cli/basic-batch-filesystem-cache.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "./collection/adapters/basic-global-source-pack.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import {
  loadStrictFixture,
  reviewedGlobalProfile,
} from "./basic-v2-automation-fixture-support.js";

const roots = new Set<string>();
const CANDIDATE_FILES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const;

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("production BASIC manual snapshot availability", () => {
  test.each(["iea-policies", "rise-policy-review"] as const)(
    "classifies a missing declared %s capture as an expected block",
    (sourceId) => {
      const fixture = loadStrictFixture();
      const captures = globalCaptures(fixture);
      const manualBytes = manualCapture("ID", sourceId);
      expect(() => parseProductionCountryInput(
        "ID",
        productionCountryInput(
          "ID",
          captures,
          reviewedGlobalProfile(fixture, "ID", captures),
          manualBytes,
          sourceId,
        ),
        captures,
        new Map(),
      )).toThrow(BasicBatchExpectedBlockError);
    },
  );

  test("blocks only a country with a missing required snapshot and keeps malformed input as an error", async () => {
    const fixture = loadStrictFixture();
    const root = createRoot();
    const batchId = "manual-availability-regression";
    const inputs = join(root, ".cache", "basic-country", "batches", batchId, "inputs");
    const readyDirectory = join(root, "data", "staging", "synthetic-country-id", "ready-run");
    mkdirSync(join(inputs, "manual", "ID"), { recursive: true, mode: 0o700 });
    mkdirSync(join(inputs, "manual", "SA"), { recursive: true, mode: 0o700 });

    const expectedManual = new Map<string, Uint8Array>();
    for (const countryCode of ["ID", "VN", "SA"] as const) {
      const bytes = manualCapture(countryCode, "iea-policies");
      expectedManual.set(countryCode, bytes);
      const captures = globalCaptures(fixture);
      writeFileSync(
        join(inputs, `${countryCode}.json`),
        JSON.stringify(productionCountryInput(
          countryCode,
          captures,
          reviewedGlobalProfile(fixture, countryCode, captures),
          bytes,
          "iea-policies",
        )),
        { mode: 0o600 },
      );
    }
    writeFileSync(join(inputs, "manual", "ID", "iea-policies.snapshot"), expectedManual.get("ID")!, {
      mode: 0o600,
    });
    writeFileSync(join(inputs, "manual", "SA", "iea-policies.snapshot"), "malformed manual capture", {
      mode: 0o600,
    });

    const result = await prepareBasicBatch({
      config: { batchId, countries: ["ID", "VN", "SA"] },
      globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
      cache: createFilesystemBasicBatchCache(root, batchId),
      async captureGlobalSource(sourceId) {
        const capture = globalCaptures(fixture).get(sourceId);
        if (capture === undefined) throw new Error("unexpected global source");
        return capture;
      },
      async prepareCountry(countryCode, captures) {
        const countryInput = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
          await readBasicBatchCountryInput(root, join(inputs, `${countryCode}.json`)),
        )) as unknown;
        const manualCaptures = await readReviewedManualProfileCaptures(root, batchId, countryCode);
        parseProductionCountryInput(countryCode, countryInput, captures, manualCaptures);
        mkdirSync(readyDirectory, { recursive: true, mode: 0o700 });
        for (const name of CANDIDATE_FILES) writeFileSync(join(readyDirectory, name), `${name}\n`);
        return { countryCode, status: "ready" as const };
      },
    });

    expect(result.results).toEqual([
      { countryCode: "ID", status: "ready" },
      { countryCode: "VN", status: "blocked" },
      { countryCode: "SA", status: "error" },
    ]);
    expect(readdirSync(readyDirectory).sort()).toEqual([...CANDIDATE_FILES].sort());
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain("malformed manual capture");
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "basic-manual-blocked-"));
  roots.add(root);
  return root;
}

function globalCaptures(fixture: ReturnType<typeof loadStrictFixture>): Map<string, Uint8Array> {
  return new Map(BASIC_GLOBAL_SOURCE_IDS.map((sourceId) => [
    sourceId,
    new TextEncoder().encode(fixture.globalSnapshots[sourceId]),
  ]));
}

function manualCapture(
  countryCode: string,
  sourceId: "iea-policies" | "rise-policy-review",
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: "basic-manual-source-capture/v1",
    countryCode,
    sourceId,
    retrievedAt: "2026-07-20T00:00:00Z",
    evidence: [{
      locator: "policy:renewable-target",
      excerpt: { zh: "合成政策证据", en: "Synthetic policy evidence" },
    }],
  }));
}

function productionCountryInput(
  countryCode: string,
  captures: ReadonlyMap<string, Uint8Array>,
  globalProfile: ReturnType<typeof reviewedGlobalProfile>,
  manualBytes: Uint8Array,
  sourceId: "iea-policies" | "rise-policy-review",
) {
  const policy = sourceId === "iea-policies" ? {
    publisher: "International Energy Agency",
    url: `https://www.iea.org/policies/synthetic-${countryCode}`,
  } : {
    publisher: "World Bank RISE",
    url: `https://rise.esmap.org/country/synthetic-${countryCode}`,
  };
  const source = {
    id: sourceId,
    publisher: policy.publisher,
    title: { zh: "IEA 政策", en: "IEA policies" },
    url: policy.url,
    publishedAt: null,
    retrievedAt: "2026-07-20T00:00:00Z",
    credibility: "OFFICIAL" as const,
  };
  const summaryField = (
    category: "policyOverview" | "windResource" | "marketSummary",
    key: "summary" | "resourceSummary" | "opportunitySummary",
    sourceIds: readonly string[],
  ) => ({
    category,
    field: {
      key,
      label: { zh: `${key} 中文`, en: `${key} English` },
      status: "AVAILABLE" as const,
      value: { zh: `${key} 中文摘要`, en: `${key} English summary` },
      unit: null,
      year: null,
      sourceIds,
      checkedAt: "2026-07-20",
      reason: null,
      note: null,
    },
  });
  return {
    candidateConfigPath: `.cache/basic-country/${countryCode}/candidate-config.json`,
    globalSourceSha256: Object.fromEntries([...captures].map(([id, bytes]) => [id, sha256Hex(bytes)])),
    reviewedGlobalProfile: globalProfile,
    manualProfile: {
      updatedAt: globalProfile.updatedAt,
      sources: [source],
      auditSources: [{
        sourceId: source.id,
        sourceName: source.publisher,
        sourceUrl: source.url,
        retrievedAt: source.retrievedAt,
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
        summaryField("policyOverview", "summary", [sourceId]),
        summaryField("windResource", "resourceSummary", ["global-wind-atlas"]),
        summaryField("marketSummary", "opportunitySummary", [sourceId]),
      ],
    },
  };
}
