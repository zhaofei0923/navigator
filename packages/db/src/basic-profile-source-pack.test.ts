import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "./basic-collection-v3-test-fixture.js";
import {
  WORLD_BANK_BASIC_PROFILE_ADAPTERS,
} from "./collection/adapters/world-bank-basic-profile.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import { resolveBasicProfileWorldBankAdapter } from "./collection/basic-source-adapter-registry.js";
import { createBasicSourceExecutionPlan } from "./collection/basic-source-request-materializer.js";
import { readFileSync } from "node:fs";
import {
  parseBasicProfileTabularSnapshot,
} from "./collection/adapters/basic-profile-tabular.js";
import {
  BASIC_GLOBAL_SOURCE_IDS,
  BASIC_MANUAL_POLICY_SOURCE_IDS,
  EMBER_DIRECT_API_EXECUTION_APPROVED,
} from "./collection/adapters/basic-global-source-pack.js";
import {
  assembleBasicCollectionAuditBundleV3,
} from "./collection/basic-audit-v3-assembler.js";
import {
  materializeBasicProfile,
  materializeBasicProfileFacts,
} from "./collection/basic-profile-fact-materializer.js";

describe("approved reusable BASIC source adapters", () => {
  test("binds the five approved keyless World Bank indicators", () => {
    expect(WORLD_BANK_BASIC_PROFILE_ADAPTERS.map(({ sourceId, indicator, profileField }) => ({
      sourceId,
      indicator,
      profileField,
    }))).toEqual([
      { sourceId: "world-bank-population", indicator: "SP.POP.TOTL", profileField: "population" },
      { sourceId: "world-bank-gdp", indicator: "NY.GDP.MKTP.CD", profileField: "gdp" },
      { sourceId: "world-bank-gdp-per-capita", indicator: "NY.GDP.PCAP.CD", profileField: "gdpPerCapita" },
      { sourceId: "world-bank-gdp-growth", indicator: "NY.GDP.MKTP.KD.ZG", profileField: "gdpGrowth" },
      { sourceId: "world-bank-electricity-access", indicator: "EG.ELC.ACCS.ZS", profileField: "electricityAccess" },
    ]);
    for (const adapter of WORLD_BANK_BASIC_PROFILE_ADAPTERS) {
      const request = adapter.request("ID");
      expect(request.url).toMatch(/^https:\/\/api\.worldbank\.org\/v2\//);
      expect(request.url).not.toMatch(/key|token|secret/i);
      expect(request.headers).toEqual({ Accept: "application/json" });
    }
  });

  test("binds the two additive World Bank profile policies from the committed catalog", () => {
    const catalog = parseBasicSourceCatalog(JSON.parse(readFileSync(
      new URL("../catalog/basic-source-catalog.json", import.meta.url),
      "utf8",
    )) as unknown);
    const plan = createBasicSourceExecutionPlan({
      catalog,
      countryCode: "ID",
      sourceIds: ["world-bank-electricity-access", "world-bank-gdp-per-capita"],
    });
    expect(plan.sources.map((entry) =>
      resolveBasicProfileWorldBankAdapter(entry, "ID").sourceId
    )).toEqual(["world-bank-electricity-access", "world-bank-gdp-per-capita"]);

    const untrustedClone = structuredClone(plan.sources[0]!);
    expect(() => resolveBasicProfileWorldBankAdapter(untrustedClone, "ID"))
      .toThrow("source catalog adapter binding is invalid");
  });

  test("strictly extracts a World Bank profile observation and preserves null as unavailable", () => {
    const adapter = WORLD_BANK_BASIC_PROFILE_ADAPTERS.find(({ sourceId }) =>
      sourceId === "world-bank-electricity-access"
    )!;
    const envelope = (value: number | null) => new TextEncoder().encode(JSON.stringify([
      { page: 1, pages: 1, per_page: 1, total: 1, sourceid: "2" },
      [{ indicator: { id: "EG.ELC.ACCS.ZS" }, country: { id: "ID" }, date: "2024", value }],
    ]));
    expect(adapter.extract({
      countryCode: "ID",
      retrievedAt: "2026-07-20T00:00:00Z",
      body: envelope(99.4),
    })).toMatchObject({
      status: "AVAILABLE",
      value: 99.4,
      unit: "%",
      year: 2024,
      checkedAt: "2026-07-20",
    });
    expect(adapter.extract({
      countryCode: "ID",
      retrievedAt: "2026-07-20T00:00:00Z",
      body: envelope(null),
    })).toMatchObject({
      status: "NOT_AVAILABLE",
      value: null,
      unit: null,
      year: null,
    });
  });

  test("preserves a valid empty World Bank envelope as sourced unavailable", () => {
    const adapter = WORLD_BANK_BASIC_PROFILE_ADAPTERS.find(({ sourceId }) =>
      sourceId === "world-bank-electricity-access"
    )!;
    const observation = adapter.extract({
      countryCode: "ID",
      retrievedAt: "2026-07-20T00:00:00Z",
      body: new TextEncoder().encode(JSON.stringify([
        { page: 1, pages: 0, per_page: 1, total: 0, sourceid: "2" },
        [],
      ])),
    });

    expect(observation).toMatchObject({
      sourceId: "world-bank-electricity-access",
      key: "electricityAccess",
      status: "NOT_AVAILABLE",
      value: null,
      unit: null,
      year: null,
      checkedAt: "2026-07-20",
      locator: "json:/1",
      reason: {
        zh: "World Bank 已核查，但最近记录无可用数值",
        en: "World Bank was checked, but the latest record has no available value",
      },
    });
  });

  test("parses reviewed tabular electricity/capacity/resource rows deterministically", () => {
    const rows = parseBasicProfileTabularSnapshot(
      new TextEncoder().encode([
        "countryCode,category,key,value,unit,year,locator",
        "ID,electricityMarket,totalGeneration,312.4,TWh,2025,table:ID:2025",
        "ID,renewableCapacity,solarCapacity,8.2,GW,2025,table:ID:solar",
        "ID,solarResource,ghi,5.1,kWh/m2/day,2024,grid:ID",
        "ID,windResource,onshoreWindClass,good,,2024,grid:ID:onshore",
      ].join("\n")),
      "ID",
    );

    expect(rows.map(({ category, key, value }) => ({ category, key, value }))).toEqual([
      { category: "electricityMarket", key: "totalGeneration", value: 312.4 },
      { category: "renewableCapacity", key: "solarCapacity", value: 8.2 },
      { category: "solarResource", key: "ghi", value: 5.1 },
      { category: "windResource", key: "onshoreWindClass", value: "good" },
    ]);
  });

  test("models missing Ember credentials as explicit checked unavailable data", () => {
    const row = parseBasicProfileTabularSnapshot(
      new TextEncoder().encode([
        "countryCode,category,key,value,unit,year,locator,reasonZh,reasonEn",
        "ID,electricityMarket,totalGeneration,,,,snapshot-check,未提供已审核的Ember不可变标准化快照,A reviewed immutable normalized Ember snapshot was not provided",
      ].join("\n")),
      "ID",
    )[0];

    expect(row).toMatchObject({
      status: "NOT_AVAILABLE",
      value: null,
      reason: {
        zh: "未提供已审核的Ember不可变标准化快照",
        en: "A reviewed immutable normalized Ember snapshot was not provided",
      },
    });
  });

  test("keeps direct Ember API execution disabled and policy sources on manual review", () => {
    expect(EMBER_DIRECT_API_EXECUTION_APPROVED).toBe(false);
    expect(BASIC_GLOBAL_SOURCE_IDS).toEqual([
      "ember-electricity", "global-solar-atlas", "global-wind-atlas", "irenastat-capacity",
    ]);
    expect(BASIC_MANUAL_POLICY_SOURCE_IDS).toEqual(["iea-policies", "rise-policy-review"]);
  });
});

describe("profile facts and v3 assembly", () => {
  test("merges deterministic and reviewed manual fields into one validated eight-category profile", () => {
    const expected = createBasicCollectionAuditV3Fixture().marketOverviewDraft.basicProfile;
    const profile = materializeBasicProfile({
      sources: expected.sources,
      updatedAt: expected.updatedAt,
      fields: Object.entries(expected.categories).flatMap(([category, { fields }]) =>
        fields.map((field) => ({ category: category as keyof typeof expected.categories, field }))),
    });
    expect(profile).toEqual(expected);
    expect(Object.keys(profile.categories)).toHaveLength(8);
  });

  test("emits one exact fact per profile field and validates the assembled bundle", () => {
    const fixture = createBasicCollectionAuditV3Fixture();
    const facts = materializeBasicProfileFacts({
      profile: fixture.marketOverviewDraft.basicProfile,
      sourceRegister: fixture.sourceRegister,
    });
    expect(facts).toHaveLength(8);
    expect(new Set(facts.map(({ fieldPath }) => fieldPath)).size).toBe(8);
    expect(facts.every(({ evidence }) => evidence.length === 1)).toBe(true);

    const assembled = assembleBasicCollectionAuditBundleV3({
      baseBundle: {
        ...structuredClone(fixture),
        sourceRegister: { ...fixture.sourceRegister, schemaVersion: "basic-country-audit/v2" },
        extractedFacts: {
          ...fixture.extractedFacts,
          schemaVersion: "basic-country-audit/v2",
          facts: fixture.extractedFacts.facts.filter(({ fieldPath }) =>
            !fieldPath.startsWith("marketOverview.basicProfile.")),
        },
        marketOverviewDraft: Object.fromEntries(
          Object.entries(fixture.marketOverviewDraft).filter(([key]) => key !== "basicProfile"),
        ),
        reviewReport: { ...fixture.reviewReport, schemaVersion: "basic-country-audit/v2" },
      },
      basicProfile: fixture.marketOverviewDraft.basicProfile,
    });
    expect(assembled).toEqual(fixture);
  });

  test("merges newly captured profile audit sources without weakening the v2 base", () => {
    const fixture = structuredClone(createBasicCollectionAuditV3Fixture());
    const source = fixture.sourceRegister.sources[0]!;
    const profile = fixture.marketOverviewDraft.basicProfile;
    const basicProfile = {
      ...profile,
      sources: [...profile.sources, {
      id: "world-bank-electricity-access",
      publisher: "World Bank",
      title: { zh: "通电率", en: "Access to electricity" },
      url: "https://api.worldbank.org/v2/country/XZ/indicator/EG.ELC.ACCS.ZS?source=2&format=json&mrv=1&per_page=1",
      publishedAt: null,
      retrievedAt: "2026-07-09T00:00:00Z",
      credibility: "OFFICIAL",
      }],
      categories: {
        ...profile.categories,
        energyAccess: {
          ...profile.categories.energyAccess,
          fields: profile.categories.energyAccess.fields.map((field, index) => index === 0 ? {
            ...field,
            sourceIds: ["world-bank-electricity-access"],
          } : field),
        },
      },
    } as const;
    const assembled = assembleBasicCollectionAuditBundleV3({
      baseBundle: {
        ...fixture,
        sourceRegister: { ...fixture.sourceRegister, schemaVersion: "basic-country-audit/v2" },
        extractedFacts: {
          ...fixture.extractedFacts,
          schemaVersion: "basic-country-audit/v2",
          facts: fixture.extractedFacts.facts.filter(({ fieldPath }) =>
            !fieldPath.startsWith("marketOverview.basicProfile.")),
        },
        marketOverviewDraft: Object.fromEntries(
          Object.entries(fixture.marketOverviewDraft).filter(([key]) => key !== "basicProfile"),
        ),
        reviewReport: { ...fixture.reviewReport, schemaVersion: "basic-country-audit/v2" },
      },
      basicProfile,
      profileAuditSources: [{
        ...source,
        sourceId: "world-bank-electricity-access",
        sourceUrl: "https://api.worldbank.org/v2/country/XZ/indicator/EG.ELC.ACCS.ZS?source=2&format=json&mrv=1&per_page=1",
        evidenceLocators: ["json:/1/0/value"],
      }],
      profileSourceChecks: [{
        sourceId: "world-bank-electricity-access",
        status: "passed",
        notes: "strict deterministic adapter validation passed",
      }],
    });
    expect(assembled.sourceRegister.sources.map(({ sourceId }) => sourceId))
      .toContain("world-bank-electricity-access");
    expect(assembled.reviewReport.sourceChecks.map(({ sourceId }) => sourceId))
      .toContain("world-bank-electricity-access");
  });
});
