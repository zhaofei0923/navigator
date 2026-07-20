import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseBasicBatchArguments,
  validateBasicBatchConfig,
  type BasicBatchConfig,
} from "./basic-batch-config.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "../collection/adapters/basic-global-source-pack.js";
import { parseBasicProfileTabularSnapshot } from "../collection/adapters/basic-profile-tabular.js";
import { materializeBasicProfile } from "../collection/basic-profile-fact-materializer.js";
import { composeBasicCountryCandidate } from "./basic-candidate-composition.js";
import { createBasicSourceTransportV2 } from "../collection/basic-source-transport-v2.js";
import type { BasicCollectionAuditBundleV2 } from "../collection/basic-collection-v2-contracts.js";
import type { BasicSourceRecord } from "../collection/basic-collection-contracts.js";
import type { BasicSourceTransportV2 } from "../collection/basic-source-v2-contracts.js";
import { parseBasicSourceCatalog } from "../collection/basic-source-catalog.js";
import {
  createBasicSourceExecutionPlan,
  type BasicSourceExecutionPlanEntry,
} from "../collection/basic-source-request-materializer.js";
import { resolveBasicProfileWorldBankAdapter } from "../collection/basic-source-adapter-registry.js";
import type {
  BasicProfileCategoryKey,
  BasicProfileField,
  BasicProfileSource,
} from "@navigator/shared-types/basic-profile";
import { BASIC_PROFILE_REQUIRED_FIELD_KEYS } from "@navigator/shared-types/basic-profile";
import { createBasicV3CandidateComposition } from "./basic-v3-candidate-composition.js";
import { writeBasicCandidateArtifactsV3 } from "./basic-candidate-artifact-writer.js";
import {
  closeBasicCandidateWorkspace,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";
import {
  createFilesystemBasicBatchCache,
  BasicBatchExpectedBlockError,
  readBasicBatchCountryInput,
  readOptionalBasicBatchCountryInput,
  readOptionalBasicBatchGlobalInput,
  readOptionalBasicBatchManualInput,
  type BasicBatchCache,
} from "./basic-batch-filesystem-cache.js";

export { createFilesystemBasicBatchCache } from "./basic-batch-filesystem-cache.js";
export type { BasicBatchCache } from "./basic-batch-filesystem-cache.js";

export type BasicBatchCountryStatus = "ready" | "blocked" | "error";
export interface BasicBatchCountryResult {
  readonly countryCode: string;
  readonly status: BasicBatchCountryStatus;
}
export interface BasicBatchResult {
  readonly batchId: string;
  readonly results: readonly BasicBatchCountryResult[];
}

export interface PrepareBasicBatchInput {
  readonly config: BasicBatchConfig;
  readonly globalSourceIds: readonly string[];
  readonly cache: BasicBatchCache;
  readonly captureGlobalSource: (sourceId: string) => Promise<Uint8Array>;
  readonly prepareCountry: (
    countryCode: string,
    globalCaptures: ReadonlyMap<string, Uint8Array>,
  ) => Promise<Readonly<{ status: BasicBatchCountryStatus; countryCode: string }>>;
}

const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY_INPUT_ERROR = "basic batch country input is invalid";
const GLOBAL_SOURCE_POLICIES = Object.freeze({
  "ember-electricity": {
    publisher: "Ember", url: "https://ember-energy.org/data/electricity-data-explorer/",
    family: "verified-research", category: "electricityMarket",
    fields: [
      "electricityConsumption", "electricityMix", "renewableGenerationShare",
      "totalGeneration",
    ],
  },
  "global-solar-atlas": {
    publisher: "World Bank ESMAP", url: "https://globalsolaratlas.info/",
    family: "international-organization", category: "solarResource",
    fields: ["ghi", "pvout", "solarPotentialSummary"],
  },
  "global-wind-atlas": {
    publisher: "World Bank ESMAP", url: "https://globalwindatlas.info/",
    family: "international-organization", category: "windResource",
    fields: ["offshoreWindClass", "onshoreWindClass"],
  },
  "irenastat-capacity": {
    publisher: "International Renewable Energy Agency (IRENA)",
    url: "https://pxweb.irena.org/pxweb/en/IRENASTAT/",
    family: "international-organization",
    category: "renewableCapacity",
    fields: ["hydroCapacity", "solarCapacity", "totalRenewableCapacity", "windCapacity"],
  },
} as const);
const MANUAL_SOURCE_POLICIES = Object.freeze({
  "iea-policies": {
    publisher: "International Energy Agency", urlPrefix: "https://www.iea.org/policies/",
    family: "international-organization",
  },
  "rise-policy-review": {
    publisher: "World Bank RISE", urlPrefix: "https://rise.esmap.org/country/",
    family: "international-organization",
  },
} as const);

export async function prepareBasicBatch(
  input: PrepareBasicBatchInput,
): Promise<BasicBatchResult> {
  const config = validateBasicBatchConfig(input.config);
  const globalIds = [...input.globalSourceIds];
  if (
    globalIds.length > 16 || new Set(globalIds).size !== globalIds.length ||
    globalIds.some((sourceId) => !SAFE_SOURCE_ID.test(sourceId))
  ) throw new Error("basic batch preparation failed");
  globalIds.sort(compareText);
  const captures = new Map<string, Uint8Array>();
  try {
    for (const sourceId of globalIds) {
      captures.set(sourceId, await input.cache.getOrCapture(
        sourceId,
        () => input.captureGlobalSource(sourceId),
      ));
    }
  } catch (error) {
    const status = error instanceof BasicBatchExpectedBlockError ? "blocked" : "error";
    return Object.freeze({
      batchId: config.batchId,
      results: Object.freeze(config.countries.map((countryCode) => Object.freeze({
        countryCode,
        status,
      }))),
    });
  }

  const results = await Promise.all(config.countries.map(async (countryCode) => {
    try {
      const prepared = await input.prepareCountry(countryCode, captures);
      if (
        prepared.countryCode !== countryCode ||
        !["ready", "blocked", "error"].includes(prepared.status)
      ) {
        throw new Error("invalid result");
      }
      return Object.freeze({ countryCode, status: prepared.status });
    } catch {
      return Object.freeze({ countryCode, status: "error" as const });
    }
  }));
  return Object.freeze({ batchId: config.batchId, results: Object.freeze(results) });
}

export interface BasicBatchCliDependencies {
  run(config: BasicBatchConfig): Promise<BasicBatchResult>;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

const USAGE = "Usage: pnpm basic:prepare-batch --countries=ID,VN,SA --batch-id=basic-v2-202607";

export async function runPrepareBasicBatchCli(
  args: readonly string[],
  dependencies?: BasicBatchCliDependencies,
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    (dependencies?.writeStdout ?? process.stdout.write.bind(process.stdout))(`${USAGE}\n`);
    return 0;
  }
  let config: BasicBatchConfig;
  try {
    config = parseBasicBatchArguments(args);
  } catch {
    (dependencies?.writeStderr ?? process.stderr.write.bind(process.stderr))("basic batch error\n");
    return 1;
  }
  try {
    const runtime = dependencies ?? createProductionBasicBatchCliDependencies();
    const result = await runtime.run(config);
    runtime.writeStdout(`${JSON.stringify(result)}\n`);
    return result.results.some(({ status }) => status === "error") ? 1 :
      result.results.some(({ status }) => status === "blocked") ? 2 : 0;
  } catch {
    (dependencies?.writeStderr ?? process.stderr.write.bind(process.stderr))("basic batch error\n");
    return 1;
  }
}

export function createProductionBasicBatchCliDependencies(
  repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url))),
): BasicBatchCliDependencies {
  return Object.freeze({
    async run(config: BasicBatchConfig) {
      const workspace = await openBasicCandidateWorkspace(repoRoot);
      try {
        const approvedCatalog = parseBasicSourceCatalog(JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBasicBatchCountryInput(
              repoRoot,
              join(repoRoot, "packages", "db", "catalog", "basic-source-catalog.json"),
            ),
          ),
        ) as unknown);
        const cache = createFilesystemBasicBatchCache(repoRoot, config.batchId);
        return await prepareBasicBatch({
          config,
          globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
          cache,
          async captureGlobalSource(sourceId) {
            const pathname = join(
              repoRoot, ".cache", "basic-country", "batches", config.batchId,
              "inputs", "global", `${sourceId}.snapshot`,
            );
            if (sourceId === "ember-electricity") {
              return readReviewedEmberSnapshotOrUnavailable(
                repoRoot, pathname, config.countries,
              );
            }
            const bytes = await readOptionalBasicBatchGlobalInput(repoRoot, pathname);
            if (bytes === null) throw new BasicBatchExpectedBlockError();
            return bytes;
          },
          async prepareCountry(countryCode, globalCaptures) {
            const countryBytes = await readOptionalBasicBatchCountryInput(repoRoot, join(
              repoRoot, ".cache", "basic-country", "batches", config.batchId,
              "inputs", `${countryCode}.json`,
            ));
            if (countryBytes === null) {
              return Object.freeze({ status: "blocked" as const, countryCode });
            }
            const manualCaptures = await readReviewedManualProfileCaptures(
              repoRoot, config.batchId, countryCode,
            );
            const input = parseProductionCountryInput(countryCode, JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(countryBytes),
            ) as unknown, globalCaptures, manualCaptures);
            const base = await composeBasicCountryCandidate({
              workspace,
              configPath: input.candidateConfigPath,
              transport: createProductionSourceTransport(),
            });
            if (base.status === "blocked") {
              return Object.freeze({ status: "blocked" as const, countryCode });
            }
            if (base.status !== "ready" || base.candidate?.validation?.valid !== true) {
              throw new Error("basic batch base candidate is invalid");
            }
            const profileTransport = createProductionSourceTransport();
            const profilePlan = createBasicSourceExecutionPlan({
              catalog: approvedCatalog,
              countryCode,
              sourceIds: ["world-bank-electricity-access", "world-bank-gdp-per-capita"],
            });
            const additiveWorldBank = await Promise.all(profilePlan.sources.map((entry) =>
              captureWorldBankProfileSourceForBatch(entry, countryCode, profileTransport)
            ));
            const baseBundle = base.candidate.validation.data;
            if (baseBundle.sourceRegister.countryCode !== countryCode) {
              throw new Error("basic batch country identity is invalid");
            }
            const profile = assembleProductionBasicProfile({
              baseBundle,
              additiveWorldBank,
              reviewedProfile: input.reviewedProfile,
            });
            const candidate = createBasicV3CandidateComposition({
              baseBundle,
              basicProfile: profile,
              profileAuditSources: [
                ...additiveWorldBank.map(({ auditSource }) => auditSource),
                ...input.reviewedProfile.auditSources,
              ],
              profileSourceChecks: [
                ...additiveWorldBank.map(({ auditSource }) => ({
                  sourceId: auditSource.sourceId,
                  status: "passed" as const,
                  notes: "strict deterministic adapter validation passed",
                })),
                ...input.reviewedProfile.auditSources.map(({ sourceId }) => ({
                  sourceId,
                  status: "passed" as const,
                  notes: "reviewed immutable source input passed",
                })),
              ],
            });
            await writeBasicCandidateArtifactsV3({ workspace, candidate });
            return Object.freeze({ status: "ready" as const, countryCode });
          },
        });
      } finally {
        await closeBasicCandidateWorkspace(workspace);
      }
    },
    writeStdout(value: string) { process.stdout.write(value); },
    writeStderr(value: string) { process.stderr.write(value); },
  });
}

