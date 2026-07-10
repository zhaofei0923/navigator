import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  BasicDeterministicAdapterOutput,
  BasicDeterministicObservation,
  BasicDeterministicSourceAdapter,
  BasicSourceTransport,
} from "./collection/basic-source-adapter-contracts.js";
import { runBasicDeterministicSourceAdapters } from "./collection/basic-source-adapter-runner.js";

const temporaryRoots = new Set<string>();
const RETRIEVED_AT = "2026-07-10T09:40:00.000Z";
const PUBLISHED_AT = "2026-07-09T00:00:00Z";
const PAYLOAD_SENTINEL = "PAYLOAD-SECRET-7fcb";
const URL_SENTINEL = "https://secret.example/private?token=URL-SECRET-61dd";

afterEach(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  temporaryRoots.clear();
});

describe("Basic deterministic source adapter runner", () => {
  test("materializes exact source and fact shapes in stable order", async () => {
    const repoRoot = createRepoRoot();
    const transportCalls: string[] = [];
    const rawValue = { nested: [{ value: "original" }], rank: 2 };
    const sourceA = adapter("source-a", [
      observation({
        locator: "table:2",
        rawValue,
        normalizedValue: { z: [1, 2], a: 1 },
        uncertainty: " estimated ",
      }),
      observation({
        locator: "table:1",
        rawValue: { rank: 1 },
        normalizedValue: { a: 1, z: [1, 2] },
        uncertainty: "range",
      }),
    ]);
    const sourceB = adapter("source-b", [
      observation({
        fieldPath: "country.name",
        locator: "json:/name",
        rawValue: "Example Land",
        normalizedValue: { zh: "", en: "Example Land" },
        unit: null,
        year: null,
      }),
      observation({
        locator: "table:3",
        rawValue: { rank: 3 },
        normalizedValue: { a: 1, z: [1, 2] },
        uncertainty: "estimated",
      }),
    ]);

    const result = await runBasicDeterministicSourceAdapters({
      repoRoot,
      countryCode: "XZ",
      runId: "run-stable",
      adapters: [sourceB, sourceA],
      transport: transport(transportCalls),
    });

    expect(transportCalls).toEqual(["source-a", "source-b"]);
    expect(result.sourceRegister).toEqual({
      schemaVersion: "basic-country-audit/v1",
      runId: "run-stable",
      countryCode: "XZ",
      sources: [
        {
          sourceId: "source-a",
          sourceName: "Source source-a",
          sourceUrl: "https://source-a.example/data?format=json",
          retrievedAt: RETRIEVED_AT,
          publishedAt: PUBLISHED_AT,
          contentSha256: sha256(bodyFor("source-a")),
          evidenceLocators: ["table:1", "table:2"],
          sourceFamily: "official-statistics",
          accessStatus: "open",
          accessNotes: "Public API",
          credibility: "OFFICIAL",
          discoveryOnly: false,
          promptInjectionRisk: "none",
        },
        {
          sourceId: "source-b",
          sourceName: "Source source-b",
          sourceUrl: "https://source-b.example/data?format=json",
          retrievedAt: RETRIEVED_AT,
          publishedAt: PUBLISHED_AT,
          contentSha256: sha256(bodyFor("source-b")),
          evidenceLocators: ["json:/name", "table:3"],
          sourceFamily: "official-statistics",
          accessStatus: "open",
          accessNotes: "Public API",
          credibility: "OFFICIAL",
          discoveryOnly: false,
          promptInjectionRisk: "none",
        },
      ],
    });
    expect(result.extractedFacts).toEqual({
      schemaVersion: "basic-country-audit/v1",
      runId: "run-stable",
      countryCode: "XZ",
      facts: [
        {
          factId: "fact-9344a8cad5365b87",
          fieldPath: "country.name",
          status: "candidate",
          evidence: [
            {
              sourceId: "source-b",
              locator: "json:/name",
              rawValue: "Example Land",
              normalizedValue: { zh: "", en: "Example Land" },
              unit: null,
              year: null,
            },
          ],
          extractionMethod: "deterministic",
          uncertainty: null,
        },
        {
          factId: "fact-23ca2a3293b7ec25",
          fieldPath: "marketOverview.population",
          status: "candidate",
          evidence: [
            {
              sourceId: "source-a",
              locator: "table:1",
              rawValue: { rank: 1 },
              normalizedValue: { a: 1, z: [1, 2] },
              unit: "people",
              year: 2025,
            },
            {
              sourceId: "source-a",
              locator: "table:2",
              rawValue: { nested: [{ value: "original" }], rank: 2 },
              normalizedValue: { z: [1, 2], a: 1 },
              unit: "people",
              year: 2025,
            },
            {
              sourceId: "source-b",
              locator: "table:3",
              rawValue: { rank: 3 },
              normalizedValue: { a: 1, z: [1, 2] },
              unit: "people",
              year: 2025,
            },
          ],
          extractionMethod: "deterministic",
          uncertainty: "estimated | range",
        },
      ],
    });
    expect(result.receipts).toEqual([
      {
        sourceId: "source-a",
        contentSha256: sha256(bodyFor("source-a")),
        byteLength: bodyFor("source-a").byteLength,
        reused: false,
      },
      {
        sourceId: "source-b",
        contentSha256: sha256(bodyFor("source-b")),
        byteLength: bodyFor("source-b").byteLength,
        reused: false,
      },
    ]);
    expect(Object.keys(result.receipts[0] ?? {}).sort()).toEqual([
      "byteLength",
      "contentSha256",
      "reused",
      "sourceId",
    ]);
    expect(JSON.stringify(result)).not.toContain(".cache");

    const materializedRaw = result.extractedFacts.facts[1]?.evidence[1]?.rawValue;
    expect(materializedRaw).not.toBe(rawValue);
    expect(Object.getPrototypeOf(materializedRaw as object)).toBe(Object.prototype);
    rawValue.nested[0]!.value = "mutated";
    expect(materializedRaw).toEqual({ nested: [{ value: "original" }], rank: 2 });
  });

  test("treats canonical objects with sorted keys and ordered arrays as one tuple", async () => {
    const result = await runPair(
      { normalizedValue: { a: 1, values: [1, 2] } },
      { normalizedValue: { values: [1, 2], a: 1 } },
    );

    expect(result.extractedFacts.facts[0]?.status).toBe("candidate");
    expect(result.extractedFacts.facts[0]?.evidence).toHaveLength(2);
  });

  test.each([
    ["normalized value", { normalizedValue: [1, 2] }, { normalizedValue: [2, 1] }],
    ["unit", { unit: "people" }, { unit: "persons" }],
    ["year", { year: 2025 }, { year: 2024 }],
  ] satisfies ReadonlyArray<readonly [
    string,
    Partial<BasicDeterministicObservation>,
    Partial<BasicDeterministicObservation>,
  ]>)("preserves a conflict from two sources when only %s differs", async (_name, left, right) => {
    const result = await runPair(left, right);
    const fact = result.extractedFacts.facts[0];

    expect(fact?.status).toBe("conflict");
    expect(fact?.evidence).toHaveLength(2);
    expect(Object.keys(fact ?? {}).sort()).toEqual([
      "evidence",
      "extractionMethod",
      "factId",
      "fieldPath",
      "status",
      "uncertainty",
    ]);
  });

  test("rejects differing tuples emitted by one source", async () => {
    const error = await captureFailure(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: "run-single-source-conflict",
        adapters: [
          adapter("source-single", [
            observation({ locator: "table:first", normalizedValue: 101 }),
            observation({ locator: "table:second", normalizedValue: 102 }),
          ]),
        ],
        transport: transport([]),
      }),
    );

    expect(error.message).toBe("source adapter materialization is invalid");
  });

  test("rejects mixed same-source tuples even when another source agrees", async () => {
    const error = await captureFailure(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: "run-mixed-source-conflict",
        adapters: [
          adapter("source-a", [
            observation({ locator: "table:a-101", normalizedValue: 101 }),
            observation({ locator: "table:a-102", normalizedValue: 102 }),
          ]),
          adapter("source-b", [
            observation({ locator: "table:b-101", normalizedValue: 101 }),
          ]),
        ],
        transport: transport([]),
      }),
    );

    expect(error.message).toBe("source adapter materialization is invalid");
  });

  test("rejects duplicate source IDs before request or transport work", async () => {
    const repoRoot = createRepoRoot();
    let requestCalls = 0;
    let transportCalls = 0;
    const duplicateA = adapter("source-duplicate", [observation()], () => {
      requestCalls += 1;
    });
    const duplicateB = adapter("source-duplicate", [observation()], () => {
      requestCalls += 1;
    });
    const noTransport: BasicSourceTransport = {
      async execute() {
        transportCalls += 1;
        throw new Error("transport must not execute");
      },
    };

    await expect(
      runBasicDeterministicSourceAdapters({
        repoRoot,
        countryCode: "XZ",
        runId: "run-duplicate",
        adapters: [duplicateA, duplicateB],
        transport: noTransport,
      }),
    ).rejects.toThrow("source adapter sourceId must be unique");
    expect(requestCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });

  test("rejects an observation-free adapter output", async () => {
    await expect(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: "run-empty",
        adapters: [adapter("source-empty", [])],
        transport: transport([]),
      }),
    ).rejects.toThrow("source adapter output must contain observations");
  });

  test.each([
    ["review status", () => ({ ...validOutput(), reviewStatus: PAYLOAD_SENTINEL })],
    ["AI flag", () => ({ ...validOutput(), aiUsable: PAYLOAD_SENTINEL })],
    ["coverage field", () => ({ ...validOutput(), coverageLevel: PAYLOAD_SENTINEL })],
    ["raw-cache field", () => ({ ...validOutput(), rawCachePath: PAYLOAD_SENTINEL })],
    ["non-finite raw value", () => outputWithObservation({ rawValue: Number.POSITIVE_INFINITY })],
    ["non-finite normalized value", () => outputWithObservation({ normalizedValue: Number.NaN })],
    ["unknown field path", () => outputWithObservation({ fieldPath: "workflow.status" })],
    ["blank locator", () => outputWithObservation({ locator: " \t " })],
    ["invalid publication date", () => ({ ...validOutput(), publishedAt: "2026-02-30T00:00:00Z" })],
    ["blank access notes", () => ({ ...validOutput(), accessNotes: " " })],
    ["invalid prompt risk", () => ({ ...validOutput(), promptInjectionRisk: "low" })],
    ["inherited output values", inheritedOutput],
    ["inherited JSON values", inheritedJsonOutput],
    ["symbol-keyed JSON values", symbolJsonOutput],
  ] as const)("rejects unsafe adapter output: %s", async (_name, makeOutput) => {
    const unsafeAdapter = withOutput(adapter("source-unsafe", [observation()]), makeOutput());
    const error = await captureFailure(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: `run-unsafe-${String(_name).replaceAll(" ", "-")}`,
        adapters: [unsafeAdapter],
        transport: transport([], RETRIEVED_AT),
      }),
    );

    expect(error.message).toMatch(/source adapter (output|observation) is invalid/);
    expect(error.message).not.toContain(PAYLOAD_SENTINEL);
    expect(error.message).not.toContain(URL_SENTINEL);
  });

  test.each([
    "extra string property",
    "symbol property",
    "every accessor",
    "every function",
  ] as const)("rejects a sparse JSON array with a compensating %s", async (kind) => {
    const probe = { executions: 0 };
    const unsafeAdapter = withOutput(
      adapter("source-unsafe-array", [observation()]),
      outputWithObservation({ rawValue: unsafeSparseArray(kind, probe) }),
    );
    const error = await captureFailure(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: `run-unsafe-array-${kind.replaceAll(" ", "-")}`,
        adapters: [unsafeAdapter],
        transport: transport([]),
      }),
    );

    expect(error.message).toBe("source adapter observation is invalid");
    expect(probe.executions).toBe(0);
    expect(error.message).not.toContain(PAYLOAD_SENTINEL);
    expect(error.message).not.toContain(URL_SENTINEL);
  });

  test("rejects invalid source dates and adapter metadata", async () => {
    const invalidDateError = await captureFailure(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: "run-invalid-retrieved-at",
        adapters: [adapter("source-invalid-date", [observation()])],
        transport: transport([], "not-a-date"),
      }),
    );
    expect(invalidDateError.message).toBe("raw capture response is invalid");

    const invalidMetadata = {
      ...adapter("source-invalid-metadata", [observation()]),
      sourceName: " ",
    } as BasicDeterministicSourceAdapter;
    let transportCalls = 0;
    const noTransport: BasicSourceTransport = {
      async execute() {
        transportCalls += 1;
        throw new Error("transport must not execute");
      },
    };
    await expect(
      runBasicDeterministicSourceAdapters({
        repoRoot: createRepoRoot(),
        countryCode: "XZ",
        runId: "run-invalid-metadata",
        adapters: [invalidMetadata],
        transport: noTransport,
      }),
    ).rejects.toThrow("source adapter metadata is invalid");
    expect(transportCalls).toBe(0);
  });

  test("snapshots validated adapter metadata before request execution", async () => {
    const source = adapter("source-metadata-snapshot", [observation()]);
    const request = source.request.bind(source);
    const mutableSource = source as unknown as {
      sourceName: string;
      request: BasicDeterministicSourceAdapter["request"];
    };
    mutableSource.request = (countryCode) => {
      mutableSource.sourceName = PAYLOAD_SENTINEL;
      return request(countryCode);
    };

    const result = await runBasicDeterministicSourceAdapters({
      repoRoot: createRepoRoot(),
      countryCode: "XZ",
      runId: "run-metadata-snapshot",
      adapters: [source],
      transport: transport([]),
    });

    expect(result.sourceRegister.sources[0]?.sourceName).toBe(
      "Source source-metadata-snapshot",
    );
    expect(JSON.stringify(result)).not.toContain(PAYLOAD_SENTINEL);
  });

  test.each(["request", "extract"] as const)(
    "redacts adapter-thrown %s errors",
    async (phase) => {
      const base = adapter("source-throwing", [observation()]);
      const throwing = {
        ...base,
        ...(phase === "request"
          ? {
              request() {
                throw new Error(`${PAYLOAD_SENTINEL} ${URL_SENTINEL}`);
              },
            }
          : {
              extract() {
                throw new Error(`${PAYLOAD_SENTINEL} ${URL_SENTINEL}`);
              },
            }),
      } as BasicDeterministicSourceAdapter;
      const error = await captureFailure(
        runBasicDeterministicSourceAdapters({
          repoRoot: createRepoRoot(),
          countryCode: "XZ",
          runId: `run-throw-${phase}`,
          adapters: [throwing],
          transport: transport([]),
        }),
      );

      expect(error.message).toBe(`source adapter ${phase} failed`);
      expect(error.message).not.toContain(PAYLOAD_SENTINEL);
      expect(error.message).not.toContain(URL_SENTINEL);
    },
  );
});

