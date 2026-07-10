import { isDeepStrictEqual } from "node:util";

import {
  CREDIBILITIES,
  INDUSTRY_TAGS,
  TECH_TAGS,
} from "@navigator/shared-types/schema";
import { describe, expect, test, vi } from "vitest";

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { BasicCollectionBridgeError } from "./collection/basic-collection-bridge-error.js";
import type {
  BasicCollectionAuditBundle,
  BasicExtractedFact,
  BasicMarketOverviewDraft,
} from "./collection/basic-collection-contracts.js";
import {
  BASIC_LLAMA_DRAFT_OPERATION,
  BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
  type BasicBridgeFailure,
  type BasicDraftBridgeInput,
  type BasicDraftModelPort,
  type BasicLlamaCppDraftRequest,
} from "./collection/basic-hermes-llama-contracts.js";
import { bridgeBasicMarketOverviewDraft } from "./collection/basic-llama-draft-bridge.js";

const LOCALIZED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["zh", "en"],
  properties: { zh: { type: "string" }, en: { type: "string" } },
};
const EXPECTED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overview", "population", "gdp", "gdpGrowth", "energyDemand",
    "renewableTarget", "keyIndicators", "source", "sourceUrl", "collectedAt",
    "updatedAt", "credibility", "reviewStatus", "aiUsable", "countryCode",
    "industryTags", "techTags",
  ],
  properties: {
    overview: LOCALIZED_SCHEMA,
    population: { type: ["number", "null"] },
    gdp: { type: ["number", "null"] },
    gdpGrowth: { type: ["number", "null"] },
    energyDemand: LOCALIZED_SCHEMA,
    renewableTarget: LOCALIZED_SCHEMA,
    keyIndicators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "unit", "year"],
        properties: {
          label: LOCALIZED_SCHEMA,
          value: { type: "string" },
          unit: { type: "string" },
          year: { type: "number" },
        },
      },
    },
    source: { type: "string" },
    sourceUrl: { type: ["string", "null"] },
    collectedAt: { type: "string" },
    updatedAt: { type: "string" },
    credibility: { type: "string", enum: [...CREDIBILITIES] },
    reviewStatus: { const: "draft" },
    aiUsable: { const: false },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    industryTags: { type: "array", items: { type: "string", enum: [...INDUSTRY_TAGS] } },
    techTags: { type: "array", items: { type: "string", enum: [...TECH_TAGS] } },
  },
};

interface BridgeCase {
  bundle: BasicCollectionAuditBundle;
  expected: BasicMarketOverviewDraft;
  requests: BasicLlamaCppDraftRequest[];
  input: BasicDraftBridgeInput;
}

function createCase(
  response?: unknown,
  onRequest?: (request: BasicLlamaCppDraftRequest) => unknown,
): BridgeCase {
  const bundle = createBasicCollectionAuditFixture();
  const expected = structuredClone(bundle.marketOverviewDraft);
  const requests: BasicLlamaCppDraftRequest[] = [];
  const model: BasicDraftModelPort = {
    async complete(request) {
      requests.push(request);
      const custom = onRequest?.(request);
      if (custom !== undefined) return custom;
      return response !== undefined ? response : completion(expected);
    },
  };
  return {
    bundle,
    expected,
    requests,
    input: { sourceRegister: bundle.sourceRegister, extractedFacts: bundle.extractedFacts, model },
  };
}

function completion(draft: unknown, extras: Record<string, unknown> = {}): unknown {
  return {
    ...extras,
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify(draft), ignored: "provider-extra" },
      ignored: "provider-extra",
    }],
  };
}

function factFor(value: BridgeCase, fieldPath: string): BasicExtractedFact {
  const fact = value.bundle.extractedFacts.facts.find((item) => item.fieldPath === fieldPath);
  if (fact === undefined) throw new Error(`missing fixture fact ${fieldPath}`);
  return fact;
}

async function expectFailure(
  value: unknown,
  expected: BasicBridgeFailure,
): Promise<void> {
  await expect(bridgeBasicMarketOverviewDraft(value as never)).resolves.toEqual({
    ok: false,
    error: expected,
  });
}

