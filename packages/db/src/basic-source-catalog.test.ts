import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  BASIC_MANUAL_DOCUMENT_ADAPTER_ID,
  BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION,
  canonicalizeBasicSourceCatalog,
  parseBasicSourceCatalog,
} from "./collection/basic-source-catalog.js";
import { resolveBasicSourceAdapter } from "./collection/basic-source-adapter-registry.js";
import {
  createBasicSourceExecutionPlan,
  isBasicSourceExecutionPlanEntryTrusted,
  snapshotBasicSourceExecutionPlanEntryProvenance,
  type BasicSourceExecutionPlanEntry,
} from "./collection/basic-source-request-materializer.js";

type MutableRecord = Record<string, unknown>;

describe("Basic source catalog parser", () => {
  test("parses, reconstructs, and recursively freezes an exact catalog", () => {
    const input = validCatalog();
    const result = parseBasicSourceCatalog(input);

    expect(result.catalog.schemaVersion).toBe("basic-source-catalog/v1");
    expect(result.catalog.sources[0]?.sourceId).toBe("world-bank-country");
    expect(result.catalogSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.catalog).not.toBe(input);
    expect(result.catalog.sources).not.toBe(input.sources);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.catalog)).toBe(true);
    expect(Object.isFrozen(result.catalog.sources)).toBe(true);
    expect(Object.isFrozen(result.catalog.sources[0])).toBe(true);
    expect(Object.isFrozen(result.catalog.sources[0]?.requestTemplate)).toBe(true);
    expect(Object.isFrozen(result.catalog.sources[0]?.requestTemplate.pathSegments)).toBe(true);
  });

  test("canonicalizes schema object key order before hashing", () => {
    const left = validCatalog();
    const right = {
      countryMappings: left.countryMappings,
      sources: left.sources,
      catalogVersion: left.catalogVersion,
      schemaVersion: left.schemaVersion,
    };

    const leftResult = parseBasicSourceCatalog(left);
    const rightResult = parseBasicSourceCatalog(right);
    expect(rightResult.catalogSha256).toBe(leftResult.catalogSha256);
    expect(canonicalizeBasicSourceCatalog(rightResult.catalog)).toBe(
      canonicalizeBasicSourceCatalog(leftResult.catalog),
    );
  });

  test("changes the digest when catalog semantics change", () => {
    const left = validCatalog();
    const right = validCatalog();
    right.catalogVersion = "2026-07-12.2";

    expect(parseBasicSourceCatalog(right).catalogSha256).not.toBe(
      parseBasicSourceCatalog(left).catalogSha256,
    );
  });

  test("exports the reviewed generic manual-document identity", () => {
    expect(BASIC_MANUAL_DOCUMENT_ADAPTER_ID).toBe(
      "basic-manual-document-capture",
    );
    expect(BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION).toBe("1.0.0");
  });

  test.each([
    ["an extra top-level key", () => ({ ...validCatalog(), extra: true })],
    [
      "a missing top-level key",
      () => {
        const { countryMappings: _removed, ...value } = validCatalog();
        return value;
      },
    ],
    [
      "an accessor",
      () => {
        const value = validCatalog() as unknown as MutableRecord;
        Object.defineProperty(value, "catalogVersion", {
          enumerable: true,
          get: () => "2026-07-12.1",
        });
        return value;
      },
    ],
    [
      "a symbol key",
      () => Object.assign(validCatalog(), { [Symbol("hidden")]: true }),
    ],
    ["a proxy", () => new Proxy(validCatalog(), {})],
    [
      "a cyclic value",
      () => {
        const value = validCatalog() as unknown as MutableRecord;
        value.cycle = value;
        return value;
      },
    ],
    [
      "a sparse array",
      () => {
        const value = validCatalog();
        value.sources = new Array(1) as typeof value.sources;
        return value;
      },
    ],
    [
      "an unsafe catalog version",
      () => changedSource(validCatalog(), () => undefined, { catalogVersion: "../v2" }),
    ],
    [
      "an unsafe source id",
      () => changedSource(validCatalog(), (source) => { source.sourceId = "../source"; }),
    ],
    [
      "an unpaired Unicode surrogate",
      () => changedSource(validCatalog(), (source) => { source.sourceName = "\ud800"; }),
    ],
    [
      "an invalid source family",
      () => changedSource(validCatalog(), (source) => { source.sourceFamily = "media"; }),
    ],
    [
      "an invalid credibility",
      () => changedSource(validCatalog(), (source) => { source.credibility = "TRUSTED"; }),
    ],
    [
      "an HTTP origin",
      () => changedSource(validCatalog(), (source) => {
        source.requestTemplate = {
          ...source.requestTemplate,
          origin: "http://api.worldbank.org",
        };
        source.approvedOrigins = ["http://api.worldbank.org"];
      }),
    ],
    [
      "an origin with a path",
      () => changedSource(validCatalog(), (source) => {
        source.requestTemplate = {
          ...source.requestTemplate,
          origin: "https://api.worldbank.org/v2",
        };
        source.approvedOrigins = ["https://api.worldbank.org/v2"];
      }),
    ],
    [
      "an HTTP license URL",
      () => changedSource(validCatalog(), (source) => {
        source.licenseUrl = "http://example.com/license";
      }),
    ],
    [
      "a whitespace-padded license URL",
      () => changedSource(validCatalog(), (source) => {
        source.licenseUrl = " https://example.com/license ";
      }),
    ],
    [
      "a non-canonical license URL",
      () => changedSource(validCatalog(), (source) => {
        source.licenseUrl = "https://exam\tple.com/license";
      }),
    ],
    [
      "an unknown field path",
      () => changedSource(validCatalog(), (source) => {
        source.fieldPaths = ["marketOverview.unknown"];
      }),
    ],
    [
      "a wildcard indicator path",
      () => changedSource(validCatalog(), (source) => {
        source.fieldPaths = ["marketOverview.keyIndicators[*].value"];
      }),
    ],
    [
      "unsorted field paths",
      () => changedSource(validCatalog(), (source) => {
        source.fieldPaths = ["country.name", "country.code"];
      }),
    ],
    [
      "duplicate field paths",
      () => changedSource(validCatalog(), (source) => {
        source.fieldPaths = ["country.code", "country.code"];
      }),
    ],
    [
      "duplicate query names",
      () => changedSource(validCatalog(), (source) => {
        source.requestTemplate = {
          ...source.requestTemplate,
          query: [source.requestTemplate.query[0]!, source.requestTemplate.query[0]!],
        };
        source.allowedQueryParameters = ["format", "format"];
      }),
    ],
    [
      "query allowlist drift",
      () => changedSource(validCatalog(), (source) => {
        source.allowedQueryParameters = ["other"];
      }),
    ],
    [
      "an origin outside the approved list",
      () => changedSource(validCatalog(), (source) => {
        source.approvedOrigins = ["https://example.com"];
      }),
    ],
    [
      "an empty country scope",
      () => changedSource(validCatalog(), (source) => { source.countryScope = []; }),
    ],
    [
      "an unsorted country scope",
      () => changedSource(validCatalog(), (source) => { source.countryScope = ["VN", "ID"]; }),
    ],
    [
      "a duplicate country scope",
      () => changedSource(validCatalog(), (source) => { source.countryScope = ["VN", "VN"]; }),
    ],
    [
      "an invalid country scope code",
      () => changedSource(validCatalog(), (source) => { source.countryScope = ["VNM"]; }),
    ],
    [
      "an invalid accept for JSON",
      () => changedSource(validCatalog(), (source) => { source.accept = "text/csv"; }),
    ],
    [
      "a manual-document JSON source",
      () => changedSource(validCatalog(), (source) => {
        source.adapterKind = "manual-document";
        source.adapterId = "basic-manual-document-capture";
      }),
    ],
    [
      "a deterministic PDF source",
      () => manualDocumentCatalog({ adapterKind: "deterministic" }),
    ],
    [
      "a drifted manual-document adapter id",
      () => manualDocumentCatalog({ adapterId: "country-pdf-capture" }),
    ],
    [
      "a drifted manual-document adapter version",
      () => manualDocumentCatalog({ adapterVersion: "1.0.1" }),
    ],
    [
      "an invalid mapping country",
      () => mappedCatalog({ countryCode: "VNM" }),
    ],
    [
      "an unknown mapped source",
      () => mappedCatalog({ sourceId: "unknown-source" }),
    ],
    [
      "an orphan mapping",
      () => ({
        ...validCatalog(),
        countryMappings: [{
          countryCode: "VN",
          sourceId: "world-bank-country",
          sourceCountryId: "VNM",
        }],
      }),
    ],
  ])("rejects %s", (_label, createValue) => {
    expect(() => parseBasicSourceCatalog(createValue())).toThrow(
      "basic source catalog is invalid",
    );
  });

  test("rejects unsorted and duplicate source entries", () => {
    const value = validCatalog();
    const second = structuredClone(value.sources[0]!);
    second.sourceId = "alpha-source";
    second.adapterId = "alpha-source";
    value.sources.push(second);
    expect(() => parseBasicSourceCatalog(value)).toThrow(
      "basic source catalog is invalid",
    );

    second.sourceId = value.sources[0]!.sourceId;
    second.adapterId = value.sources[0]!.adapterId;
    expect(() => parseBasicSourceCatalog(value)).toThrow(
      "basic source catalog is invalid",
    );
  });

  test.each([
    ["source extra key", () => changedSource(validCatalog(), (source) => { source.extra = true; })],
    ["source missing key", () => changedSource(validCatalog(), (source) => { delete (source as MutableRecord).attribution; })],
    ["request template extra key", () => changedSource(validCatalog(), (source) => { Object.assign(source.requestTemplate, { extra: true }); })],
    ["request template missing key", () => changedSource(validCatalog(), (source) => { delete (source.requestTemplate as MutableRecord).query; })],
    ["token extra key", () => changedSource(validCatalog(), (source) => { Object.assign(source.requestTemplate.pathSegments[0]!, { extra: true }); })],
    ["token missing key", () => changedSource(validCatalog(), (source) => { delete (source.requestTemplate.pathSegments[0] as MutableRecord).value; })],
    ["query extra key", () => changedSource(validCatalog(), (source) => { Object.assign(source.requestTemplate.query[0]!, { extra: true }); })],
    ["query missing key", () => changedSource(validCatalog(), (source) => { delete (source.requestTemplate.query[0] as unknown as MutableRecord).value; })],
    ["mapping extra key", () => { const value = mappedCatalog(); Object.assign(value.countryMappings[0]!, { extra: true }); return value; }],
    ["mapping missing key", () => { const value = mappedCatalog(); delete (value.countryMappings[0] as unknown as MutableRecord).sourceCountryId; return value; }],
    ["nested accessor", () => changedSource(validCatalog(), (source) => { Object.defineProperty(source, "sourceName", { enumerable: true, get: () => "World Bank" }); })],
    ["nested symbol key", () => changedSource(validCatalog(), (source) => { Object.assign(source, { [Symbol("hidden")]: true }); })],
  ])("rejects a %s", (_label, createValue) => {
    expect(() => parseBasicSourceCatalog(createValue())).toThrow(
      "basic source catalog is invalid",
    );
  });

  test("rejects unsorted and duplicate country mappings", () => {
    const unsorted = mappedCatalog();
    unsorted.countryMappings = [
      { countryCode: "VN", sourceId: "world-bank-country", sourceCountryId: "VNM" },
      { countryCode: "ID", sourceId: "world-bank-country", sourceCountryId: "IDN" },
    ];
    expect(() => parseBasicSourceCatalog(unsorted)).toThrow(
      "basic source catalog is invalid",
    );

    const duplicate = mappedCatalog();
    duplicate.countryMappings.push(structuredClone(duplicate.countryMappings[0]!));
    expect(() => parseBasicSourceCatalog(duplicate)).toThrow(
      "basic source catalog is invalid",
    );
  });

  test("accepts an exact indexed indicator field path", () => {
    const value = validCatalog();
    value.sources[0]!.fieldPaths = [
      "marketOverview.keyIndicators[0].label",
      "marketOverview.keyIndicators[0].unit",
      "marketOverview.keyIndicators[0].value",
      "marketOverview.keyIndicators[0].year",
    ];
    expect(parseBasicSourceCatalog(value).catalog.sources[0]?.fieldPaths).toEqual(
      value.sources[0]?.fieldPaths,
    );
  });

  test.each([
    ["sources", () => catalogWithSources(2_049)],
    ["mappings", () => catalogWithMappings(10_001)],
    ["field paths", () => catalogWithFieldPaths(129)],
    ["query entries", () => catalogWithQueryEntries(65)],
    ["generic arrays", () => manualDocumentCatalog({ countryScope: countryCodes(257) })],
    ["string bytes", () => changedSource(validCatalog(), (source) => { source.sourceName = "x".repeat(65_537); })],
    ["URL bytes", () => changedSource(validCatalog(), (source) => { source.licenseUrl = `https://example.com/${"x".repeat(8_193)}`; })],
    ["JSON depth", () => catalogWithNestedSourceName(64)],
  ])("rejects the %s resource limit", (_label, createValue) => {
    expect(() => parseBasicSourceCatalog(createValue())).toThrow(
      "basic source catalog is invalid",
    );
  });
});

