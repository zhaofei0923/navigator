import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseBasicBatchArguments,
  validateBasicBatchConfig,
  type BasicBatchConfig,
} from "./basic-batch-config.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "../collection/adapters/basic-global-source-pack.js";
import { WORLD_BANK_BASIC_PROFILE_ADAPTERS } from "../collection/adapters/world-bank-basic-profile.js";
import { materializeBasicProfile } from "../collection/basic-profile-fact-materializer.js";
import { composeBasicCountryCandidate } from "./basic-candidate-composition.js";
import { createBasicSourceTransportV2 } from "../collection/basic-source-transport-v2.js";
import type { BasicCollectionAuditBundleV2 } from "../collection/basic-collection-v2-contracts.js";
import type { BasicSourceRecord } from "../collection/basic-collection-contracts.js";
import type { BasicSourceTransportV2 } from "../collection/basic-source-v2-contracts.js";
import { createBasicV3CandidateComposition } from "./basic-v3-candidate-composition.js";
import { writeBasicCandidateArtifactsV3 } from "./basic-candidate-artifact-writer.js";
import {
  closeBasicCandidateWorkspace,
  openBasicCandidateWorkspace,
} from "./basic-candidate-workspace.js";

export interface BasicBatchCache {
  getOrCapture(
    sourceId: string,
    capture: () => Promise<Uint8Array>,
  ): Promise<Uint8Array>;
}

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
  ) => Promise<Readonly<{ status: "ready" | "blocked"; countryCode: string }>>;
}

const SAFE_SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const CACHE_ERROR = "basic batch cache is invalid";
const pendingByCache = new WeakMap<object, Map<string, Promise<Uint8Array>>>();