function adapter(
  sourceId: string,
  observations: readonly BasicDeterministicObservation[],
  onRequest: () => void = () => undefined,
): BasicDeterministicSourceAdapter {
  return {
    adapterId: `adapter-${sourceId}`,
    adapterVersion: "1.0.0",
    sourceId,
    sourceName: `Source ${sourceId}`,
    sourceFamily: "official-statistics",
    credibility: "OFFICIAL",
    request() {
      onRequest();
      return {
        method: "GET",
        url: `https://${sourceId}.example/data?format=json`,
        accept: "application/json",
        allowedOrigins: [`https://${sourceId}.example`],
        allowedQueryParameters: ["format"],
      };
    },
    extract() {
      return {
        publishedAt: PUBLISHED_AT,
        promptInjectionRisk: "none",
        accessNotes: "Public API",
        observations,
      };
    },
  };
}

function observation(
  overrides: Partial<BasicDeterministicObservation> = {},
): BasicDeterministicObservation {
  return {
    fieldPath: "marketOverview.population",
    locator: "table:population",
    rawValue: 101,
    normalizedValue: 101,
    unit: "people",
    year: 2025,
    uncertainty: null,
    ...overrides,
  };
}

function validOutput(): BasicDeterministicAdapterOutput {
  return {
    publishedAt: PUBLISHED_AT,
    promptInjectionRisk: "none",
    accessNotes: "Public API",
    observations: [observation()],
  };
}