describe("Basic source request materializer", () => {
  const finalUrlCases = [
    ["path literal", pathLiteralCatalogForToken],
    ["query literal", queryLiteralCatalogForToken],
    ["percent-expanded sourceCountryId mapping", mappedCountryIdCatalogForToken],
  ] as const;

  test("materializes countryCode in a path and preserves exact query order", () => {
    const catalog = parseBasicSourceCatalog(validCatalog());

    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    });

    expect(plan).toEqual({
      catalogVersion: "2026-07-12.1",
      catalogSha256: catalog.catalogSha256,
      countryCode: "VN",
      sources: [{
        source: catalog.catalog.sources[0],
        request: {
          method: "GET",
          url: "https://api.worldbank.org/v2/country/VN?format=json",
          accept: "application/json",
          allowedOrigins: ["https://api.worldbank.org"],
          allowedQueryParameters: ["format"],
        },
      }],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sources)).toBe(true);
    expect(Object.isFrozen(plan.sources[0]?.request)).toBe(true);
  });

  test("binds materialized entries to unforgeable full-catalog provenance", () => {
    const catalog = parseBasicSourceCatalog(twoSourceCatalog());
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: ["world-bank-country", "world-bank-population"],
    });

    const firstProvenance = snapshotBasicSourceExecutionPlanEntryProvenance(
      plan.sources[0],
    );
    const secondProvenance = snapshotBasicSourceExecutionPlanEntryProvenance(
      plan.sources[1],
    );
    expect(firstProvenance).toEqual({
      catalogVersion: catalog.catalog.catalogVersion,
      catalogSha256: catalog.catalogSha256,
      countryCode: "VN",
    });
    expect(secondProvenance).toBe(firstProvenance);
    expect(isBasicSourceExecutionPlanEntryTrusted(plan.sources[0])).toBe(true);

    const forgedEntry = structuredClone(plan.sources[0]);
    expect(isBasicSourceExecutionPlanEntryTrusted(forgedEntry)).toBe(false);
    expect(snapshotBasicSourceExecutionPlanEntryProvenance(forgedEntry)).toBeNull();
  });

  test("materializes a literal-only URL", () => {
    const value = validCatalog();
    value.sources[0]!.requestTemplate = {
      origin: "https://api.worldbank.org",
      pathSegments: [
        { kind: "literal", value: "v2" },
        { kind: "literal", value: "fixed" },
      ],
      query: [],
    };
    value.sources[0]!.allowedQueryParameters = [];

    const plan = createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    });

    expect(plan.sources[0]?.request.url).toBe(
      "https://api.worldbank.org/v2/fixed",
    );
  });

  test("encodes sourceCountryId as one path component and one query value", () => {
    const value = mappedCatalog();
    value.countryMappings[0]!.sourceCountryId = "Viet Nam/2026";
    value.sources[0]!.requestTemplate.query = [
      { name: "format", value: { kind: "literal", value: "json" } },
      {
        name: "external",
        value: { kind: "placeholder", value: "sourceCountryId" },
      },
    ];
    value.sources[0]!.allowedQueryParameters = ["format", "external"];

    const plan = createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    });

    expect(plan.sources[0]?.request.url).toBe(
      "https://api.worldbank.org/v2/country/Viet%20Nam%2F2026?format=json&external=Viet+Nam%2F2026",
    );
  });

  test("supports non-alphanumeric literal query names through URLSearchParams", () => {
    const value = validCatalog();
    value.sources[0]!.requestTemplate.query = [{
      name: "$filter",
      value: { kind: "literal", value: "active" },
    }];
    value.sources[0]!.allowedQueryParameters = ["$filter"];

    const plan = createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    });

    expect(plan.sources[0]?.request).toMatchObject({
      url: "https://api.worldbank.org/v2/country/VN?%24filter=active",
      allowedQueryParameters: ["$filter"],
    });
  });

  test.each(finalUrlCases)(
    "accepts an 8,192-byte final URL and rejects 8,193 bytes for a %s",
    (_label, createCatalog) => {
      const { plan, token } = findExactPlannedUrl(createCatalog, 8_192);
      expect(Buffer.byteLength(plan.sources[0]!.request.url, "utf8")).toBe(
        8_192,
      );
      const catalog = parseBasicSourceCatalog(createCatalog(`${token}x`));

      expect(() => createBasicSourceExecutionPlan({
        catalog,
        countryCode: "VN",
        sourceIds: ["world-bank-country"],
      })).toThrow("source catalog execution plan is invalid");
    },
  );

  test.each([
    ["a lowercase country code", { countryCode: "vn", sourceIds: ["world-bank-country"] }],
    ["an unknown source", { countryCode: "VN", sourceIds: ["unknown-source"] }],
    ["no selected sources", { countryCode: "VN", sourceIds: [] }],
    ["unsorted source ids", { countryCode: "VN", sourceIds: ["world-bank-population", "world-bank-country"] }],
    ["duplicate source ids", { countryCode: "VN", sourceIds: ["world-bank-country", "world-bank-country"] }],
  ])("rejects %s", (_label, selection) => {
    const value = selection.sourceIds.includes("world-bank-population")
      ? twoSourceCatalog()
      : validCatalog();
    expect(() => createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: selection.countryCode,
      sourceIds: selection.sourceIds,
    })).toThrow("source catalog execution plan is invalid");
  });

  test("rejects a missing sourceCountryId mapping", () => {
    const value = mappedCatalog();
    value.countryMappings = [];
    expect(() => createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    })).toThrow("source catalog mapping is invalid");
  });

  test("rejects a country outside source scope", () => {
    const value = validCatalog();
    value.sources[0]!.countryScope = ["ID"];
    expect(() => createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    })).toThrow("source catalog execution plan is invalid");
  });

  test("rejects optional-credentialed sources", () => {
    const value = validCatalog();
    value.sources[0]!.accessMode = "optional-credentialed";
    expect(() => createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    })).toThrow("source catalog execution plan is invalid");
  });

  test("rejects more than 64 active sources", () => {
    const value = catalogWithSources(65);
    expect(() => createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(value),
      countryCode: "VN",
      sourceIds: value.sources.map(({ sourceId }) => sourceId),
    })).toThrow("source catalog execution plan is invalid");
  });

  test.each([
    ["a placeholder in an origin", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.origin = "https://{countryCode}.example.com";
      source.approvedOrigins = [source.requestTemplate.origin];
    }],
    ["a placeholder in a query name", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.query[0]!.name = "{countryCode}";
      source.allowedQueryParameters = ["{countryCode}"];
    }],
    ["a placeholder substring", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.pathSegments[1] = {
        kind: "literal",
        value: "country-{countryCode}",
      };
    }],
    ["URL credentials", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.origin = "https://user:pass@api.worldbank.org";
      source.approvedOrigins = [source.requestTemplate.origin];
    }],
    ["a URL fragment", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.origin = "https://api.worldbank.org#fragment";
      source.approvedOrigins = [source.requestTemplate.origin];
    }],
    ["a pre-encoded component", (source: ReturnType<typeof validSource>) => {
      source.requestTemplate.pathSegments[1] = {
        kind: "literal",
        value: "country%2Fadmin",
      };
    }],
  ])("rejects %s before planning", (_label, mutate) => {
    const value = validCatalog();
    mutate(value.sources[0]!);
    expect(() => parseBasicSourceCatalog(value)).toThrow(
      "basic source catalog is invalid",
    );
  });

  test("rejects a forged catalog digest", () => {
    const catalog = parseBasicSourceCatalog(validCatalog());
    expect(() => createBasicSourceExecutionPlan({
      catalog: { ...catalog, catalogSha256: "0".repeat(64) },
      countryCode: "VN",
      sourceIds: ["world-bank-country"],
    })).toThrow("source catalog execution plan is invalid");
  });

  test.each([".", ".."]) (
    "rejects a literal %s path component before URL normalization",
    (component) => {
      const value = validCatalog();
      value.sources[0]!.requestTemplate.pathSegments[1] = {
        kind: "literal",
        value: component,
      };
      expect(() => createBasicSourceExecutionPlan({
        catalog: parseBasicSourceCatalog(value),
        countryCode: "VN",
        sourceIds: ["world-bank-country"],
      })).toThrow("source catalog execution plan is invalid");
    },
  );

  test.each([".", ".."]) (
    "rejects a mapped %s path component before URL normalization",
    (component) => {
      const value = mappedCatalog();
      value.countryMappings[0]!.sourceCountryId = component;
      expect(() => createBasicSourceExecutionPlan({
        catalog: parseBasicSourceCatalog(value),
        countryCode: "VN",
        sourceIds: ["world-bank-country"],
      })).toThrow("source catalog execution plan is invalid");
    },
  );
});

