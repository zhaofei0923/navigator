import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  BASIC_RAW_CAPTURE_SCHEMA_VERSION,
} from "./collection/basic-source-adapter-contracts.js";
import {
  parseBasicRawCaptureManifest,
} from "./collection/basic-source-metadata.js";
import {
  captureBasicRawSource,
  type BasicRawCaptureInput,
} from "./collection/basic-raw-capture.js";
import {
  captureBasicRawSourceV2,
} from "./collection/basic-raw-capture-v2.js";
import {
  BASIC_RAW_CAPTURE_MAX_BYTES_V2,
  BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
  type BasicRawCaptureInputV2,
  type BasicSourceTransportResponseV2,
  type BasicSourceTransportV2,
} from "./collection/basic-source-v2-contracts.js";
import type {
  BasicSourceTransport,
  BasicSourceTransportResponse,
} from "./collection/basic-source-adapter-contracts.js";
import {
  createBasicRawCaptureManifestV2,
  parseBasicRawCaptureManifestV2,
  snapshotBasicRawCaptureInputV2,
  snapshotBasicSourceTransportResponseV2,
} from "./collection/basic-source-metadata-v2.js";

const roots = new Set<string>();
const SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CATALOG_SHA256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const SENTINEL = "V2_CAPTURE_METADATA_DO_NOT_LEAK";

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("Basic raw capture v2 metadata", () => {
  test("reconstructs and recursively freezes catalog-bound input", () => {
    const source = input(repoRoot());

    const result = snapshotBasicRawCaptureInputV2(source);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.request).not.toBe(source.request);
    expect(result.request.allowedOrigins).toEqual([
      "https://data.example",
      "https://mirror.example",
    ]);
    expect(result.request.allowedQueryParameters).toEqual(["format", "lang"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(result.request.allowedQueryParameters)).toBe(true);
  });

  test.each([
    ["country code", "countryCode", "vn"],
    ["run ID", "runId", "../run"],
    ["catalog version", "catalogVersion", "Version 1"],
    ["catalog digest", "catalogSha256", CATALOG_SHA256.toUpperCase()],
    ["catalog digest length", "catalogSha256", "a".repeat(63)],
    ["adapter ID", "adapterId", "World_Bank"],
    ["adapter version", "adapterVersion", "1..0"],
    ["source ID", "sourceId", "world_bank"],
    ["repository root", "repoRoot", "relative/path"],
  ] as const)("rejects an invalid %s", (_label, key, value) => {
    expect(() => snapshotBasicRawCaptureInputV2({
      ...input(repoRoot()),
      [key]: value,
    })).toThrow("raw capture input is invalid");
  });

  test.each(["extra", "missing", "symbol", "accessor", "proxy"] as const)(
    "rejects a top-level %s exact-shape violation",
    (kind) => {
      const probe = { executions: 0 };
      const value = unsafeRecord(input(repoRoot()), kind, probe);

      expect(() => snapshotBasicRawCaptureInputV2(value)).toThrow(
        "raw capture input is invalid",
      );
      expect(probe.executions).toBe(0);
    },
  );

  test("rejects an invalid nested request with a redacted error", () => {
    const original = input(repoRoot());
    const source = {
      ...original,
      request: { ...original.request, url: SENTINEL },
    };

    let error: Error | null = null;
    try {
      snapshotBasicRawCaptureInputV2(source);
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error?.message).toBe("raw capture request is invalid");
    expect(error?.message).not.toContain(SENTINEL);
  });

  test("snapshots strict response metadata without consuming the body", () => {
    let reads = 0;
    const source = {
      ...response(),
      body: (async function* body() {
        reads += 1;
        yield new Uint8Array([1]);
      })(),
    };

    const result = snapshotBasicSourceTransportResponseV2(source);

    expect(result).not.toBe(source);
    expect(result).toMatchObject({
      status: 200,
      finalUrl: "https://data.example/v1/countries/VN?format=csv&lang=en",
      contentType: "text/csv; charset=utf-8",
      retrievedAt: "2026-07-12T04:00:00.000Z",
      redirectChain: [],
    });
    expect(result.body).toBe(source.body);
    expect(reads).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.redirectChain)).toBe(true);
  });

  test.each([
    ["non-finite status", { status: Number.NaN }],
    ["fractional status", { status: 200.5 }],
    ["invalid final URL", { finalUrl: SENTINEL }],
    ["invalid timestamp", { retrievedAt: "2026-07-12T04:00:00+00:00" }],
    ["oversized redirect chain", { redirectChain: Array(4).fill("https://data.example/") }],
    ["oversized content type", { contentType: "a".repeat(65_537) }],
  ])("rejects malformed response metadata: %s", (_label, mutation) => {
    expect(() => snapshotBasicSourceTransportResponseV2({
      ...response(),
      ...mutation,
    })).toThrow("raw capture response is invalid");
  });

  test("creates exact manifest bytes while preserving reviewed request order", () => {
    const captureInput = input(repoRoot());
    const transportResponse = response();

    const manifest = createBasicRawCaptureManifestV2(
      captureInput,
      transportResponse,
      SHA256,
      17,
    );

    expect(JSON.stringify(manifest)).toBe(JSON.stringify({
      schemaVersion: "basic-country-raw-capture/v2",
      countryCode: "VN",
      runId: "run-20260712",
      catalogVersion: "2026.07.12",
      catalogSha256: CATALOG_SHA256,
      adapterId: "energy-csv",
      adapterVersion: "1.0.0",
      sourceId: "energy-csv",
      request: {
        method: "GET",
        url: "https://data.example/v1/countries/VN?format=csv&lang=en",
        accept: "text/csv",
        allowedOrigins: ["https://data.example", "https://mirror.example"],
        allowedQueryParameters: ["format", "lang"],
      },
      response: {
        status: 200,
        finalUrl: "https://data.example/v1/countries/VN?format=csv&lang=en",
        redirectChain: [],
        contentType: "text/csv; charset=utf-8",
        retrievedAt: "2026-07-12T04:00:00.000Z",
        byteLength: 17,
        contentSha256: SHA256,
      },
    }));
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.request)).toBe(true);
    expect(Object.isFrozen(manifest.request.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(manifest.response)).toBe(true);
    expect(Object.isFrozen(manifest.response.redirectChain)).toBe(true);
  });

  test.each([
    ["uppercase digest", SHA256.toUpperCase(), 17],
    ["short digest", "a".repeat(63), 17],
    ["negative byte count", SHA256, -1],
    ["fractional byte count", SHA256, 1.5],
    ["non-finite byte count", SHA256, Number.POSITIVE_INFINITY],
    ["oversized byte count", SHA256, BASIC_RAW_CAPTURE_MAX_BYTES_V2 + 1],
  ] as const)("rejects invalid manifest creation metadata: %s", (
    _label,
    digest,
    byteLength,
  ) => {
    expect(() => createBasicRawCaptureManifestV2(
      input(repoRoot()),
      response(),
      digest,
      byteLength,
    )).toThrow("raw capture manifest metadata is invalid");
  });

  test("parses a reconstructed, recursively frozen manifest", () => {
    const manifest = validManifest();

    const result = parseBasicRawCaptureManifestV2(
      JSON.parse(JSON.stringify(manifest)) as unknown,
    );

    expect(result).toEqual(manifest);
    expect(result).not.toBe(manifest);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.request)).toBe(true);
    expect(Object.isFrozen(result?.request.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(result?.response)).toBe(true);
    expect(Object.isFrozen(result?.response.redirectChain)).toBe(true);
  });

  test.each([
    ["v1 schema", (value: Record<string, unknown>) => ({
      ...value,
      schemaVersion: BASIC_RAW_CAPTURE_SCHEMA_VERSION,
    })],
    ["unknown schema", (value: Record<string, unknown>) => ({
      ...value,
      schemaVersion: "basic-country-raw-capture/v3",
    })],
    ["extra key", (value: Record<string, unknown>) => ({ ...value, extra: true })],
    ["missing key", (value: Record<string, unknown>) => {
      const copy = { ...value };
      delete copy.catalogSha256;
      return copy;
    }],
    ["invalid country", (value: Record<string, unknown>) => ({ ...value, countryCode: "vn" })],
    ["invalid run", (value: Record<string, unknown>) => ({ ...value, runId: "../run" })],
    ["invalid catalog version", (value: Record<string, unknown>) => ({ ...value, catalogVersion: "2026 07" })],
    ["invalid catalog digest", (value: Record<string, unknown>) => ({ ...value, catalogSha256: CATALOG_SHA256.toUpperCase() })],
    ["invalid adapter", (value: Record<string, unknown>) => ({ ...value, adapterId: "energy_csv" })],
    ["invalid adapter version", (value: Record<string, unknown>) => ({ ...value, adapterVersion: "1..0" })],
    ["invalid source", (value: Record<string, unknown>) => ({ ...value, sourceId: "energy_csv" })],
    ["non-GET request", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), method: "POST" } })],
    ["invalid Accept", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), accept: "application/xml" } })],
    ["unsafe origin", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), allowedOrigins: ["https://data.example/path"] } })],
    ["unsafe query name", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), allowedQueryParameters: ["bad%20name"] } })],
    ["non-finite status", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), status: Number.NaN } })],
    ["bad final URL", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), finalUrl: SENTINEL } })],
    ["bad timestamp", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), retrievedAt: "not-a-time" } })],
    ["negative byte count", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), byteLength: -1 } })],
    ["oversized byte count", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), byteLength: BASIC_RAW_CAPTURE_MAX_BYTES_V2 + 1 } })],
    ["bad content digest", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), contentSha256: SHA256.toUpperCase() } })],
  ])("rejects a manifest with %s", (_label, mutate) => {
    expect(parseBasicRawCaptureManifestV2(mutate(validManifest()))).toBeNull();
  });

  test.each(["symbol", "accessor", "proxy"] as const)(
    "rejects a manifest with a %s shape violation",
    (kind) => {
      const probe = { executions: 0 };
      expect(parseBasicRawCaptureManifestV2(
        unsafeRecord(validManifest(), kind, probe),
      )).toBeNull();
      expect(probe.executions).toBe(0);
    },
  );

  test("rejects cyclic, sparse, oversized, and deeply nested manifest values", () => {
    const cyclic = validManifest();
    (cyclic.request as Record<string, unknown>).allowedOrigins = [cyclic];
    const sparse = validManifest();
    (sparse.response as Record<string, unknown>).redirectChain = new Array(1);
    const oversized = validManifest();
    (oversized.request as Record<string, unknown>).allowedQueryParameters =
      Array.from({ length: 257 }, (_, index) => `q${index}`);
    const deep = validManifest();
    let child: Record<string, unknown> = deep;
    for (let index = 0; index < 65; index += 1) {
      child.extra = {};
      child = child.extra as Record<string, unknown>;
    }

    expect(parseBasicRawCaptureManifestV2(cyclic)).toBeNull();
    expect(parseBasicRawCaptureManifestV2(sparse)).toBeNull();
    expect(parseBasicRawCaptureManifestV2(oversized)).toBeNull();
    expect(parseBasicRawCaptureManifestV2(deep)).toBeNull();
  });

  test("keeps v1 and v2 manifest parsers mutually exclusive", () => {
    const v2 = validManifest();
    const v1 = {
      schemaVersion: BASIC_RAW_CAPTURE_SCHEMA_VERSION,
      countryCode: v2.countryCode,
      runId: v2.runId,
      adapterId: v2.adapterId,
      adapterVersion: v2.adapterVersion,
      sourceId: v2.sourceId,
      request: v2.request,
      response: v2.response,
    };

    expect(parseBasicRawCaptureManifestV2(v1)).toBeNull();
    expect(parseBasicRawCaptureManifest({
      ...v1,
      schemaVersion: BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
      catalogVersion: v2.catalogVersion,
      catalogSha256: v2.catalogSha256,
    })).toBeNull();
  });
});

