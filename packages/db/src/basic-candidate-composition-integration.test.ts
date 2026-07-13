import { readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { serializeBasicCollectionAuditArtifactsV2 } from "./collection/basic-audit-v2-artifacts.js";
import { materializeBasicDocumentEvidence } from "./collection/basic-document-observation-materializer.js";
import { parseBasicDocumentObservationPlan } from "./collection/basic-document-observation-parser.js";
import { parseBasicCountryEditorialInput } from "./collection/basic-editorial-input-parser.js";
import { parseBasicSourceCatalog } from "./collection/basic-source-catalog.js";
import {
  createBasicSourceExecutionPlan,
  type BasicSourceExecutionPlan,
} from "./collection/basic-source-request-materializer.js";
import {
  parseBasicManualSourceReview,
  parseBasicStructuredSourceReview,
} from "./collection/basic-source-review-parser.js";
import { runBasicSourceExecutionPlanV2 } from "./collection/basic-source-plan-runner-v2.js";
import type {
  BasicSourceTransportV2,
} from "./collection/basic-source-v2-contracts.js";
import { materializeBasicReviewedRunV2 } from "./collection/basic-v2-materialization.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import { writeBasicCandidateArtifacts } from "./cli/basic-candidate-artifact-writer.js";
import { composeBasicCountryCandidate } from "./cli/basic-candidate-composition.js";
import {
  BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
  parseBasicCandidateConfig,
} from "./cli/basic-candidate-config.js";
import {
  closeBasicCandidateWorkspace,
  openBasicCandidateWorkspace,
} from "./cli/basic-candidate-workspace.js";

const COUNTRY_CODE = "ID";
const COUNTRY_DIRECTORY = "fixture-id-shape";
const RUN_ID = "fixture-id-catalog-to-staging-v2";
const FIXED_TIME = "2026-01-02T03:04:05.000Z";
const MANUAL_SOURCE_ID = "fixture-manual-document";
const WORLD_BANK_SOURCE_IDS = [
  "world-bank-country",
  "world-bank-gdp",
  "world-bank-gdp-growth",
  "world-bank-population",
] as const;
const SOURCE_IDS = [MANUAL_SOURCE_ID, ...WORLD_BANK_SOURCE_IDS] as const;
const RUN_DIRECTORY = join(".cache", "basic-country", COUNTRY_CODE, RUN_ID);
const CONFIG_PATH = join(RUN_DIRECTORY, "candidate-config.json");
const JSON_INPUT_PATHS = [
  "editorial.json",
  "plans/fixture-manual-document.json",
  "reviews/manual.json",
  "reviews/structured.json",
] as const;
const EXPECTED_FIELD_PATHS = [
  "country.code",
  "country.flagEmoji",
  "country.name",
  "country.region",
  "country.summary",
  "country.updatedAt",
  "marketOverview.collectedAt",
  "marketOverview.countryCode",
  "marketOverview.credibility",
  "marketOverview.energyDemand",
  "marketOverview.gdp",
  "marketOverview.gdpGrowth",
  "marketOverview.industryTags",
  "marketOverview.keyIndicators[0].label",
  "marketOverview.keyIndicators[0].unit",
  "marketOverview.keyIndicators[0].value",
  "marketOverview.keyIndicators[0].year",
  "marketOverview.overview",
  "marketOverview.population",
  "marketOverview.renewableTarget",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.techTags",
  "marketOverview.updatedAt",
] as const;

describe("synthetic catalog-to-staging Basic candidate integration", () => {
  test("runs the production catalog, cache, reviews, composition, and native writer", async () => {
    const repoRoot = await mkdtemp("/tmp/navigator-basic-candidate-integration-");
    let workspace: Awaited<ReturnType<typeof openBasicCandidateWorkspace>> | null = null;
    try {
      const catalogValue = syntheticCatalog();
      await createRepository(repoRoot, catalogValue);
      const catalog = parseBasicSourceCatalog(catalogValue);
      const plan = createBasicSourceExecutionPlan({
        catalog,
        countryCode: COUNTRY_CODE,
        sourceIds: SOURCE_IDS,
      });
      const firstTransport = fixtureTransport(plan);
      const preliminary = await runBasicSourceExecutionPlanV2({
        repoRoot,
        countryCode: COUNTRY_CODE,
        runId: RUN_ID,
        plan,
        transport: firstTransport,
      });
      expect(firstTransport.execute).toHaveBeenCalledTimes(5);
      expect(preliminary.receipts.every(({ reused }) => !reused)).toBe(true);

      const manifestValues = await readRawManifests(repoRoot);
      expect(manifestValues).toHaveLength(5);
      for (const manifest of manifestValues) {
        expect(manifest).toMatchObject({
          schemaVersion: "basic-country-raw-capture/v2",
          countryCode: COUNTRY_CODE,
          runId: RUN_ID,
          catalogVersion: plan.catalogVersion,
          catalogSha256: plan.catalogSha256,
        });
      }

      const inputs = buildInputs(plan, preliminary.documentCaptures[0]!);
      expect(inputs.documentPlan.capture.contentSha256).toBe(
        preliminary.documentCaptures[0]!.manifest.response.contentSha256,
      );
      await writeRunInputs(repoRoot, inputs);
      const expectation = {
        runId: RUN_ID,
        countryCode: COUNTRY_CODE,
        catalogVersion: plan.catalogVersion,
        catalogSha256: plan.catalogSha256,
        deterministicSourceIds: WORLD_BANK_SOURCE_IDS,
        manualSourceIds: [MANUAL_SOURCE_ID],
      };
      const structuredReview = parseBasicStructuredSourceReview(
        inputs.structuredReview,
        expectation,
      );
      const manualReview = parseBasicManualSourceReview(
        inputs.manualReview,
        expectation,
      );
      const documentPlan = parseBasicDocumentObservationPlan(inputs.documentPlan);
      const documentResult = materializeBasicDocumentEvidence({
        plan,
        captures: preliminary.documentCaptures,
        review: manualReview,
        documentPlans: [documentPlan],
      });
      const editorial = parseBasicCountryEditorialInput(inputs.editorial);
      const reviewed = materializeBasicReviewedRunV2({
        preliminary,
        structuredReview,
        documentResult,
        editorial,
      });
      expect(reviewed.materialization.extractedFacts.facts.map(({ fieldPath }) => fieldPath))
        .toEqual(EXPECTED_FIELD_PATHS);
      workspace = await openBasicCandidateWorkspace(repoRoot);

      const cacheOnlyTransport = throwingTransport();
      const first = await composeBasicCountryCandidate({
        workspace,
        configPath: CONFIG_PATH,
        transport: cacheOnlyTransport,
      });

      expect(cacheOnlyTransport.execute).not.toHaveBeenCalled();
      expect(first.status).toBe("ready");
      expect(first.candidate?.failedStage).toBeNull();
      expect(first.candidate?.validation).toMatchObject({
        valid: true,
        readyForHumanReview: true,
        blockers: [],
      });
      expect(first.candidate?.artifacts?.["extracted-facts.json"].facts).toHaveLength(24);
      expect(first.candidate?.artifacts?.["source-register.json"].sources).toHaveLength(5);
      expect(first.candidate?.artifacts?.["source-register.json"]).toMatchObject({
        catalogVersion: plan.catalogVersion,
        catalogSha256: plan.catalogSha256,
      });
      expect(first.candidate?.artifacts?.["review-report.json"]).toMatchObject({
        status: "ready-for-human-review",
        humanDecision: null,
      });
      assertInputProvenance(inputs, plan);

      const firstBytes = serializedCandidate(first.candidate);
      await permuteJsonInputs(repoRoot);
      const secondTransport = throwingTransport();
      const second = await composeBasicCountryCandidate({
        workspace,
        configPath: CONFIG_PATH,
        transport: secondTransport,
      });
      expect(secondTransport.execute).not.toHaveBeenCalled();
      expect(second.status).toBe("ready");
      expect(serializedCandidate(second.candidate)).toEqual(firstBytes);
      const blockedCandidate = await runBasicDeterministicCandidate({
        countryDirectory: COUNTRY_DIRECTORY,
        countryCode: COUNTRY_CODE,
        runId: RUN_ID,
        catalogVersion: plan.catalogVersion,
        catalogSha256: plan.catalogSha256,
        runner: Object.freeze({
          run() {
            return Promise.resolve(reviewed.materialization);
          },
        }),
        sourceChecks: reviewed.sourceChecks.map((check) =>
          check.sourceId === MANUAL_SOURCE_ID
            ? {
                ...check,
                status: "failed",
                notes: "Synthetic fixture-only trust check failed",
              }
            : check),
        injectionRisks: reviewed.injectionRisks,
      });
      expect(blockedCandidate.failedStage).toBe("preflight");
      expect(blockedCandidate.artifacts).toBeNull();
      await expect(writeBasicCandidateArtifacts({
        workspace,
        candidate: blockedCandidate,
      })).rejects.toThrow("basic candidate artifact write failed");
      expect(await exists(stagingTarget(repoRoot))).toBe(false);

      await expect(writeBasicCandidateArtifacts({
        workspace,
        candidate: second.candidate!,
      })).resolves.toEqual({ status: "written" });

      expect([...(await readdir(stagingTarget(repoRoot)))].sort(compareText)).toEqual([
        "extracted-facts.json",
        "market-overview.draft.json",
        "review-report.json",
        "source-register.json",
      ]);
      expect(await exists(join(stagingTarget(repoRoot), "collection-manifest.json"))).toBe(false);
      expect(await exists(join(repoRoot, "data", COUNTRY_DIRECTORY))).toBe(false);
      expect(await exists(join(repoRoot, "prisma"))).toBe(false);
      expect(second.candidate?.boundaryVerdict).toMatchObject({
        prismaWrite: "not-attempted",
        knowledgeChunkCount: 0,
        aiUsableTrueCount: 0,
        aiEligibleKnowledgeIds: [],
      });
      expect(JSON.stringify(second.candidate)).not.toContain("KnowledgeChunk");
    } finally {
      if (workspace !== null) await closeBasicCandidateWorkspace(workspace);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("rejects unsorted required arrays instead of normalizing them", () => {
    expect(() => parseBasicCandidateConfig({
      ...candidateConfig(),
      sourceIds: [...SOURCE_IDS].reverse(),
    })).toThrow("basic candidate config is invalid");
  });
});

function syntheticCatalog(): Record<string, unknown> {
  const committed = JSON.parse(readFileSync(
    new URL("../catalog/basic-source-catalog.json", import.meta.url),
    "utf8",
  )) as Record<string, unknown> & { sources: unknown[] };
  return {
    ...committed,
    catalogVersion: "fixture-catalog-to-staging-v2",
    sources: [manualCatalogSource(), ...committed.sources],
  };
}

function manualCatalogSource() {
  return {
    sourceId: MANUAL_SOURCE_ID,
    sourceName: "Synthetic fixture-only reviewed HTML document",
    sourceFamily: "government",
    credibility: "OFFICIAL",
    format: "html",
    countryScope: [COUNTRY_CODE],
    requestTemplate: {
      origin: "https://fixture-only.invalid",
      pathSegments: [
        { kind: "literal", value: "synthetic" },
        { kind: "placeholder", value: "countryCode" },
        { kind: "literal", value: "fixture-document.html" },
      ],
      query: [],
    },
    accept: "text/html",
    approvedOrigins: ["https://fixture-only.invalid"],
    allowedQueryParameters: [],
    accessMode: "open",
    licenseName: "Synthetic fixture-only test license",
    licenseUrl: "https://fixture-only.invalid/license",
    attribution: "Synthetic fixture-only content; not an Indonesia source",
    refreshCadence: "manual",
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
      "marketOverview.overview",
      "marketOverview.renewableTarget",
      "marketOverview.techTags",
    ],
  };
}

function fixtureTransport(plan: BasicSourceExecutionPlan) {
  const sourceByUrl = new Map(plan.sources.map(({ source, request }) => [
    request.url,
    source.sourceId,
  ]));
  const execute = vi.fn(async (request: BasicSourceExecutionPlan["sources"][number]["request"]) => {
    const sourceId = sourceByUrl.get(request.url);
    if (sourceId === undefined) throw new Error("unexpected synthetic fixture request");
    const html = sourceId === MANUAL_SOURCE_ID;
    const body = html
      ? new TextEncoder().encode(
        "<html><body>synthetic fixture-only evidence; not an Indonesia claim</body></html>",
      )
      : new TextEncoder().encode(JSON.stringify(worldBankFixture(sourceId)));
    return {
      status: 200,
      finalUrl: request.url,
      redirectChain: [],
      contentType: html ? "text/html" : "application/json; charset=utf-8",
      retrievedAt: FIXED_TIME,
      body: bytes(body),
    };
  });
  return { execute } satisfies BasicSourceTransportV2 & { execute: typeof execute };
}

function worldBankFixture(sourceId: string): unknown {
  if (sourceId === "world-bank-country") {
    return [
      { page: 1, pages: 1, per_page: "50", total: 1, fixtureOnly: true },
      [{ iso2Code: COUNTRY_CODE, name: "Synthetic Fixture Country ID", fixtureOnly: true }],
    ];
  }
  const indicators: Readonly<Record<string, readonly [string, number, string]>> = {
    "world-bank-gdp": ["NY.GDP.MKTP.CD", 22_222_222, "2099"],
    "world-bank-gdp-growth": ["NY.GDP.MKTP.KD.ZG", 2.22, "2099"],
    "world-bank-population": ["SP.POP.TOTL", 111_111, "2099"],
  };
  const item = indicators[sourceId];
  if (item === undefined) throw new Error("unknown synthetic fixture source");
  return [
    {
      page: 1,
      pages: 1,
      per_page: 1,
      total: 1,
      sourceid: "2",
      lastupdated: "2099-01-01",
      fixtureOnly: true,
    },
    [{
      indicator: { id: item[0] },
      country: { id: COUNTRY_CODE },
      date: item[2],
      value: item[1],
      fixtureOnly: true,
    }],
  ];
}

function buildInputs(
  plan: BasicSourceExecutionPlan,
  capture: Parameters<typeof buildDocumentPlan>[1],
) {
  const structuredReview = {
    schemaVersion: "basic-structured-source-review/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sources: WORLD_BANK_SOURCE_IDS.map((sourceId) => ({
      sourceId,
      sourceCheck: { status: "passed", notes: "Synthetic fixture-only response reviewed" },
    })),
    injectionRisks: [],
  };
  const manualReview = {
    schemaVersion: "basic-manual-source-review/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sources: [{
      sourceId: MANUAL_SOURCE_ID,
      publishedAt: "2026-01-01T00:00:00.000Z",
      accessNotes: "Synthetic fixture-only HTML reviewed",
      promptInjectionRisk: "none",
      sourceCheck: { status: "passed", notes: "Synthetic fixture-only manual review passed" },
      injectionRisks: [],
    }],
  };
  const documentPlan = buildDocumentPlan(plan, capture);
  const editorial = buildEditorial(plan);
  return {
    config: candidateConfig(),
    structuredReview,
    manualReview,
    documentPlan,
    editorial,
  };
}