export function createFilesystemBasicBatchCache(
  repoRoot: string,
  batchId: string,
): BasicBatchCache {
  const validated = validateBasicBatchConfig({ countries: ["XZ"], batchId });
  const root = resolve(repoRoot, ".cache", "basic-country", "batches", validated.batchId);
  const cache = Object.freeze({
    getOrCapture(sourceId: string, capture: () => Promise<Uint8Array>): Promise<Uint8Array> {
      if (!SAFE_SOURCE_ID.test(sourceId) || typeof capture !== "function") {
        return Promise.reject(new Error(CACHE_ERROR));
      }
      let pending = pendingByCache.get(cache);
      if (pending === undefined) {
        pending = new Map();
        pendingByCache.set(cache, pending);
      }
      const existing = pending.get(sourceId);
      if (existing !== undefined) return existing;
      const operation = loadOrCapture(root, sourceId, capture);
      pending.set(sourceId, operation);
      void operation.finally(() => {
        if (pending?.get(sourceId) === operation) pending.delete(sourceId);
      }).catch(() => undefined);
      return operation;
    },
  });
  return cache;
}

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
  } catch {
    return Object.freeze({
      batchId: config.batchId,
      results: Object.freeze(config.countries.map((countryCode) => Object.freeze({
        countryCode,
        status: "error" as const,
      }))),
    });
  }

  const results = await Promise.all(config.countries.map(async (countryCode) => {
    try {
      const prepared = await input.prepareCountry(countryCode, captures);
      if (prepared.countryCode !== countryCode || !["ready", "blocked"].includes(prepared.status)) {
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
  repoRoot = resolve(new URL("../../../../", import.meta.url).pathname),
): BasicBatchCliDependencies {
  return Object.freeze({
    async run(config: BasicBatchConfig) {
      const workspace = await openBasicCandidateWorkspace(repoRoot);
      try {
        const cache = createFilesystemBasicBatchCache(repoRoot, config.batchId);
        return await prepareBasicBatch({
          config,
          globalSourceIds: BASIC_GLOBAL_SOURCE_IDS,
          cache,
          captureGlobalSource: (sourceId) => readBoundedFile(join(
            repoRoot, ".cache", "basic-country", "batches", config.batchId,
            "inputs", "global", `${sourceId}.snapshot`,
          )),
          async prepareCountry(countryCode, globalCaptures) {
            const input = parseProductionCountryInput(JSON.parse(await readFile(join(
              repoRoot, ".cache", "basic-country", "batches", config.batchId,
              "inputs", `${countryCode}.json`,
            ), "utf8")) as unknown, globalCaptures);
            const base = await composeBasicCountryCandidate({
              workspace,
              configPath: input.candidateConfigPath,
              transport: createProductionSourceTransport(),
            });
            if (base.status !== "ready" || base.candidate?.validation?.valid !== true) {
              throw new Error("basic batch base candidate is invalid");
            }
            const profileTransport = createProductionSourceTransport();
            const additiveWorldBank = await Promise.all([
              "world-bank-electricity-access",
              "world-bank-gdp-per-capita",
            ].map((sourceId) => captureWorldBankProfileSourceForBatch(
              sourceId,
              countryCode,
              profileTransport,
            )));
            const baseBundle = base.candidate.validation.data;
            if (baseBundle.sourceRegister.countryCode !== countryCode) {
              throw new Error("basic batch country identity is invalid");
            }
            const profile = materializeBasicProfile({
              sources: [
                ...profileSourcesFromBase(baseBundle),
                ...additiveWorldBank.map(({ profileSource }) => profileSource),
                ...input.reviewedProfile.sources,
              ].sort((left, right) => compareText(left.id, right.id)),
              updatedAt: input.reviewedProfile.updatedAt,
              fields: [
                ...profileFieldsFromBase(baseBundle),
                ...additiveWorldBank.map(({ field }) => field),
                ...input.reviewedProfile.fields,
              ],
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

async function loadOrCapture(
  root: string,
  sourceId: string,
  capture: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  try {
    const objects = join(root, "objects");
    const refs = join(root, "refs");
    await mkdir(objects, { recursive: true, mode: 0o700 });
    await mkdir(refs, { recursive: true, mode: 0o700 });
    const refPath = join(refs, `${sourceId}.json`);
    try {
      const rawRef = JSON.parse(await readFile(refPath, "utf8")) as unknown;
      const reference = parseReference(rawRef, sourceId);
      const bytes = new Uint8Array(await readFile(join(objects, reference.sha256)));
      if (bytes.byteLength !== reference.byteLength || sha256(bytes) !== reference.sha256) invalidCache();
      return bytes;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const captured = await capture();
    if (!(captured instanceof Uint8Array) || captured.byteLength === 0 || captured.byteLength > MAX_CAPTURE_BYTES) invalidCache();
    const bytes = new Uint8Array(captured);
    const digest = sha256(bytes);
    const objectPath = join(objects, digest);
    try {
      await writeFile(objectPath, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!isExists(error)) throw error;
    }
    const temporary = join(refs, `.${sourceId}.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify({ sourceId, sha256: digest, byteLength: bytes.byteLength })}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, refPath);
    return bytes;
  } catch {
    throw new Error(CACHE_ERROR);
  }
}

function parseReference(value: unknown, sourceId: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidCache();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "byteLength,sha256,sourceId" ||
    record.sourceId !== sourceId || typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sha256) || typeof record.byteLength !== "number" ||
    !Number.isSafeInteger(record.byteLength) || record.byteLength <= 0 ||
    record.byteLength > MAX_CAPTURE_BYTES
  ) invalidCache();
  return { sha256: record.sha256, byteLength: record.byteLength };
}

function parseProductionCountryInput(
  value: unknown,
  globalCaptures: ReadonlyMap<string, Uint8Array>,
): Readonly<{
  candidateConfigPath: string;
  reviewedProfile: Readonly<{
    updatedAt: string;
    sources: readonly import("@navigator/shared-types/basic-profile").BasicProfileSource[];
    auditSources: readonly import("../collection/basic-collection-contracts.js").BasicSourceRecord[];
    fields: readonly Readonly<{
      category: import("@navigator/shared-types/basic-profile").BasicProfileCategoryKey;
      field: import("@navigator/shared-types/basic-profile").BasicProfileField;
    }>[];
  }>;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("basic batch country input is invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "candidateConfigPath,globalSourceSha256,reviewedProfile") {
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
  const reviewed = record.reviewedProfile;
  if (typeof reviewed !== "object" || reviewed === null || Array.isArray(reviewed)) {
    throw new Error("basic batch country input is invalid");
  }
  const reviewedRecord = reviewed as Record<string, unknown>;
  if (
    Object.keys(reviewedRecord).sort().join(",") !== "auditSources,fields,sources,updatedAt" ||
    typeof reviewedRecord.updatedAt !== "string" || !Array.isArray(reviewedRecord.sources) ||
    !Array.isArray(reviewedRecord.auditSources) || !Array.isArray(reviewedRecord.fields)
  ) throw new Error("basic batch country input is invalid");
  return Object.freeze({
    candidateConfigPath: record.candidateConfigPath,
    reviewedProfile: Object.freeze({
      updatedAt: reviewedRecord.updatedAt,
      sources: reviewedRecord.sources as never,
      auditSources: reviewedRecord.auditSources as never,
      fields: reviewedRecord.fields as never,
    }),
  });
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

export async function captureWorldBankProfileSourceForBatch(
  sourceId: string,
  countryCode: string,
  transport: BasicSourceTransportV2,
  now: () => Date = () => new Date(),
) {
  try {
    const adapter = WORLD_BANK_BASIC_PROFILE_ADAPTERS.find((entry) => entry.sourceId === sourceId);
    if (adapter === undefined) throw new Error("invalid source");
    const request = adapter.request(countryCode);
    const response = await transport.execute({
      method: "GET",
      url: request.url,
      accept: "application/json",
      allowedOrigins: ["https://api.worldbank.org"],
      allowedQueryParameters: ["source", "format", "mrv", "per_page"],
    });
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
      id: sourceId,
      publisher: "World Bank",
      title: { zh: label.zh, en: label.en },
      url: request.url,
      publishedAt: null,
      retrievedAt,
      credibility: "OFFICIAL" as const,
    },
    auditSource: {
      sourceId,
      sourceName: "World Bank",
      sourceUrl: request.url,
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
        sourceIds: [sourceId],
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

function profileSourcesFromBase(
  bundle: BasicCollectionAuditBundleV2,
) {
  const selected = new Set(["world-bank-population", "world-bank-gdp", "world-bank-gdp-growth"]);
  return bundle.sourceRegister.sources.filter((source: { sourceId: string }) => selected.has(source.sourceId))
    .map((source: BasicSourceRecord) => ({
      id: source.sourceId,
      publisher: source.sourceName,
      title: { zh: worldBankLabel(baseProfileKey(source.sourceId)).zh, en: worldBankLabel(baseProfileKey(source.sourceId)).en },
      url: source.sourceUrl,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      credibility: source.credibility,
    }));
}

function profileFieldsFromBase(bundle: BasicCollectionAuditBundleV2) {
  const definitions = [
    ["world-bank-population", "population", "population"],
    ["world-bank-gdp", "gdp", "gdp"],
    ["world-bank-gdp-growth", "gdpGrowth", "gdpGrowth"],
  ] as const;
  return definitions.map(([sourceId, key, draftKey]) => {
    const fact = bundle.extractedFacts.facts.find((entry) =>
      entry.fieldPath === `marketOverview.${draftKey}`
    );
    const evidence = fact?.evidence.find((entry) => entry.sourceId === sourceId);
    const source = bundle.sourceRegister.sources.find((entry) => entry.sourceId === sourceId);
    const value = bundle.marketOverviewDraft[draftKey];
    if (
      evidence === undefined || source === undefined ||
      !(value === null || (typeof value === "number" && Number.isFinite(value)))
    ) {
      throw new Error("basic batch World Bank base fact is invalid");
    }
    const unavailable = value === null;
    return {
      category: "countryBasics" as const,
      field: {
        key,
        label: worldBankLabel(key),
        status: unavailable ? "NOT_AVAILABLE" as const : "AVAILABLE" as const,
        value,
        unit: unavailable ? null : evidence.unit,
        year: unavailable ? null : evidence.year,
        sourceIds: [sourceId],
        checkedAt: source.retrievedAt.slice(0, 10),
        reason: unavailable ? {
          zh: "World Bank 已核查，但最近记录无可用数值",
          en: "World Bank was checked, but the latest record has no available value",
        } : null,
        note: null,
      },
    };
  });
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

function baseProfileKey(sourceId: string): string {
  return sourceId === "world-bank-population" ? "population" :
    sourceId === "world-bank-gdp" ? "gdp" : "gdpGrowth";
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

async function readBoundedFile(pathname: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(pathname));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CAPTURE_BYTES) {
    throw new Error("basic batch global input is invalid");
  }
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidCache(): never {
  throw new Error(CACHE_ERROR);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  process.exitCode = await runPrepareBasicBatchCli(process.argv.slice(2));
}