interface ReviewedGlobalProfileInput {
  readonly updatedAt: string;
  readonly sources: readonly BasicProfileSource[];
  readonly auditSources: readonly BasicSourceRecord[];
  readonly fields: readonly Readonly<{
    category: BasicProfileCategoryKey;
    field: BasicProfileField;
  }>[];
}

export function assembleProductionBasicProfile(input: Readonly<{
  baseBundle: BasicCollectionAuditBundleV2;
  additiveWorldBank: readonly Readonly<{
    profileSource: BasicProfileSource;
    field: Readonly<{ category: BasicProfileCategoryKey; field: BasicProfileField }>;
  }>[];
  reviewedProfile: ReviewedGlobalProfileInput;
}>) {
  const baseProfile = profileProjectionFromBase(input.baseBundle);
  return materializeBasicProfile({
    sources: [
      ...baseProfile.sources,
      ...input.additiveWorldBank.map(({ profileSource }) => profileSource),
      ...input.reviewedProfile.sources,
    ].sort((left, right) => compareText(left.id, right.id)),
    updatedAt: input.reviewedProfile.updatedAt,
    fields: sortProfileFields([
      ...baseProfile.fields,
      ...input.additiveWorldBank.map(({ field }) => field),
      ...input.reviewedProfile.fields,
    ]),
  });
}