describe("Basic immutable raw capture v2", () => {
  test.each([
    ["application/json", "application/json"],
    ["text/csv", "text/csv"],
    ["text/html", "text/html"],
    ["application/pdf", "application/pdf"],
  ] as const)("captures exact %s bytes with %s", async (accept, contentType) => {
    const root = repoRoot();
    const body = new Uint8Array([0, 1, 2, 127, 128, 255]);

    const result = await captureBasicRawSourceV2(
      captureInput(root, accept),
      captureTransport(body, contentType),
    );

    expect(result).toMatchObject({
      sourceId: "energy-csv",
      contentSha256: sha256(body),
      byteLength: body.byteLength,
      reused: false,
      body,
      contentType,
      redirectChain: [],
    });
    expect(readFileSync(v2PayloadPath(root, body))).toEqual(Buffer.from(body));
    expect(existsSync(v2ManifestPath(root))).toBe(true);
  });

  test("writes exact catalog-bound manifest bytes in schema order", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("country,value\nVN,42\n");
    const captureInputValue = captureInput(root, "text/csv");

    await captureBasicRawSourceV2(
      captureInputValue,
      captureTransport(body, "text/csv; charset=utf-8"),
    );

    expect(readFileSync(v2ManifestPath(root), "utf8")).toBe(JSON.stringify({
      schemaVersion: "basic-country-raw-capture/v2",
      countryCode: "VN",
      runId: "run-20260712",
      catalogVersion: "2026.07.12",
      catalogSha256: CATALOG_SHA256,
      adapterId: "energy-csv",
      adapterVersion: "1.0.0",
      sourceId: "energy-csv",
      request: {
        method: "GET",
        url: "https://data.example/v1/countries/VN?format=csv&lang=en",
        accept: "text/csv",
        allowedOrigins: ["https://data.example", "https://mirror.example"],
        allowedQueryParameters: ["format", "lang"],
      },
      response: {
        status: 200,
        finalUrl: "https://data.example/v1/countries/VN?format=csv&lang=en",
        redirectChain: [],
        contentType: "text/csv; charset=utf-8",
        retrievedAt: "2026-07-12T04:00:00.000Z",
        byteLength: body.byteLength,
        contentSha256: sha256(body),
      },
    }));
  });

  test("hashes the transfer-decoded byte stream before parsing", async () => {
    const root = repoRoot();
    const first = new Uint8Array([0, 255, 1]);
    const second = new Uint8Array([2, 3, 4]);
    const body = new Uint8Array([...first, ...second]);
    const responseValue = {
      ...captureResponse(body, "application/pdf"),
      body: (async function* streamed() {
        yield first;
        yield second;
      })(),
    };

    const result = await captureBasicRawSourceV2(
      captureInput(root, "application/pdf"),
      { async execute() { return responseValue; } },
    );

    expect(result.body).toEqual(body);
    expect(result.contentSha256).toBe(sha256(body));
  });

  test("captures an empty body", async () => {
    const root = repoRoot();
    const body = new Uint8Array();

    const result = await captureBasicRawSourceV2(
      captureInput(root, "text/html"),
      captureTransport(body, "text/html"),
    );

    expect(result).toMatchObject({
      byteLength: 0,
      contentSha256: sha256(body),
      body,
    });
  });

  test("accepts exactly 10 MiB and rejects one additional byte", async () => {
    const exact = new Uint8Array(BASIC_RAW_CAPTURE_MAX_BYTES_V2);
    const exactRoot = repoRoot();
    await expect(captureBasicRawSourceV2(
      captureInput(exactRoot),
      captureTransport(exact, "text/csv"),
    )).resolves.toMatchObject({ byteLength: BASIC_RAW_CAPTURE_MAX_BYTES_V2 });

    const oversized = new Uint8Array(BASIC_RAW_CAPTURE_MAX_BYTES_V2 + 1);
    await expect(captureBasicRawSourceV2(
      captureInput(repoRoot()),
      captureTransport(oversized, "text/csv"),
    )).rejects.toThrow("source response body exceeds the capture limit");
  });

  test("reuses a fully verified cache without calling transport", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("cached");
    await captureBasicRawSourceV2(
      captureInput(root),
      captureTransport(body, "text/csv"),
    );
    let calls = 0;

    const result = await captureBasicRawSourceV2(captureInput(root), {
      async execute() {
        calls += 1;
        throw new Error("cache reuse must not execute transport");
      },
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ reused: true, body });
    expect(Object.isFrozen(result.redirectChain)).toBe(true);
  });

  test.each([
    ["catalog version", (value: BasicRawCaptureInputV2) => ({ ...value, catalogVersion: "2026.07.13" })],
    ["catalog digest", (value: BasicRawCaptureInputV2) => ({ ...value, catalogSha256: "1".repeat(64) })],
    ["adapter version", (value: BasicRawCaptureInputV2) => ({ ...value, adapterVersion: "2.0.0" })],
    ["request URL", (value: BasicRawCaptureInputV2) => ({ ...value, request: { ...value.request, url: "https://data.example/v1/countries/VN?format=csv" } })],
    ["Accept", (value: BasicRawCaptureInputV2) => ({ ...value, request: { ...value.request, accept: "text/html" as const } })],
    ["origin order", (value: BasicRawCaptureInputV2) => ({ ...value, request: { ...value.request, allowedOrigins: [...value.request.allowedOrigins].reverse() } })],
    ["query-name order", (value: BasicRawCaptureInputV2) => ({ ...value, request: { ...value.request, allowedQueryParameters: [...value.request.allowedQueryParameters].reverse() } })],
  ] as const)("does not reuse cache after a %s change", async (_label, mutate) => {
    const root = repoRoot();
    const body = new TextEncoder().encode("identity");
    await captureBasicRawSourceV2(
      captureInput(root),
      captureTransport(body, "text/csv"),
    );
    let calls = 0;

    await expect(captureBasicRawSourceV2(
      mutate(captureInput(root)),
      {
        async execute() {
          calls += 1;
          return captureResponse(body, "text/csv");
        },
      },
    )).rejects.toThrow("raw capture manifest is invalid");
    expect(calls).toBe(0);
  });

  test("uses source ID as an isolated cache identity", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("source identity");
    await captureBasicRawSourceV2(
      captureInput(root),
      captureTransport(body, "text/csv"),
    );
    const other = {
      ...captureInput(root),
      adapterId: "other-source",
      sourceId: "other-source",
    };
    let calls = 0;

    const result = await captureBasicRawSourceV2(other, {
      async execute() {
        calls += 1;
        return captureResponse(body, "text/csv");
      },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ sourceId: "other-source", reused: false });
    expect(existsSync(v2SourceDirectory(root, "other-source"))).toBe(true);
  });

  test("does not reuse a valid v1 raw cache", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("namespace");
    await captureBasicRawSource(v1Input(root), v1Transport(body));
    let calls = 0;

    const result = await captureBasicRawSourceV2(captureInput(root), {
      async execute() {
        calls += 1;
        return captureResponse(body, "text/csv");
      },
    });

    expect(calls).toBe(1);
    expect(result.reused).toBe(false);
    expect(existsSync(v1SourceDirectory(root))).toBe(true);
    expect(existsSync(v2SourceDirectory(root))).toBe(true);
  });

  test.each([
    "payload bytes",
    "manifest digest",
    "manifest extra key",
  ] as const)("rejects tampered %s before transport", async (kind) => {
    const root = repoRoot();
    const body = new TextEncoder().encode("tamper target");
    await captureBasicRawSourceV2(
      captureInput(root),
      captureTransport(body, "text/csv"),
    );
    if (kind === "payload bytes") {
      const tampered = new Uint8Array(body);
      tampered[0] = tampered[0] === 0 ? 1 : 0;
      writeFileSync(v2PayloadPath(root, body), tampered);
    } else {
      const manifest = readV2Manifest(root);
      if (kind === "manifest digest") {
        manifest.catalogSha256 = "1".repeat(64);
      } else {
        manifest.extra = SENTINEL;
      }
      writeFileSync(v2ManifestPath(root), JSON.stringify(manifest));
    }

    await expect(captureBasicRawSourceV2(
      captureInput(root),
      captureTransport(body, "text/csv"),
    )).rejects.toThrow(/raw capture (manifest|payload) is invalid/);
  });

  test.each(["missing manifest", "wrong payload name", "extra file"] as const)(
    "rejects an incomplete cache with %s",
    async (kind) => {
      const root = repoRoot();
      const body = new TextEncoder().encode("incomplete");
      await captureBasicRawSourceV2(
        captureInput(root),
        captureTransport(body, "text/csv"),
      );
      if (kind === "missing manifest") unlinkSync(v2ManifestPath(root));
      if (kind === "wrong payload name") {
        renameSync(v2PayloadPath(root, body), join(v2SourceDirectory(root), "wrong.bin"));
      }
      if (kind === "extra file") {
        writeFileSync(join(v2SourceDirectory(root), "extra"), "extra");
      }

      await expect(captureBasicRawSourceV2(
        captureInput(root),
        captureTransport(body, "text/csv"),
      )).rejects.toThrow(/raw capture (is incomplete|payload is invalid)/);
    },
  );

  test("does not expose the final directory before atomic publication", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("atomic");
    const checking: BasicSourceTransportV2 = {
      async execute() {
        expect(existsSync(v2SourceDirectory(root))).toBe(false);
        return captureResponse(body, "text/csv");
      },
    };

    await captureBasicRawSourceV2(captureInput(root), checking);

    expect(existsSync(v2SourceDirectory(root))).toBe(true);
  });

  test("fails closed if raw-v2 becomes an external symlink during transport", async () => {
    const root = repoRoot();
    const outside = repoRoot();
    const rawDirectory = v2RawDirectory(root);
    const displacedRawDirectory = join(root, "displaced-raw-v2");
    const body = new TextEncoder().encode("path identity changed");

    await expect(captureBasicRawSourceV2(
      captureInput(root),
      {
        async execute() {
          expect(existsSync(rawDirectory)).toBe(true);
          renameSync(rawDirectory, displacedRawDirectory);
          symlinkSync(outside, rawDirectory, "dir");
          return captureResponse(body, "text/csv");
        },
      },
    )).rejects.toThrow("raw capture path is not allowed");

    expect(readdirSync(outside)).toEqual([]);
  });

  test("rejects symlinked roots and cache ancestors before transport", async () => {
    const container = repoRoot();
    const realRoot = repoRoot();
    const linkedRoot = join(container, "repo-link");
    symlinkSync(realRoot, linkedRoot);
    let calls = 0;
    const noTransport: BasicSourceTransportV2 = {
      async execute() {
        calls += 1;
        return captureResponse(new Uint8Array(), "text/csv");
      },
    };

    await expect(captureBasicRawSourceV2(
      captureInput(linkedRoot),
      noTransport,
    )).rejects.toThrow("raw capture path is not allowed");

    const root = repoRoot();
    const outside = repoRoot();
    mkdirSync(join(root, ".cache"), { recursive: true });
    symlinkSync(outside, join(root, ".cache", "basic-country"));
    await expect(captureBasicRawSourceV2(
      captureInput(root),
      noTransport,
    )).rejects.toThrow("raw capture path is not allowed");
    expect(calls).toBe(0);
  });

  test.each([
    ["country traversal", { countryCode: "../VN" }],
    ["run traversal", { runId: "../run" }],
    ["source traversal", { sourceId: "../source" }],
    ["relative root", { repoRoot: "relative" }],
  ])("rejects %s before transport", async (_label, mutation) => {
    let calls = 0;
    await expect(captureBasicRawSourceV2(
      { ...captureInput(repoRoot()), ...mutation } as BasicRawCaptureInputV2,
      {
        async execute() {
          calls += 1;
          return captureResponse(new Uint8Array(), "text/csv");
        },
      },
    )).rejects.toThrow(/raw capture (input|path) is invalid|raw capture input is invalid/);
    expect(calls).toBe(0);
  });

  test("redacts unexpected filesystem failures", async () => {
    const root = repoRoot();
    const longRunId = `r${"a".repeat(299)}`;
    let calls = 0;

    const error = await rejection(captureBasicRawSourceV2(
      { ...captureInput(root), runId: longRunId },
      {
        async execute() {
          calls += 1;
          return captureResponse(new Uint8Array(), "text/csv");
        },
      },
    ));

    expect(error.message).toBe("raw capture operation failed");
    expect(error.message).not.toContain(longRunId);
    expect(error.message).not.toContain(root);
    expect(error.stack ?? "").not.toContain(longRunId);
    expect(calls).toBe(0);
  });

  test("concurrent equal content converges on one immutable capture", async () => {
    const root = repoRoot();
    const body = new TextEncoder().encode("same");

    const results = await Promise.all([
      captureBasicRawSourceV2(captureInput(root), captureTransport(body, "text/csv")),
      captureBasicRawSourceV2(captureInput(root), captureTransport(body, "text/csv")),
    ]);

    expect(results.map(({ contentSha256 }) => contentSha256)).toEqual([
      sha256(body),
      sha256(body),
    ]);
  });

  test("concurrent different content rejects the losing publication", async () => {
    const root = repoRoot();
    const first = new TextEncoder().encode("first");
    const second = new TextEncoder().encode("second");

    const results = await Promise.allSettled([
      captureBasicRawSourceV2(captureInput(root), captureTransport(first, "text/csv")),
      captureBasicRawSourceV2(captureInput(root), captureTransport(second, "text/csv")),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  test.each([
    ["status", { status: 500 }],
    ["final URL", { finalUrl: "https://other.example/private?token=SECRET" }],
    ["MIME", { contentType: "text/html" }],
    ["timestamp", { retrievedAt: "not-a-time" }],
  ])("rejects a bad response %s", async (_label, mutation) => {
    const body = new TextEncoder().encode("response");
    await expect(captureBasicRawSourceV2(
      captureInput(repoRoot()),
      {
        async execute() {
          return { ...captureResponse(body, "text/csv"), ...mutation };
        },
      },
    )).rejects.toThrow("raw capture response is invalid");
  });

  test("redacts transport and body iterator failures", async () => {
    const root = repoRoot();
    const transportFailure = await rejection(captureBasicRawSourceV2(
      captureInput(root),
      {
        async execute() {
          throw new Error(`https://data.example/?token=${SENTINEL}`);
        },
      },
    ));
    const bodyFailure = await rejection(captureBasicRawSourceV2(
      captureInput(repoRoot()),
      {
        async execute() {
          return {
            ...captureResponse(new Uint8Array(), "text/csv"),
            body: (async function* body() {
              throw new Error(`https://data.example/?token=${SENTINEL}`);
            })(),
          };
        },
      },
    ));

    expect(transportFailure.message).toBe("raw capture transport failed");
    expect(bodyFailure.message).toBe("source response body read failed");
    expect(transportFailure.message).not.toContain(SENTINEL);
    expect(bodyFailure.message).not.toContain(SENTINEL);
  });
});

function repoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "basic-raw-v2-metadata-"));
  roots.add(root);
  return root;
}