function buildDocumentPlan(
  plan: BasicSourceExecutionPlan,
  capture: Awaited<ReturnType<typeof runBasicSourceExecutionPlanV2>>["documentCaptures"][number],
) {
  const editorial = editorialDefinitions().map(({ fieldPath, locator, rawValue }) => ({
    usage: "editorial-evidence",
    fieldPath,
    locator,
    rawValue,
  }));
  const sourceFacts = [
    ["marketOverview.keyIndicators[0].unit", "html:section=fixture-indicator-unit", "fixture-unit", "fixture-unit"],
    ["marketOverview.keyIndicators[0].value", "html:section=fixture-indicator-value", "fixture-333", "fixture-333"],
    ["marketOverview.keyIndicators[0].year", "html:section=fixture-indicator-year", 2099, 2099],
  ].map(([fieldPath, locator, rawValue, normalizedValue]) => ({
    usage: "source-fact",
    fieldPath,
    locator,
    rawValue,
    normalizedValue,
    unit: "fixture-unit",
    year: 2099,
    uncertainty: null,
  }));
  return {
    schemaVersion: "basic-document-observation-plan/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    sourceId: MANUAL_SOURCE_ID,
    capture: {
      adapterId: capture.manifest.adapterId,
      adapterVersion: capture.manifest.adapterVersion,
      requestUrl: capture.manifest.request.url,
      retrievedAt: capture.manifest.response.retrievedAt,
      contentType: capture.manifest.response.contentType,
      byteLength: capture.manifest.response.byteLength,
      contentSha256: capture.manifest.response.contentSha256,
    },
    observations: [...editorial, ...sourceFacts].sort((left, right) =>
      compareText(`${left.fieldPath}\0${left.locator}`, `${right.fieldPath}\0${right.locator}`)),
  };
}