function sortProfileFields(
  fields: readonly Readonly<{ category: BasicProfileCategoryKey; field: BasicProfileField }>[],
) {
  return [...fields].sort((left, right) => {
    if (left.category !== right.category) return compareText(left.category, right.category);
    const keys = BASIC_PROFILE_REQUIRED_FIELD_KEYS[left.category];
    return keys.indexOf(left.field.key as never) - keys.indexOf(right.field.key as never);
  });
}

function parseProductionCountryInput(
  countryCode: string,
  value: unknown,
  globalCaptures: ReadonlyMap<string, Uint8Array>,
  manualCaptures: ReadonlyMap<string, Uint8Array>,
): Readonly<{
  candidateConfigPath: string;
  reviewedProfile: ReviewedGlobalProfileInput;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("basic batch country input is invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "candidateConfigPath,globalSourceSha256,manualProfile,reviewedGlobalProfile") {
    throw new Error("basic batch country input is invalid");
  }
  const hashes = record.globalSourceSha256;
  if (typeof hashes !== "object" || hashes === null || Array.isArray(hashes)) {
    throw new Error("basic batch country input is invalid");
  }
  const hashRecord = hashes as Record<string, unknown>;
  if (!sameStrings(Object.keys(hashRecord).sort(), [...globalCaptures.keys()].sort())) {
    throw new Error("basic batch country input is invalid");
  }
  for (const [sourceId, bytes] of globalCaptures) {
    if (hashRecord[sourceId] !== sha256(bytes)) {
      throw new Error("basic batch country input is invalid");
    }
  }
  if (
    typeof record.candidateConfigPath !== "string" ||
    !record.candidateConfigPath.startsWith(`.cache/basic-country/`) ||
    record.candidateConfigPath.includes("..")
  ) throw new Error("basic batch country input is invalid");
  const reviewedRecord = parseProfileInputRecord(record.reviewedGlobalProfile);
  const manualRecord = parseProfileInputRecord(record.manualProfile);
  const reviewedProfile = bindReviewedGlobalProfileSnapshots(
    countryCode,
    globalCaptures,
    {
      updatedAt: reviewedRecord.updatedAt,
      sources: reviewedRecord.sources as never,
      auditSources: reviewedRecord.auditSources as never,
      fields: reviewedRecord.fields as never,
    },
  );
  const mergedProfile = bindReviewedManualProfileCaptures(
    countryCode,
    manualCaptures,
    reviewedProfile,
    {
      updatedAt: manualRecord.updatedAt,
      sources: manualRecord.sources as never,
      auditSources: manualRecord.auditSources as never,
      fields: manualRecord.fields as never,
    },
  );
  return Object.freeze({
    candidateConfigPath: record.candidateConfigPath,
    reviewedProfile: mergedProfile,
  });
}

