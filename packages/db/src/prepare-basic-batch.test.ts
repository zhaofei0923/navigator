import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
  bindReviewedGlobalProfileSnapshots,
  bindReviewedManualProfileCaptures,
  createFilesystemBasicBatchCache,
  createEmberNoCredentialTabularSnapshot,
  captureWorldBankProfileSourceForBatch,
  prepareBasicBatch,
  readReviewedManualProfileCaptures,
  readReviewedEmberSnapshotOrUnavailable,
  runPrepareBasicBatchCli,
} from "./cli/prepare-basic-batch.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";
import { parseBasicProfileTabularSnapshot } from "./collection/adapters/basic-profile-tabular.js";
import {
  readBasicBatchCountryInput,
  readBasicBatchGlobalInput,
} from "./cli/basic-batch-filesystem-cache.js";
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

  test("publishes one immutable winner across independent cache instances", async () => {
    const root = createRoot();
    const left = createFilesystemBasicBatchCache(root, "batch-race");
    const right = createFilesystemBasicBatchCache(root, "batch-race");
    let releaseCaptures: () => void = () => undefined;
    const capturesReady = new Promise<void>((resolve) => { releaseCaptures = resolve; });
    let started = 0;
    const capture = (value: string) => async () => {
      started += 1;
      if (started === 2) releaseCaptures();
      await capturesReady;
      return new TextEncoder().encode(value);
    };

    const [leftBytes, rightBytes] = await Promise.all([
      left.getOrCapture("global-wind-atlas", capture("left-snapshot")),
      right.getOrCapture("global-wind-atlas", capture("right-snapshot")),
    ]);

    expect(leftBytes).toEqual(rightBytes);
    expect(started).toBe(2);
    expect(readdirSync(join(
      root, ".cache", "basic-country", "batches", "batch-race", "refs",
    )).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    const warm = await createFilesystemBasicBatchCache(root, "batch-race").getOrCapture(
      "global-wind-atlas",
      async () => { throw new Error("warm cache must not capture"); },
    );
    expect(warm).toEqual(leftBytes);
  });

  test("publishes one immutable winner across separate processes", async () => {
    const root = createRoot();
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const runChild = (identity: string) => new Promise<string>((resolveChild, rejectChild) => {
      const source = [
        "import { existsSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "import { createFilesystemBasicBatchCache } from './src/cli/basic-batch-filesystem-cache.ts';",
        "const [root, identity] = process.argv.slice(1);",
        "const marker = join(root, `marker-${identity}`);",
        "const peer = join(root, `marker-${identity === 'left' ? 'right' : 'left'}`);",
        "const cache = createFilesystemBasicBatchCache(root, 'batch-process-race');",
        "const bytes = await cache.getOrCapture('global-wind-atlas', async () => {",
        "  writeFileSync(marker, identity);",
        "  const deadline = Date.now() + 5000;",
        "  while (!existsSync(peer) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));",
        "  if (!existsSync(peer)) throw new Error('peer did not capture');",
        "  return new TextEncoder().encode(`${identity}-snapshot`);",
        "});",
        "process.stdout.write(new TextDecoder().decode(bytes));",
      ].join("\n");
      const child = spawn(process.execPath, [
        "--conditions=development",
        "--import", "../../scripts/node-ts-source-hook.mjs",
        "--input-type=module",
        "--eval", source,
        root,
        identity,
      ], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", rejectChild);
      child.on("close", (code) => {
        if (code === 0) resolveChild(stdout);
        else rejectChild(new Error(`child failed: ${stderr}`));
      });
    });

    const [left, right] = await Promise.all([runChild("left"), runChild("right")]);
    expect(left).toBe(right);
    expect(["left-snapshot", "right-snapshot"]).toContain(left);
  });

  test("rejects a conflicting pre-existing content-addressed object", async () => {
    const root = createRoot();
    const batchRoot = join(root, ".cache", "basic-country", "batches", "batch-conflict");
    const intended = new TextEncoder().encode("approved-snapshot");
    const digest = createHash("sha256").update(intended).digest("hex");
    mkdirSync(join(batchRoot, "objects"), { recursive: true, mode: 0o700 });
    mkdirSync(join(batchRoot, "refs"), { recursive: true, mode: 0o700 });
    writeFileSync(join(batchRoot, "objects", digest), "conflicting-object");

    await expect(createFilesystemBasicBatchCache(root, "batch-conflict").getOrCapture(
      "global-solar-atlas", async () => intended,
    )).rejects.toThrow("basic batch cache is invalid");
    expect(readdirSync(join(batchRoot, "refs"))).toEqual([]);
  });

  test("uses unique publication temps and ignores a stale temp from another process", async () => {
    const root = createRoot();
    const refs = join(root, ".cache", "basic-country", "batches", "batch-stale", "refs");
    mkdirSync(join(root, ".cache", "basic-country", "batches", "batch-stale", "objects"), {
      recursive: true, mode: 0o700,
    });
    mkdirSync(refs, { recursive: true, mode: 0o700 });
    writeFileSync(join(refs, ".global-solar-atlas.123.tmp"), "stale");

    const result = await createFilesystemBasicBatchCache(root, "batch-stale").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("fresh"),
    );

    expect(new TextDecoder().decode(result)).toBe("fresh");
    expect(readdirSync(refs)).toContain(".global-solar-atlas.123.tmp");
    expect(readdirSync(refs)).toContain("global-solar-atlas.json");
  });

  test.each(["refs", "objects"])("refuses a symlinked %s cache directory", async (leaf) => {
    const root = createRoot();
    const batchRoot = join(root, ".cache", "basic-country", "batches", "batch-symlink");
    const outside = join(root, "outside");
    mkdirSync(batchRoot, { recursive: true });
    mkdirSync(outside);
    mkdirSync(join(batchRoot, leaf === "refs" ? "objects" : "refs"), { mode: 0o700 });
    symlinkSync(outside, join(batchRoot, leaf), "dir");

    await expect(createFilesystemBasicBatchCache(root, "batch-symlink").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("refuses non-private or non-directory cache hierarchy components", async () => {
    const root = createRoot();
    const publicBatch = join(root, ".cache", "basic-country", "batches", "batch-public");
    mkdirSync(publicBatch, { recursive: true, mode: 0o700 });
    mkdirSync(join(publicBatch, "objects"), { mode: 0o755 });
    mkdirSync(join(publicBatch, "refs"), { mode: 0o700 });
    await expect(createFilesystemBasicBatchCache(root, "batch-public").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");

    const blockedRoot = createRoot();
    mkdirSync(join(blockedRoot, ".cache"), { mode: 0o700 });
    writeFileSync(join(blockedRoot, ".cache", "basic-country"), "not a directory");
    await expect(createFilesystemBasicBatchCache(blockedRoot, "batch-blocked").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");
  });

  test("refuses a symlink above the cache leaf hierarchy", async () => {
    const root = createRoot();
    const outside = join(root, "outside-cache-parent");
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(root, ".cache"), "dir");

    await expect(createFilesystemBasicBatchCache(root, "batch-parent-link").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("rejects symlink refs and oversized ref files", async () => {
    const root = createRoot();
    const batchRoot = join(root, ".cache", "basic-country", "batches", "batch-ref-input");
    const refs = join(batchRoot, "refs");
    mkdirSync(join(batchRoot, "objects"), { recursive: true, mode: 0o700 });
    mkdirSync(refs, { recursive: true, mode: 0o700 });
    const outside = join(root, "outside-ref.json");
    writeFileSync(outside, "{}");
    symlinkSync(outside, join(refs, "global-wind-atlas.json"));
    const cache = createFilesystemBasicBatchCache(root, "batch-ref-input");
    await expect(cache.getOrCapture(
      "global-wind-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");

    rmSync(join(refs, "global-wind-atlas.json"));
    writeFileSync(join(refs, "global-wind-atlas.json"), "x");
    truncateSync(join(refs, "global-wind-atlas.json"), 65 * 1024);
    await expect(cache.getOrCapture(
      "global-wind-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");
  });

  test("rejects oversized cached objects before reading their contents", async () => {
    const root = createRoot();
    const batchRoot = join(root, ".cache", "basic-country", "batches", "batch-object-input");
    const objects = join(batchRoot, "objects");
    const refs = join(batchRoot, "refs");
    const digest = "a".repeat(64);
    mkdirSync(objects, { recursive: true, mode: 0o700 });
    mkdirSync(refs, { recursive: true, mode: 0o700 });
    writeFileSync(join(objects, digest), "x");
    truncateSync(join(objects, digest), 65 * 1024 * 1024);
    writeFileSync(join(refs, "global-wind-atlas.json"), JSON.stringify({
      sourceId: "global-wind-atlas", sha256: digest, byteLength: 64 * 1024 * 1024,
    }));

    await expect(createFilesystemBasicBatchCache(root, "batch-object-input").getOrCapture(
      "global-wind-atlas", async () => new TextEncoder().encode("snapshot"),
    )).rejects.toThrow("basic batch cache is invalid");
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

  test("keeps publication descriptor-relative when the cache path is replaced during capture", async () => {
    const root = createRoot();
    const batchRoot = join(root, ".cache", "basic-country", "batches", "batch-replaced");
    const moved = join(root, "original-batch");
    const outside = join(root, "replacement-target");
    mkdirSync(outside, { mode: 0o700 });

    const result = await createFilesystemBasicBatchCache(root, "batch-replaced").getOrCapture(
      "global-solar-atlas",
      async () => {
        renameSync(batchRoot, moved);
        symlinkSync(outside, batchRoot, "dir");
        return new TextEncoder().encode("held-directory-snapshot");
      },
    );

    expect(new TextDecoder().decode(result)).toBe("held-directory-snapshot");
    expect(readdirSync(outside)).toEqual([]);
    expect(readdirSync(join(moved, "refs"))).toContain("global-solar-atlas.json");
    await expect(createFilesystemBasicBatchCache(root, "batch-replaced").getOrCapture(
      "global-solar-atlas", async () => new TextEncoder().encode("must-not-write"),
    )).rejects.toThrow("basic batch cache is invalid");
  });

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

describe("bounded BASIC batch input reads", () => {
  test.each([
    ["global", readBasicBatchGlobalInput, 65 * 1024 * 1024],
    ["country", readBasicBatchCountryInput, 2 * 1024 * 1024],
  ] as const)("rejects oversized %s input before allocation", async (_label, readInput, size) => {
    const root = createRoot();
    const input = join(root, "input");
    writeFileSync(input, "x");
    truncateSync(input, size);
    await expect(readInput(root, input)).rejects.toThrow("basic batch input is invalid");
  });

  test.each([
    ["global", readBasicBatchGlobalInput],
    ["country", readBasicBatchCountryInput],
  ] as const)("rejects symlinked %s input files and parent directories", async (_label, readInput) => {
    const root = createRoot();
    const outside = join(root, "outside");
    const safe = join(root, "safe");
    mkdirSync(outside);
    writeFileSync(join(outside, "input"), "{}");
    symlinkSync(outside, safe, "dir");
    await expect(readInput(root, join(safe, "input")))
      .rejects.toThrow("basic batch input is invalid");
  });

  test.each([
    ["global", readBasicBatchGlobalInput],
    ["country", readBasicBatchCountryInput],
  ] as const)("rejects a non-directory %s input hierarchy", async (_label, readInput) => {
    const root = createRoot();
    const parent = join(root, "not-a-directory");
    writeFileSync(parent, "regular file");
    await expect(readInput(root, join(parent, "input")))
      .rejects.toThrow("basic batch input is invalid");
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
      approvedWorldBankEntry("world-bank-gdp-per-capita", "ID"),
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
      approvedWorldBankEntry("world-bank-electricity-access", "ID"), "ID", transport as never,
      () => new Date("2026-07-20T00:01:00Z"),
    )).rejects.toThrow(/^world bank BASIC profile capture failed$/);
    expect(chunksRead).toBe(2);
  });

  test("uses a trusted committed execution-plan entry for the World Bank request", async () => {
    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
      "utf8",
    )) as unknown);
    const entry = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "ID",
      sourceIds: ["world-bank-gdp-per-capita"],
    }).sources[0]!;
    const body = new TextEncoder().encode(JSON.stringify([
      { page: 1, pages: 1, per_page: 1, total: 1, sourceid: "2" },
      [{ indicator: { id: "NY.GDP.PCAP.CD" }, country: { id: "ID" }, date: "2024", value: 4932.1 }],
    ]));
    const result = await captureWorldBankProfileSourceForBatch(entry, "ID", {
      async execute(request) {
        expect(request).toEqual(entry.request);
        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          retrievedAt: "2026-07-20T00:00:00Z",
          redirectChain: [],
          body: (async function* () { yield body; })(),
        };
      },
    }, () => new Date("2026-07-20T00:01:00Z"));
    expect(result.field.field.key).toBe("gdpPerCapita");
  });
});

describe("reviewed global BASIC profile snapshots", () => {
  test("binds every captured byte hash and tabular row to its exact audit source and field", () => {
    const encoder = new TextEncoder();
    const ember = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,electricityMarket,totalGeneration,312.4,TWh,2025,table:ID:2025",
      "ID,electricityMarket,renewableGenerationShare,48,%,2025,table:ID:renewables:2025",
    ].join("\n"));
    const solar = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,solarResource,ghi,5.1,kWh/m2/day,2024,grid:ID",
      "ID,solarResource,pvout,4.3,kWh/kWp/day,2024,grid:ID:pvout",
    ].join("\n"));
    const wind = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,windResource,onshoreWindClass,good,,2024,grid:ID:onshore",
      "ID,windResource,offshoreWindClass,very-good,,2024,grid:ID:offshore",
    ].join("\n"));
    const capacity = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,renewableCapacity,solarCapacity,8.2,GW,2025,table:ID:solar",
      "ID,renewableCapacity,windCapacity,0.2,GW,2025,table:ID:wind",
      "ID,renewableCapacity,hydroCapacity,6.7,GW,2025,table:ID:hydro",
      "ID,renewableCapacity,totalRenewableCapacity,15.1,GW,2025,table:ID:total",
    ].join("\n"));
    const captures = new Map([
      ["ember-electricity", ember],
      ["global-solar-atlas", solar],
      ["global-wind-atlas", wind],
      ["irenastat-capacity", capacity],
    ]);
    const reviewedProfile = {
      updatedAt: "2026-07-20T00:00:00Z",
      sources: [
        profileSource("ember-electricity"),
        profileSource("global-solar-atlas"),
        profileSource("global-wind-atlas"),
        profileSource("irenastat-capacity"),
      ],
      auditSources: [
        auditSource("ember-electricity", ember, ["table:ID:2025", "table:ID:renewables:2025"]),
        auditSource("global-solar-atlas", solar, ["grid:ID", "grid:ID:pvout"]),
        auditSource("global-wind-atlas", wind, ["grid:ID:onshore", "grid:ID:offshore"]),
        auditSource("irenastat-capacity", capacity, [
          "table:ID:solar", "table:ID:wind", "table:ID:hydro", "table:ID:total",
        ]),
      ],
      fields: [
        reviewedField("ember-electricity", "electricityMarket", "totalGeneration", 312.4, "TWh", 2025),
        reviewedField("ember-electricity", "electricityMarket", "renewableGenerationShare", 48, "%", 2025),
        reviewedField("irenastat-capacity", "renewableCapacity", "solarCapacity", 8.2, "GW", 2025),
        reviewedField("irenastat-capacity", "renewableCapacity", "windCapacity", 0.2, "GW", 2025),
        reviewedField("irenastat-capacity", "renewableCapacity", "hydroCapacity", 6.7, "GW", 2025),
        reviewedField("irenastat-capacity", "renewableCapacity", "totalRenewableCapacity", 15.1, "GW", 2025),
        reviewedField("global-solar-atlas", "solarResource", "ghi", 5.1, "kWh/m2/day", 2024),
        reviewedField("global-solar-atlas", "solarResource", "pvout", 4.3, "kWh/kWp/day", 2024),
        reviewedField("global-wind-atlas", "windResource", "onshoreWindClass", "good", null, 2024),
        reviewedField("global-wind-atlas", "windResource", "offshoreWindClass", "very-good", null, 2024),
      ],
    } as const;

    expect(bindReviewedGlobalProfileSnapshots("ID", captures, reviewedProfile))
      .toEqual(reviewedProfile);

    const forged = structuredClone(reviewedProfile);
    forged.auditSources[0]!.contentSha256 = "0".repeat(64);
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, forged))
      .toThrow("basic batch country input is invalid");

    const forgedField = structuredClone(reviewedProfile);
    forgedField.fields[0]!.field.value = 999;
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, forgedField))
      .toThrow("basic batch country input is invalid");

    for (const invalidCaptures of [
      new Map([...captures].slice(1)),
      new Map([...captures, ["unrelated-source", encoder.encode("unrelated")]]),
      new Map([...captures].map(([sourceId, bytes], index) =>
        [index === 0 ? "unrelated-source" : sourceId, bytes] as const)),
    ]) {
      expect(() => bindReviewedGlobalProfileSnapshots("ID", invalidCaptures, reviewedProfile))
        .toThrow("basic batch country input is invalid");
    }

    const duplicateAudit = {
      ...structuredClone(reviewedProfile),
      auditSources: [
        ...structuredClone(reviewedProfile.auditSources),
        structuredClone(reviewedProfile.auditSources[0]!),
      ],
    };
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, duplicateAudit))
      .toThrow("basic batch country input is invalid");

    const extraProfileSource = {
      ...reviewedProfile,
      sources: [...reviewedProfile.sources, {
        ...profileSource("ember-electricity"),
        id: "unrelated-source",
      }],
    };
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, extraProfileSource))
      .toThrow("basic batch country input is invalid");

    const extraAuditSource = {
      ...reviewedProfile,
      auditSources: [...reviewedProfile.auditSources, {
        ...auditSource("ember-electricity", ember, ["table:ID:2025"]),
        sourceId: "unrelated-source",
      }],
    };
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, extraAuditSource))
      .toThrow("basic batch country input is invalid");

    for (const mutate of [
      (value: typeof forged) => { value.auditSources[0]!.sourceUrl = "https://example.com/drift"; },
      (value: typeof forged) => { value.auditSources[0]!.retrievedAt = "2026-07-19T00:00:00Z"; },
      (value: typeof forged) => { value.auditSources[0]!.evidenceLocators = ["table:wrong"]; },
    ]) {
      const drifted = structuredClone(reviewedProfile);
      mutate(drifted);
      expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, drifted))
        .toThrow("basic batch country input is invalid");
    }

    const colluding = structuredClone(reviewedProfile);
    colluding.sources[0]!.publisher = "Forged Publisher";
    colluding.sources[0]!.url = "https://forged.example/source";
    colluding.auditSources[0]!.sourceName = "Forged Publisher";
    colluding.auditSources[0]!.sourceUrl = "https://forged.example/source";
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, colluding))
      .toThrow("basic batch country input is invalid");

    const sameOriginDrift = structuredClone(reviewedProfile);
    sameOriginDrift.sources[0]!.url = "https://ember-energy.org/unapproved-snapshot";
    sameOriginDrift.auditSources[0]!.sourceUrl = "https://ember-energy.org/unapproved-snapshot";
    expect(() => bindReviewedGlobalProfileSnapshots("ID", captures, sameOriginDrift))
      .toThrow("basic batch country input is invalid");

    const incompleteSolar = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,solarResource,ghi,5.1,kWh/m2/day,2024,grid:ID",
    ].join("\n"));
    const incompleteCaptures = new Map(captures);
    incompleteCaptures.set("global-solar-atlas", incompleteSolar);
    const incompleteProfile = {
      ...reviewedProfile,
      auditSources: reviewedProfile.auditSources.map((source, index) => index === 1
        ? auditSource("global-solar-atlas", incompleteSolar, ["grid:ID"])
        : source),
      fields: reviewedProfile.fields.filter(({ field }) => field.key !== "pvout"),
    };
    expect(() => bindReviewedGlobalProfileSnapshots("ID", incompleteCaptures, incompleteProfile))
      .toThrow("basic batch country input is invalid");

    const futureSolar = encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,solarResource,ghi,5.1,kWh/m2/day,2027,grid:ID",
      "ID,solarResource,pvout,4.3,kWh/kWp/day,2027,grid:ID:pvout",
    ].join("\n"));
    const futureCaptures = new Map(captures);
    futureCaptures.set("global-solar-atlas", futureSolar);
    const futureProfile = {
      ...reviewedProfile,
      auditSources: reviewedProfile.auditSources.map((source) =>
        source.sourceId === "global-solar-atlas"
          ? auditSource("global-solar-atlas", futureSolar, ["grid:ID", "grid:ID:pvout"])
          : source),
      fields: reviewedProfile.fields.map((entry) => entry.category === "solarResource" ? {
        ...entry,
        field: { ...entry.field, year: 2027 },
      } : entry),
    };
    expect(() => bindReviewedGlobalProfileSnapshots("ID", futureCaptures, futureProfile))
      .toThrow("basic batch country input is invalid");

  });

  test("uses the production missing-snapshot path to create sourced NOT_AVAILABLE Ember rows", async () => {
    const root = createRoot();
    const bytes = await readReviewedEmberSnapshotOrUnavailable(
      root, join(root, "missing-ember.snapshot"), ["ID", "VN"],
    );
    expect(bytes).toEqual(createEmberNoCredentialTabularSnapshot(["ID", "VN"]));
    expect(new TextDecoder().decode(bytes)).not.toContain("secret");
    expect(bindSnapshotRows(bytes, "ID")).toEqual([expect.objectContaining({
      category: "electricityMarket",
      key: "totalGeneration",
      status: "NOT_AVAILABLE",
      reason: {
        zh: "未提供已审核的Ember不可变标准化快照",
        en: "A reviewed immutable normalized Ember snapshot was not provided",
      },
    }), expect.objectContaining({
      category: "electricityMarket",
      key: "renewableGenerationShare",
      status: "NOT_AVAILABLE",
    })]);
    expect(bindSnapshotRows(bytes, "VN")).toHaveLength(2);
  });

  test("uses a present reviewed immutable normalized Ember snapshot byte-for-byte", async () => {
    const root = createRoot();
    const directory = join(root, "inputs", "global");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const pathname = join(directory, "ember-electricity.snapshot");
    const reviewed = new TextEncoder().encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,electricityMarket,totalGeneration,312.4,TWh,2025,table:ID:2025",
      "ID,electricityMarket,renewableGenerationShare,48,%,2025,table:ID:renewables:2025",
    ].join("\n"));
    writeFileSync(pathname, reviewed, { mode: 0o600 });
    await expect(readReviewedEmberSnapshotOrUnavailable(root, pathname, ["ID"]))
      .resolves.toEqual(reviewed);
  });
});