function input(root: string): BasicRawCaptureInputV2 {
  return {
    repoRoot: root,
    countryCode: "VN",
    runId: "run-20260712",
    catalogVersion: "2026.07.12",
    catalogSha256: CATALOG_SHA256,
    adapterId: "energy-csv",
    adapterVersion: "1.0.0",
    sourceId: "energy-csv",
    request: {
      method: "GET",
      url: "https://data.example/v1/countries/VN?format=csv&lang=en",
      accept: "text/csv",
      allowedOrigins: ["https://data.example", "https://mirror.example"],
      allowedQueryParameters: ["format", "lang"],
    },
  };
}

function response(): BasicSourceTransportResponseV2 {
  return {
    status: 200,
    finalUrl: "https://data.example/v1/countries/VN?format=csv&lang=en",
    contentType: "text/csv; charset=utf-8",
    retrievedAt: "2026-07-12T04:00:00.000Z",
    redirectChain: [],
    body: (async function* body() {})(),
  };
}

function validManifest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createBasicRawCaptureManifestV2(
    input(repoRoot()),
    response(),
    SHA256,
    17,
  ))) as Record<string, unknown>;
}

function unsafeRecord(
  source: object,
  kind: "extra" | "missing" | "symbol" | "accessor" | "proxy",
  probe: { executions: number },
): unknown {
  const value: Record<PropertyKey, unknown> = { ...source };
  if (kind === "extra") value.extra = SENTINEL;
  if (kind === "missing") delete value.countryCode;
  if (kind === "symbol") value[Symbol("extra")] = SENTINEL;
  if (kind === "accessor") {
    Object.defineProperty(value, "countryCode", {
      enumerable: true,
      get() {
        probe.executions += 1;
        throw new Error(SENTINEL);
      },
    });
  }
  return kind === "proxy" ? new Proxy(value, {}) : value;
}

