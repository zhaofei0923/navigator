import { describe, expect, test } from "vitest";

import {
  BASIC_MANUAL_DOCUMENT_ADAPTER_ID,
  BASIC_MANUAL_DOCUMENT_ADAPTER_VERSION,
  canonicalizeBasicSourceCatalog,
  parseBasicSourceCatalog,
} from "./collection/basic-source-catalog.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";

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

function countryCodes(count: number): string[] {
  return Array.from({ length: count }, (_, index) => countryCode(index)).sort();
}

function countryCode(index: number): string {
  const normalized = index % (26 * 26);
  return `${String.fromCharCode(65 + Math.floor(normalized / 26))}${String.fromCharCode(65 + normalized % 26)}`;
}