describe("Basic source adapter registry", () => {
  test("resolves all four reviewed World Bank adapter identities", () => {
    const plan = createBasicSourceExecutionPlan({
      catalog: parseBasicSourceCatalog(fourWorldBankCatalog()),
      countryCode: "VN",
      sourceIds: [
        "world-bank-country",
        "world-bank-gdp",
        "world-bank-gdp-growth",
        "world-bank-population",
      ],
    });

    expect(plan.sources.map((entry) =>
      resolveBasicSourceAdapter(entry, "VN").adapterId)).toEqual([
      "world-bank-country",
      "world-bank-gdp",
      "world-bank-gdp-growth",
      "world-bank-population",
    ]);
  });

  test.each([
    ["source id", (entry: MutableRegistryEntry) => { entry.source.sourceId = "world-bank-country-drift"; }],
    ["source name", (entry: MutableRegistryEntry) => { entry.source.sourceName = "World Bank Drift"; }],
    ["source family", (entry: MutableRegistryEntry) => { entry.source.sourceFamily = "government"; }],
    ["credibility", (entry: MutableRegistryEntry) => { entry.source.credibility = "VERIFIED"; }],
    ["adapter id", (entry: MutableRegistryEntry) => { entry.source.adapterId = "unknown-adapter"; }],
    ["adapter version", (entry: MutableRegistryEntry) => { entry.source.adapterVersion = "1.0.1"; }],
    ["request method", (entry: MutableRegistryEntry) => { entry.request.method = "POST"; }],
    ["request URL", (entry: MutableRegistryEntry) => { entry.request.url = "https://api.worldbank.org/v2/country/ID?format=json"; }],
    ["request Accept", (entry: MutableRegistryEntry) => { entry.request.accept = "text/csv"; }],
    ["request origins", (entry: MutableRegistryEntry) => { entry.request.allowedOrigins = ["https://example.com"]; }],
    ["request query names", (entry: MutableRegistryEntry) => { entry.request.allowedQueryParameters = ["other"]; }],
    ["catalog Accept", (entry: MutableRegistryEntry) => { entry.source.accept = "text/csv"; }],
    ["catalog origins", (entry: MutableRegistryEntry) => { entry.source.approvedOrigins = ["https://example.com"]; }],
    ["catalog query names", (entry: MutableRegistryEntry) => { entry.source.allowedQueryParameters = ["other"]; }],
    ["adapter kind", (entry: MutableRegistryEntry) => { entry.source.adapterKind = "manual-document"; }],
    ["format", (entry: MutableRegistryEntry) => { entry.source.format = "csv"; }],
    ["access mode", (entry: MutableRegistryEntry) => { entry.source.accessMode = "optional-credentialed"; }],
  ])("rejects %s drift", (_label, mutate) => {
    const entry = mutableRegistryEntry();
    mutate(entry);
    expect(() => resolveBasicSourceAdapter(
      entry as unknown as BasicSourceExecutionPlanEntry,
      "VN",
    )).toThrow("source catalog adapter binding is invalid");
  });

  test("rejects an invalid country before returning an adapter", () => {
    expect(() => resolveBasicSourceAdapter(
      mutableRegistryEntry() as unknown as BasicSourceExecutionPlanEntry,
      "vn",
    )).toThrow("source catalog adapter binding is invalid");
  });
});

