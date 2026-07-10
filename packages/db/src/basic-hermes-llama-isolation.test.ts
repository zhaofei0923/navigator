import { createHash } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";

const ioSentinels = vi.hoisted(() => ({
  appendFile: vi.fn(),
  appendFileSync: vi.fn(),
  createConnection: vi.fn(),
  createWriteStream: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  writeFile: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal(),
  appendFile: ioSentinels.appendFile,
  appendFileSync: ioSentinels.appendFileSync,
  createWriteStream: ioSentinels.createWriteStream,
  writeFile: ioSentinels.writeFile,
  writeFileSync: ioSentinels.writeFileSync,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal(),
  exec: ioSentinels.exec,
  execFile: ioSentinels.execFile,
  spawn: ioSentinels.spawn,
  spawnSync: ioSentinels.spawnSync,
}));
vi.mock("node:http", async (importOriginal) => ({
  ...await importOriginal(),
  request: ioSentinels.httpRequest,
}));
vi.mock("node:https", async (importOriginal) => ({
  ...await importOriginal(),
  request: ioSentinels.httpsRequest,
}));
vi.mock("node:net", async (importOriginal) => ({
  ...await importOriginal(),
  connect: ioSentinels.createConnection,
  createConnection: ioSentinels.createConnection,
}));

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
  bridgeBasicMarketOverviewDraft,
  createBasicLlamaCppDraftTransport,
  promoteBasicHermesJsonEvidence,
  runBasicHermesDiscovery,
  type BasicLlamaCppDraftRequest,
  type BasicLlamaCppFetchResponse,
} from "./index.js";