describe("reviewed manual BASIC profile captures", () => {
  test("binds IEA policy evidence to captured bytes and rejects zero hashes and fake locators", () => {
    const globalProfile = reviewedGlobalProfileFixture();
    const manualBytes = manualCapture("iea-policies", ["section:renewable-target"]);
    const manualProfile = reviewedManualProfileFixture(
      "iea-policies",
      manualBytes,
      "policyOverview",
      "summary",
      ["iea-policies"],
    );

    expect(bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", manualBytes]]), globalProfile, manualProfile,
    ).fields).toEqual(expect.arrayContaining(manualProfile.fields));

    const zeroHash = structuredClone(manualProfile);
    zeroHash.auditSources[0]!.contentSha256 = "0".repeat(64);
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", manualBytes]]), globalProfile, zeroHash,
    )).toThrow("basic batch country input is invalid");

    const fakeLocator = structuredClone(manualProfile);
    fakeLocator.auditSources[0]!.evidenceLocators = ["section:not-in-capture"];
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", manualBytes]]), globalProfile, fakeLocator,
    )).toThrow("basic batch country input is invalid");

    for (const unapprovedUrl of [
      "https://www.iea.org/reports/not-a-policy",
      "https://www.iea.org/policies/example?redirect=unreviewed",
      "https://www.iea.org/policies/example#unreviewed",
      "https://www.iea.org/policies/../reports/unreviewed",
      "https://www.iea.org/policies/%2e%2e/reports/unreviewed",
      "https://www.iea.org/policies/%252e%252e/reports/unreviewed",
      "https://www.iea.org/policies/%2E%2E%2Freports/unreviewed",
      "https://www.iea.org/policies/%2fnot-a-slug",
      "https://www.iea.org/policies/%5cnot-a-slug",
      "https://www.iea.org/policies/政策",
      "https://www.iea.org/policies\\..\\reports\\unreviewed",
      "https://reviewer@www.iea.org/policies/example",
      "https://www.iea.org:444/policies/example",
    ]) {
      const driftedUrl = {
        ...structuredClone(manualProfile),
        sources: manualProfile.sources.map((source) => ({ ...source, url: unapprovedUrl })),
        auditSources: manualProfile.auditSources.map((source) => ({
          ...source, sourceUrl: unapprovedUrl,
        })),
      };
      expect(() => bindReviewedManualProfileCaptures(
        "ID", new Map([["iea-policies", manualBytes]]), globalProfile, driftedUrl,
      )).toThrow("basic batch country input is invalid");
    }

    const riseBytes = manualCapture("rise-policy-review", ["section:renewable-target"]);
    const riseProfile = reviewedManualProfileFixture(
      "rise-policy-review", riseBytes, "policyOverview", "summary", ["rise-policy-review"],
    );
    expect(bindReviewedManualProfileCaptures(
      "ID", new Map([["rise-policy-review", riseBytes]]), globalProfile, riseProfile,
    ).fields).toEqual(expect.arrayContaining(riseProfile.fields));
    for (const unapprovedUrl of [
      "https://rise.esmap.org/country/../about",
      "https://rise.esmap.org/country/%2e%2e/about",
      "https://rise.esmap.org/country/%252e%252e/about",
      "https://rise.esmap.org/country/%2fnot-a-slug",
      "https://rise.esmap.org/country/国家",
      "https://rise.esmap.org/country\\..\\about",
      "https://reviewer@rise.esmap.org/country/example",
      "https://rise.esmap.org:444/country/example",
    ]) {
      const driftedUrl = {
        ...structuredClone(riseProfile),
        sources: riseProfile.sources.map((source) => ({ ...source, url: unapprovedUrl })),
        auditSources: riseProfile.auditSources.map((source) => ({
          ...source, sourceUrl: unapprovedUrl,
        })),
      };
      expect(() => bindReviewedManualProfileCaptures(
        "ID", new Map([["rise-policy-review", riseBytes]]), globalProfile, driftedUrl,
      )).toThrow("basic batch country input is invalid");
    }
  });

  test("exposes no unauthenticated manual profile merge entrypoint", async () => {
    const batchModule = await import("./cli/prepare-basic-batch.js");
    expect(batchModule).not.toHaveProperty("mergeReviewedManualProfile");
  });

  test("enforces category ownership and prevents manual overrides or unobserved global fields", () => {
    const globalProfile = reviewedGlobalProfileFixture();
    const ieaBytes = manualCapture("iea-policies", ["section:renewable-target"]);
    const solarAsPolicy = reviewedManualProfileFixture(
      "iea-policies",
      ieaBytes,
      "policyOverview",
      "summary",
      ["global-solar-atlas"],
    );
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, solarAsPolicy,
    )).toThrow("basic batch country input is invalid");

    const windOwnedByPolicy = reviewedManualProfileFixture(
      "iea-policies", ieaBytes, "windResource", "resourceSummary", ["iea-policies"],
    );
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, windOwnedByPolicy,
    )).toThrow("basic batch country input is invalid");

    const overrideObservedWind = reviewedManualProfileFixture(
      "iea-policies", ieaBytes, "windResource", "onshoreWindClass", ["global-wind-atlas"],
    );
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, overrideObservedWind,
    )).toThrow("basic batch country input is invalid");

    const unownedSolar = reviewedManualProfileFixture(
      "iea-policies", ieaBytes, "solarResource", "resourceSummary", ["global-solar-atlas"],
    );
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, unownedSolar,
    )).toThrow("basic batch country input is invalid");

    const windSummary = {
      ...reviewedManualProfileFixture(
        "iea-policies", ieaBytes, "windResource", "resourceSummary", ["global-wind-atlas"],
      ),
      sources: [],
      auditSources: [],
    };
    expect(bindReviewedManualProfileCaptures(
      "ID", new Map(), globalProfile, windSummary,
    ).fields).toContainEqual(expect.objectContaining({
      category: "windResource",
      field: expect.objectContaining({ key: "resourceSummary" }),
    }));

    const marketSummary = {
      ...windSummary,
      fields: [{
        ...windSummary.fields[0]!,
        category: "marketSummary" as const,
        field: {
          ...windSummary.fields[0]!.field,
          key: "opportunitySummary",
          sourceIds: ["global-wind-atlas", "global-solar-atlas"],
        },
      }],
    };
    expect(bindReviewedManualProfileCaptures(
      "ID", new Map(), globalProfile, marketSummary,
    ).fields).toContainEqual(expect.objectContaining({
      category: "marketSummary",
      field: expect.objectContaining({
        sourceIds: ["global-wind-atlas", "global-solar-atlas"],
      }),
    }));

    const arbitraryKey = reviewedManualProfileFixture(
      "iea-policies", ieaBytes, "policyOverview", "renewableTarget", ["iea-policies"],
    );
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, arbitraryKey,
    )).toThrow("basic batch country input is invalid");

    const scalarValue = structuredClone(arbitraryKey);
    scalarValue.fields[0]!.field.key = "summary";
    scalarValue.fields[0]!.field.value = { zh: "", en: "Reviewed content" };
    expect(() => bindReviewedManualProfileCaptures(
      "ID", new Map([["iea-policies", ieaBytes]]), globalProfile, scalarValue,
    )).toThrow("basic batch country input is invalid");
  });

  test("loads only descriptor-controlled bounded regular manual capture files", async () => {
    const root = createRoot();
    const directory = join(
      root, ".cache", "basic-country", "batches", "batch-1", "inputs", "manual", "ID",
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const bytes = manualCapture("iea-policies", ["section:renewable-target"]);
    writeFileSync(join(directory, "iea-policies.snapshot"), bytes, { mode: 0o600 });

    await expect(readReviewedManualProfileCaptures(root, "batch-1", "ID"))
      .resolves.toEqual(new Map([["iea-policies", bytes]]));

    const outside = join(root, "outside.snapshot");
    writeFileSync(outside, bytes, { mode: 0o600 });
    symlinkSync(outside, join(directory, "rise-policy-review.snapshot"));
    await expect(readReviewedManualProfileCaptures(root, "batch-1", "ID"))
      .rejects.toThrow("manual BASIC profile capture input is invalid");
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
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "navigator-basic-batch-"));
  roots.add(root);
  return root;
}

