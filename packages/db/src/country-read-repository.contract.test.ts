import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  sortCountrySnapshots,
  type CountryDataSnapshot,
  type CountryReadRepository,
  type JsonObject,
} from "@navigator/shared-types/country-runtime";
import { MODULE_KEYS } from "@navigator/shared-types/schema";
import { describe, expect, test } from "vitest";

import { writeBasicCountryPublicationV3RepositoryFixture } from "./basic-publication-v3-test-fixture.js";
import { loadApprovedBasicCountryPublicationVersioned } from "./collection/basic-publication-versioned-loader.js";
import {
  ApprovedPublicationCountryReadRepositoryError,
  createApprovedPublicationCountryReadRepository,
} from "./read/approved-publication-country-read-repository.js";
import {
  createPrismaCountryReadRepository,
  type PrismaCountryReadClient,
} from "./read/prisma-country-read-repository.js";
import { discoverApprovedBasicCountryDirectories } from "./seed/approved-basic-publications-validation.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const EXPECTED_COUNTRY_CODES = ["ID", "VN", "SA", "AE", "BR", "ZA"];

const REGION_TO_PRISMA = {
  "southeast-asia": "SOUTHEAST_ASIA",
  "south-asia": "SOUTH_ASIA",
  "middle-east": "MIDDLE_EAST",
  africa: "AFRICA",
  "latin-america": "LATIN_AMERICA",
  europe: "EUROPE",
  "central-asia": "CENTRAL_ASIA",
} as const;

const MODULE_TO_PRISMA = {
  "market-overview": "MARKET_OVERVIEW",
  policy: "POLICY",
  risk: "RISK",
  opportunities: "OPPORTUNITIES",
  projects: "PROJECTS",
  partners: "PARTNERS",
  "chinese-companies": "CHINESE_COMPANIES",
  "entry-strategy": "ENTRY_STRATEGY",
  "ai-advisor": "AI_ADVISOR",
  reports: "REPORTS",
} as const;

const INDUSTRY_TO_PRISMA = {
  solar: "SOLAR",
  wind: "WIND",
  storage: "STORAGE",
  ev: "EV",
  hydrogen: "HYDROGEN",
  grid: "GRID",
  "bess-mfg": "BESS_MFG",
  epc: "EPC",
} as const;

const TECH_TO_PRISMA = {
  "pv-module": "PV_MODULE",
  inverter: "INVERTER",
  "onshore-wind": "ONSHORE_WIND",
  "offshore-wind": "OFFSHORE_WIND",
  lfp: "LFP",
  ncm: "NCM",
  electrolyzer: "ELECTROLYZER",
} as const;

function approvedSnapshots(): CountryDataSnapshot[] {
  const snapshots = discoverApprovedBasicCountryDirectories(REPOSITORY_ROOT).map(
    (countryDirectory) => {
      const publication = loadApprovedBasicCountryPublicationVersioned(
        REPOSITORY_ROOT,
        countryDirectory,
      );
      if (!publication.valid) {
        throw new Error("Approved publication fixture is invalid");
      }
      const canonical = publication.data.canonical;
      return {
        country: canonical.country as unknown as JsonObject,
        marketOverview: canonical.marketOverview as unknown as JsonObject,
        policy: canonical.policy as unknown as readonly JsonObject[],
        risk: canonical.risk as unknown as readonly JsonObject[],
        opportunities: canonical.opportunities as unknown as readonly JsonObject[],
        projects: canonical.projects as unknown as readonly JsonObject[],
        partners: canonical.partners as unknown as readonly JsonObject[],
        chineseCompanies: canonical.chineseCompanies as unknown as readonly JsonObject[],
        entryStrategy: canonical.entryStrategy as unknown as JsonObject | null,
        reports: canonical.reports as unknown as readonly JsonObject[],
        knowledge: canonical.knowledge as unknown as readonly JsonObject[],
      } satisfies CountryDataSnapshot;
    },
  );
  return sortCountrySnapshots(snapshots);
}