function parseProfileInputRecord(value: unknown): Readonly<{
  updatedAt: string;
  sources: readonly unknown[];
  auditSources: readonly unknown[];
  fields: readonly unknown[];
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) countryInputInvalid();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "auditSources,fields,sources,updatedAt" ||
    typeof record.updatedAt !== "string" || !Array.isArray(record.sources) ||
    !Array.isArray(record.auditSources) || !Array.isArray(record.fields)
  ) countryInputInvalid();
  return {
    updatedAt: record.updatedAt as string,
    sources: record.sources as readonly unknown[],
    auditSources: record.auditSources as readonly unknown[],
    fields: record.fields as readonly unknown[],
  };
}

export function bindReviewedGlobalProfileSnapshots(
  countryCode: string,
  globalCaptures: ReadonlyMap<string, Uint8Array>,
  reviewedProfile: ReviewedGlobalProfileInput,
): ReviewedGlobalProfileInput {
  try {
    if (!/^[A-Z]{2}$/.test(countryCode)) countryInputInvalid();
    const capturedIds = [...globalCaptures.keys()].sort(compareText);
    const requiredIds = [...BASIC_GLOBAL_SOURCE_IDS].sort(compareText);
    if (!sameStrings(capturedIds, requiredIds)) countryInputInvalid();

    if (!isRfc3339(reviewedProfile.updatedAt)) countryInputInvalid();
    const fields = [...reviewedProfile.fields];
    uniqueById(fields, ({ category, field }) => `${category}.${field.key}`);
    const auditsById = uniqueById(reviewedProfile.auditSources, ({ sourceId }) => sourceId);
    const sourcesById = uniqueById(reviewedProfile.sources, ({ id }) => id);
    if (
      !sameStrings([...auditsById.keys()].sort(compareText), requiredIds) ||
      !sameStrings([...sourcesById.keys()].sort(compareText), requiredIds)
    ) countryInputInvalid();

    for (const sourceId of requiredIds) {
      const bytes = globalCaptures.get(sourceId);
      const audit = auditsById.get(sourceId);
      const source = sourcesById.get(sourceId);
      if (bytes === undefined || audit === undefined || source === undefined) countryInputInvalid();
      const rows = parseBasicProfileTabularSnapshot(bytes, countryCode);
      const policy = GLOBAL_SOURCE_POLICIES[sourceId as keyof typeof GLOBAL_SOURCE_POLICIES];
      const locators = rows.map(({ locator }) => locator).sort(compareText);
      const sourceFields = fields.filter(({ field }) => field.sourceIds.includes(sourceId));
      if (
        rows.length === 0 || new Set(locators).size !== locators.length ||
        audit.contentSha256 !== sha256(bytes) ||
        policy === undefined || source.publisher !== policy.publisher ||
        !nonEmptyLocalizedText(source.title) || !isRfc3339(source.retrievedAt) ||
        source.url !== policy.url ||
        audit.sourceFamily !== policy.family || audit.credibility !== "OFFICIAL" ||
        rows.some(({ category }) => category !== policy.category) ||
        !sameStrings(
          rows.map(({ key }) => key).sort(compareText),
          [...policy.fields].sort(compareText),
        ) ||
        !sameStrings([...audit.evidenceLocators].sort(compareText), locators) ||
        audit.sourceId !== source.id || audit.sourceName !== source.publisher ||
        audit.sourceUrl !== source.url || audit.retrievedAt !== source.retrievedAt ||
        audit.publishedAt !== source.publishedAt || audit.credibility !== source.credibility ||
        audit.accessStatus !== "open" || audit.discoveryOnly ||
        audit.promptInjectionRisk !== "none" || sourceFields.length !== rows.length ||
        sourceFields.some(({ field }) =>
          !sameStrings(field.sourceIds, [sourceId]) ||
          !nonEmptyLocalizedText(field.label)
        ) ||
        rows.some(({ status, year }) => status === "AVAILABLE" && (
          year === null || year > Number(audit.retrievedAt.slice(0, 4))
        ))
      ) countryInputInvalid();
      const fieldsByPath = uniqueById(
        sourceFields,
        ({ category, field }) => `${category}.${field.key}`,
      );
      for (const row of rows) {
        const entry = fieldsByPath.get(`${row.category}.${row.key}`);
        if (
          entry === undefined || entry.field.status !== row.status ||
          !sameJson(entry.field.value, row.value) || entry.field.unit !== row.unit ||
          entry.field.year !== row.year || !sameJson(entry.field.reason, row.reason) ||
          entry.field.checkedAt !== audit.retrievedAt.slice(0, 10) ||
          entry.field.note !== null
        ) countryInputInvalid();
      }
    }

    return Object.freeze({
      updatedAt: reviewedProfile.updatedAt,
      sources: Object.freeze(reviewedProfile.sources.map((source) => Object.freeze(source))),
      auditSources: Object.freeze(reviewedProfile.auditSources.map((source) => Object.freeze(source))),
      fields: Object.freeze(fields),
    });
  } catch {
    throw new Error(COUNTRY_INPUT_ERROR);
  }
}