function buildEditorial(plan: BasicSourceExecutionPlan) {
  const countryName = {
    fieldPath: "country.name",
    normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u56fd\u5bb6 ID", en: "Synthetic Fixture Country ID" },
    evidence: [{
      sourceId: "world-bank-country",
      locator: "json:/1/0/name",
      rawValue: "Synthetic Fixture Country ID",
      unit: null,
      year: null,
    }],
    uncertainty: null,
  };
  const items = editorialDefinitions().map((definition) => ({
    fieldPath: definition.fieldPath,
    normalizedValue: definition.normalizedValue,
    evidence: [{
      sourceId: MANUAL_SOURCE_ID,
      locator: definition.locator,
      rawValue: definition.rawValue,
      unit: null,
      year: null,
    }],
    uncertainty: null,
  }));
  return {
    schemaVersion: "basic-country-editorial-input/v1",
    runId: RUN_ID,
    countryCode: COUNTRY_CODE,
    catalogVersion: plan.catalogVersion,
    catalogSha256: plan.catalogSha256,
    primarySourceId: MANUAL_SOURCE_ID,
    items: [countryName, ...items].sort((left, right) =>
      compareText(left.fieldPath, right.fieldPath)),
  };
}

function editorialDefinitions() {
  return [
    { fieldPath: "country.region", locator: "html:section=fixture-region", rawValue: "Synthetic fixture region token", normalizedValue: "central-asia" },
    { fieldPath: "country.summary", locator: "html:section=fixture-summary", rawValue: "Synthetic fixture summary", normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u6458\u8981", en: "Synthetic fixture summary" } },
    { fieldPath: "marketOverview.energyDemand", locator: "html:section=fixture-energy-demand", rawValue: "Synthetic fixture energy demand", normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u80fd\u6e90\u9700\u6c42", en: "Synthetic fixture energy demand" } },
    { fieldPath: "marketOverview.industryTags", locator: "html:section=fixture-industry-tags", rawValue: "Synthetic fixture tag solar", normalizedValue: ["solar"] },
    { fieldPath: "marketOverview.keyIndicators[0].label", locator: "html:section=fixture-indicator-label", rawValue: "Synthetic fixture indicator", normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u6307\u6807", en: "Synthetic fixture indicator" } },
    { fieldPath: "marketOverview.overview", locator: "html:section=fixture-overview", rawValue: "Synthetic fixture overview", normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u6982\u89c8", en: "Synthetic fixture overview" } },
    { fieldPath: "marketOverview.renewableTarget", locator: "html:section=fixture-renewable-target", rawValue: "Synthetic fixture target", normalizedValue: { zh: "\u5408\u6210\u5939\u5177\u76ee\u6807", en: "Synthetic fixture target" } },
    { fieldPath: "marketOverview.techTags", locator: "html:section=fixture-tech-tags", rawValue: "Synthetic fixture tag pv-module", normalizedValue: ["pv-module"] },
  ] as const;
}

function candidateConfig() {
  return {
    schemaVersion: BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
    countryDirectory: COUNTRY_DIRECTORY,
    countryCode: COUNTRY_CODE,
    runId: RUN_ID,
    sourceIds: SOURCE_IDS,
    structuredReviewPath: "reviews/structured.json",
    manualReviewPath: "reviews/manual.json",
    documentPlanPaths: ["plans/fixture-manual-document.json"],
    editorialInputPath: "editorial.json",
  };
}

async function createRepository(repoRoot: string, catalog: unknown): Promise<void> {
  await mkdir(join(repoRoot, "packages", "db", "catalog"), { recursive: true });
  await writeFile(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await writeJson(join(repoRoot, "package.json"), { name: "navigator" });
  await writeJson(join(repoRoot, "packages", "db", "package.json"), { name: "@navigator/db" });
  await writeJson(join(repoRoot, "packages", "db", "catalog", "basic-source-catalog.json"), catalog);
}

async function writeRunInputs(repoRoot: string, inputs: ReturnType<typeof buildInputs>) {
  const run = join(repoRoot, RUN_DIRECTORY);
  await mkdir(join(run, "reviews"), { recursive: true });
  await mkdir(join(run, "plans"), { recursive: true });
  await writeJson(join(run, "candidate-config.json"), inputs.config);
  await writeJson(join(run, "reviews", "structured.json"), inputs.structuredReview);
  await writeJson(join(run, "reviews", "manual.json"), inputs.manualReview);
  await writeJson(join(run, "plans", "fixture-manual-document.json"), inputs.documentPlan);
  await writeJson(join(run, "editorial.json"), inputs.editorial);
}

async function permuteJsonInputs(repoRoot: string): Promise<void> {
  const paths = [
    join(repoRoot, "packages", "db", "catalog", "basic-source-catalog.json"),
    join(repoRoot, RUN_DIRECTORY, "candidate-config.json"),
    ...JSON_INPUT_PATHS.map((pathname) => join(repoRoot, RUN_DIRECTORY, pathname)),
  ];
  for (const pathname of paths) {
    const value = JSON.parse(await readFile(pathname, "utf8")) as JsonValue;
    await writeJson(pathname, reverseObjectKeys(value));
  }
}

async function readRawManifests(repoRoot: string): Promise<Record<string, unknown>[]> {
  return Promise.all(SOURCE_IDS.map(async (sourceId) => JSON.parse(await readFile(join(
    repoRoot,
    RUN_DIRECTORY,
    "raw-v2",
    sourceId,
    "capture.json",
  ), "utf8")) as Record<string, unknown>));
}

function assertInputProvenance(inputs: ReturnType<typeof buildInputs>, plan: BasicSourceExecutionPlan) {
  for (const value of [
    inputs.structuredReview,
    inputs.manualReview,
    inputs.documentPlan,
    inputs.editorial,
  ]) {
    expect(value).toMatchObject({
      catalogVersion: plan.catalogVersion,
      catalogSha256: plan.catalogSha256,
    });
  }
}

function serializedCandidate(candidate: Awaited<ReturnType<typeof composeBasicCountryCandidate>>["candidate"]) {
  if (candidate?.artifacts === null || candidate?.artifacts === undefined) {
    throw new Error("expected ready candidate artifacts");
  }
  return Object.fromEntries(Object.entries(
    serializeBasicCollectionAuditArtifactsV2(candidate.artifacts),
  ).map(([name, value]) => [name, Buffer.from(value).toString("hex")]));
}

function throwingTransport() {
  const execute = vi.fn(async () => {
    throw new Error("network must not run after raw-v2 cache population");
  });
  return { execute } satisfies BasicSourceTransportV2 & { execute: typeof execute };
}

async function* bytes(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield new Uint8Array(value);
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await writeFile(pathname, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function stagingTarget(repoRoot: string): string {
  return join(repoRoot, "data", "staging", COUNTRY_DIRECTORY, RUN_ID);
}

async function exists(pathname: string): Promise<boolean> {
  return lstat(pathname).then(() => true, () => false);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function reverseObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseObjectKeys) as T;
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).reverse().map((key) => [
    key,
    reverseObjectKeys(record[key]),
  ])) as T;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