function expectedBoundarySnapshot(
  snapshot: CountryDataSnapshot,
): CountryDataSnapshot {
  return {
    ...snapshot,
    marketOverview: snapshot.marketOverview === null
      ? null
      : {
          ...snapshot.marketOverview,
          basicProfile: snapshot.marketOverview.basicProfile ?? null,
        },
  };
}

function asRecord(value: JsonObject): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}

function toPrismaRow(snapshot: CountryDataSnapshot): Record<string, unknown> {
  const country = asRecord(snapshot.country);
  const countryCode = country.code;
  if (typeof countryCode !== "string") {
    throw new Error("Country fixture code is invalid");
  }
  const market = snapshot.marketOverview === null
    ? null
    : asRecord(snapshot.marketOverview);
  const coverage = country.moduleCoverage;
  if (!Array.isArray(coverage)) {
    throw new Error("Country fixture coverage is invalid");
  }
  const region = country.region;
  if (typeof region !== "string" || !(region in REGION_TO_PRISMA)) {
    throw new Error("Country fixture region is invalid");
  }

  return {
    code: countryCode,
    name: country.name,
    region: REGION_TO_PRISMA[region as keyof typeof REGION_TO_PRISMA],
    coverageLevel: country.coverageLevel,
    flagEmoji: country.flagEmoji,
    summary: country.summary,
    updatedAt: new Date(String(country.updatedAt)),
    moduleCoverage: coverage.map((value) => {
      const item = value as Readonly<Record<string, unknown>>;
      const moduleKey = String(item.moduleKey) as keyof typeof MODULE_TO_PRISMA;
      return {
        countryCode,
        moduleKey: MODULE_TO_PRISMA[moduleKey],
        status: item.status,
        dataCount: item.dataCount,
        updatedAt: new Date(String(item.updatedAt)),
      };
    }),
    marketOverview: market === null
      ? null
      : {
          ...market,
          collectedAt: new Date(String(market.collectedAt)),
          updatedAt: new Date(String(market.updatedAt)),
          industryTags: (market.industryTags as readonly string[]).map(
            (tag) => INDUSTRY_TO_PRISMA[tag as keyof typeof INDUSTRY_TO_PRISMA],
          ),
          techTags: (market.techTags as readonly string[]).map(
            (tag) => TECH_TO_PRISMA[tag as keyof typeof TECH_TO_PRISMA],
          ),
        },
    policies: [],
    risks: [],
    opportunities: [],
    projects: [],
    partners: [],
    chineseCompanies: [],
    entryStrategy: null,
    reports: [],
    knowledgeChunks: [],
  };
}

class CanonicalPrismaClient implements PrismaCountryReadClient {
  readonly rows: readonly Record<string, unknown>[];

  constructor(snapshots: readonly CountryDataSnapshot[]) {
    this.rows = snapshots.map(toPrismaRow).reverse();
  }

  readonly country = {
    findMany: async (): Promise<readonly unknown[]> => this.rows,
    findUnique: async (args: Readonly<{ where: Readonly<{ code: string }> }>): Promise<unknown> =>
      this.rows.find((row) => row.code === args.where.code) ?? null,
  };
}

interface RepositoryHarness {
  readonly name: string;
  create(): CountryReadRepository;
}

const canonicalSnapshots = approvedSnapshots().map(expectedBoundarySnapshot);
const harnesses: readonly RepositoryHarness[] = [
  {
    name: "approved publication adapter",
    create: () => createApprovedPublicationCountryReadRepository({
      repositoryRoot: REPOSITORY_ROOT,
    }),
  },
  {
    name: "Prisma adapter",
    create: () => createPrismaCountryReadRepository(
      new CanonicalPrismaClient(canonicalSnapshots),
    ),
  },
];