export async function readReviewedManualProfileCaptures(
  repoRoot: string,
  batchId: string,
  countryCode: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
  try {
    const validated = validateBasicBatchConfig({ countries: [countryCode], batchId });
    const captures = new Map<string, Uint8Array>();
    for (const sourceId of Object.keys(MANUAL_SOURCE_POLICIES).sort(compareText)) {
      const bytes = await readOptionalBasicBatchManualInput(repoRoot, join(
        repoRoot,
        ".cache",
        "basic-country",
        "batches",
        validated.batchId,
        "inputs",
        "manual",
        countryCode,
        `${sourceId}.snapshot`,
      ));
      if (bytes !== null) captures.set(sourceId, bytes);
    }
    return captures;
  } catch {
    throw new Error("manual BASIC profile capture input is invalid");
  }
}

export function bindReviewedManualProfileCaptures(
  countryCode: string,
  captures: ReadonlyMap<string, Uint8Array>,
  globalProfile: ReviewedGlobalProfileInput,
  manualProfile: ReviewedGlobalProfileInput,
): ReviewedGlobalProfileInput {
  try {
    if (!/^[A-Z]{2}$/.test(countryCode)) countryInputInvalid();
    const globalSources = uniqueById(globalProfile.sources, ({ id }) => id);
    const globalAudits = uniqueById(globalProfile.auditSources, ({ sourceId }) => sourceId);
    const manualSources = uniqueById(manualProfile.sources, ({ id }) => id);
    const manualAudits = uniqueById(manualProfile.auditSources, ({ sourceId }) => sourceId);
    if (
      manualProfile.updatedAt !== globalProfile.updatedAt ||
      !sameStrings([...manualSources.keys()].sort(compareText), [...manualAudits.keys()].sort(compareText)) ||
      !sameStrings([...manualSources.keys()].sort(compareText), [...captures.keys()].sort(compareText))
    ) countryInputInvalid();

    for (const [sourceId, bytes] of captures) {
      const source = manualSources.get(sourceId);
      const audit = manualAudits.get(sourceId);
      const policy = MANUAL_SOURCE_POLICIES[sourceId as keyof typeof MANUAL_SOURCE_POLICIES];
      if (
        source === undefined || audit === undefined || policy === undefined ||
        !(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
        audit.contentSha256 !== sha256(bytes) ||
        source.publisher !== policy.publisher || !approvedManualSourceUrl(source.url, policy.urlPrefix) ||
        audit.sourceName !== source.publisher || audit.sourceUrl !== source.url ||
        audit.retrievedAt !== source.retrievedAt || audit.publishedAt !== source.publishedAt ||
        audit.credibility !== "OFFICIAL" || source.credibility !== "OFFICIAL" ||
        audit.sourceFamily !== policy.family || audit.accessStatus !== "open" ||
        audit.discoveryOnly || audit.promptInjectionRisk !== "none"
      ) countryInputInvalid();
      const capture = parseManualProfileCapture(bytes, countryCode, sourceId);
      if (
        capture.retrievedAt !== audit.retrievedAt ||
        !sameStrings(
          [...capture.evidenceLocators].sort(compareText),
          [...audit.evidenceLocators].sort(compareText),
        )
      ) countryInputInvalid();
    }

    const globalFieldPaths = new Set(globalProfile.fields.map(
      ({ category, field }) => `${category}.${field.key}`,
    ));
    const approvedSourceIds = new Set([...globalSources.keys(), ...manualSources.keys()]);
    const approvedAudits = new Map([...globalAudits, ...manualAudits]);
    const requiredManualPaths = [
      "marketSummary.opportunitySummary",
      "policyOverview.summary",
      "windResource.resourceSummary",
    ];
    const manualPaths = manualProfile.fields.map(
      ({ category, field }) => `${category}.${field.key}`,
    ).sort(compareText);
    if (!sameStrings(manualPaths, requiredManualPaths)) countryInputInvalid();
    for (const { category, field } of manualProfile.fields) {
      if (
        globalFieldPaths.has(`${category}.${field.key}`) ||
        field.sourceIds.some((sourceId) => !approvedSourceIds.has(sourceId)) ||
        field.sourceIds.length === 0 || !nonEmptyLocalizedText(field.label) ||
        field.unit !== null || field.year !== null || field.note !== null ||
        !(field.status === "AVAILABLE"
          ? nonEmptyLocalizedText(field.value) && field.reason === null
          : field.status === "NOT_AVAILABLE" && field.value === null &&
            nonEmptyLocalizedText(field.reason))
      ) countryInputInvalid();
      if (
        category === "policyOverview" && (
          field.key !== "summary" ||
          field.sourceIds.some((sourceId) => !manualSources.has(sourceId))
        )
      ) countryInputInvalid();
      if (
        category === "windResource" && (
          field.key !== "resourceSummary" ||
          !sameStrings([...field.sourceIds].sort(compareText), ["global-wind-atlas"])
        )
      ) countryInputInvalid();
      if (category === "marketSummary" && field.key !== "opportunitySummary") {
        countryInputInvalid();
      }
      if (![
        "policyOverview", "windResource", "marketSummary",
      ].includes(category)) countryInputInvalid();
      for (const sourceId of field.sourceIds) {
        const audit = approvedAudits.get(sourceId);
        if (
          audit === undefined || audit.evidenceLocators.length === 0 ||
          !/^[a-f0-9]{64}$/.test(audit.contentSha256) || /^0+$/.test(audit.contentSha256)
        ) countryInputInvalid();
      }
    }
    for (const sourceId of manualSources.keys()) {
      if (!manualProfile.fields.some(({ field }) => field.sourceIds.includes(sourceId))) {
        countryInputInvalid();
      }
    }
    return mergeReviewedManualProfile(globalProfile, manualProfile);
  } catch {
    throw new Error(COUNTRY_INPUT_ERROR);
  }
}

function parseManualProfileCapture(
  bytes: Uint8Array,
  countryCode: string,
  sourceId: string,
): Readonly<{ retrievedAt: string; evidenceLocators: readonly string[] }> {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) countryInputInvalid();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "countryCode,evidence,retrievedAt,schemaVersion,sourceId" ||
    record.schemaVersion !== "basic-manual-source-capture/v1" ||
    record.countryCode !== countryCode || record.sourceId !== sourceId ||
    typeof record.retrievedAt !== "string" || !Number.isFinite(Date.parse(record.retrievedAt)) ||
    !Array.isArray(record.evidence) || record.evidence.length === 0 || record.evidence.length > 128
  ) countryInputInvalid();
  const locators = record.evidence.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) countryInputInvalid();
    const evidence = entry as Record<string, unknown>;
    if (Object.keys(evidence).sort().join(",") !== "excerpt,locator") countryInputInvalid();
    if (
      typeof evidence.locator !== "string" || evidence.locator.length === 0 ||
      evidence.locator.length > 500 || /[\r\n\0]/.test(evidence.locator)
    ) countryInputInvalid();
    if (typeof evidence.excerpt !== "object" || evidence.excerpt === null || Array.isArray(evidence.excerpt)) {
      countryInputInvalid();
    }
    const excerpt = evidence.excerpt as Record<string, unknown>;
    if (
      Object.keys(excerpt).sort().join(",") !== "en,zh" ||
      typeof excerpt.zh !== "string" || excerpt.zh.trim().length === 0 ||
      typeof excerpt.en !== "string" || excerpt.en.trim().length === 0
    ) countryInputInvalid();
    return evidence.locator;
  });
  if (new Set(locators).size !== locators.length) countryInputInvalid();
  return { retrievedAt: record.retrievedAt as string, evidenceLocators: locators };
}