describe("committed Basic source catalog", () => {
  test("registers the eight reviewed Basic sources in deterministic order", () => {
    const catalog = readCommittedCatalog();
    const sourceIds = [
      "indonesia-esdm-2025-performance",
      "indonesia-esdm-national-energy-policy-2025",
      "vietnam-chinhphu-adjusted-pdp8-2025",
      "vietnam-evn-annual-report-2024-2025",
      "world-bank-country",
      "world-bank-gdp",
      "world-bank-gdp-growth",
      "world-bank-population",
    ] as const;
    const worldBankSourceIds = [
      "world-bank-country",
      "world-bank-gdp",
      "world-bank-gdp-growth",
      "world-bank-population",
    ] as const;

    expect(catalog.catalog.catalogVersion).toBe("2026-07-15.1");
    expect(catalog.catalog.countryMappings).toEqual([]);
    expect(catalog.catalogSha256).toBe(
      "ddb53c6b6fb82bc7dd050475a04b147f3ffa43b76886974591e950f829872f92",
    );
    expect(catalog.catalog.sources.map(({ sourceId }) => sourceId)).toEqual(
      sourceIds,
    );

    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: worldBankSourceIds,
    });
    for (const entry of plan.sources) {
      const adapter = resolveBasicSourceAdapter(entry, "VN");
      expect(entry.request).toEqual(adapter.request("VN"));
    }
  });

  test("materializes the reviewed Indonesia government document requests", () => {
    const catalog = readCommittedCatalog();
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "ID",
      sourceIds: [
        "indonesia-esdm-2025-performance",
        "indonesia-esdm-national-energy-policy-2025",
      ],
    });

    expect(plan).toMatchObject({
      catalogVersion: "2026-07-15.1",
      countryCode: "ID",
      sources: [
        {
          source: {
            sourceId: "indonesia-esdm-2025-performance",
            sourceFamily: "energy-authority",
            format: "html",
            countryScope: ["ID"],
            requestTemplate: {
              origin: "https://www.esdm.go.id",
              pathSegments: [
                { kind: "literal", value: "en" },
                { kind: "literal", value: "media-center" },
                { kind: "literal", value: "news-archives" },
                {
                  kind: "literal",
                  value: "capaian-positif-tahun-2025-negara-hadir-penuhi-kebutuhan-energi-masyarakat",
                },
              ],
              query: [],
            },
            accept: "text/html",
            approvedOrigins: ["https://www.esdm.go.id"],
            allowedQueryParameters: [],
            accessMode: "open",
            refreshCadence: "annual",
            adapterId: "basic-manual-document-capture",
            adapterVersion: "1.0.0",
            adapterKind: "manual-document",
            fieldPaths: [
              "country.region",
              "country.summary",
              "marketOverview.energyDemand",
              "marketOverview.industryTags",
              "marketOverview.keyIndicators[0].label",
              "marketOverview.keyIndicators[0].unit",
              "marketOverview.keyIndicators[0].value",
              "marketOverview.keyIndicators[0].year",
              "marketOverview.keyIndicators[1].label",
              "marketOverview.keyIndicators[1].unit",
              "marketOverview.keyIndicators[1].value",
              "marketOverview.keyIndicators[1].year",
              "marketOverview.keyIndicators[2].label",
              "marketOverview.keyIndicators[2].unit",
              "marketOverview.keyIndicators[2].value",
              "marketOverview.keyIndicators[2].year",
              "marketOverview.overview",
              "marketOverview.renewableTarget",
              "marketOverview.techTags",
            ],
          },
          request: {
            method: "GET",
            url: "https://www.esdm.go.id/en/media-center/news-archives/capaian-positif-tahun-2025-negara-hadir-penuhi-kebutuhan-energi-masyarakat",
            accept: "text/html",
            allowedOrigins: ["https://www.esdm.go.id"],
            allowedQueryParameters: [],
          },
        },
        {
          source: {
            sourceId: "indonesia-esdm-national-energy-policy-2025",
            sourceFamily: "government",
            format: "pdf",
            countryScope: ["ID"],
            requestTemplate: {
              origin: "https://jdih.esdm.go.id",
              pathSegments: [
                { kind: "literal", value: "dokumen" },
                { kind: "literal", value: "download" },
              ],
              query: [
                {
                  name: "id",
                  value: { kind: "literal", value: "2025pp40.pdf" },
                },
              ],
            },
            accept: "application/pdf",
            approvedOrigins: ["https://jdih.esdm.go.id"],
            allowedQueryParameters: ["id"],
            accessMode: "open",
            refreshCadence: "event-driven",
            adapterId: "basic-manual-document-capture",
            adapterVersion: "1.0.0",
            adapterKind: "manual-document",
            fieldPaths: ["marketOverview.renewableTarget"],
          },
          request: {
            method: "GET",
            url: "https://jdih.esdm.go.id/dokumen/download?id=2025pp40.pdf",
            accept: "application/pdf",
            allowedOrigins: ["https://jdih.esdm.go.id"],
            allowedQueryParameters: ["id"],
          },
        },
      ],
    });
  });

  test("materializes the reviewed Vietnam government HTML request", () => {
    const catalog = readCommittedCatalog();
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: ["vietnam-chinhphu-adjusted-pdp8-2025"],
    });
    const entry = plan.sources[0]!;

    expect(plan).toMatchObject({
      catalogVersion: "2026-07-15.1",
      countryCode: "VN",
    });
    expect({
      url: entry.request.url,
      method: entry.request.method,
      accept: entry.request.accept,
      allowedOrigins: entry.request.allowedOrigins,
      origin: entry.source.requestTemplate.origin,
      approvedOrigins: entry.source.approvedOrigins,
      adapterId: entry.source.adapterId,
      adapterVersion: entry.source.adapterVersion,
      adapterKind: entry.source.adapterKind,
      format: entry.source.format,
      countryScope: entry.source.countryScope,
      fieldPaths: entry.source.fieldPaths,
    }).toEqual({
      url: "https://xaydungchinhsach.chinhphu.vn/quyet-dinh-768-qd-ttg-thu-tuong-chinh-phu-phe-duyet-dieu-chinh-quy-hoach-dien-viii-119250417074054718.htm",
      method: "GET",
      accept: "text/html",
      allowedOrigins: ["https://xaydungchinhsach.chinhphu.vn"],
      origin: "https://xaydungchinhsach.chinhphu.vn",
      approvedOrigins: ["https://xaydungchinhsach.chinhphu.vn"],
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document",
      format: "html",
      countryScope: ["VN"],
      fieldPaths: [
        "country.region",
        "country.summary",
        "marketOverview.energyDemand",
        "marketOverview.industryTags",
        "marketOverview.overview",
        "marketOverview.renewableTarget",
        "marketOverview.techTags",
      ],
    });
  });

  test("materializes the reviewed Vietnam EVN PDF request", () => {
    const catalog = readCommittedCatalog();
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "VN",
      sourceIds: ["vietnam-evn-annual-report-2024-2025"],
    });
    const entry = plan.sources[0]!;

    expect(plan).toMatchObject({
      catalogVersion: "2026-07-15.1",
      countryCode: "VN",
    });
    expect({
      url: entry.request.url,
      method: entry.request.method,
      accept: entry.request.accept,
      allowedOrigins: entry.request.allowedOrigins,
      origin: entry.source.requestTemplate.origin,
      approvedOrigins: entry.source.approvedOrigins,
      adapterId: entry.source.adapterId,
      adapterVersion: entry.source.adapterVersion,
      adapterKind: entry.source.adapterKind,
      format: entry.source.format,
      countryScope: entry.source.countryScope,
      fieldPaths: entry.source.fieldPaths,
    }).toEqual({
      url: "https://en.evn.com.vn/userfile/files/2026/4/AnnualRepot2025_V23-20260408155435105.pdf",
      method: "GET",
      accept: "application/pdf",
      allowedOrigins: ["https://en.evn.com.vn"],
      origin: "https://en.evn.com.vn",
      approvedOrigins: ["https://en.evn.com.vn"],
      adapterId: "basic-manual-document-capture",
      adapterVersion: "1.0.0",
      adapterKind: "manual-document",
      format: "pdf",
      countryScope: ["VN"],
      fieldPaths: [
        "country.summary",
        "marketOverview.energyDemand",
        "marketOverview.keyIndicators[0].label",
        "marketOverview.keyIndicators[0].unit",
        "marketOverview.keyIndicators[0].value",
        "marketOverview.keyIndicators[0].year",
        "marketOverview.keyIndicators[1].label",
        "marketOverview.keyIndicators[1].unit",
        "marketOverview.keyIndicators[1].value",
        "marketOverview.keyIndicators[1].year",
        "marketOverview.keyIndicators[2].label",
        "marketOverview.keyIndicators[2].unit",
        "marketOverview.keyIndicators[2].value",
        "marketOverview.keyIndicators[2].year",
        "marketOverview.overview",
      ],
    });
  });
});