async function expectBlocked(value: BridgeCase): Promise<void> {
  await expectFailure(value.input, {
    code: "DRAFT_INPUT_BLOCKED",
    phase: "draft",
    retryable: false,
  });
  expect(value.requests).toHaveLength(0);
}

function changeExpected(value: BridgeCase, fieldPath: string, normalizedValue: unknown): void {
  const fact = factFor(value, fieldPath);
  for (const evidence of fact.evidence) evidence.normalizedValue = normalizedValue as never;
}

function throwingProxy<T extends object>(target: T): { proxy: T; traps: ReturnType<typeof vi.fn> } {
  const traps = vi.fn(() => { throw new Error("reflection trap must not run"); });
  return {
    proxy: new Proxy(target, {
      get: traps,
      getOwnPropertyDescriptor: traps,
      getPrototypeOf: traps,
      ownKeys: traps,
    }),
    traps,
  };
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const item of Object.values(value)) expectDeepFrozen(item, seen);
}

describe("bridgeBasicMarketOverviewDraft request and success", () => {
  test("exports the immutable frozen protocol and returns the exact grounded draft", async () => {
    expect(BASIC_LLAMA_DRAFT_PROTOCOL_VERSION).toBe("basic-country-draft/v1");
    expect(BASIC_LLAMA_DRAFT_OPERATION).toBe("return-exact-draft");
    const value = createCase();

    const result = await bridgeBasicMarketOverviewDraft(value.input);

    expect(result).toEqual({ ok: true, data: value.expected });
    expect(value.requests).toHaveLength(1);
  });

  test("locks the exact one-message request, recursive schema, and semantic envelope", async () => {
    const value = createCase();
    await bridgeBasicMarketOverviewDraft(value.input);

    expect(value.requests).toEqual([{
      messages: [{
        role: "user",
        content: JSON.stringify({
          protocol: "basic-country-draft/v1",
          operation: "return-exact-draft",
          draft: value.expected,
        }),
      }],
      stream: false,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_schema", schema: EXPECTED_SCHEMA },
    }]);
    expect(JSON.parse(value.requests[0]!.messages[0].content)).toEqual({
      protocol: BASIC_LLAMA_DRAFT_PROTOCOL_VERSION,
      operation: BASIC_LLAMA_DRAFT_OPERATION,
      draft: value.expected,
    });
  });

  test("deep-freezes the request and schema before handing them to the model", async () => {
    const value = createCase(undefined, (request) => {
      expectDeepFrozen(request);
      expect(Reflect.set(request.messages[0], "content", "mutated")).toBe(false);
      expect(Reflect.set(request.response_format.schema, "extra", true)).toBe(false);
      return completion(value.expected);
    });

    await expect(bridgeBasicMarketOverviewDraft(value.input)).resolves.toMatchObject({ ok: true });
  });

  test("never sends raw values, uncertainty, source content, snippets, paths, or secrets", async () => {
    const value = createCase();
    value.bundle.sourceRegister.sources[0]!.sourceName = "SOURCE-CONTENT-SENTINEL";
    const evidence = factFor(value, "marketOverview.overview").evidence[0]!;
    evidence.rawValue = "RAW-SNIPPET-SECRET-/repo/cache/file";
    factFor(value, "marketOverview.overview").uncertainty = "DISCOVERY-SNIPPET-SENTINEL";

    await bridgeBasicMarketOverviewDraft(value.input);

    const serialized = JSON.stringify(value.requests[0]);
    for (const sentinel of [
      "SOURCE-CONTENT-SENTINEL", "RAW-SNIPPET-SECRET", "/repo/cache/file",
      "DISCOVERY-SNIPPET-SENTINEL", "rawValue", "uncertainty",
    ]) expect(serialized).not.toContain(sentinel);
  });

  test("preserves one-sided bilingual fallback", async () => {
    const value = createCase();
    const overview = { zh: "", en: "Market overview" };
    value.expected.overview = overview;
    changeExpected(value, "marketOverview.overview", overview);
    value.input.model = { async complete() { return completion(value.expected); } };

    await expect(bridgeBasicMarketOverviewDraft(value.input)).resolves.toEqual({
      ok: true,
      data: value.expected,
    });
  });

  test("returns a wholly fresh recursively frozen draft immune to caller mutation", async () => {
    const value = createCase();
    const normalized = factFor(value, "marketOverview.overview").evidence[0]!.normalizedValue;
    const result = await bridgeBasicMarketOverviewDraft(value.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).not.toBe(value.expected);
    expect(result.data.overview).not.toBe(value.expected.overview);
    expect(result.data.overview).not.toBe(normalized);
    expectDeepFrozen(result.data);
    value.expected.overview.en = "caller mutation";
    expect(result.data.overview.en).toBe("Market overview");
  });

  test("uses the captured complete method with a stable receiver and never reads bind", async () => {
    const value = createCase();
    const model = {
      expectedReceiver: null as object | null,
      complete(request: BasicLlamaCppDraftRequest) {
        expect(this).toBe(model);
        return Promise.resolve(completion(value.expected));
      },
    };
    model.expectedReceiver = model;
    Object.defineProperty(model.complete, "bind", {
      get() { throw new Error("bind must not be read"); },
    });
    value.input.model = model;

    await expect(bridgeBasicMarketOverviewDraft(value.input)).resolves.toMatchObject({ ok: true });
  });

  test("snapshots caller facts before awaiting the model", async () => {
    let release: ((response: unknown) => void) | undefined;
    const value = createCase();
    value.input.model = {
      complete() {
        return new Promise((resolve) => { release = resolve; });
      },
    };
    const pending = bridgeBasicMarketOverviewDraft(value.input);
    const original = structuredClone(value.expected);
    changeExpected(value, "marketOverview.overview", { zh: "mutated", en: "mutated" });
    value.bundle.sourceRegister.sources[0]!.evidenceLocators.length = 0;
    release?.(completion(original));

    await expect(pending).resolves.toEqual({ ok: true, data: original });
  });

  test("does not use global fetch", async () => {
    const prior = globalThis.fetch;
    const sentinel = vi.fn(() => { throw new Error("global fetch forbidden"); });
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: sentinel });
    try {
      await bridgeBasicMarketOverviewDraft(createCase().input);
      expect(sentinel).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: prior });
    }
  });
});

