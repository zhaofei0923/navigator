import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import {
  createBasicV3CandidateComposition,
  isBasicV3CandidateProductionResult,
} from "./cli/basic-v3-candidate-composition.js";
import {
  parseBasicBatchArguments,
} from "./cli/basic-batch-config.js";
import {
  createFilesystemBasicBatchCache,
  captureWorldBankProfileSourceForBatch,
  prepareBasicBatch,
  runPrepareBasicBatchCli,
} from "./cli/prepare-basic-batch.js";
import {
  createBasicCollectionAuditArtifactsV3,
} from "./collection/basic-audit-v3-artifacts.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("BASIC batch config", () => {
  test("parses one to three unique uppercase countries and a safe batch id", () => {
    expect(parseBasicBatchArguments([
      "--countries=ID,VN,SA",
      "--batch-id=basic-v2-202607",
    ])).toEqual({
      countries: ["ID", "VN", "SA"],
      batchId: "basic-v2-202607",
    });
  });

  test.each([
    ["duplicate", ["--countries=ID,ID", "--batch-id=batch-1"]],
    ["lowercase", ["--countries=Id", "--batch-id=batch-1"]],
    ["more than three", ["--countries=ID,VN,SA,AE", "--batch-id=batch-1"]],
    ["unsafe batch", ["--countries=ID", "--batch-id=../batch"]],
    ["unknown option", ["--countries=ID", "--batch-id=batch-1", "--publish"]],
  ])("rejects %s", (_label, args) => {
    expect(() => parseBasicBatchArguments(args)).toThrow("basic batch config is invalid");
  });
});