const TITLE_SENTINEL = "SEARXNG_TITLE_SENTINEL";
const SNIPPET_SENTINEL = "SEARXNG_SNIPPET_SENTINEL";
const RAW_BODY_SENTINEL = "RAW_CAPTURE_BODY_SENTINEL";
const PROVIDER_EXTRAS_SENTINEL = "PROVIDER_EXTRAS_SENTINEL";
const REPO_PATH_SENTINEL = "/repo/P1-6C-SENTINEL";
const CACHE_PATH_SENTINEL = ".cache/basic-country/P1-6C-SENTINEL";
const STAGING_PATH_SENTINEL = "data/staging/P1-6C-SENTINEL";
const CANONICAL_SENTINEL = "CANONICAL_SENTINEL";
const MANIFEST_SENTINEL = "MANIFEST_SENTINEL";
const KNOWLEDGE_SENTINEL = "KNOWLEDGE_SENTINEL";
const AI_SENTINEL = "AI_SENTINEL";
const RUN_ID = "run-isolation-1";
const COUNTRY_CODE = "ID";
const SOURCE_URL = "https://example.com/data?format=json";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("P1-6C Hermes and llama bridge isolation", () => {
  test("promotes only sanitized evidence after injected Hermes discovery without retaining caller values", async () => {
    const sentinels = installNoLiveIoSentinels();
    const rawBody = new TextEncoder().encode(JSON.stringify({
      facts: [{ value: 42 }],
      raw: RAW_BODY_SENTINEL,
    }));
    const providerDiscovery = discoveryEnvelope();
    const discoveryResult = await runBasicHermesDiscovery({
      countryCode: COUNTRY_CODE,
      runId: RUN_ID,
      queries: ["Indonesia solar policy"],
      maxResults: 10,
    }, {
      async discover() {
        return providerDiscovery;
      },
    });

    expect(discoveryResult).toMatchObject({ ok: true });
    if (!discoveryResult.ok) throw new Error("injected Hermes discovery must succeed");

    const policy = reviewedPolicy();
    const promotionInput = {
      base: baseAdapterResult(),
      discovery: discoveryResult.data,
      openedSources: [{
        discoveryId: "candidate-1",
        policy,
        capture: {
          sourceId: "hermes-source",
          contentSha256: sha256(rawBody),
          byteLength: rawBody.byteLength,
          reused: false,
          body: rawBody,
          finalUrl: SOURCE_URL,
          contentType: "application/json",
          retrievedAt: "2026-07-10T09:45:00.000Z",
        },
        observations: [{
          fieldPath: "marketOverview.population",
          locator: "json:/facts/0/value",
          rawValue: 42,
          normalizedValue: 42,
          unit: "people",
          year: 2025,
          uncertainty: null,
        }],
      }],
    };

    const result = promoteBasicHermesJsonEvidence(promotionInput);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("fixture-shaped evidence promotion must succeed");
    const serialized = JSON.stringify(result);

    policy.sourceName = "mutated caller policy";
    rawBody.fill(0);
    providerDiscovery.candidates[0]!.title = "mutated provider title";

    expect(JSON.stringify(result)).toBe(serialized);
    expectNoBridgeSecrets(serialized);
    expectNoLiveIo(sentinels);
  });

  test("serializes grounded draft success and failure without provider extras or mutable caller values", async () => {
    const sentinels = installNoLiveIoSentinels();
    const fixture = createBasicCollectionAuditFixture();
    const sourceRegister = structuredClone(fixture.sourceRegister);
    const extractedFacts = structuredClone(fixture.extractedFacts);
    const providerExtras = forbiddenProviderExtras();
    const providerResponse = completion(structuredClone(fixture.marketOverviewDraft), providerExtras);
    const model = {
      complete: vi.fn(async () => providerResponse),
    };

    const success = await bridgeBasicMarketOverviewDraft({
      sourceRegister,
      extractedFacts,
      model,
    });
    expect(success).toEqual({ ok: true, data: fixture.marketOverviewDraft });
    const successSerialized = JSON.stringify(success);

    sourceRegister.sources[0]!.sourceName = "mutated caller source";
    extractedFacts.facts[0]!.evidence[0]!.normalizedValue = "mutated caller fact";
    providerExtras.repoPath = "mutated provider extra";

    expect(JSON.stringify(success)).toBe(successSerialized);
    expectNoBridgeSecrets(successSerialized);

    const failure = await bridgeBasicMarketOverviewDraft({
      sourceRegister: structuredClone(fixture.sourceRegister),
      extractedFacts: structuredClone(fixture.extractedFacts),
      model: {
        async complete() {
          return { ...forbiddenProviderExtras(), choices: [] };
        },
      },
    });

    expect(failure).toEqual({
      ok: false,
      error: { code: "LLAMA_OUTPUT_INCOMPLETE", phase: "llama", retryable: false },
    });
    expectNoBridgeSecrets(JSON.stringify(failure));
    expect(sentinels.globalFetch).not.toHaveBeenCalled();
    expect(model.complete).toHaveBeenCalledOnce();
    expectNoLiveIo(sentinels);
  });

  test("uses injected llama fetch without falling back to global fetch or live I/O", async () => {
    const sentinels = installNoLiveIoSentinels();
    const injectedFetch = vi.fn(async (): Promise<BasicLlamaCppFetchResponse> =>
      jsonResponse({ choices: [], ...forbiddenProviderExtras() }));
    const transport = createBasicLlamaCppDraftTransport({
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "qwen35b",
      fetchImpl: injectedFetch,
    });

    await expect(transport.complete(transportRequest())).resolves.toEqual({
      choices: [],
      ...forbiddenProviderExtras(),
    });

    expect(injectedFetch).toHaveBeenCalledOnce();
    expect(sentinels.globalFetch).not.toHaveBeenCalled();
    expectNoLiveIo(sentinels);
  });
});

function discoveryEnvelope(): {
  schemaVersion: typeof BASIC_HERMES_DISCOVERY_SCHEMA_VERSION;
  runId: string;
  countryCode: string;
  candidates: Array<Record<string, unknown>>;
} {
  return {
    schemaVersion: BASIC_HERMES_DISCOVERY_SCHEMA_VERSION,
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    candidates: [{
      discoveryId: "candidate-1",
      provider: "searxng",
      query: "Indonesia solar policy",
      title: TITLE_SENTINEL,
      snippet: SNIPPET_SENTINEL,
      url: SOURCE_URL,
      discoveredAt: "2026-07-10T09:40:00.000Z",
      discoveryOnly: true,
    }],
  };
}