describe("bridgeBasicMarketOverviewDraft preflight", () => {
  test.each([
    ["a missing required static path", (value: BridgeCase) => {
      value.bundle.extractedFacts.facts = value.bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => fieldPath !== "country.summary",
      );
    }],
    ["an unknown path", (value: BridgeCase) => {
      factFor(value, "country.summary").fieldPath = "marketOverview.policy";
    }],
    ["a duplicate path", (value: BridgeCase) => {
      factFor(value, "country.summary").fieldPath = "country.name";
    }],
    ["a gapped indicator index", (value: BridgeCase) => {
      for (const fact of value.bundle.extractedFacts.facts) {
        fact.fieldPath = fact.fieldPath.replace("keyIndicators[0]", "keyIndicators[1]");
      }
    }],
    ["an incomplete indicator group", (value: BridgeCase) => {
      value.bundle.extractedFacts.facts = value.bundle.extractedFacts.facts.filter(
        ({ fieldPath }) => fieldPath !== "marketOverview.keyIndicators[0].unit",
      );
    }],
    ["a duplicate factId", (value: BridgeCase) => {
      value.bundle.extractedFacts.facts[1]!.factId = value.bundle.extractedFacts.facts[0]!.factId;
    }],
    ["a duplicate sourceId", (value: BridgeCase) => {
      value.bundle.sourceRegister.sources[1]!.sourceId = value.bundle.sourceRegister.sources[0]!.sourceId;
    }],
    ["an unknown evidence source", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").evidence[0]!.sourceId = "missing-source";
    }],
    ["an evidence locator mismatch", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").evidence[0]!.locator = "missing locator";
    }],
    ["empty evidence", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").evidence = [];
    }],
    ["a missing fact status", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").status = "missing";
    }],
    ["a conflict fact status", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").status = "conflict";
    }],
    ["an untrusted fact status", (value: BridgeCase) => {
      factFor(value, "marketOverview.gdp").status = "untrusted";
    }],
    ["a restricted source", (value: BridgeCase) => {
      value.bundle.sourceRegister.sources[0]!.accessStatus = "restricted";
    }],
    ["an unverified source", (value: BridgeCase) => {
      value.bundle.sourceRegister.sources[0]!.credibility = "UNVERIFIED";
    }],
    ["a discovery source", (value: BridgeCase) => {
      value.bundle.sourceRegister.sources[0]!.discoveryOnly = true;
    }],
    ["a prompt injection risk", (value: BridgeCase) => {
      value.bundle.sourceRegister.sources[0]!.promptInjectionRisk = "suspected";
    }],
    ["different normalized candidate values", (value: BridgeCase) => {
      const fact = factFor(value, "marketOverview.gdp");
      fact.evidence.push({ ...structuredClone(fact.evidence[0]!), normalizedValue: 1 });
    }],
  ])("blocks %s before calling the model", async (_name, mutate) => {
    const value = createCase();
    mutate(value);
    await expectBlocked(value);
  });

  test.each([
    ["source schemaVersion", (value: BridgeCase) => { value.bundle.sourceRegister.schemaVersion = "wrong" as never; }],
    ["fact schemaVersion", (value: BridgeCase) => { value.bundle.extractedFacts.schemaVersion = "wrong" as never; }],
    ["runId", (value: BridgeCase) => { value.bundle.extractedFacts.runId = "different"; }],
    ["countryCode", (value: BridgeCase) => { value.bundle.extractedFacts.countryCode = "YY"; }],
    ["country.code fact", (value: BridgeCase) => { changeExpected(value, "country.code", "YY"); }],
    ["marketOverview.countryCode fact", (value: BridgeCase) => { changeExpected(value, "marketOverview.countryCode", "YY"); }],
  ])("blocks a %s identity mismatch", async (_name, mutate) => {
    const value = createCase();
    mutate(value);
    await expectBlocked(value);
  });

  test("blocks non-finite and cyclic normalized JSON before the model", async () => {
    const nonFinite = createCase();
    changeExpected(nonFinite, "marketOverview.gdp", Number.POSITIVE_INFINITY);
    await expectBlocked(nonFinite);

    const cyclic = createCase();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    changeExpected(cyclic, "marketOverview.overview", cycle);
    await expectBlocked(cyclic);
  });

  test("rejects proxy and accessor inputs before invoking their traps", async () => {
    const proxiedInput = throwingProxy(createCase().input);
    await expectFailure(proxiedInput.proxy, { code: "INPUT_INVALID", phase: "input", retryable: false });
    expect(proxiedInput.traps).not.toHaveBeenCalled();

    const value = createCase();
    let getterCalls = 0;
    Object.defineProperty(value.input, "sourceRegister", {
      enumerable: true,
      get() { getterCalls += 1; return value.bundle.sourceRegister; },
    });
    await expectFailure(value.input, { code: "INPUT_INVALID", phase: "input", retryable: false });
    expect(getterCalls).toBe(0);
  });

  test("maps a replaced top-level key to INPUT_INVALID", async () => {
    const value = createCase();
    const malformed = value.input as unknown as Record<string, unknown>;
    delete malformed.sourceRegister;
    malformed.unexpected = value.bundle.sourceRegister;

    await expectFailure(malformed, {
      code: "INPUT_INVALID",
      phase: "input",
      retryable: false,
    });
    expect(value.requests).toHaveLength(0);
  });

  test("rejects hostile nested JSON before reflection traps", async () => {
    const value = createCase();
    const hostile = throwingProxy({ zh: "x", en: "y" });
    changeExpected(value, "marketOverview.overview", hostile.proxy);
    await expectBlocked(value);
    expect(hostile.traps).not.toHaveBeenCalled();
  });

  test("rejects nested accessors, symbols, and inherited custom objects", async () => {
    const accessor = createCase();
    let getterCalls = 0;
    Object.defineProperty(accessor.bundle.sourceRegister.sources[0], "sourceName", {
      enumerable: true,
      get() { getterCalls += 1; return "forbidden"; },
    });
    await expectBlocked(accessor);
    expect(getterCalls).toBe(0);

    const symbol = createCase();
    Object.defineProperty(symbol.bundle.extractedFacts.facts[0], Symbol("extra"), {
      enumerable: true,
      value: "forbidden",
    });
    await expectBlocked(symbol);

    const inherited = createCase();
    Object.setPrototypeOf(inherited.bundle.sourceRegister.sources[0]!, { inherited: true });
    await expectBlocked(inherited);
  });

  test("rejects sparse/custom arrays and depth overflow", async () => {
    const sparse = createCase();
    sparse.bundle.extractedFacts.facts = new Array(1);
    await expectBlocked(sparse);

    const custom = createCase();
    Object.setPrototypeOf(custom.bundle.sourceRegister.sources, null);
    await expectBlocked(custom);

    const deep = createCase();
    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let index = 0; index < 70; index += 1) {
      const next: Record<string, unknown> = {};
      nested.next = next;
      nested = next;
    }
    changeExpected(deep, "marketOverview.overview", root);
    await expectBlocked(deep);
  });

  test("rejects model proxies and complete accessors without traps/getters", async () => {
    const proxied = createCase();
    const hostile = throwingProxy({ complete: async () => completion(proxied.expected) });
    proxied.input.model = hostile.proxy;
    await expectFailure(proxied.input, { code: "INPUT_INVALID", phase: "input", retryable: false });
    expect(hostile.traps).not.toHaveBeenCalled();

    const accessor = createCase();
    let getterCalls = 0;
    accessor.input.model = Object.defineProperty({}, "complete", {
      get() { getterCalls += 1; return async () => completion(accessor.expected); },
    }) as BasicDraftModelPort;
    await expectFailure(accessor.input, { code: "INPUT_INVALID", phase: "input", retryable: false });
    expect(getterCalls).toBe(0);
  });
});