describe("BASIC content-addressed batch cache and isolation", () => {
  test("deduplicates global captures and makes a warm run perform zero fetches", async () => {
    const root = createRoot();
    const cache = createFilesystemBasicBatchCache(root, "batch-1");
    let fetches = 0;
    const capture = async (sourceId: string) => {
      fetches += 1;
      return new TextEncoder().encode(`capture:${sourceId}`);
    };
    const prepareCountry = async (countryCode: string) => ({
      status: "ready" as const,
      countryCode,
    });

    const first = await prepareBasicBatch({
      config: { countries: ["ID", "VN", "SA"], batchId: "batch-1" },
      globalSourceIds: ["ember-electricity", "irenastat-capacity"],
      cache,
      captureGlobalSource: capture,
      prepareCountry,
    });
    const second = await prepareBasicBatch({
      config: { countries: ["ID", "VN", "SA"], batchId: "batch-1" },
      globalSourceIds: ["ember-electricity", "irenastat-capacity"],
      cache,
      captureGlobalSource: capture,
      prepareCountry,
    });

    expect(first.results).toEqual(second.results);
    expect(fetches).toBe(2);
    expect(readdirSync(join(root, ".cache", "basic-country", "batches", "batch-1", "objects")))
      .toHaveLength(2);
  });

  test("single-flights concurrent reads and fails closed when cached bytes are tampered", async () => {
    const root = createRoot();
    const cache = createFilesystemBasicBatchCache(root, "batch-single-flight");
    let fetches = 0;
    const capture = async () => {
      fetches += 1;
      await Promise.resolve();
      return new TextEncoder().encode("immutable-global-snapshot");
    };
    const [left, right] = await Promise.all([
      cache.getOrCapture("global-solar-atlas", capture),
      cache.getOrCapture("global-solar-atlas", capture),
    ]);
    expect(left).toEqual(right);
    expect(fetches).toBe(1);

    const objectName = readdirSync(join(
      root, ".cache", "basic-country", "batches", "batch-single-flight", "objects",
    ))[0]!;
    writeFileSync(join(
      root, ".cache", "basic-country", "batches", "batch-single-flight", "objects", objectName,
    ), "tampered");
    await expect(cache.getOrCapture("global-solar-atlas", capture))
      .rejects.toThrow("basic batch cache is invalid");
    expect(fetches).toBe(1);
  });

  test.each(["../escape", "source/child", "SOURCE", ""])(
    "rejects unsafe cache source id %j without filesystem work",
    async (sourceId) => {
      const root = createRoot();
      const cache = createFilesystemBasicBatchCache(root, "batch-safe");
      await expect(cache.getOrCapture(sourceId, async () => new Uint8Array([1])))
        .rejects.toThrow("basic batch cache is invalid");
    },
  );

  test("limits concurrency to three and preserves unrelated successes", async () => {
    const root = createRoot();
    let active = 0;
    let maximum = 0;
    const result = await prepareBasicBatch({
      config: { countries: ["ID", "VN", "SA"], batchId: "batch-2" },
      globalSourceIds: [],
      cache: createFilesystemBasicBatchCache(root, "batch-2"),
      captureGlobalSource: async () => new Uint8Array(),
      async prepareCountry(countryCode) {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        if (countryCode === "VN") throw new Error("secret upstream detail");
        return { status: "ready" as const, countryCode };
      },
    });

    expect(maximum).toBeLessThanOrEqual(3);
    expect(result.results).toEqual([
      { countryCode: "ID", status: "ready" },
      { countryCode: "VN", status: "error" },
      { countryCode: "SA", status: "ready" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("BASIC batch CLI", () => {
  test("supports help and wires parsed arguments to the injected runner", async () => {
    const stdout: string[] = [];
    expect(await runPrepareBasicBatchCli(["--help"], {
      run: async () => ({ batchId: "unused", results: [] }),
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined,
    })).toBe(0);
    expect(stdout.join("")).toContain("pnpm basic:prepare-batch");

    let received: unknown = null;
    expect(await runPrepareBasicBatchCli([
      "--countries=ID,VN", "--batch-id=batch-cli",
    ], {
      async run(config) {
        received = config;
        return { batchId: config.batchId, results: config.countries.map((countryCode) => ({
          countryCode,
          status: "ready" as const,
        })) };
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined,
    })).toBe(0);
    expect(received).toEqual({ countries: ["ID", "VN"], batchId: "batch-cli" });
  });

  test("runs the real TypeScript source command for help and configured arguments", () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const help = spawnSync(process.execPath, [
      "--conditions=development", "--import", "../../scripts/node-ts-source-hook.mjs",
      "src/cli/prepare-basic-batch.ts", "--help",
    ], { cwd: packageRoot, encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("pnpm basic:prepare-batch");

    const run = spawnSync(process.execPath, [
      "--conditions=development", "--import", "../../scripts/node-ts-source-hook.mjs",
      "src/cli/prepare-basic-batch.ts", "--countries=ID", "--batch-id=missing-input-fixture",
    ], { cwd: packageRoot, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('"countryCode":"ID","status":"error"');
    expect(run.stderr).not.toContain("inputs are not configured");
  });
});

describe("per-country World Bank profile capture", () => {
  test("uses the injected transport and materializes a bounded audited observation", async () => {
    let requestUrl = "";
    const body = new TextEncoder().encode(JSON.stringify([
      { page: 1, pages: 1, per_page: 1, total: 1, sourceid: "2" },
      [{ indicator: { id: "NY.GDP.PCAP.CD" }, country: { id: "ID" }, date: "2024", value: 4932.1 }],
    ]));
    const result = await captureWorldBankProfileSourceForBatch(
      "world-bank-gdp-per-capita",
      "ID",
      {
        async execute(request) {
          requestUrl = request.url;
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "application/json",
            retrievedAt: "2026-07-20T00:00:00Z",
            redirectChain: [],
            body: (async function* () { yield body; })(),
          };
        },
      },
      () => new Date("2026-07-20T00:01:00Z"),
    );
    expect(requestUrl).toContain("NY.GDP.PCAP.CD");
    expect(result.field.field).toMatchObject({
      key: "gdpPerCapita",
      status: "AVAILABLE",
      value: 4932.1,
      sourceIds: ["world-bank-gdp-per-capita"],
    });
    expect(result.auditSource.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("stops reading above 10 MiB and redacts transport details", async () => {
    let chunksRead = 0;
    const transport = {
      async execute(request: { url: string }) {
        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          retrievedAt: "2026-07-20T00:00:00Z",
          redirectChain: [],
          body: (async function* () {
            chunksRead += 1;
            yield new Uint8Array(10 * 1024 * 1024);
            chunksRead += 1;
            yield new Uint8Array([1]);
            chunksRead += 1;
            throw new Error("SECRET-TRANSPORT-DETAIL");
          })(),
        };
      },
    };
    await expect(captureWorldBankProfileSourceForBatch(
      "world-bank-electricity-access", "ID", transport as never,
      () => new Date("2026-07-20T00:01:00Z"),
    )).rejects.toThrow(/^world bank BASIC profile capture failed$/);
    expect(chunksRead).toBe(2);
  });
});

describe("BASIC v3 candidate composition", () => {
  test("creates a trusted validated four-file draft candidate only", () => {
    const fixture = createBasicCollectionAuditV3Fixture();
    const composition = createBasicV3CandidateComposition({
      baseBundle: {
        ...structuredClone(fixture),
        sourceRegister: { ...fixture.sourceRegister, schemaVersion: "basic-country-audit/v2" },
        extractedFacts: {
          ...fixture.extractedFacts,
          schemaVersion: "basic-country-audit/v2",
          facts: fixture.extractedFacts.facts.filter(({ fieldPath }) =>
            !fieldPath.startsWith("marketOverview.basicProfile.")),
        },
        marketOverviewDraft: Object.fromEntries(
          Object.entries(fixture.marketOverviewDraft).filter(([key]) => key !== "basicProfile"),
        ),
        reviewReport: { ...fixture.reviewReport, schemaVersion: "basic-country-audit/v2" },
      },
      basicProfile: fixture.marketOverviewDraft.basicProfile,
    });

    expect(composition.status).toBe("ready");
    expect(isBasicV3CandidateProductionResult(composition)).toBe(true);
    expect(composition.validation.valid).toBe(true);
    expect(Object.keys(composition.artifacts ?? {})).toEqual([
      "source-register.json",
      "extracted-facts.json",
      "market-overview.draft.json",
      "review-report.json",
    ]);
    expect(createBasicCollectionAuditArtifactsV3(composition.validation.data!))
      .toEqual(composition.artifacts);
    expect(composition.validation.data?.marketOverviewDraft).toMatchObject({
      reviewStatus: "draft",
      aiUsable: false,
    });
    expect(JSON.stringify(composition)).not.toContain("canonical");
    expect(JSON.stringify(composition)).not.toContain("Prisma");
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "navigator-basic-batch-"));
  roots.add(root);
  return root;
}