function bindSnapshotRows(bytes: Uint8Array, countryCode: string) {
  return parseBasicProfileTabularSnapshot(bytes, countryCode);
}

function profileSource(sourceId: string) {
  const policies: Record<string, { publisher: string; url: string }> = {
    "ember-electricity": {
      publisher: "Ember", url: "https://ember-energy.org/data/electricity-data-explorer/",
    },
    "global-solar-atlas": {
      publisher: "World Bank ESMAP", url: "https://globalsolaratlas.info/",
    },
    "global-wind-atlas": {
      publisher: "World Bank ESMAP", url: "https://globalwindatlas.info/",
    },
    "irenastat-capacity": {
      publisher: "International Renewable Energy Agency (IRENA)",
      url: "https://pxweb.irena.org/pxweb/en/IRENASTAT/",
    },
  };
  const policy = policies[sourceId]!;
  return {
    id: sourceId,
    publisher: policy.publisher,
    title: { zh: sourceId, en: sourceId },
    url: policy.url,
    publishedAt: null,
    retrievedAt: "2026-07-20T00:00:00Z",
    credibility: "OFFICIAL" as const,
  };
}

function auditSource(sourceId: string, bytes: Uint8Array, locators: string[]) {
  const source = profileSource(sourceId);
  return {
    sourceId,
    sourceName: source.publisher,
    sourceUrl: source.url,
    retrievedAt: "2026-07-20T00:00:00Z",
    publishedAt: null,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    evidenceLocators: locators,
    sourceFamily: sourceId === "ember-electricity"
      ? "verified-research" as const : "international-organization" as const,
    accessStatus: "open" as const,
    accessNotes: null,
    credibility: "OFFICIAL" as const,
    discoveryOnly: false,
    promptInjectionRisk: "none" as const,
  };
}

