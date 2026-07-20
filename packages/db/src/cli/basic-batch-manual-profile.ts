import { createHash } from "node:crypto";
import { join } from "node:path";

import { validateBasicBatchConfig } from "./basic-batch-config.js";
import { readOptionalBasicBatchManualInput } from "./basic-batch-filesystem-cache.js";
import type { ReviewedGlobalProfileInput } from "./basic-batch-production-input.js";

const COUNTRY_INPUT_ERROR = "basic batch country input is invalid";

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
        repoRoot, ".cache", "basic-country", "batches", validated.batchId,
        "inputs", "manual", countryCode, `${sourceId}.snapshot`,
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
        audit.contentSha256 !== sha256(bytes) || source.publisher !== policy.publisher ||
        !approvedManualSourceUrl(source.url, policy.urlPrefix) ||
        audit.sourceName !== source.publisher || audit.sourceUrl !== source.url ||
        audit.retrievedAt !== source.retrievedAt || audit.publishedAt !== source.publishedAt ||
        audit.credibility !== "OFFICIAL" || source.credibility !== "OFFICIAL" ||
        audit.sourceFamily !== policy.family || audit.accessStatus !== "open" ||
        audit.discoveryOnly || audit.promptInjectionRisk !== "none"
      ) countryInputInvalid();
      const capture = parseManualProfileCapture(bytes, countryCode, sourceId);
      if (
        capture.retrievedAt !== audit.retrievedAt ||
        !sameStrings([...capture.evidenceLocators].sort(compareText), [...audit.evidenceLocators].sort(compareText))
      ) countryInputInvalid();
    }

    const globalFieldPaths = new Set(globalProfile.fields.map(({ category, field }) => `${category}.${field.key}`));
    const approvedSourceIds = new Set([...globalSources.keys(), ...manualSources.keys()]);
    const approvedAudits = new Map([...globalAudits, ...manualAudits]);
    const requiredManualPaths = [
      "marketSummary.opportunitySummary", "policyOverview.summary", "windResource.resourceSummary",
    ];
    const manualPaths = manualProfile.fields.map(({ category, field }) => `${category}.${field.key}`).sort(compareText);
    if (!sameStrings(manualPaths, requiredManualPaths)) countryInputInvalid();
    for (const { category, field } of manualProfile.fields) {
      if (
        globalFieldPaths.has(`${category}.${field.key}`) ||
        field.sourceIds.some((sourceId) => !approvedSourceIds.has(sourceId)) ||
        field.sourceIds.length === 0 || !nonEmptyLocalizedText(field.label) ||
        field.unit !== null || field.year !== null || field.note !== null ||
        !(field.status === "AVAILABLE"
          ? nonEmptyLocalizedText(field.value) && field.reason === null
          : field.status === "NOT_AVAILABLE" && field.value === null && nonEmptyLocalizedText(field.reason))
      ) countryInputInvalid();
      if (category === "policyOverview" && (
        field.key !== "summary" || field.sourceIds.some((sourceId) => !manualSources.has(sourceId))
      )) countryInputInvalid();
      if (category === "windResource" && (
        field.key !== "resourceSummary" || !sameStrings([...field.sourceIds].sort(compareText), ["global-wind-atlas"])
      )) countryInputInvalid();
      if (category === "marketSummary" && field.key !== "opportunitySummary") countryInputInvalid();
      if (!["policyOverview", "windResource", "marketSummary"].includes(category)) countryInputInvalid();
      for (const sourceId of field.sourceIds) {
        const audit = approvedAudits.get(sourceId);
        if (
          audit === undefined || audit.evidenceLocators.length === 0 ||
          !/^[a-f0-9]{64}$/.test(audit.contentSha256) || /^0+$/.test(audit.contentSha256)
        ) countryInputInvalid();
      }
    }
    for (const sourceId of manualSources.keys()) {
      if (!manualProfile.fields.some(({ field }) => field.sourceIds.includes(sourceId))) countryInputInvalid();
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
    Object.keys(record).sort().join(",") !== "countryCode,evidence,retrievedAt,schemaVersion,sourceId" ||
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
      field.sourceIds.some((sourceId) => !allowedReferences.has(sourceId))) ||
    manualProfile.updatedAt !== globalProfile.updatedAt
  ) countryInputInvalid();
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
}

function approvedManualSourceUrl(value: string, approvedPrefix: string): boolean {
  try {
    if (/[\\\u0000-\u0020%]/.test(value)) return false;
    const raw = /^https:\/\/[^/?#]+(\/[^?#]*)$/.exec(value);
    if (raw === null) return false;
    const parsed = new URL(value);
    const approved = new URL(approvedPrefix);
    const suffix = parsed.pathname.slice(approved.pathname.length);
    return parsed.origin === approved.origin && parsed.pathname.startsWith(approved.pathname) &&
      parsed.pathname.length > approved.pathname.length && raw[1] === parsed.pathname &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(suffix) &&
      parsed.port === "" && parsed.search === "" && parsed.hash === "" &&
      parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
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

function uniqueById<T>(values: readonly T[], id: (value: T) => string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) countryInputInvalid();
    result.set(key, value);
  }
  return result;
}

function nonEmptyLocalizedText(value: unknown): value is Readonly<{ zh: string; en: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "en,zh" &&
    typeof record.zh === "string" && record.zh.trim().length > 0 &&
    typeof record.en === "string" && record.en.trim().length > 0;
}

function countryInputInvalid(): never {
  throw new Error(COUNTRY_INPUT_ERROR);
}