for (const harness of harnesses) {
  describe(`CountryReadRepository contract: ${harness.name}`, () => {
    test("lists the six auto-discovered countries in deterministic display order", async () => {
      const repository = harness.create();

      const first = await repository.list();
      const second = await repository.list();

      expect(first.map((snapshot) => snapshot.country.code)).toEqual(
        EXPECTED_COUNTRY_CODES,
      );
      expect(second).toEqual(first);
    });

    test("finds only normalized ISO2 codes and returns null for invalid or unknown codes", async () => {
      const repository = harness.create();

      await expect(repository.findByCode("ID")).resolves.toEqual(
        canonicalSnapshots[0],
      );
      for (const code of ["id", " ID ", "", "I", "IDN", "1D", "ZZ"]) {
        await expect(repository.findByCode(code)).resolves.toBeNull();
      }
    });

    test("returns storage-neutral canonical snapshots with all ten coverage rows", async () => {
      const repository = harness.create();

      const snapshots = await repository.list();

      expect(snapshots).toEqual(canonicalSnapshots);
      for (const snapshot of snapshots) {
        const coverage = snapshot.country.moduleCoverage;
        expect(Array.isArray(coverage)).toBe(true);
        expect(
          (coverage as readonly JsonObject[]).map((item) => item.moduleKey),
        ).toEqual(MODULE_KEYS);
        expect(snapshot.marketOverview).not.toBeNull();
        if (snapshot.country.code === "ID") {
          expect(snapshot.marketOverview?.basicProfile).toMatchObject({
            schemaVersion: "basic-market-profile/v2",
          });
        } else {
          expect(snapshot.marketOverview).toHaveProperty("basicProfile", null);
        }
      }
    });

    test("keeps BASIC deep modules and knowledge empty without audit structures", async () => {
      const repository = harness.create();

      const snapshots = await repository.list();

      for (const snapshot of snapshots) {
        expect(snapshot.policy).toEqual([]);
        expect(snapshot.risk).toEqual([]);
        expect(snapshot.opportunities).toEqual([]);
        expect(snapshot.projects).toEqual([]);
        expect(snapshot.partners).toEqual([]);
        expect(snapshot.chineseCompanies).toEqual([]);
        expect(snapshot.entryStrategy).toBeNull();
        expect(snapshot.reports).toEqual([]);
        expect(snapshot.knowledge).toEqual([]);
        expect(findForbiddenBoundaryKey(snapshot)).toBeNull();
      }
    });
  });
}