function outputWithObservation(
  overrides: Record<string, unknown>,
): BasicDeterministicAdapterOutput {
  return {
    ...validOutput(),
    observations: [{ ...observation(), ...overrides } as BasicDeterministicObservation],
  };
}

function inheritedOutput(): BasicDeterministicAdapterOutput {
  return Object.assign(Object.create({ publishedAt: PUBLISHED_AT }), {
    promptInjectionRisk: "none",
    accessNotes: URL_SENTINEL,
    observations: [observation()],
  }) as BasicDeterministicAdapterOutput;
}

function inheritedJsonOutput(): BasicDeterministicAdapterOutput {
  const rawValue = Object.assign(Object.create({ inherited: PAYLOAD_SENTINEL }), {
    own: URL_SENTINEL,
  });
  return outputWithObservation({ rawValue });
}

function symbolJsonOutput(): BasicDeterministicAdapterOutput {
  const rawValue: Record<PropertyKey, unknown> = { own: URL_SENTINEL };
  rawValue[Symbol("payload")] = PAYLOAD_SENTINEL;
  return outputWithObservation({ rawValue });
}

function unsafeSparseArray(
  kind: "extra string property" | "symbol property" | "every accessor" | "every function",
  probe: { executions: number },
): unknown[] {
  const value = new Array<unknown>(2);
  value[0] = "safe";
  const sentinel = `${PAYLOAD_SENTINEL} ${URL_SENTINEL}`;
  const property = kind === "symbol property" ? Symbol("sentinel") :
    kind === "extra string property" ? "extra" : "every";
  const descriptor: PropertyDescriptor = kind === "every accessor"
    ? { enumerable: true, get: () => { probe.executions += 1; throw new Error(sentinel); } }
    : {
        enumerable: true,
        value: kind === "every function"
          ? () => { probe.executions += 1; throw new Error(sentinel); }
          : sentinel,
      };
  Object.defineProperty(value, property, descriptor);
  return value;
}