function captureInput(
  root: string,
  accept: BasicRawCaptureInputV2["request"]["accept"] = "text/csv",
): BasicRawCaptureInputV2 {
  const format = {
    "application/json": "json",
    "text/csv": "csv",
    "text/html": "html",
    "application/pdf": "pdf",
  }[accept];
  return {
    ...input(root),
    request: {
      ...input(root).request,
      url: `https://data.example/v1/countries/VN?format=${format}&lang=en`,
      accept,
    },
  };
}

function captureResponse(
  body: Uint8Array,
  contentType: string,
): BasicSourceTransportResponseV2 {
  const format = contentType.toLowerCase().includes("json")
    ? "json"
    : contentType.toLowerCase().includes("html")
      ? "html"
      : contentType.toLowerCase().includes("pdf")
        ? "pdf"
        : "csv";
  return {
    status: 200,
    finalUrl: `https://data.example/v1/countries/VN?format=${format}&lang=en`,
    contentType,
    retrievedAt: "2026-07-12T04:00:00.000Z",
    redirectChain: [],
    body: chunks(body),
  };
}

function captureTransport(
  body: Uint8Array,
  contentType: string,
): BasicSourceTransportV2 {
  return { async execute() { return captureResponse(body, contentType); } };
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield body;
}

function v2SourceDirectory(root: string, sourceId = "energy-csv"): string {
  return join(v2RawDirectory(root), sourceId);
}