function mergeReviewedManualProfile(
  globalProfile: ReviewedGlobalProfileInput,
  manualProfile: ReviewedGlobalProfileInput,
): ReviewedGlobalProfileInput {
  try {
    const globalSourceIds = new Set(globalProfile.sources.map(({ id }) => id));
    const manualSources = uniqueById(manualProfile.sources, ({ id }) => id);
    const manualAudits = uniqueById(manualProfile.auditSources, ({ sourceId }) => sourceId);
    if (!sameStrings([...manualSources.keys()].sort(compareText), [...manualAudits.keys()].sort(compareText))) {
      countryInputInvalid();
    }
    for (const [sourceId, source] of manualSources) {
      const policy = MANUAL_SOURCE_POLICIES[sourceId as keyof typeof MANUAL_SOURCE_POLICIES];
      const audit = manualAudits.get(sourceId);
      if (
        policy === undefined || audit === undefined || source.publisher !== policy.publisher ||
        !approvedManualSourceUrl(source.url, policy.urlPrefix) || audit.sourceName !== source.publisher ||
        audit.sourceUrl !== source.url || audit.retrievedAt !== source.retrievedAt ||
        audit.publishedAt !== source.publishedAt || audit.credibility !== "OFFICIAL" ||
        source.credibility !== "OFFICIAL" || audit.sourceFamily !== policy.family ||
        audit.accessStatus !== "open" || audit.discoveryOnly ||
        audit.promptInjectionRisk !== "none" || audit.evidenceLocators.length === 0
      ) countryInputInvalid();
    }
    const allowedReferences = new Set([...globalSourceIds, ...manualSources.keys()]);
    if (
      manualProfile.fields.some(({ category, field }) =>
        !["marketSummary", "policyOverview", "windResource"].includes(category) ||
        field.sourceIds.some((sourceId) => !allowedReferences.has(sourceId)))
    ) countryInputInvalid();
    if (manualProfile.updatedAt !== globalProfile.updatedAt) countryInputInvalid();
    const sources = [...globalProfile.sources, ...manualProfile.sources];
    const fields = [...globalProfile.fields, ...manualProfile.fields];
    uniqueById(sources, ({ id }) => id);
    uniqueById(fields, ({ category, field }) => `${category}.${field.key}`);
    return Object.freeze({
      updatedAt: globalProfile.updatedAt,
      sources: Object.freeze(sources),
      auditSources: Object.freeze([...globalProfile.auditSources, ...manualProfile.auditSources]),
      fields: Object.freeze(fields),
    });
  } catch {
    throw new Error(COUNTRY_INPUT_ERROR);
  }
}

