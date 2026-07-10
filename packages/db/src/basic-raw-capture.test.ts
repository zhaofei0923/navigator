import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  captureBasicRawSource,
  type BasicRawCaptureInput,
} from "./collection/basic-raw-capture.js";
import type {
  BasicSourceTransport,
  BasicSourceTransportResponse,
} from "./collection/basic-source-adapter-contracts.js";

const temporaryRoots = new Set<string>();
const BODY = new TextEncoder().encode('{"value":1234}');
const CONTENT_SHA256 =
  "07a9415d68c1cc231402a4b0c4a01aa291945f4a25dc1ffb228a697346c88d4b";

afterEach(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  temporaryRoots.clear();
});

describe("Basic immutable raw capture", () => {
  test("captures exact streamed bytes with their SHA-256", async () => {
    const repoRoot = createRepoRoot();
    const receipt = await captureBasicRawSource(
      input(repoRoot),
      transport(BODY),
    );

    expect(receipt).toMatchObject({
      sourceId: "world-bank-country",
      contentSha256: CONTENT_SHA256,
      byteLength: BODY.byteLength,
      reused: false,
      body: BODY,
    });
    expect(readFileSync(payloadPath(repoRoot))).toEqual(Buffer.from(BODY));
    expect(readManifest(repoRoot)).toEqual({
      schemaVersion: "basic-country-raw-capture/v1",
      countryCode: "VN",
      runId: "run-20260710",
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
      response: {
        status: 200,
        finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
        redirectChain: [],
        contentType: "application/json",
        retrievedAt: "2026-07-10T09:40:00.000Z",
        byteLength: BODY.byteLength,
        contentSha256: CONTENT_SHA256,
      },
    });
  });

  test("rejects a body one byte over the stream limit", async () => {
    const repoRoot = createRepoRoot();
    const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);

    await expect(
      captureBasicRawSource(input(repoRoot), transport(tooLarge)),
    ).rejects.toThrow("source response body exceeds the capture limit");
  });

  test("reuses a verified cache without calling the transport", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    const failingTransport: BasicSourceTransport = {
      async execute() {
        throw new Error("transport must not be called");
      },
    };

    const receipt = await captureBasicRawSource(input(repoRoot), failingTransport);

    expect(receipt).toMatchObject({
      contentSha256: CONTENT_SHA256,
      reused: true,
      body: BODY,
    });
  });

  test("rejects a one-byte cache payload tamper before transport", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    const tampered = new Uint8Array(BODY);
    tampered[0] = tampered[0] === 0 ? 1 : 0;
    writeFileSync(payloadPath(repoRoot), tampered);

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow("raw capture payload is invalid");
  });

  test.each([
    ["countryCode", "../VN"],
    ["runId", "../run"],
    ["sourceId", "WORLD_BANK"],
  ] as const)("rejects unsafe %s before transport", async (key, value) => {
    const repoRoot = createRepoRoot();
    let calls = 0;
    const noNetwork: BasicSourceTransport = {
      async execute() {
        calls += 1;
        return response(BODY);
      },
    };
    const captureInput = { ...input(repoRoot), [key]: value };

    await expect(captureBasicRawSource(captureInput, noNetwork)).rejects.toThrow(
      "raw capture path is not allowed",
    );
    expect(calls).toBe(0);
  });

  test("rejects a symlinked raw-cache ancestor before transport", async () => {
    const repoRoot = createRepoRoot();
    const outside = createRepoRoot();
    mkdirSync(join(repoRoot, ".cache"), { recursive: true });
    symlinkSync(outside, join(repoRoot, ".cache", "basic-country"));

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow("raw capture path is not allowed");
  });

  test("does not overwrite an immutable identity with mismatched adapter metadata", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    const different = new TextEncoder().encode('{"value":9999}');

    await expect(
      captureBasicRawSource(
        { ...input(repoRoot), adapterVersion: "2.0.0" },
        transport(different),
      ),
    ).rejects.toThrow("raw capture manifest is invalid");
    expect(readFileSync(payloadPath(repoRoot))).toEqual(Buffer.from(BODY));
  });

  test("rejects malformed manifest keys", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    writeManifest(repoRoot, { ...readManifest(repoRoot), unexpected: true });

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow("raw capture manifest is invalid");
  });

  test.each([
    ["adapter ID", (value: Record<string, unknown>) => ({ ...value, adapterId: "other" })],
    ["adapter version", (value: Record<string, unknown>) => ({ ...value, adapterVersion: "2.0.0" })],
    ["request URL", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), url: "https://api.worldbank.org/v2/country/ID?format=json" } })],
    ["Accept value", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), accept: "application/problem+json" } })],
    ["origin allowlist", (value: Record<string, unknown>) => ({ ...value, request: { ...(value.request as object), allowedOrigins: ["https://other.example"] } })],
    ["final URL", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), finalUrl: "https://api.worldbank.org/other?format=json" } })],
    ["redirect chain", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), redirectChain: ["https://api.worldbank.org/redirect?format=json"] } })],
    ["status", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), status: 500 } })],
    ["MIME", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), contentType: "text/html" } })],
    ["byte count", (value: Record<string, unknown>) => ({ ...value, response: { ...(value.response as object), byteLength: BODY.byteLength + 1 } })],
  ])("rejects a cache %s mismatch", async (_label, mutate) => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    writeManifest(repoRoot, mutate(readManifest(repoRoot)));

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow(/raw capture (manifest|payload) is invalid/);
  });

  test("rejects a payload filename mismatch", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    renameSync(payloadPath(repoRoot), join(sourceDirectory(repoRoot), "wrong.bin"));

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow("raw capture payload is invalid");
  });

  test("rejects a final payload without its manifest", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    unlinkSync(join(sourceDirectory(repoRoot), "capture.json"));

    await expect(
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ).rejects.toThrow("raw capture is incomplete");
  });

  test("ignores orphan temporary files", async () => {
    const repoRoot = createRepoRoot();
    mkdirSync(sourceDirectory(repoRoot), { recursive: true });
    writeFileSync(join(sourceDirectory(repoRoot), ".tmp-orphan"), "partial");

    await expect(captureBasicRawSource(input(repoRoot), transport(BODY))).resolves.toMatchObject({
      reused: false,
      contentSha256: CONTENT_SHA256,
    });
  });

  test("concurrent identical captures converge on one immutable capture", async () => {
    const repoRoot = createRepoRoot();
    const [first, second] = await Promise.all([
      captureBasicRawSource(input(repoRoot), transport(BODY)),
      captureBasicRawSource(input(repoRoot), transport(BODY)),
    ]);

    expect([first.contentSha256, second.contentSha256]).toEqual([
      CONTENT_SHA256,
      CONTENT_SHA256,
    ]);
    expect(existsSync(payloadPath(repoRoot))).toBe(true);
  });

  test("concurrent differing captures reject the losing payload", async () => {
    const repoRoot = createRepoRoot();
    const different = new TextEncoder().encode('{"value":9999}');
    const results = await Promise.allSettled([
      captureBasicRawSource(input(repoRoot), transport(BODY)),
      captureBasicRawSource(input(repoRoot), transport(different)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});

function input(repoRoot: string): BasicRawCaptureInput {
  return {
    repoRoot,
    countryCode: "VN",
    runId: "run-20260710",
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

function transport(body: Uint8Array): BasicSourceTransport {
  return { async execute() { return response(body); } };
}

function response(body: Uint8Array): BasicSourceTransportResponse {
  return {
    status: 200,
    finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
    contentType: "application/json",
    retrievedAt: "2026-07-10T09:40:00.000Z",
    redirectChain: [],
    body: chunks(body),
  };
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield body;
}

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "basic-raw-capture-"));
  temporaryRoots.add(root);
  return root;
}

function sourceDirectory(repoRoot: string): string {
  return join(repoRoot, ".cache", "basic-country", "VN", "run-20260710", "raw", "world-bank-country");
}

function payloadPath(repoRoot: string): string {
  return join(sourceDirectory(repoRoot), `${CONTENT_SHA256}.bin`);
}

function readManifest(repoRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sourceDirectory(repoRoot), "capture.json"), "utf8")) as Record<string, unknown>;
}

function writeManifest(repoRoot: string, manifest: unknown): void {
  writeFileSync(join(sourceDirectory(repoRoot), "capture.json"), JSON.stringify(manifest));
}