describe("bridgeBasicMarketOverviewDraft model and output failures", () => {
  test.each([
    [new BasicCollectionBridgeError("LLAMA_TIMEOUT"), { code: "LLAMA_TIMEOUT", phase: "llama", retryable: true }],
    [new BasicCollectionBridgeError("LLAMA_UNAVAILABLE"), { code: "LLAMA_UNAVAILABLE", phase: "llama", retryable: true }],
    [new BasicCollectionBridgeError("LLAMA_RESPONSE_INVALID"), { code: "LLAMA_RESPONSE_INVALID", phase: "llama", retryable: false }],
    [new Error("provider secret"), { code: "LLAMA_UNAVAILABLE", phase: "llama", retryable: true }],
  ] as const)("sanitizes a rejected model failure", async (error, failure) => {
    const value = createCase();
    value.input.model = { async complete() { throw error; } };
    await expectFailure(value.input, failure);
    expect(value.requests).toHaveLength(0);
  });

  test("catches synchronous model throws", async () => {
    const value = createCase();
    value.input.model = { complete() { throw new Error("sync provider secret"); } };
    await expectFailure(value.input, { code: "LLAMA_UNAVAILABLE", phase: "llama", retryable: true });
  });

  test.each([
    ["a non-object envelope", null],
    ["a missing choices property", {}],
    ["a sparse choices array", { choices: new Array(1) }],
    ["a malformed choice", { choices: [null] }],
    ["a malformed message", { choices: [{ finish_reason: "stop", message: null }] }],
  ])("maps %s to LLAMA_RESPONSE_INVALID", async (_name, response) => {
    const value = createCase(response);
    await expectFailure(value.input, { code: "LLAMA_RESPONSE_INVALID", phase: "llama", retryable: false });
  });

  test("rejects hostile envelope proxies and accessors without invoking them", async () => {
    const value = createCase();
    const hostile = throwingProxy({ choices: [] });
    value.input.model = {
      complete() { return hostile.proxy as never; },
    };
    await expectFailure(value.input, { code: "LLAMA_RESPONSE_INVALID", phase: "llama", retryable: false });
    expect(hostile.traps).not.toHaveBeenCalled();

    let getterCalls = 0;
    const envelope = Object.defineProperty({}, "choices", {
      enumerable: true,
      get() { getterCalls += 1; return []; },
    });
    value.input.model = { async complete() { return envelope; } };
    await expectFailure(value.input, { code: "LLAMA_RESPONSE_INVALID", phase: "llama", retryable: false });
    expect(getterCalls).toBe(0);

    const contentAccessor = createCase();
    let contentGetterCalls = 0;
    const message = Object.defineProperty({}, "content", {
      enumerable: true,
      get() { contentGetterCalls += 1; return JSON.stringify(contentAccessor.expected); },
    });
    contentAccessor.input.model = {
      async complete() { return { choices: [{ finish_reason: "stop", message }] }; },
    };
    await expectFailure(contentAccessor.input, { code: "LLAMA_RESPONSE_INVALID", phase: "llama", retryable: false });
    expect(contentGetterCalls).toBe(0);
  });

  test.each([
    ["empty choices", { choices: [] }],
    ["multiple choices", { choices: [{}, {}] }],
    ["non-stop finish", { choices: [{ finish_reason: "length", message: { content: "{}" } }] }],
    ["missing content", { choices: [{ finish_reason: "stop", message: {} }] }],
    ["non-string content", { choices: [{ finish_reason: "stop", message: { content: 1 } }] }],
    ["blank content", { choices: [{ finish_reason: "stop", message: { content: "  " } }] }],
  ])("maps %s to LLAMA_OUTPUT_INCOMPLETE", async (_name, response) => {
    await expectFailure(createCase(response).input, {
      code: "LLAMA_OUTPUT_INCOMPLETE",
      phase: "llama",
      retryable: false,
    });
  });

  test("maps non-JSON content to LLAMA_OUTPUT_NOT_JSON", async () => {
    const response = { choices: [{ finish_reason: "stop", message: { content: "not-json" } }] };
    await expectFailure(createCase(response).input, {
      code: "LLAMA_OUTPUT_NOT_JSON",
      phase: "llama",
      retryable: false,
    });
  });

  test.each([
    ["reviewStatus", (draft: Record<string, unknown>) => { draft.reviewStatus = "published"; }],
    ["aiUsable", (draft: Record<string, unknown>) => { draft.aiUsable = true; }],
  ])("maps a changed %s lock to DRAFT_LOCK_VIOLATION", async (_name, mutate) => {
    const value = createCase();
    const draft = structuredClone(value.expected) as unknown as Record<string, unknown>;
    mutate(draft);
    await expectFailure(createCase(completion(draft)).input, {
      code: "DRAFT_LOCK_VIOLATION",
      phase: "draft",
      retryable: false,
    });
  });

  test.each([
    ["an extra policy field", (draft: Record<string, unknown>) => { draft.policy = "forbidden"; }],
    ["a wrong field type", (draft: Record<string, unknown>) => { draft.population = "one million"; }],
    ["both localized sides blank", (draft: Record<string, unknown>) => { draft.overview = { zh: "", en: "" }; }],
  ])("maps %s to LLAMA_OUTPUT_SCHEMA_INVALID", async (_name, mutate) => {
    const value = createCase();
    const draft = structuredClone(value.expected) as unknown as Record<string, unknown>;
    mutate(draft);
    await expectFailure(createCase(completion(draft)).input, {
      code: "LLAMA_OUTPUT_SCHEMA_INVALID",
      phase: "draft",
      retryable: false,
    });
  });

  test("rejects a structurally valid value that differs from grounded facts", async () => {
    const value = createCase();
    const changed = structuredClone(value.expected);
    changed.gdp = 1;
    await expectFailure(createCase(completion(changed)).input, {
      code: "LLAMA_OUTPUT_UNGROUNDED",
      phase: "draft",
      retryable: false,
    });
    expect(isDeepStrictEqual(changed, value.expected)).toBe(false);
  });
});