function validCatalog() {
  return {
    schemaVersion: "basic-source-catalog/v1",
    catalogVersion: "2026-07-12.1",
    sources: [validSource()],
    countryMappings: [] as Array<{
      countryCode: string;
      sourceId: string;
      sourceCountryId: string;
    }>,
  };
}

function validSource(): MutableRecord & {
  sourceId: string;
  adapterId: string;
  adapterVersion: string;
  sourceName: string;
  sourceFamily: string;
  credibility: string;
  format: string;
  countryScope: string | string[];
  requestTemplate: {
    origin: string;
    pathSegments: Array<{ kind: string; value: string }>;
    query: Array<{ name: string; value: { kind: string; value: string } }>;
  };
  accept: string;
  approvedOrigins: string[];
  allowedQueryParameters: string[];
  accessMode: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  refreshCadence: string;
  adapterKind: string;
  fieldPaths: string[];
} {
  return {
    sourceId: "world-bank-country",
    sourceName: "World Bank",
    sourceFamily: "international-organization",
    credibility: "OFFICIAL",
    format: "json",
    countryScope: "all",
    requestTemplate: {
      origin: "https://api.worldbank.org",
      pathSegments: [
        { kind: "literal", value: "v2" },
        { kind: "literal", value: "country" },
        { kind: "placeholder", value: "countryCode" },
      ],
      query: [{
        name: "format",
        value: { kind: "literal", value: "json" },
      }],
    },
    accept: "application/json",
    approvedOrigins: ["https://api.worldbank.org"],
    allowedQueryParameters: ["format"],
    accessMode: "open",
    licenseName:
      "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://datacatalog.worldbank.org/public-licenses",
    attribution:
      "World Bank, World Development Indicators; licensed under CC BY 4.0; changes and translations must be indicated.",
    refreshCadence: "annual",
    adapterId: "world-bank-country",
    adapterVersion: "1.0.0",
    adapterKind: "deterministic",
    fieldPaths: ["country.code", "country.name"],
  };
}