function withOutput(
  source: BasicDeterministicSourceAdapter,
  output: unknown,
): BasicDeterministicSourceAdapter {
  return {
    ...source,
    extract() {
      return output as BasicDeterministicAdapterOutput;
    },
  };
}

async function runPair(
  left: Partial<BasicDeterministicObservation>,
  right: Partial<BasicDeterministicObservation>,
) {
  return runBasicDeterministicSourceAdapters({
    repoRoot: createRepoRoot(),
    countryCode: "XZ",
    runId: `run-pair-${temporaryRoots.size}`,
    adapters: [
      adapter("source-b", [observation(right)]),
      adapter("source-a", [observation(left)]),
    ],
    transport: transport([]),
  });
}

function transport(
  calls: string[],
  retrievedAt = RETRIEVED_AT,
): BasicSourceTransport {
  return {
    async execute(request) {
      const sourceId = new URL(request.url).hostname.split(".")[0] ?? "unknown";
      calls.push(sourceId);
      const body = bodyFor(sourceId);
      return {
        status: 200,
        finalUrl: request.url,
        contentType: "application/json",
        retrievedAt,
        redirectChain: [],
        body: (async function* stream() {
          yield body;
        })(),
      };
    },
  };
}

function bodyFor(sourceId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ sourceId }));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "navigator-runner-"));
  temporaryRoots.add(root);
  return root;
}

async function captureFailure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("expected an Error rejection");
  }
  throw new Error("expected promise to reject");
}