function reviewedField(
  sourceId: string,
  category: "electricityMarket" | "renewableCapacity" | "solarResource" | "windResource",
  key: string,
  value: number | string,
  unit: string | null,
  year: number,
) {
  return {
    category,
    field: {
      key,
      label: { zh: key, en: key },
      status: "AVAILABLE" as const,
      value,
      unit,
      year,
      sourceIds: [sourceId],
      checkedAt: "2026-07-20",
      reason: null,
      note: null,
    },
  };
}

function approvedWorldBankEntry(
  sourceId: "world-bank-electricity-access" | "world-bank-gdp-per-capita",
  countryCode: string,
) {
  const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
    new URL("../catalog/basic-source-catalog.json", import.meta.url),
    "utf8",
  )) as unknown);
  return createBasicSourceExecutionPlan({ catalog, countryCode, sourceIds: [sourceId] }).sources[0]!;
}

function reviewedGlobalProfileFixture() {
  const encoder = new TextEncoder();
  const captures = {
    ember: encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,electricityMarket,totalGeneration,312.4,TWh,2025,table:ID:2025",
      "ID,electricityMarket,renewableGenerationShare,48,%,2025,table:ID:renewables:2025",
    ].join("\n")),
    solar: encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,solarResource,ghi,5.1,kWh/m2/day,2024,grid:ID",
      "ID,solarResource,pvout,4.3,kWh/kWp/day,2024,grid:ID:pvout",
    ].join("\n")),
    wind: encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,windResource,onshoreWindClass,good,,2024,grid:ID:onshore",
      "ID,windResource,offshoreWindClass,very-good,,2024,grid:ID:offshore",
    ].join("\n")),
    capacity: encoder.encode([
      "countryCode,category,key,value,unit,year,locator",
      "ID,renewableCapacity,solarCapacity,8.2,GW,2025,table:ID:solar",
      "ID,renewableCapacity,windCapacity,0.2,GW,2025,table:ID:wind",
      "ID,renewableCapacity,hydroCapacity,6.7,GW,2025,table:ID:hydro",
      "ID,renewableCapacity,totalRenewableCapacity,15.1,GW,2025,table:ID:total",
    ].join("\n")),
  };
  return {
    updatedAt: "2026-07-20T00:00:00Z",
    sources: [
      profileSource("ember-electricity"),
      profileSource("global-solar-atlas"),
      profileSource("global-wind-atlas"),
      profileSource("irenastat-capacity"),
    ],
    auditSources: [
      auditSource("ember-electricity", captures.ember, ["table:ID:2025", "table:ID:renewables:2025"]),
      auditSource("global-solar-atlas", captures.solar, ["grid:ID", "grid:ID:pvout"]),
      auditSource("global-wind-atlas", captures.wind, ["grid:ID:onshore", "grid:ID:offshore"]),
      auditSource("irenastat-capacity", captures.capacity, [
        "table:ID:solar", "table:ID:wind", "table:ID:hydro", "table:ID:total",
      ]),
    ],
    fields: [
      reviewedField("ember-electricity", "electricityMarket", "totalGeneration", 312.4, "TWh", 2025),
      reviewedField("ember-electricity", "electricityMarket", "renewableGenerationShare", 48, "%", 2025),
      reviewedField("irenastat-capacity", "renewableCapacity", "solarCapacity", 8.2, "GW", 2025),
      reviewedField("irenastat-capacity", "renewableCapacity", "windCapacity", 0.2, "GW", 2025),
      reviewedField("irenastat-capacity", "renewableCapacity", "hydroCapacity", 6.7, "GW", 2025),
      reviewedField("irenastat-capacity", "renewableCapacity", "totalRenewableCapacity", 15.1, "GW", 2025),
      reviewedField("global-solar-atlas", "solarResource", "ghi", 5.1, "kWh/m2/day", 2024),
      reviewedField("global-solar-atlas", "solarResource", "pvout", 4.3, "kWh/kWp/day", 2024),
      reviewedField("global-wind-atlas", "windResource", "onshoreWindClass", "good", null, 2024),
      reviewedField("global-wind-atlas", "windResource", "offshoreWindClass", "very-good", null, 2024),
    ],
  };
}