function changedSource(
  catalog: ReturnType<typeof validCatalog>,
  mutate: (source: ReturnType<typeof validSource>) => void,
  topLevel: Partial<ReturnType<typeof validCatalog>> = {},
) {
  mutate(catalog.sources[0]!);
  return Object.assign(catalog, topLevel);
}

function manualDocumentCatalog(overrides: MutableRecord = {}) {
  const value = validCatalog();
  value.sources[0] = Object.assign(validSource(), {
    sourceId: "vietnam-energy-plan",
    sourceName: "Vietnam energy plan",
    sourceFamily: "government",
    format: "pdf",
    countryScope: ["VN"],
    requestTemplate: {
      origin: "https://example.gov.vn",
      pathSegments: [
        { kind: "literal", value: "energy-plan.pdf" },
      ],
      query: [],
    },
    accept: "application/pdf",
    approvedOrigins: ["https://example.gov.vn"],
    allowedQueryParameters: [],
    accessMode: "open",
    licenseName: "Official publication terms",
    licenseUrl: "https://example.gov.vn/terms",
    attribution: "Government of Vietnam",
    refreshCadence: "manual",
    adapterId: "basic-manual-document-capture",
    adapterVersion: "1.0.0",
    adapterKind: "manual-document",
    fieldPaths: ["marketOverview.renewableTarget"],
  }, overrides);
  return value;
}

