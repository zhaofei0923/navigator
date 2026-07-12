import { mkdtempSync, rmSync } from "node:fs";
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
  BASIC_RAW_CAPTURE_MAX_BYTES_V2,
  BASIC_RAW_CAPTURE_V2_SCHEMA_VERSION,
  type BasicRawCaptureInputV2,
  type BasicSourceTransportResponseV2,
} from "./collection/basic-source-v2-contracts.js";
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