function manualCapture(sourceId: string, evidenceLocators: readonly string[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: "basic-manual-source-capture/v1",
    countryCode: "ID",
    sourceId,
    retrievedAt: "2026-07-20T00:00:00Z",
    evidence: evidenceLocators.map((locator) => ({
      locator,
      excerpt: { zh: "已审核证据摘录", en: "Reviewed evidence excerpt" },
    })),
  }));
}

function reviewedManualProfileFixture(
  sourceId: "iea-policies" | "rise-policy-review",
  bytes: Uint8Array,
  category: "policyOverview" | "windResource" | "marketSummary" | "solarResource",
  key: string,
  sourceIds: string[],
) {
  const policies = {
    "iea-policies": {
      publisher: "International Energy Agency",
      url: "https://www.iea.org/policies/example",
    },
    "rise-policy-review": {
      publisher: "World Bank RISE",
      url: "https://rise.esmap.org/country/example",
    },
  } as const;
  const policy = policies[sourceId];
  return {
    updatedAt: "2026-07-20T00:00:00Z",
    sources: [{
      id: sourceId,
      publisher: policy.publisher,
      title: { zh: sourceId, en: sourceId },
      url: policy.url,
      publishedAt: null,
      retrievedAt: "2026-07-20T00:00:00Z",
      credibility: "OFFICIAL" as const,
    }],
    auditSources: [{
      sourceId,
      sourceName: policy.publisher,
      sourceUrl: policy.url,
      retrievedAt: "2026-07-20T00:00:00Z",
      publishedAt: null,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      evidenceLocators: ["section:renewable-target"],
      sourceFamily: "international-organization" as const,
      accessStatus: "open" as const,
      accessNotes: null,
      credibility: "OFFICIAL" as const,
      discoveryOnly: false,
      promptInjectionRisk: "none" as const,
    }],
    fields: [{
      category,
      field: {
        key,
        label: { zh: key, en: key },
        status: "AVAILABLE" as const,
        value: { zh: "已审核内容", en: "Reviewed content" },
        unit: null,
        year: null,
        sourceIds,
        checkedAt: "2026-07-20",
        reason: null,
        note: null,
      },
    }],
  };
}