function mappedCatalog(mappingOverrides: MutableRecord = {}) {
  const value = validCatalog();
  value.sources[0]!.requestTemplate.pathSegments[2] = {
    kind: "placeholder",
    value: "sourceCountryId",
  };
  value.countryMappings = [{
    countryCode: "VN",
    sourceId: "world-bank-country",
    sourceCountryId: "VNM",
    ...mappingOverrides,
  } as { countryCode: string; sourceId: string; sourceCountryId: string }];
  return value;
}

function pathLiteralCatalogForToken(token: string) {
  const catalog = validCatalog();
  const source = catalog.sources[0]!;
  source.requestTemplate = {
    origin: source.requestTemplate.origin,
    pathSegments: [{ kind: "literal", value: token }],
    query: [],
  };
  source.allowedQueryParameters = [];
  return catalog;
}

function queryLiteralCatalogForToken(token: string) {
  const catalog = validCatalog();
  const source = catalog.sources[0]!;
  source.requestTemplate = {
    origin: source.requestTemplate.origin,
    pathSegments: [{ kind: "literal", value: "v2" }],
    query: [{ name: "q", value: { kind: "literal", value: token } }],
  };
  source.allowedQueryParameters = ["q"];
  return catalog;
}

function mappedCountryIdCatalogForToken(token: string) {
  const catalog = mappedCatalog();
  const source = catalog.sources[0]!;
  source.requestTemplate = {
    origin: source.requestTemplate.origin,
    pathSegments: [{ kind: "placeholder", value: "sourceCountryId" }],
    query: [],
  };
  source.allowedQueryParameters = [];
  catalog.countryMappings[0]!.sourceCountryId = `/${token}`;
  return catalog;
}