describe("approved publication v3 adapter", () => {
  test("reads an approved v3 profile from canonical data", async () => {
    const fixture = writeBasicCountryPublicationV3RepositoryFixture();
    try {
      const repository = createApprovedPublicationCountryReadRepository({
        repositoryRoot: fixture.root,
      });

      const snapshot = await repository.findByCode(
        fixture.publication.approvalReceipt.countryCode,
      );
      expect(snapshot?.marketOverview?.basicProfile).toEqual(
        fixture.publication.canonical.marketOverview.basicProfile,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

describe("approved publication adapter error boundary", () => {
  test("redacts a sensitive invalid-root loader failure behind the stable runtime error", () => {
    const sensitiveRoot = "/private/tenant-secret/publication-root-does-not-exist";

    let thrown: unknown;
    try {
      createApprovedPublicationCountryReadRepository({
        repositoryRoot: sensitiveRoot,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApprovedPublicationCountryReadRepositoryError);
    expect(thrown).toMatchObject({
      name: "ApprovedPublicationCountryReadRepositoryError",
      message: "APPROVED_PUBLICATION_RUNTIME_INVALID",
    });
    expect(thrown).not.toHaveProperty("cause");
    expect(JSON.stringify(thrown)).not.toContain(sensitiveRoot);
  });
});

describe("country read deep-record normalization", () => {
  test("normalizes an omitted legacy BASIC profile to explicit null", async () => {
    const { normalizeCountryReadSnapshot } = await import(
      "./read/country-read-normalization.js"
    );
    const legacy = approvedSnapshots().find(
      (snapshot) => snapshot.country.code === "VN",
    );
    if (legacy === undefined || legacy.marketOverview === null) {
      throw new Error("Expected an approved legacy market overview");
    }
    expect(legacy.marketOverview).not.toHaveProperty("basicProfile");

    const normalized = normalizeCountryReadSnapshot(legacy);

    expect(normalized.marketOverview).toHaveProperty("basicProfile", null);
  });

  test("normalizes STANDARD-like list slots by updatedAt descending then id ascending", async () => {
    const { normalizeCountryReadSnapshot } = await import(
      "./read/country-read-normalization.js"
    );
    const normalized = normalizeCountryReadSnapshot(standardLikeSnapshot());

    expect(normalized.policy.map((record) => record.id)).toEqual([
      "policy-a",
      "policy-b",
      "policy-z",
    ]);
    expect(normalized.reports.map((record) => record.id)).toEqual([
      "report-new",
      "report-old",
    ]);
    expect(normalized.knowledge.map((record) => record.id)).toEqual([
      "knowledge-a",
      "knowledge-b",
    ]);
    expect(normalized.policy).toHaveLength(3);
    expect(normalized.reports).toHaveLength(2);
    expect(normalized.knowledge).toHaveLength(2);
  });

  test("rejects duplicate record IDs without rejecting legitimate multiple records", async () => {
    const { normalizeCountryReadSnapshot } = await import(
      "./read/country-read-normalization.js"
    );
    const snapshot = standardLikeSnapshot();
    const duplicate = {
      ...snapshot,
      reports: [snapshot.reports[0]!, { ...snapshot.reports[1]!, id: "report-old" }],
    } satisfies CountryDataSnapshot;

    expect(() => normalizeCountryReadSnapshot(duplicate)).toThrow(
      "COUNTRY_READ_INVALID_DATA",
    );
  });

  test("both approved-publication and Prisma adapters call the same normalizer", () => {
    const readDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "read");
    for (const filename of [
      "approved-publication-country-read-repository.ts",
      "prisma-country-read-repository.ts",
    ]) {
      const source = readFileSync(resolve(readDirectory, filename), "utf8");
      expect(source).toContain("normalizeCountryReadSnapshot");
    }
  });
});

function standardLikeSnapshot(): CountryDataSnapshot {
  const record = (id: string, updatedAt: string): JsonObject => ({ id, updatedAt });
  return {
    country: {
      code: "ID",
      name: { zh: "印度尼西亚", en: "Indonesia" },
      region: "southeast-asia",
      coverageLevel: "STANDARD",
      flagEmoji: "🇮🇩",
      summary: { zh: "摘要", en: "Summary" },
      moduleCoverage: [],
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
    marketOverview: null,
    policy: [
      record("policy-z", "2026-01-01T00:00:00.000Z"),
      record("policy-b", "2026-02-01T00:00:00.000Z"),
      record("policy-a", "2026-02-01T00:00:00.000Z"),
    ],
    risk: [],
    opportunities: [],
    projects: [],
    partners: [],
    chineseCompanies: [],
    entryStrategy: null,
    reports: [
      record("report-old", "2026-01-01T00:00:00.000Z"),
      record("report-new", "2026-03-01T00:00:00.000Z"),
    ],
    knowledge: [
      record("knowledge-b", "2026-04-01T00:00:00.000Z"),
      record("knowledge-a", "2026-04-01T00:00:00.000Z"),
    ],
  };
}

function findForbiddenBoundaryKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenBoundaryKey(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const forbidden = new Set([
    "approvalReceipt",
    "artifactSha256",
    "audit",
    "candidate",
    "manifest",
    "reviewerId",
    "runId",
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) return key;
    const found = findForbiddenBoundaryKey(child);
    if (found !== null) return found;
  }
  return null;
}