function createProductionSourceTransport() {
  return createBasicSourceTransportV2(async (url, init) => {
    const response = await globalThis.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, headers: response.headers, body: response.body };
  });
}

export function createEmberNoCredentialTabularSnapshot(
  countries: readonly string[],
): Uint8Array {
  try {
    if (
      countries.length < 1 || countries.length > 3 ||
      new Set(countries).size !== countries.length ||
      countries.some((countryCode) => !/^[A-Z]{2}$/.test(countryCode))
    ) throw new Error("invalid countries");
    return new TextEncoder().encode([
      "countryCode,category,key,value,unit,year,locator,reasonZh,reasonEn",
      ...countries.flatMap((countryCode) => [
        [countryCode, "electricityMarket", "totalGeneration", "", "", "",
          "credential-check:total-generation"],
        [countryCode, "electricityMarket", "electricityConsumption", "", "", "",
          "credential-check:electricity-consumption"],
        [countryCode, "electricityMarket", "electricityMix", "", "", "",
          "credential-check:electricity-mix"],
        [countryCode, "electricityMarket", "renewableGenerationShare", "", "", "",
          "credential-check:renewable-generation-share"],
      ].map((row) => [...row,
        "未提供已审核的Ember不可变标准化快照",
        "A reviewed immutable normalized Ember snapshot was not provided",
      ].join(","))),
    ].join("\n"));
  } catch {
    throw new Error("ember BASIC profile snapshot is invalid");
  }
}

export async function readReviewedEmberSnapshotOrUnavailable(
  repoRoot: string,
  pathname: string,
  countries: readonly string[],
): Promise<Uint8Array> {
  try {
    const reviewed = await readOptionalBasicBatchGlobalInput(repoRoot, pathname);
    return reviewed ?? createEmberNoCredentialTabularSnapshot(countries);
  } catch {
    throw new Error("ember reviewed snapshot input is invalid");
  }
}

export async function captureWorldBankProfileSourceForBatch(
  planEntry: BasicSourceExecutionPlanEntry,
  countryCode: string,
  transport: BasicSourceTransportV2,
  now: () => Date = () => new Date(),
) {
  try {
    const adapter = resolveBasicProfileWorldBankAdapter(planEntry, countryCode);
    const response = await transport.execute(planEntry.request);
    const body = await readBoundedBody(response.body, 10 * 1024 * 1024);
    const retrievedAt = response.retrievedAt;
    const current = now();
    if (!Number.isFinite(current.getTime()) || Date.parse(retrievedAt) > current.getTime() + 5 * 60_000) {
      throw new Error("invalid retrieval time");
    }
    const observation = adapter.extract({ countryCode, retrievedAt, body });
  const label = worldBankLabel(observation.key);
    return Object.freeze({
    profileSource: {
      id: adapter.sourceId,
      publisher: "World Bank",
      title: { zh: label.zh, en: label.en },
      url: planEntry.request.url,
      publishedAt: null,
      retrievedAt,
      credibility: "OFFICIAL" as const,
    },
    auditSource: {
      sourceId: adapter.sourceId,
      sourceName: "World Bank",
      sourceUrl: planEntry.request.url,
      retrievedAt,
      publishedAt: null,
      contentSha256: sha256(body),
      evidenceLocators: [observation.locator],
      sourceFamily: "international-organization" as const,
      accessStatus: "open" as const,
      accessNotes: null,
      credibility: "OFFICIAL" as const,
      discoveryOnly: false,
      promptInjectionRisk: "none" as const,
    },
    field: {
      category: observation.category,
      field: {
        key: observation.key,
        label,
        status: observation.status,
        value: observation.value,
        unit: observation.unit,
        year: observation.year,
        sourceIds: [adapter.sourceId],
        checkedAt: observation.checkedAt,
        reason: observation.reason,
        note: null,
      },
    },
    });
  } catch {
    throw new Error("world bank BASIC profile capture failed");
  }
}

