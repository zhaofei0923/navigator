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
const METADATA_SENTINEL = "RAW_METADATA_DO_NOT_LEAK_1f2a";
const TRANSPORT_FAILURE_SENTINEL =
  "https://api.worldbank.org/private?token=TRANSPORT_SECRET_DO_NOT_LEAK";

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
      redirectChain: [],
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

  test("returns fresh frozen redirect provenance for new and cached captures", async () => {
    const repoRoot = createRepoRoot();
    const originalUrl = "https://api.worldbank.org/v2/country/VN?format=json";
    const redirectChain = [
      "https://api.worldbank.org/v2/country/VN/redirect?format=json",
      originalUrl,
    ];
    const first = await captureBasicRawSource(input(repoRoot), {
      async execute() {
        return { ...response(BODY), finalUrl: originalUrl, redirectChain };
      },
    });

    expect(first.redirectChain).toEqual(redirectChain);
    expect(first.redirectChain).not.toBe(redirectChain);
    expect(Object.isFrozen(first.redirectChain)).toBe(true);
    redirectChain[0] = "https://api.worldbank.org/mutated?format=json";
    expect(first.redirectChain).toEqual([
      "https://api.worldbank.org/v2/country/VN/redirect?format=json",
      originalUrl,
    ]);
    expect(Object.getOwnPropertyDescriptor(first, "redirectChain")).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false,
    });
    expect(Reflect.set(first, "redirectChain", [])).toBe(false);
    expect(first.redirectChain).toEqual([
      "https://api.worldbank.org/v2/country/VN/redirect?format=json",
      originalUrl,
    ]);
    const mutatedUrl = "https://api.worldbank.org/mutated?format=json";
    expect(() => { first.finalUrl = mutatedUrl; }).not.toThrow();
    expect(first.finalUrl).toBe(mutatedUrl);

    const cached = await captureBasicRawSource(input(repoRoot), {
      async execute() {
        throw new Error("cache reuse must not fetch");
      },
    });

    expect(cached).toMatchObject({ reused: true, finalUrl: originalUrl, redirectChain: first.redirectChain });
    expect(cached.redirectChain).not.toBe(first.redirectChain);
    expect(Object.isFrozen(cached.redirectChain)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(cached, "redirectChain")).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false,
    });
    expect(Reflect.set(cached, "redirectChain", [])).toBe(false);
    expect(cached.redirectChain).toEqual([
      "https://api.worldbank.org/v2/country/VN/redirect?format=json",
      originalUrl,
    ]);
    const cachedMutatedUrl = "https://api.worldbank.org/cached-mutated?format=json";
    expect(() => { cached.finalUrl = cachedMutatedUrl; }).not.toThrow();
    expect(cached.finalUrl).toBe(cachedMutatedUrl);
  });

  test("does not expose the final source directory before complete publication", async () => {
    const repoRoot = createRepoRoot();
    const checkingTransport: BasicSourceTransport = {
      async execute() {
        expect(existsSync(sourceDirectory(repoRoot))).toBe(false);
        return response(BODY);
      },
    };

    await expect(
      captureBasicRawSource(input(repoRoot), checkingTransport),
    ).resolves.toMatchObject({ contentSha256: CONTENT_SHA256 });
    expect(existsSync(sourceDirectory(repoRoot))).toBe(true);
  });

  test("snapshots and freezes capture input before transport awaits", async () => {
    const repoRoot = createRepoRoot();
    const captureInput = input(repoRoot);
    const mutatingTransport: BasicSourceTransport = {
      async execute(request) {
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.allowedOrigins)).toBe(true);
        expect(Object.isFrozen(request.allowedQueryParameters)).toBe(true);
        captureInput.countryCode = "ID";
        captureInput.adapterId = METADATA_SENTINEL;
        captureInput.request.url =
          `https://mutated.example/${METADATA_SENTINEL}`;
        (captureInput.request.allowedOrigins as string[])[0] =
          "https://mutated.example";
        return response(BODY);
      },
    };

    const result = await captureBasicRawSource(captureInput, mutatingTransport);

    expect(result.finalUrl).toBe(
      "https://api.worldbank.org/v2/country/VN?format=json",
    );
    expect(JSON.stringify(readManifest(repoRoot))).not.toContain(
      METADATA_SENTINEL,
    );
    expect(readManifest(repoRoot)).toMatchObject({
      countryCode: "VN",
      adapterId: "world-bank-country",
      request: {
        url: "https://api.worldbank.org/v2/country/VN?format=json",
        allowedOrigins: ["https://api.worldbank.org"],
      },
    });
  });

  test("snapshots transport response metadata before body collection awaits", async () => {
    const repoRoot = createRepoRoot();
    const mutableResponse = response(BODY) as BasicSourceTransportResponse & {
      redirectChain: string[];
    };
    mutableResponse.redirectChain = [];
    mutableResponse.body = (async function* mutateAfterYield() {
      yield BODY;
      mutableResponse.finalUrl =
        `https://api.worldbank.org/${METADATA_SENTINEL}?format=json`;
      mutableResponse.contentType = METADATA_SENTINEL;
      mutableResponse.retrievedAt = "not-a-timestamp";
      mutableResponse.redirectChain.push(
        `https://api.worldbank.org/${METADATA_SENTINEL}?format=json`,
      );
    })();
    const mutatingTransport: BasicSourceTransport = {
      async execute() {
        return mutableResponse;
      },
    };

    const result = await captureBasicRawSource(
      input(repoRoot),
      mutatingTransport,
    );

    expect(result).toMatchObject({
      finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
      contentType: "application/json",
      retrievedAt: "2026-07-10T09:40:00.000Z",
      redirectChain: [],
    });
    expect(JSON.stringify(readManifest(repoRoot))).not.toContain(
      METADATA_SENTINEL,
    );
    expect(readManifest(repoRoot).response).toMatchObject({
      finalUrl: "https://api.worldbank.org/v2/country/VN?format=json",
      redirectChain: [],
      contentType: "application/json",
      retrievedAt: "2026-07-10T09:40:00.000Z",
    });
  });

  test.each(["extra key", "symbol key", "accessor key"] as const)(
    "rejects a transport response with an %s without executing accessors",
    async (kind) => {
      const repoRoot = createRepoRoot();
      const probe = { executions: 0 };
      const invalidTransport: BasicSourceTransport = {
        async execute() {
          return unsafeResponse(kind, probe);
        },
      };

      const error = await rejectWith(
        captureBasicRawSource(input(repoRoot), invalidTransport),
      );

      expect(error.message).toBe("raw capture response is invalid");
      expect(error.message).not.toContain(METADATA_SENTINEL);
      expect(probe.executions).toBe(0);
    },
  );

  test.each(["sparse", "extra property", "custom prototype"] as const)(
    "rejects a transport response with a %s redirect chain",
    async (kind) => {
      const repoRoot = createRepoRoot();
      const invalidResponse = response(BODY) as BasicSourceTransportResponse & {
        redirectChain: string[];
      };
      invalidResponse.redirectChain = unsafeRedirectChain(kind);
      const invalidTransport: BasicSourceTransport = {
        async execute() {
          return invalidResponse;
        },
      };

      await expect(
        captureBasicRawSource(input(repoRoot), invalidTransport),
      ).rejects.toThrow("raw capture response is invalid");
    },
  );

  test("rejects a non-strict transport retrievedAt timestamp", async () => {
    const repoRoot = createRepoRoot();
    const invalidTransport: BasicSourceTransport = {
      async execute() {
        return {
          ...response(BODY),
          retrievedAt: "2026-07-10T09:40:00+00:00",
        };
      },
    };

    await expect(
      captureBasicRawSource(input(repoRoot), invalidTransport),
    ).rejects.toThrow("raw capture response is invalid");
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

  test("does not reuse a raw-v2 namespace as the v1 cache", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    const v2Directory = join(
      repoRoot,
      ".cache",
      "basic-country",
      "VN",
      "run-20260710",
      "raw-v2",
    );
    renameSync(rawDirectory(repoRoot), v2Directory);
    let calls = 0;

    const result = await captureBasicRawSource(input(repoRoot), {
      async execute() {
        calls += 1;
        return response(BODY);
      },
    });

    expect(calls).toBe(1);
    expect(result.reused).toBe(false);
    expect(existsSync(v2Directory)).toBe(true);
    expect(existsSync(rawDirectory(repoRoot))).toBe(true);
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
    ["countryCode", " VN "],
    ["runId", "../run"],
    ["runId", " run-20260710 "],
    ["sourceId", "WORLD_BANK"],
    ["sourceId", " world-bank-country "],
    ["adapterId", " world-bank-country "],
    ["adapterVersion", " 1.0.0 "],
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

  test("rejects a symlinked repo root before transport", async () => {
    const container = createRepoRoot();
    const realRepoRoot = createRepoRoot();
    const linkedRepoRoot = join(container, "repo-link");
    symlinkSync(realRepoRoot, linkedRepoRoot);
    let calls = 0;
    const noNetwork: BasicSourceTransport = {
      async execute() {
        calls += 1;
        return response(BODY);
      },
    };

    await expect(
      captureBasicRawSource(input(linkedRepoRoot), noNetwork),
    ).rejects.toThrow("raw capture path is not allowed");
    expect(calls).toBe(0);
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

  test("rejects an invalid cached retrievedAt before transport", async () => {
    const repoRoot = createRepoRoot();
    await captureBasicRawSource(input(repoRoot), transport(BODY));
    const manifest = readManifest(repoRoot);
    writeManifest(repoRoot, {
      ...manifest,
      response: {
        ...(manifest.response as object),
        retrievedAt: "2026-07-10T09:40:00+00:00",
      },
    });
    let calls = 0;
    const noTransport: BasicSourceTransport = {
      async execute() {
        calls += 1;
        return response(BODY);
      },
    };

    await expect(
      captureBasicRawSource(input(repoRoot), noTransport),
    ).rejects.toThrow("raw capture manifest is invalid");
    expect(calls).toBe(0);
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

  test("ignores an orphan sibling temp directory after a simulated crash", async () => {
    const repoRoot = createRepoRoot();
    const orphanDirectory = join(
      rawDirectory(repoRoot),
      ".tmp-world-bank-country-orphan",
    );
    mkdirSync(orphanDirectory, { recursive: true });
    writeFileSync(join(orphanDirectory, "partial.bin"), "partial");

    await expect(captureBasicRawSource(input(repoRoot), transport(BODY))).resolves.toMatchObject({
      reused: false,
      contentSha256: CONTENT_SHA256,
    });
    expect(existsSync(orphanDirectory)).toBe(true);
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

  test("redacts injected transport execution failures at the capture boundary", async () => {
    const repoRoot = createRepoRoot();
    const leakingTransport: BasicSourceTransport = {
      async execute() {
        throw new Error(
          `${TRANSPORT_FAILURE_SENTINEL} ${METADATA_SENTINEL}`,
        );
      },
    };

    const error = await rejectWith(
      captureBasicRawSource(input(repoRoot), leakingTransport),
    );

    expect(error.message).toBe("raw capture transport failed");
    expect(error.message).not.toContain(TRANSPORT_FAILURE_SENTINEL);
    expect(error.message).not.toContain(METADATA_SENTINEL);
    expect(error.stack ?? "").not.toContain(TRANSPORT_FAILURE_SENTINEL);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  test("redacts injected response body iterator failures", async () => {
    const repoRoot = createRepoRoot();
    const leakingTransport: BasicSourceTransport = {
      async execute() {
        return {
          ...response(BODY),
          body: leakingChunks(),
        };
      },
    };

    const error = await rejectWith(
      captureBasicRawSource(input(repoRoot), leakingTransport),
    );

    expect(error.message).toBe("source response body read failed");
    expect(error.message).not.toMatch(/RAW_BODY_DO_NOT_LEAK|worldbank/);
  });

  test.each([Number.NaN, 200.5])(
    "rejects invalid transport response status %s",
    async (status) => {
      const repoRoot = createRepoRoot();
      const invalidTransport: BasicSourceTransport = {
        async execute() {
          return { ...response(BODY), status };
        },
      };

      await expect(
        captureBasicRawSource(input(repoRoot), invalidTransport),
      ).rejects.toThrow("raw capture response is invalid");
    },
  );

  test("accepts canonical trailing-slash equivalence and preserves source URL", async () => {
    const repoRoot = createRepoRoot();
    const captureInput = input(repoRoot);
    captureInput.request = {
      ...captureInput.request,
      url: "https://api.worldbank.org",
      allowedQueryParameters: [],
    };
    const normalizedTransport: BasicSourceTransport = {
      async execute() {
        return {
          ...response(BODY),
          finalUrl: "https://api.worldbank.org/",
        };
      },
    };

    await expect(
      captureBasicRawSource(captureInput, normalizedTransport),
    ).resolves.toMatchObject({ finalUrl: "https://api.worldbank.org/" });
    expect(
      (readManifest(repoRoot).request as Record<string, unknown>).url,
    ).toBe("https://api.worldbank.org");
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

function unsafeResponse(
  kind: "extra key" | "symbol key" | "accessor key",
  probe: { executions: number },
): BasicSourceTransportResponse {
  const result: Record<PropertyKey, unknown> = response(BODY) as unknown as Record<
    PropertyKey,
    unknown
  >;
  const property =
    kind === "extra key"
      ? "unexpected"
      : kind === "symbol key"
        ? Symbol("unexpected")
        : "finalUrl";
  Object.defineProperty(result, property, {
    configurable: true,
    enumerable: true,
    ...(kind === "extra key"
      ? { value: METADATA_SENTINEL, writable: true }
      : {
          get() {
            probe.executions += 1;
            throw new Error(METADATA_SENTINEL);
          },
        }),
  });
  return result as unknown as BasicSourceTransportResponse;
}

function unsafeRedirectChain(
  kind: "sparse" | "extra property" | "custom prototype",
): string[] {
  if (kind === "sparse") {
    return new Array<string>(1);
  }
  const result: string[] = [];
  if (kind === "extra property") {
    Object.defineProperty(result, "unexpected", {
      enumerable: true,
      value: METADATA_SENTINEL,
    });
    return result;
  }
  Object.setPrototypeOf(result, Object.create(Array.prototype));
  return result;
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield body;
}

async function* leakingChunks(): AsyncIterable<Uint8Array> {
  throw new Error(
    "https://api.worldbank.org/?secret=RAW_BODY_DO_NOT_LEAK",
  );
}

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "basic-raw-capture-"));
  temporaryRoots.add(root);
  return root;
}

function sourceDirectory(repoRoot: string): string {
  return join(repoRoot, ".cache", "basic-country", "VN", "run-20260710", "raw", "world-bank-country");
}

function rawDirectory(repoRoot: string): string {
  return join(repoRoot, ".cache", "basic-country", "VN", "run-20260710", "raw");
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

async function rejectWith(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected promise to reject");
}
