import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import { worldBankCountryAdapter } from "./collection/adapters/world-bank-country.js";
import type {
  BasicDeterministicAdapterOutput,
} from "./collection/basic-source-adapter-contracts.js";
import {
  parseBasicSourceCatalog,
} from "./collection/basic-source-catalog.js";
import {
  runBasicSourceExecutionPlanV2,
  snapshotBasicDocumentCaptureProvenanceV2,
} from "./collection/basic-source-plan-runner-v2.js";
import {
  createBasicSourceExecutionPlan,
  snapshotBasicSourceExecutionPlanEntryProvenance,
  type BasicSourceExecutionPlan,
} from "./collection/basic-source-request-materializer.js";
import type {
  BasicSourceTransportV2,
} from "./collection/basic-source-v2-contracts.js";

const RUN_ID = "data-basic-vn-20260712-r1";
const RETRIEVED_AT = "2026-07-12T04:00:00.000Z";
const ERROR = "basic source plan run is invalid";
const roots = new Set<string>();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("catalog-driven Basic source plan runner v2", () => {
  test("runs order-independent reviewed World Bank entries in source-ID order", async () => {
    const plan = committedWorldBankPlan();
    const reversedPlan = {
      ...plan,
      sources: Array.from(plan.sources).reverse(),
    };
    const transport = fixtureTransport(plan);

    const result = await runBasicSourceExecutionPlanV2({
      repoRoot: repoRoot(),
      countryCode: "VN",
      runId: RUN_ID,
      plan: reversedPlan,
      transport,
    });

    expect(transport.execute).toHaveBeenCalledTimes(4);
    expect(result.sourceRegister).toMatchObject({
      schemaVersion: "basic-country-audit/v2",
      runId: RUN_ID,
      countryCode: "VN",
      catalogVersion: plan.catalogVersion,
      catalogSha256: plan.catalogSha256,
    });
    expect(result.sourceRegister.sources.map(({ sourceId }) => sourceId)).toEqual([
      "world-bank-country",
      "world-bank-gdp",
      "world-bank-gdp-growth",
      "world-bank-population",
    ]);
    expect(result.extractedFacts.facts.map(({ fieldPath }) => fieldPath)).toEqual([
      "country.code",
      "country.name",
      "marketOverview.gdp",
      "marketOverview.gdpGrowth",
      "marketOverview.population",
    ]);
    expect(result.extractedFacts.facts.every(
      ({ extractionMethod, evidence }) =>
        extractionMethod === "deterministic" && evidence.length > 0,
    )).toBe(true);
    expect(result.structuredEditorialEvidence).toEqual([]);
    expect(result.documentCaptures).toEqual([]);
    expect(result.receipts.map(({ sourceId }) => sourceId)).toEqual(
      result.sourceRegister.sources.map(({ sourceId }) => sourceId),
    );
    expect(result.receipts.every(
      (receipt) => Object.keys(receipt).join(",") ===
        "sourceId,contentSha256,byteLength,reused",
    )).toBe(true);
    expectDeeplyFrozen(result);
  });

  test("binds the deterministic adapter before cache or network and passes frozen copied capture metadata", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    const events: string[] = [];
    const originalRequest = worldBankCountryAdapter.request;
    const originalExtract = worldBankCountryAdapter.extract;
    vi.spyOn(worldBankCountryAdapter, "request").mockImplementation((countryCode) => {
      events.push("bind");
      return originalRequest(countryCode);
    });
    vi.spyOn(worldBankCountryAdapter, "extract").mockImplementation((input) => {
      events.push("extract");
      expect(Object.isFrozen(input)).toBe(true);
      expect(input).toMatchObject({
        countryCode: "VN",
        requestUrl: plan.sources[0]?.request.url,
        finalUrl: plan.sources[0]?.request.url,
        contentType: "application/json; charset=utf-8",
        retrievedAt: RETRIEVED_AT,
      });
      const output = originalExtract(input);
      input.body.fill(0);
      return output;
    });
    const transport = fixtureTransport(plan, () => events.push("network"));

    const result = await runBasicSourceExecutionPlanV2({
      repoRoot: repoRoot(),
      countryCode: "VN",
      runId: RUN_ID,
      plan,
      transport,
    });

    expect(events).toEqual(["bind", "network", "extract"]);
    expect(result.sourceRegister.sources[0]?.contentSha256).toBe(
      fixture("world-bank-country-vn.json").contentSha256,
    );
  });

  test("splits source-backed, hybrid-name, and editorial observations by centralized ownership", async () => {
    const plan = countryPlanWithFieldPaths([
      "country.code",
      "country.name",
      "country.summary",
    ]);
    vi.spyOn(worldBankCountryAdapter, "extract").mockReturnValue({
      publishedAt: "2026-07-01T00:00:00.000Z",
      promptInjectionRisk: "suspected",
      accessNotes: "Reviewed note",
      observations: [
        observation("country.summary", "json:/summary", "Summary", {
          zh: "Summary zh",
          en: "Summary",
        }),
        observation("country.name", "json:/name", "Viet Nam", {
          zh: "",
          en: "Viet Nam",
        }),
        observation("country.code", "json:/code", "VN", "VN"),
      ],
    });

    const result = await runBasicSourceExecutionPlanV2({
      repoRoot: repoRoot(),
      countryCode: "VN",
      runId: RUN_ID,
      plan,
      transport: fixtureTransport(plan),
    });

    expect(result.extractedFacts.facts.map(({ fieldPath }) => fieldPath)).toEqual([
      "country.code",
      "country.name",
    ]);
    expect(result.structuredEditorialEvidence).toEqual([{
      sourceId: "world-bank-country",
      fieldPath: "country.summary",
      locator: "json:/summary",
      rawValue: "Summary",
    }]);
    expect(result.sourceRegister.sources).toEqual([
      expect.objectContaining({
        sourceId: "world-bank-country",
        sourceName: "World Bank",
        sourceUrl: plan.sources[0]?.request.url,
        publishedAt: "2026-07-01T00:00:00.000Z",
        evidenceLocators: ["json:/code", "json:/name", "json:/summary"],
        sourceFamily: "international-organization",
        accessStatus: "open",
        accessNotes: "Reviewed note",
        credibility: "OFFICIAL",
        discoveryOnly: false,
        promptInjectionRisk: "suspected",
      }),
    ]);
  });

  test.each([
    ["derived", "country.flagEmoji"],
    ["outside the catalog", "country.summary"],
    ["unknown", "marketOverview.notReviewed"],
  ])("rejects a %s adapter observation path", async (_label, fieldPath) => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    vi.spyOn(worldBankCountryAdapter, "extract").mockReturnValue({
      publishedAt: null,
      promptInjectionRisk: "none",
      accessNotes: null,
      observations: [observation(fieldPath, "json:/secret", "SECRET", "SECRET")],
    });

    await expect(run(plan, fixtureTransport(plan))).rejects.toThrow(ERROR);
  });

  test("redacts adapter throws and invalid adapter output", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    vi.spyOn(worldBankCountryAdapter, "extract").mockImplementation(() => {
      throw new Error("SECRET_ADAPTER_BODY");
    });
    await expect(rejection(run(plan, fixtureTransport(plan)))).resolves.toMatchObject({
      message: ERROR,
    });

    vi.restoreAllMocks();
    vi.spyOn(worldBankCountryAdapter, "extract").mockReturnValue({
      publishedAt: null,
      promptInjectionRisk: "none",
      accessNotes: null,
      observations: [],
      secret: "SECRET_INVALID_OUTPUT",
    } as unknown as BasicDeterministicAdapterOutput);
    const error = await rejection(run(
      plan,
      fixtureTransport(plan),
      repoRoot(),
      `${RUN_ID}-invalid`,
    ));
    expect(error.message).toBe(ERROR);
    expect(error.message).not.toMatch(/SECRET|ADAPTER|BODY|OUTPUT/);
  });

  test("rejects over-limit structured editorial JSON from an adapter", async () => {
    const plan = countryPlanWithFieldPaths(["country.summary"]);
    vi.spyOn(worldBankCountryAdapter, "extract").mockReturnValue({
      publishedAt: null,
      promptInjectionRisk: "none",
      accessNotes: null,
      observations: [observation(
        "country.summary",
        "json:/summary",
        "x".repeat(65_537),
        { zh: "Summary zh", en: "Summary" },
      )],
    });

    await expect(run(plan, fixtureTransport(plan))).rejects.toThrow(ERROR);
  });

  test.each([
    ["source metadata", (plan: MutablePlan) => {
      plan.sources[0]!.source.sourceName = "Drift SECRET";
    }],
    ["request metadata", (plan: MutablePlan) => {
      plan.sources[0]!.request.url = "https://api.worldbank.org/v2/country/ID?format=json";
    }],
    ["optional credentials", (plan: MutablePlan) => {
      plan.sources[0]!.source.accessMode = "optional-credentialed";
    }],
    ["country scope", (plan: MutablePlan) => {
      plan.sources[0]!.source.countryScope = ["ID"];
    }],
    ["JSON marked manual", (plan: MutablePlan) => {
      plan.sources[0]!.source.adapterKind = "manual-document";
    }],
    ["CSV marked manual", (plan: MutablePlan) => {
      plan.sources[0]!.source.format = "csv";
      plan.sources[0]!.source.accept = "text/csv";
      plan.sources[0]!.source.adapterKind = "manual-document";
      plan.sources[0]!.request.accept = "text/csv";
    }],
  ])("rejects %s before cache or network", async (_label, mutate) => {
    const plan = mutablePlan(committedWorldBankPlan(["world-bank-country"]));
    mutate(plan);
    const transport = fixtureTransport(plan);
    const root = repoRoot();

    const error = await rejection(run(plan, transport, root));

    expect(error.message).toBe(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test.each(["html", "pdf"] as const)(
    "captures a manual %s document without creating sources or facts",
    async (format) => {
      const plan = manualDocumentPlan(format);
      const transport = documentTransport(plan, format === "html"
        ? "<html><script>globalThis.fetch('forbidden')</script></html>"
        : "%PDF-1.7\nraw bytes that are not parsed");

      const result = await runBasicSourceExecutionPlanV2({
        repoRoot: repoRoot(),
        countryCode: "VN",
        runId: RUN_ID,
        plan,
        transport,
      });

      expect(transport.execute).toHaveBeenCalledTimes(1);
      expect(result.sourceRegister.sources).toEqual([]);
      expect(result.extractedFacts.facts).toEqual([]);
      expect(result.structuredEditorialEvidence).toEqual([]);
      expect(result.documentCaptures).toEqual([{
        catalogSource: plan.sources[0]?.source,
        manifest: expect.objectContaining({
          schemaVersion: "basic-country-raw-capture/v2",
          countryCode: "VN",
          runId: RUN_ID,
          catalogVersion: plan.catalogVersion,
          catalogSha256: plan.catalogSha256,
          adapterId: "basic-manual-document-capture",
          adapterVersion: "1.0.0",
          sourceId: `official-${format}`,
          request: plan.sources[0]?.request,
          response: expect.objectContaining({
            contentType: format === "html" ? "text/html" : "application/pdf",
          }),
        }),
      }]);
      expect("body" in (result.documentCaptures[0] as unknown as object)).toBe(false);
      const capture = result.documentCaptures[0]!;
      const provenance = snapshotBasicDocumentCaptureProvenanceV2(capture);
      expect(provenance).toMatchObject({
        runId: RUN_ID,
        countryCode: "VN",
        catalogVersion: plan.catalogVersion,
        catalogSha256: plan.catalogSha256,
        sourceId: `official-${format}`,
      });
      expect(provenance?.entryProvenance).toBe(
        snapshotBasicSourceExecutionPlanEntryProvenance(plan.sources[0]),
      );
      expect(provenance?.catalogSource).toBe(capture.catalogSource);
      expect(provenance?.manifest).toBe(capture.manifest);
      expect(snapshotBasicDocumentCaptureProvenanceV2({ ...capture })).toBeNull();
      expectDeeplyFrozen(result);
    },
  );

  test.each([
    ["adapter ID", (plan: MutablePlan) => {
      plan.sources[0]!.source.adapterId = "unknown-manual-capture";
    }],
    ["adapter version", (plan: MutablePlan) => {
      plan.sources[0]!.source.adapterVersion = "1.0.1";
    }],
    ["HTML marked deterministic", (plan: MutablePlan) => {
      plan.sources[0]!.source.adapterKind = "deterministic";
    }],
    ["PDF marked deterministic", (plan: MutablePlan) => {
      plan.sources[0]!.source.format = "pdf";
      plan.sources[0]!.source.accept = "application/pdf";
      plan.sources[0]!.source.adapterKind = "deterministic";
      plan.sources[0]!.request.accept = "application/pdf";
    }],
  ])("revalidates the manual executor %s before capture", async (_label, mutate) => {
    const plan = mutablePlan(manualDocumentPlan("html"));
    mutate(plan);
    const transport = documentTransport(plan, "body");
    const root = repoRoot();

    await expect(run(plan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects manual request-template drift before capture", async () => {
    const plan = mutablePlan(manualDocumentPlan("html"));
    plan.sources[0]!.request.url =
      "https://documents.example/sources/ID/other.html";
    const transport = documentTransport(
      plan as unknown as BasicSourceExecutionPlan,
      "body",
    );
    const root = repoRoot();

    await expect(run(plan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects a coherent copied plan entry before cache or network", async () => {
    const forgedPlan = structuredClone(
      manualDocumentPlan("html"),
    ) as BasicSourceExecutionPlan;
    const transport = documentTransport(forgedPlan, "body");
    const root = repoRoot();

    await expect(run(forgedPlan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects entries with mixed materialization provenance", async () => {
    const firstPlan = committedWorldBankPlan([
      "world-bank-country",
      "world-bank-gdp",
    ]);
    const secondPlan = committedWorldBankPlan(["world-bank-gdp"]);
    const mixedPlan: BasicSourceExecutionPlan = {
      ...firstPlan,
      sources: [firstPlan.sources[0]!, secondPlan.sources[0]!],
    };
    const transport = fixtureTransport(mixedPlan);
    const root = repoRoot();

    await expect(run(mixedPlan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects real catalog mapping drift before cache or network", async () => {
    const originalPlan = mappedManualDocumentPlan("VNM");
    const driftedCatalogPlan = mappedManualDocumentPlan("VN-external");
    const driftedIdentityPlan: BasicSourceExecutionPlan = {
      catalogVersion: driftedCatalogPlan.catalogVersion,
      catalogSha256: driftedCatalogPlan.catalogSha256,
      countryCode: originalPlan.countryCode,
      sources: originalPlan.sources,
    };
    const transport = documentTransport(driftedIdentityPlan, "body");
    const root = repoRoot();

    await expect(run(driftedIdentityPlan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects a forged external mapping ID before cache or network", async () => {
    const forgedPlan = mutablePlan(mappedManualDocumentPlan("VNM"));
    forgedPlan.sources[0]!.request.url =
      "https://documents.example/sources/wrong-external-id/policy.html";
    const transport = documentTransport(
      forgedPlan as unknown as BasicSourceExecutionPlan,
      "body",
    );
    const root = repoRoot();

    await expect(run(forgedPlan, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects more than 64 entries and duplicate non-plan entries before side effects", async () => {
    const base = mutablePlan(committedWorldBankPlan(["world-bank-country"]));
    base.sources = Array.from({ length: 65 }, (_, index) => ({
      source: {
        ...structuredClone(base.sources[0]!.source),
        sourceId: `source-${String(index).padStart(2, "0")}`,
        adapterId: `adapter-${String(index).padStart(2, "0")}`,
      },
      request: structuredClone(base.sources[0]!.request),
    }));
    const overLimitTransport = fixtureTransport(base);
    const overLimitRoot = repoRoot();

    await expect(run(base, overLimitTransport, overLimitRoot)).rejects.toThrow(ERROR);
    expect(overLimitTransport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(overLimitRoot)).toBe(0);

    const duplicate = mutablePlan(committedWorldBankPlan(["world-bank-country"]));
    duplicate.sources.push(structuredClone(duplicate.sources[0]!));
    const duplicateTransport = fixtureTransport(duplicate);
    const duplicateRoot = repoRoot();
    await expect(run(duplicate, duplicateTransport, duplicateRoot)).rejects.toThrow(ERROR);
    expect(duplicateTransport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(duplicateRoot)).toBe(0);
  });

  test("rejects exact input and plan identity drift without invoking transport", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    const transport = fixtureTransport(plan);
    const root = repoRoot();
    const valid = {
      repoRoot: root,
      countryCode: "VN",
      runId: RUN_ID,
      plan,
      transport,
    };
    const cases: unknown[] = [
      { ...valid, extra: true },
      { ...valid, countryCode: "ID" },
      { ...valid, plan: { ...plan, countryCode: "ID" } },
      { ...valid, plan: { ...plan, catalogSha256: "A".repeat(64) } },
      new Proxy(valid, {}),
    ];
    const accessor = { ...valid };
    Object.defineProperty(accessor, "plan", {
      enumerable: true,
      get: () => {
        throw new Error("SECRET_GETTER");
      },
    });
    cases.push(accessor);

    for (const value of cases) {
      await expect(runBasicSourceExecutionPlanV2(
        value as Parameters<typeof runBasicSourceExecutionPlanV2>[0],
      )).rejects.toThrow(ERROR);
    }
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects a proxied plan array without executing its traps", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    const trap = vi.fn(() => {
      throw new Error("SECRET_PLAN_ARRAY_TRAP");
    });
    const proxiedSources = new Proxy(Array.from(plan.sources), {
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const transport = fixtureTransport(plan);
    const root = repoRoot();

    await expect(run({ ...plan, sources: proxiedSources }, transport, root))
      .rejects.toThrow(ERROR);
    expect(trap).not.toHaveBeenCalled();
    expect(transport.execute).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("rejects a Proxy transport prototype before descriptor or prototype traps", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    const trap = vi.fn(() => {
      throw new Error("SECRET_TRANSPORT_PROTOTYPE_TRAP");
    });
    const proxyPrototype = new Proxy({}, {
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
    });
    const transport = Object.create(proxyPrototype) as BasicSourceTransportV2;
    const root = repoRoot();

    await expect(run(plan, transport, root)).rejects.toThrow(ERROR);
    expect(trap).not.toHaveBeenCalled();
    expect(cacheEntryCount(root)).toBe(0);
  });

  test("refuses a cached capture from another catalog digest", async () => {
    const plan = committedWorldBankPlan(["world-bank-country"]);
    const root = repoRoot();
    await run(plan, fixtureTransport(plan), root);
    const drifted = {
      ...plan,
      catalogSha256: "0".repeat(64),
    };
    const transport = fixtureTransport(drifted);

    await expect(run(drifted, transport, root)).rejects.toThrow(ERROR);
    expect(transport.execute).not.toHaveBeenCalled();
  });

  test("does not call global fetch, model, Hermes, search, socket, or child-process sentinels", async () => {
    const sentinels = ["fetch", "model", "Hermes", "search", "socket", "childProcess"];
    const calls = new Map<string, ReturnType<typeof vi.fn>>();
    for (const name of sentinels) {
      const sentinel = vi.fn(() => {
        throw new Error(`${name} must not run`);
      });
      calls.set(name, sentinel);
      vi.stubGlobal(name, sentinel);
    }
    const plan = committedWorldBankPlan(["world-bank-country"]);

    await run(plan, fixtureTransport(plan));

    for (const sentinel of calls.values()) expect(sentinel).not.toHaveBeenCalled();
  });

  test("statically forbids network, process, model, Hermes, and search imports or dependencies", () => {
    const productionSource = readFileSync(fileURLToPath(new URL(
      "./collection/basic-source-plan-runner-v2.ts",
      import.meta.url,
    )), "utf8");
    const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL(
      "../package.json",
      import.meta.url,
    )), "utf8")) as Record<string, unknown>;
    const dependencyNames = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((key) => {
      const value = packageJson[key];
      return isRecord(value) ? Object.keys(value) : [];
    });
    const forbiddenNodeModule =
      /^(?:node:)?(?:child_process|dgram|http|https|net|tls)(?:$|\/)/;
    const forbiddenCapability = /hermes|searx(?:ng)?|llama|model|search/i;
    const forbidden = (specifier: string) =>
      forbiddenNodeModule.test(specifier) || forbiddenCapability.test(specifier);
    const productionSpecifiers = staticModuleSpecifiers(productionSource);

    expect(productionSpecifiers).toEqual(expect.arrayContaining([
      "node:fs/promises",
      "node:path",
      "node:util/types",
      "./basic-source-request-materializer.js",
    ]));
    expect(staticModuleSpecifiers(`
      import "node:http";
      export { connect } from "node:net";
      const model = import("@local/llama-model");
      const search = require("searxng-search");
    `).filter(forbidden)).toEqual([
      "node:net",
      "node:http",
      "@local/llama-model",
      "searxng-search",
    ]);
    expect(productionSpecifiers.filter(forbidden)).toEqual([]);
    expect(dependencyNames.filter(forbidden)).toEqual([]);
  });
});

async function run(
  plan: BasicSourceExecutionPlan,
  transport: BasicSourceTransportV2,
  root = repoRoot(),
  runId = RUN_ID,
) {
  return runBasicSourceExecutionPlanV2({
    repoRoot: root,
    countryCode: "VN",
    runId,
    plan,
    transport,
  });
}

function committedWorldBankPlan(
  sourceIds = [
    "world-bank-country",
    "world-bank-gdp",
    "world-bank-gdp-growth",
    "world-bank-population",
  ],
): BasicSourceExecutionPlan {
  const value: unknown = JSON.parse(readFileSync(
    fileURLToPath(new URL("../catalog/basic-source-catalog.json", import.meta.url)),
    "utf8",
  ));
  return createBasicSourceExecutionPlan({
    catalog: parseBasicSourceCatalog(value),
    countryCode: "VN",
    sourceIds,
  });
}

function countryPlanWithFieldPaths(fieldPaths: readonly string[]) {
  const value = committedCatalogValue();
  const source = value.sources.find(({ sourceId }) => sourceId === "world-bank-country");
  if (source === undefined) throw new Error("fixture source missing");
  source.fieldPaths = Array.from(fieldPaths);
  const catalog = parseBasicSourceCatalog(value);
  return createBasicSourceExecutionPlan({
    catalog,
    countryCode: "VN",
    sourceIds: ["world-bank-country"],
  });
}

function manualDocumentPlan(format: "html" | "pdf") {
  const accept = format === "html" ? "text/html" : "application/pdf";
  const sourceId = `official-${format}`;
  const value = {
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: "2026-07-12.documents-1",
    sources: [{
      sourceId,
      sourceName: `Official ${format.toUpperCase()}`,
      sourceFamily: "government",
      credibility: "OFFICIAL",
      format,
      countryScope: ["VN"],
      requestTemplate: {
        origin: "https://documents.example",
        pathSegments: [
          { kind: "literal", value: "sources" },
          { kind: "placeholder", value: "countryCode" },
          { kind: "literal", value: `policy.${format}` },
        ],
        query: [],
      },
      accept,
      approvedOrigins: ["https://documents.example"],
      allowedQueryParameters: [],
      accessMode: "open",
      licenseName: "Official public information",
      licenseUrl: "https://documents.example/license",
      attribution: "Official authority",
      refreshCadence: "event-driven",
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document",
      fieldPaths: ["country.summary"],
    }],
    countryMappings: [],
  };
  const catalog = parseBasicSourceCatalog(value);
  return createBasicSourceExecutionPlan({
    catalog,
    countryCode: "VN",
    sourceIds: [sourceId],
  });
}

function mappedManualDocumentPlan(sourceCountryId: string) {
  const value = {
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: "2026-07-12.documents-1",
    sources: [{
      sourceId: "official-html",
      sourceName: "Official HTML",
      sourceFamily: "government",
      credibility: "OFFICIAL",
      format: "html",
      countryScope: ["VN"],
      requestTemplate: {
        origin: "https://documents.example",
        pathSegments: [
          { kind: "literal", value: "sources" },
          { kind: "placeholder", value: "sourceCountryId" },
          { kind: "literal", value: "policy.html" },
        ],
        query: [],
      },
      accept: "text/html",
      approvedOrigins: ["https://documents.example"],
      allowedQueryParameters: [],
      accessMode: "open",
      licenseName: "Official public information",
      licenseUrl: "https://documents.example/license",
      attribution: "Official authority",
      refreshCadence: "event-driven",
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document",
      fieldPaths: ["country.summary"],
    }],
    countryMappings: [{
      countryCode: "VN",
      sourceId: "official-html",
      sourceCountryId,
    }],
  };
  const catalog = parseBasicSourceCatalog(value);
  return createBasicSourceExecutionPlan({
    catalog,
    countryCode: "VN",
    sourceIds: ["official-html"],
  });
}

function fixtureTransport(
  plan: Pick<BasicSourceExecutionPlan, "sources">,
  onExecute?: () => void,
): BasicSourceTransportV2 & { execute: ReturnType<typeof vi.fn> } {
  const fixtures = new Map([
    ["world-bank-country", fixture("world-bank-country-vn.json")],
    ["world-bank-gdp", fixture("world-bank-gdp-vn.json")],
    ["world-bank-gdp-growth", fixture("world-bank-gdp-growth-vn.json")],
    ["world-bank-population", fixture("world-bank-population-vn.json")],
  ]);
  const sourceByUrl = new Map(plan.sources.map(({ source, request }) => [
    request.url,
    source.sourceId,
  ]));
  const execute = vi.fn(async (request: BasicSourceExecutionPlan["sources"][number]["request"]) => {
    onExecute?.();
    const sourceId = sourceByUrl.get(request.url);
    const item = sourceId === undefined ? undefined : fixtures.get(sourceId);
    if (item === undefined) throw new Error("unexpected fixture transport request");
    return {
      status: 200,
      finalUrl: request.url,
      contentType: "application/json; charset=utf-8",
      retrievedAt: RETRIEVED_AT,
      redirectChain: [],
      body: bytes(item.body),
    };
  });
  return { execute };
}

function documentTransport(
  plan: BasicSourceExecutionPlan,
  body: string,
): BasicSourceTransportV2 & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    status: 200,
    finalUrl: plan.sources[0]!.request.url,
    contentType: plan.sources[0]!.request.accept,
    retrievedAt: RETRIEVED_AT,
    redirectChain: [],
    body: bytes(new TextEncoder().encode(body)),
  }));
  return { execute };
}

async function* bytes(value: Uint8Array) {
  yield new Uint8Array(value);
}

function fixture(name: string): {
  readonly body: Uint8Array;
  readonly contentSha256: string;
} {
  const value: unknown = JSON.parse(readFileSync(fileURLToPath(new URL(
    `../fixtures/source-adapters/${name}`,
    import.meta.url,
  )), "utf8"));
  if (!isRecord(value) || typeof value.bodyBase64 !== "string" ||
      typeof value.contentSha256 !== "string") {
    throw new Error("fixture is invalid");
  }
  return {
    body: new Uint8Array(Buffer.from(value.bodyBase64, "base64")),
    contentSha256: value.contentSha256,
  };
}

function observation(
  fieldPath: string,
  locator: string,
  rawValue: string,
  normalizedValue: string | { readonly zh: string; readonly en: string },
) {
  return {
    fieldPath,
    locator,
    rawValue,
    normalizedValue,
    unit: null,
    year: null,
    uncertainty: null,
  };
}

function committedCatalogValue(): {
  sources: Array<{ sourceId: string; fieldPaths: string[] }>;
  [key: string]: unknown;
} {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL("../catalog/basic-source-catalog.json", import.meta.url)),
    "utf8",
  )) as {
    sources: Array<{ sourceId: string; fieldPaths: string[] }>;
    [key: string]: unknown;
  };
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

type MutablePlan = Mutable<BasicSourceExecutionPlan>;

function mutablePlan(plan: BasicSourceExecutionPlan): MutablePlan {
  return structuredClone(plan) as unknown as MutablePlan;
}

function repoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "navigator-basic-runner-v2-"));
  roots.add(root);
  return root;
}

function cacheEntryCount(root: string): number {
  const cache = join(root, ".cache");
  try {
    return readdirSync(cache, { recursive: true }).length;
  } catch {
    return 0;
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

async function rejection(value: Promise<unknown>): Promise<Error> {
  try {
    await value;
    throw new Error("expected rejection");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function staticModuleSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}