function findExactPlannedUrl(
  createCatalog: (token: string) => ReturnType<typeof validCatalog>,
  targetByteLength: number,
) {
  let lower = 1;
  let upper = targetByteLength;
  while (lower <= upper) {
    const tokenLength = Math.floor((lower + upper) / 2);
    const token = "x".repeat(tokenLength);
    const catalog = parseBasicSourceCatalog(createCatalog(token));
    let plan: ReturnType<typeof createBasicSourceExecutionPlan>;
    try {
      plan = createBasicSourceExecutionPlan({
        catalog,
        countryCode: "VN",
        sourceIds: ["world-bank-country"],
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "source catalog execution plan is invalid"
      ) throw error;
      upper = tokenLength - 1;
      continue;
    }
    const actualByteLength = Buffer.byteLength(
      plan.sources[0]!.request.url,
      "utf8",
    );
    if (actualByteLength < targetByteLength) {
      lower = tokenLength + 1;
    } else if (actualByteLength > targetByteLength) {
      upper = tokenLength - 1;
    } else {
      return { plan, token };
    }
  }
  throw new Error("unable to build exact materialized URL fixture");
}

function catalogWithSources(count: number) {
  const value = validCatalog();
  value.sources = Array.from({ length: count }, (_, index) => {
    const source = validSource();
    source.sourceId = `source-${String(index).padStart(4, "0")}`;
    source.adapterId = source.sourceId;
    return source;
  });
  return value;
}

function catalogWithMappings(count: number) {
  const value = mappedCatalog();
  value.sources[0]!.countryScope = "all";
  value.countryMappings = Array.from({ length: count }, (_, index) => ({
    countryCode: countryCode(index),
    sourceId: "world-bank-country",
    sourceCountryId: `external-${String(index).padStart(5, "0")}`,
  })).sort((left, right) =>
    left.countryCode.localeCompare(right.countryCode) ||
    left.sourceId.localeCompare(right.sourceId));
  return value;
}

function catalogWithFieldPaths(count: number) {
  const value = validCatalog();
  value.sources[0]!.fieldPaths = Array.from(
    { length: count },
    (_, index) => `marketOverview.keyIndicators[${index}].value`,
  ).sort();
  return value;
}

function catalogWithQueryEntries(count: number) {
  const value = validCatalog();
  const query = Array.from({ length: count }, (_, index) => ({
    name: `p${String(index).padStart(2, "0")}`,
    value: { kind: "literal", value: String(index) },
  }));
  value.sources[0]!.requestTemplate.query = query;
  value.sources[0]!.allowedQueryParameters = query.map(({ name }) => name);
  return value;
}

function catalogWithNestedSourceName(depth: number) {
  const value = validCatalog() as unknown as MutableRecord;
  let current: MutableRecord = value;
  for (let index = 0; index < depth; index += 1) {
    const child: MutableRecord = {};
    current.nested = child;
    current = child;
  }
  return value;
}

function twoSourceCatalog() {
  const value = validCatalog();
  const population = validSource();
  population.sourceId = "world-bank-population";
  population.adapterId = "world-bank-population";
  population.fieldPaths = ["marketOverview.population"];
  value.sources.push(population);
  return value;
}

interface MutableRegistryEntry {
  source: ReturnType<typeof validSource>;
  request: {
    method: string;
    url: string;
    accept: string;
    allowedOrigins: string[];
    allowedQueryParameters: string[];
  };
}

function mutableRegistryEntry(): MutableRegistryEntry {
  const plan = createBasicSourceExecutionPlan({
    catalog: parseBasicSourceCatalog(validCatalog()),
    countryCode: "VN",
    sourceIds: ["world-bank-country"],
  });
  return structuredClone(plan.sources[0]!) as unknown as MutableRegistryEntry;
}

function fourWorldBankCatalog() {
  const value = validCatalog();
  value.sources = [
    validSource(),
    indicatorSource(
      "world-bank-gdp",
      "NY.GDP.MKTP.CD",
      "marketOverview.gdp",
    ),
    indicatorSource(
      "world-bank-gdp-growth",
      "NY.GDP.MKTP.KD.ZG",
      "marketOverview.gdpGrowth",
    ),
    indicatorSource(
      "world-bank-population",
      "SP.POP.TOTL",
      "marketOverview.population",
    ),
  ];
  return value;
}

function indicatorSource(
  sourceId: string,
  indicator: string,
  fieldPath: string,
) {
  const source = validSource();
  source.sourceId = sourceId;
  source.adapterId = sourceId;
  source.requestTemplate = {
    origin: "https://api.worldbank.org",
    pathSegments: [
      { kind: "literal", value: "v2" },
      { kind: "literal", value: "country" },
      { kind: "placeholder", value: "countryCode" },
      { kind: "literal", value: "indicator" },
      { kind: "literal", value: indicator },
    ],
    query: [
      { name: "source", value: { kind: "literal", value: "2" } },
      { name: "format", value: { kind: "literal", value: "json" } },
      { name: "mrv", value: { kind: "literal", value: "1" } },
      { name: "per_page", value: { kind: "literal", value: "1" } },
    ],
  };
  source.allowedQueryParameters = ["source", "format", "mrv", "per_page"];
  source.fieldPaths = [fieldPath];
  return source;
}

function countryCodes(count: number): string[] {
  return Array.from({ length: count }, (_, index) => countryCode(index)).sort();
}

function countryCode(index: number): string {
  const normalized = index % (26 * 26);
  return `${String.fromCharCode(65 + Math.floor(normalized / 26))}${String.fromCharCode(65 + normalized % 26)}`;
}

function readCommittedCatalog() {
  const pathname = fileURLToPath(
    new URL("../catalog/basic-source-catalog.json", import.meta.url),
  );
  const value: unknown = JSON.parse(readFileSync(pathname, "utf8"));
  return parseBasicSourceCatalog(value);
}