function profileProjectionFromBase(bundle: BasicCollectionAuditBundleV2): Readonly<{
  sources: readonly BasicProfileSource[];
  fields: readonly Readonly<{ category: "countryBasics"; field: BasicProfileField }>[];
}> {
  const definitions = [
    ["country.code", "countryCode", bundle.sourceRegister.countryCode],
    ["country.name", "countryName", undefined],
    ["country.region", "region", undefined],
    ["marketOverview.population", "population", bundle.marketOverviewDraft.population],
    ["marketOverview.gdp", "gdp", bundle.marketOverviewDraft.gdp],
    ["marketOverview.gdpGrowth", "gdpGrowth", bundle.marketOverviewDraft.gdpGrowth],
  ] as const;
  const auditById = new Map(bundle.sourceRegister.sources.map((source) => [source.sourceId, source]));
  const referencedSourceIds = new Set<string>();
  const fields = definitions.map(([fieldPath, key, projectedValue]) => {
    const fact = bundle.extractedFacts.facts.find((entry) => entry.fieldPath === fieldPath);
    if (fact?.status !== "candidate" || fact.evidence.length === 0) {
      throw new Error("basic batch base profile fact is invalid");
    }
    const observedValue = projectedValue === undefined
      ? fact.evidence[0]!.normalizedValue
      : projectedValue;
    const value = baseProfileValue(key, observedValue, bundle.sourceRegister.countryCode);
    const sourceIds = [...new Set(fact.evidence.map(({ sourceId }) => sourceId))].sort(compareText);
    const sources = sourceIds.map((sourceId) => {
      const source = auditById.get(sourceId);
      if (source === undefined) throw new Error("basic batch base profile source is invalid");
      referencedSourceIds.add(sourceId);
      return source;
    });
    const unavailable = value === null;
    const firstEvidence = fact.evidence[0]!;
    return Object.freeze({
      category: "countryBasics" as const,
      field: Object.freeze({
        key,
        label: basicProfileLabel(key),
        status: unavailable ? "NOT_AVAILABLE" as const : "AVAILABLE" as const,
        value,
        unit: unavailable ? null : firstEvidence.unit,
        year: unavailable ? null : firstEvidence.year,
        sourceIds: Object.freeze(sourceIds),
        checkedAt: sources.map(({ retrievedAt }) => retrievedAt.slice(0, 10)).sort(compareText).at(-1)!,
        reason: unavailable ? Object.freeze({
          zh: "World Bank 已核查，但最近记录无可用数值",
          en: "World Bank was checked, but the latest record has no available value",
        }) : null,
        note: null,
      }),
    });
  });
  const sources = [...referencedSourceIds].sort(compareText).map((sourceId) => {
    const source = auditById.get(sourceId)!;
    return Object.freeze({
      id: source.sourceId,
      publisher: source.sourceName,
      title: Object.freeze({ zh: source.sourceName, en: source.sourceName }),
      url: source.sourceUrl,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      credibility: source.credibility,
    });
  });
  return Object.freeze({ sources: Object.freeze(sources), fields: Object.freeze(fields) });
}

function baseProfileValue(
  key: string,
  value: unknown,
  countryCode: string,
): BasicProfileField["value"] {
  if (key === "countryCode") {
    if (value !== countryCode) throw new Error("basic batch base profile value is invalid");
    return countryCode;
  }
  if (key === "countryName") {
    if (!nonEmptyLocalizedText(value)) throw new Error("basic batch base profile value is invalid");
    return value;
  }
  if (key === "region") {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("basic batch base profile value is invalid");
    }
    return value;
  }
  if (value === null || (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("basic batch base profile value is invalid");
}

async function readBoundedBody(
  body: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
      throw new Error("invalid response body");
    }
    length += chunk.byteLength;
    if (length > maximumBytes) throw new Error("response body exceeds limit");
    chunks.push(new Uint8Array(chunk));
  }
  if (length === 0) throw new Error("empty response body");
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function worldBankLabel(key: string): Readonly<{ zh: string; en: string }> {
  const labels: Record<string, Readonly<{ zh: string; en: string }>> = {
    population: { zh: "人口", en: "Population" },
    gdp: { zh: "国内生产总值", en: "GDP" },
    gdpPerCapita: { zh: "人均国内生产总值", en: "GDP per capita" },
    gdpGrowth: { zh: "国内生产总值增长率", en: "GDP growth" },
    electricityAccess: { zh: "通电率", en: "Access to electricity" },
  };
  return labels[key] ?? (() => { throw new Error("world bank BASIC field is invalid"); })();
}

function basicProfileLabel(key: string): Readonly<{ zh: string; en: string }> {
  const labels: Record<string, Readonly<{ zh: string; en: string }>> = {
    countryCode: { zh: "国家代码", en: "Country code" },
    countryName: { zh: "国家名称", en: "Country name" },
    region: { zh: "区域", en: "Region" },
  };
  return labels[key] ?? worldBankLabel(key);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueById<T>(
  values: readonly T[],
  id: (value: T) => string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) countryInputInvalid();
    result.set(key, value);
  }
  return result;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function approvedManualSourceUrl(value: string, approvedPrefix: string): boolean {
  try {
    if (
      /[\\\u0000-\u0020%]/.test(value)
    ) return false;
    const raw = /^https:\/\/[^/?#]+(\/[^?#]*)$/.exec(value);
    if (raw === null) return false;
    const parsed = new URL(value);
    const approved = new URL(approvedPrefix);
    const suffix = parsed.pathname.slice(approved.pathname.length);
    return (
      parsed.origin === approved.origin && parsed.pathname.startsWith(approved.pathname) &&
      parsed.pathname.length > approved.pathname.length && raw[1] === parsed.pathname &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(suffix) &&
      parsed.port === "" &&
      parsed.search === "" && parsed.hash === "" && parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function nonEmptyLocalizedText(
  value: unknown,
): value is Readonly<{ zh: string; en: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "en,zh" &&
    typeof record.zh === "string" && record.zh.trim().length > 0 &&
    typeof record.en === "string" && record.en.trim().length > 0
  );
}

function isRfc3339(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function countryInputInvalid(): never {
  throw new Error(COUNTRY_INPUT_ERROR);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  process.exitCode = await runPrepareBasicBatchCli(process.argv.slice(2));
}