function reviewedPolicy(): Record<string, unknown> {
  return {
    sourceId: "hermes-source",
    sourceName: "Reviewed statistics portal",
    sourceUrl: SOURCE_URL,
    sourceFamily: "official-statistics",
    credibility: "VERIFIED",
    accessStatus: "open",
    accessNotes: null,
    publishedAt: "2026-07-09T00:00:00.000Z",
    promptInjectionRisk: "none",
    approvedOrigins: ["https://example.com"],
    allowedQueryParameters: ["format"],
  };
}

function baseAdapterResult(): Record<string, unknown> {
  return {
    sourceRegister: {
      schemaVersion: "basic-country-audit/v1",
      runId: RUN_ID,
      countryCode: COUNTRY_CODE,
      sources: [{
        sourceId: "base-source",
        sourceName: "Base source",
        sourceUrl: "https://base.example/source",
        retrievedAt: "2026-07-10T08:00:00.000Z",
        publishedAt: null,
        contentSha256: "a".repeat(64),
        evidenceLocators: ["json:/code"],
        sourceFamily: "official-statistics",
        accessStatus: "open",
        accessNotes: null,
        credibility: "OFFICIAL",
        discoveryOnly: false,
        promptInjectionRisk: "none",
      }],
    },
    extractedFacts: {
      schemaVersion: "basic-country-audit/v1",
      runId: RUN_ID,
      countryCode: COUNTRY_CODE,
      facts: [{
        factId: "fact-base-code",
        fieldPath: "country.code",
        status: "candidate",
        evidence: [{
          sourceId: "base-source",
          locator: "json:/code",
          rawValue: COUNTRY_CODE,
          normalizedValue: COUNTRY_CODE,
          unit: null,
          year: null,
        }],
        extractionMethod: "deterministic",
        uncertainty: null,
      }],
    },
    receipts: [{
      sourceId: "base-source",
      contentSha256: "a".repeat(64),
      byteLength: 7,
      reused: false,
    }],
  };
}

function completion(draft: unknown, extras: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extras,
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify(draft) },
    }],
  };
}

function forbiddenProviderExtras(): Record<string, string> {
  return {
    providerExtras: PROVIDER_EXTRAS_SENTINEL,
    title: TITLE_SENTINEL,
    snippet: SNIPPET_SENTINEL,
    rawBody: RAW_BODY_SENTINEL,
    repoPath: REPO_PATH_SENTINEL,
    cachePath: CACHE_PATH_SENTINEL,
    stagingPath: STAGING_PATH_SENTINEL,
    canonical: CANONICAL_SENTINEL,
    manifest: MANIFEST_SENTINEL,
    knowledge: KNOWLEDGE_SENTINEL,
    ai: AI_SENTINEL,
  };
}

function transportRequest(): BasicLlamaCppDraftRequest {
  return {
    messages: [{ role: "user", content: "{}" }],
    stream: false,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
    response_format: { type: "json_schema", schema: {} },
  };
}

function jsonResponse(value: unknown): BasicLlamaCppFetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    status: 200,
    redirected: false,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectNoBridgeSecrets(serialized: string): void {
  for (const forbidden of [
    TITLE_SENTINEL,
    SNIPPET_SENTINEL,
    RAW_BODY_SENTINEL,
    PROVIDER_EXTRAS_SENTINEL,
    REPO_PATH_SENTINEL,
    CACHE_PATH_SENTINEL,
    STAGING_PATH_SENTINEL,
    CANONICAL_SENTINEL,
    MANIFEST_SENTINEL,
    KNOWLEDGE_SENTINEL,
    AI_SENTINEL,
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toMatch(
    /"(?:body|title|snippet|providerExtras|repoPath|cachePath|stagingPath|canonical|manifest|knowledge|ai)"\s*:/,
  );
}

function installNoLiveIoSentinels() {
  const globalFetch = vi.fn();
  vi.stubGlobal("fetch", globalFetch);
  return { globalFetch, ...ioSentinels };
}

function expectNoLiveIo(sentinels: ReturnType<typeof installNoLiveIoSentinels>): void {
  for (const sentinel of Object.values(sentinels)) {
    expect(sentinel).not.toHaveBeenCalled();
  }
}