function v2RawDirectory(root: string): string {
  return join(
    root,
    ".cache",
    "basic-country",
    "VN",
    "run-20260712",
    "raw-v2",
  );
}

function v2ManifestPath(root: string): string {
  return join(v2SourceDirectory(root), "capture.json");
}

function v2PayloadPath(root: string, body: Uint8Array): string {
  return join(v2SourceDirectory(root), `${sha256(body)}.bin`);
}

function readV2Manifest(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(v2ManifestPath(root), "utf8")) as Record<
    string,
    unknown
  >;
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function v1Input(root: string): BasicRawCaptureInput {
  return {
    repoRoot: root,
    countryCode: "VN",
    runId: "run-20260712",
    adapterId: "world-bank-country",
    adapterVersion: "1.0.0",
    sourceId: "world-bank-country",
    request: {
      method: "GET",
      url: "https://api.worldbank.org/v2/country/VN?format=json",
      accept: "application/json",
      allowedOrigins: ["https://api.worldbank.org"],
      allowedQueryParameters: ["format"],
    },
  };
}

function v1Transport(body: Uint8Array): BasicSourceTransport {
  return {
    async execute(): Promise<BasicSourceTransportResponse> {
      return {
        status: 200,
        finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
        contentType: "application/json",
        retrievedAt: "2026-07-12T04:00:00.000Z",
        redirectChain: [],
        body: chunks(body),
      };
    },
  };
}

function v1SourceDirectory(root: string): string {
  return join(
    root,
    ".cache",
    "basic-country",
    "VN",
    "run-20260712",
    "raw",
    "world-bank-country",
  );
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected promise to reject");
}
