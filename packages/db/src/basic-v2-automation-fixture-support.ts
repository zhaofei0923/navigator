import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import {
  BASIC_PROFILE_REQUIRED_FIELD_KEYS,
  type BasicProfile,
  type BasicProfileCategoryKey,
  type BasicProfileField,
} from "@navigator/shared-types/basic-profile";

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import { createBasicV3CandidateComposition } from "./cli/basic-v3-candidate-composition.js";
import { bindReviewedGlobalProfileSnapshots } from "./cli/prepare-basic-batch.js";
import { BASIC_GLOBAL_SOURCE_IDS } from "./collection/adapters/basic-global-source-pack.js";
import { parseBasicProfileTabularSnapshot } from "./collection/adapters/basic-profile-tabular.js";
import { classifyBasicV2FieldPath } from "./collection/basic-collection-v2-contracts.js";
import { materializeBasicDerivedFacts } from "./collection/basic-derived-fact-materializer.js";
import { sha256Hex } from "./collection/basic-publication-digests.js";
import { materializeBasicProfile } from "./collection/basic-profile-fact-materializer.js";
import { validateBasicCollectionAuditBundleV2 } from "./collection/basic-collection-v2-validator.js";

export const CANDIDATE_FILES = [
  "source-register.json", "extracted-facts.json", "market-overview.draft.json", "review-report.json",
] as const;
export const CANONICAL_FILES = [
  "collection-manifest.json", "country.json", "market-overview.json",
] as const;

const POLICIES = {
  "ember-electricity": { publisher: "Ember", url: "https://ember-energy.org/data/electricity-data-explorer/", sourceFamily: "verified-research" as const },
  "global-solar-atlas": { publisher: "World Bank ESMAP", url: "https://globalsolaratlas.info/", sourceFamily: "international-organization" as const },
  "global-wind-atlas": { publisher: "World Bank ESMAP", url: "https://globalwindatlas.info/", sourceFamily: "international-organization" as const },
  "irenastat-capacity": { publisher: "International Renewable Energy Agency (IRENA)", url: "https://pxweb.irena.org/pxweb/en/IRENASTAT/", sourceFamily: "international-organization" as const },
} as const;

export interface StrictFixture {
  readonly batchId: string;
  readonly globalSnapshots: Readonly<Record<(typeof BASIC_GLOBAL_SOURCE_IDS)[number], string>>;
  readonly reviewedSnapshotSha256: Readonly<Record<(typeof BASIC_GLOBAL_SOURCE_IDS)[number], string>>;
  readonly countries: readonly Readonly<{ countryCode: string; countryDirectory: string; runId: string }>[];
  readonly approval: Readonly<{ reviewerId: string; submittedAt: string; decidedAt: string }>;
}

export function loadStrictFixture(): StrictFixture {
  const value: unknown = JSON.parse(readFileSync(new URL(
    "../fixtures/basic-v2-automation/strict-three-country-input.json", import.meta.url,
  ), "utf8"));
  if (!isStrictFixture(value)) throw new Error("strict automation fixture is invalid");
  for (const sourceId of BASIC_GLOBAL_SOURCE_IDS) {
    if (sha256Hex(new TextEncoder().encode(value.globalSnapshots[sourceId])) !== value.reviewedSnapshotSha256[sourceId]) {
      throw new Error("strict automation fixture capture hash is invalid");
    }
  }
  return value;
}

export function isGlobalSourceId(value: string): value is (typeof BASIC_GLOBAL_SOURCE_IDS)[number] {
  return (BASIC_GLOBAL_SOURCE_IDS as readonly string[]).includes(value);
}

export function tamperOneCapturedByte(captures: ReadonlyMap<string, Uint8Array>) {
  const tampered = new Map(captures);
  const original = tampered.get("global-solar-atlas");
  if (original === undefined) throw new Error("missing solar capture");
  const copy = new Uint8Array(original);
  copy[copy.byteLength - 1] = copy[copy.byteLength - 1]! ^ 1;
  tampered.set("global-solar-atlas", copy);
  return tampered;
}

export function assertTamperRejected(fixture: StrictFixture, countryCode: string, captures: ReadonlyMap<string, Uint8Array>): void {
  expect(() => bindReviewedGlobalProfileSnapshots(
    countryCode, tamperOneCapturedByte(captures), reviewedGlobalProfile(fixture, countryCode, captures),
  )).toThrow("basic batch country input is invalid");
}

export function createSyntheticCandidate(
  fixture: StrictFixture, countryCode: string, countryDirectory: string, runId: string,
  captures: ReadonlyMap<string, Uint8Array>,
) {
  const base = structuredClone(createBasicCollectionAuditV2Fixture());
  const sourceRegister = { ...base.sourceRegister, countryCode, runId };
  const candidateFacts = base.extractedFacts.facts
    .filter(({ fieldPath }) => classifyBasicV2FieldPath(fieldPath) !== "derived")
    .map((fact) => ({ ...fact, ...(
      fact.fieldPath === "country.code" || fact.fieldPath === "marketOverview.countryCode"
        ? { evidence: fact.evidence.map((evidence) => ({ ...evidence, rawValue: countryCode, normalizedValue: countryCode })) }
        : {}) }));
  const derived = materializeBasicDerivedFacts({ countryCode, primarySourceId: "source-1", sourceRegister, candidateFacts });
  const marketOverviewDraft = { ...structuredClone(base.marketOverviewDraft), countryCode };
  for (const fact of derived.facts) {
    if (!fact.fieldPath.startsWith("marketOverview.")) continue;
    const value = fact.evidence[0]?.normalizedValue;
    if (value !== undefined) (marketOverviewDraft as unknown as Record<string, unknown>)[fact.fieldPath.slice("marketOverview.".length)] = value;
  }
  const v2 = {
    countryDirectory, runId, sourceRegister: derived.sourceRegister,
    extractedFacts: { schemaVersion: "basic-country-audit/v2" as const, countryCode, runId, facts: [...candidateFacts, ...derived.facts].sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)) },
    marketOverviewDraft,
    reviewReport: { ...base.reviewReport, countryCode, runId },
  };
  const validated = validateBasicCollectionAuditBundleV2(v2);
  if (!validated.valid) throw new Error(validated.errors.join(" | "));
  const bound = bindReviewedGlobalProfileSnapshots(countryCode, captures, reviewedGlobalProfile(fixture, countryCode, captures));
  const source = base.sourceRegister.sources.find(({ sourceId }) => sourceId === "source-1");
  if (source === undefined) throw new Error("missing synthetic profile source");
  const profile = materializeBasicProfile({
    updatedAt: bound.updatedAt,
    sources: [...bound.sources, { id: "source-1", publisher: source.sourceName, title: { zh: "合成基础来源", en: "Synthetic base source" }, url: source.sourceUrl, publishedAt: source.publishedAt, retrievedAt: source.retrievedAt, credibility: source.credibility }],
    fields: [...bound.fields, ...retainedFields(countryCode)],
  });
  return createBasicV3CandidateComposition({
    baseBundle: v2,
    basicProfile: profile,
    profileAuditSources: bound.auditSources,
    profileSourceChecks: bound.auditSources.map(({ sourceId }) => ({ sourceId, status: "passed" as const, notes: "strict synthetic snapshot bound by production validator" })),
  });
}

export function assertCapturedProvenance(fixture: StrictFixture, bytes: Record<(typeof CANDIDATE_FILES)[number], Uint8Array>): void {
  const register = JSON.parse(decode(bytes["source-register.json"])) as { sources: readonly { sourceId: string; contentSha256: string }[] };
  const facts = JSON.parse(decode(bytes["extracted-facts.json"])) as { facts: readonly { fieldPath: string; evidence: readonly { sourceId: string }[] }[] };
  const profile = JSON.parse(decode(bytes["market-overview.draft.json"])) as {
    basicProfile: BasicProfile;
  };
  for (const sourceId of BASIC_GLOBAL_SOURCE_IDS) {
    expect(register.sources).toContainEqual(expect.objectContaining({ sourceId, contentSha256: fixture.reviewedSnapshotSha256[sourceId] }));
    expect(profile.basicProfile.sources).toContainEqual(expect.objectContaining({ id: sourceId }));
  }
  const profileFacts = facts.facts.filter(({ fieldPath }) => fieldPath.startsWith("marketOverview.basicProfile."));
  for (const [category, requiredKeys] of Object.entries(BASIC_PROFILE_REQUIRED_FIELD_KEYS)) {
    const actualKeys = profile.basicProfile.categories[
      category as BasicProfileCategoryKey
    ].fields.map(({ key }) => key);
    expect([...actualKeys].sort()).toEqual([...requiredKeys].sort());
  }
  expect(profileFacts).toHaveLength(24);
  expect(new Set(profileFacts.flatMap(({ evidence }) => evidence.map(({ sourceId }) => sourceId))))
    .toEqual(new Set([...BASIC_GLOBAL_SOURCE_IDS, "source-1"]));
}

export function artifactBytes<T extends readonly string[]>(directory: string, names: T): Record<T[number], Uint8Array> {
  return Object.fromEntries(names.map((name) => [name, new Uint8Array(readFileSync(join(directory, name)))])) as unknown as Record<T[number], Uint8Array>;
}

export function candidateFromArtifacts(bytes: Record<(typeof CANDIDATE_FILES)[number], Uint8Array>, countryDirectory: string) {
  const sourceRegister = JSON.parse(decode(bytes["source-register.json"]));
  return { countryDirectory, runId: sourceRegister.runId, sourceRegister, extractedFacts: JSON.parse(decode(bytes["extracted-facts.json"])), marketOverviewDraft: JSON.parse(decode(bytes["market-overview.draft.json"])), reviewReport: JSON.parse(decode(bytes["review-report.json"])) };
}

export function canonicalFromFiles(directory: string) {
  return { collectionManifest: JSON.parse(readFileSync(join(directory, "collection-manifest.json"), "utf8")), data: { country: JSON.parse(readFileSync(join(directory, "country.json"), "utf8")), marketOverview: JSON.parse(readFileSync(join(directory, "market-overview.json"), "utf8")), policy: [], risk: [], opportunities: [], projects: [], partners: [], chineseCompanies: [], entryStrategy: null, reports: [], knowledge: [] } };
}

export function snapshot(bytes: Record<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, createHash("sha256").update(value).digest("hex")]));
}

function reviewedGlobalProfile(fixture: StrictFixture, countryCode: string, captures: ReadonlyMap<string, Uint8Array>) {
  const rows = new Map(BASIC_GLOBAL_SOURCE_IDS.map((sourceId) => {
    const bytes = captures.get(sourceId);
    if (bytes === undefined) throw new Error("missing captured source");
    return [sourceId, parseBasicProfileTabularSnapshot(bytes, countryCode)] as const;
  }));
  return {
    updatedAt: "2026-07-20T00:00:00Z",
    sources: BASIC_GLOBAL_SOURCE_IDS.map((sourceId) => ({ id: sourceId, publisher: POLICIES[sourceId].publisher, title: { zh: sourceId, en: sourceId }, url: POLICIES[sourceId].url, publishedAt: null, retrievedAt: "2026-07-20T00:00:00Z", credibility: "OFFICIAL" as const })),
    auditSources: BASIC_GLOBAL_SOURCE_IDS.map((sourceId) => ({ sourceId, sourceName: POLICIES[sourceId].publisher, sourceUrl: POLICIES[sourceId].url, retrievedAt: "2026-07-20T00:00:00Z", publishedAt: null, contentSha256: fixture.reviewedSnapshotSha256[sourceId], evidenceLocators: rows.get(sourceId)!.map(({ locator }) => locator).sort(), sourceFamily: POLICIES[sourceId].sourceFamily, accessStatus: "open" as const, accessNotes: null, credibility: "OFFICIAL" as const, discoveryOnly: false, promptInjectionRisk: "none" as const })),
    fields: BASIC_GLOBAL_SOURCE_IDS.flatMap((sourceId) => rows.get(sourceId)!.map((row) => ({ category: row.category, field: { key: row.key, label: { zh: row.key, en: row.key }, status: row.status, value: row.value, unit: row.unit, year: row.year, sourceIds: [sourceId], checkedAt: "2026-07-20", reason: row.reason, note: null } }))),
  };
}

function retainedFields(countryCode: string): readonly Readonly<{
  category: BasicProfileCategoryKey;
  field: BasicProfileField;
}>[] {
  const entries: readonly Readonly<{
    category: BasicProfileCategoryKey;
    key: string;
    value: BasicProfileField["value"];
    unit: string | null;
    year: number | null;
  }>[] = [
    { category: "countryBasics", key: "countryCode", value: countryCode, unit: null, year: null },
    { category: "countryBasics", key: "countryName", value: { zh: `合成国家 ${countryCode}`, en: `Synthetic ${countryCode}` }, unit: null, year: null },
    { category: "countryBasics", key: "region", value: "synthetic-region", unit: null, year: null },
    { category: "countryBasics", key: "population", value: 1_000_000, unit: "people", year: 2025 },
    { category: "countryBasics", key: "gdp", value: 25_000_000_000, unit: "current US$", year: 2025 },
    { category: "countryBasics", key: "gdpPerCapita", value: 25_000, unit: "current US$ per person", year: 2025 },
    { category: "countryBasics", key: "gdpGrowth", value: 5.2, unit: "%", year: 2025 },
    { category: "energyAccess", key: "electricityAccess", value: 98.5, unit: "%", year: 2025 },
    { category: "windResource", key: "resourceSummary", value: { zh: "合成风资源摘要", en: "Synthetic wind resource summary" }, unit: null, year: null },
    { category: "policyOverview", key: "summary", value: { zh: "合成政策摘要", en: "Synthetic policy summary" }, unit: null, year: null },
    { category: "marketSummary", key: "opportunitySummary", value: { zh: "合成市场摘要", en: "Synthetic market summary" }, unit: null, year: null },
  ];
  return entries.map(({ category, key, value, unit, year }) => ({
    category,
    field: {
      key,
      label: { zh: `${key} 中文`, en: `${key} synthetic` },
      status: "AVAILABLE",
      value,
      unit,
      year,
      sourceIds: ["source-1"],
      checkedAt: "2026-07-10",
      reason: null,
      note: null,
    },
  }));
}

function isStrictFixture(value: unknown): value is StrictFixture {
  if (!isRecord(value) || !hasExactKeys(value, ["approval", "batchId", "countries", "globalSnapshots", "reviewedSnapshotSha256"]) || typeof value.batchId !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value.batchId) || !Array.isArray(value.countries) || value.countries.length !== 3 || !isRecord(value.globalSnapshots) || !isRecord(value.reviewedSnapshotSha256) || !isRecord(value.approval) || !hasExactKeys(value.approval, ["decidedAt", "reviewerId", "submittedAt"])) return false;
  if (typeof value.approval.reviewerId !== "string" || value.approval.reviewerId === "" || !rfc3339(value.approval.submittedAt) || !rfc3339(value.approval.decidedAt) || !hasExactKeys(value.globalSnapshots, BASIC_GLOBAL_SOURCE_IDS) || !hasExactKeys(value.reviewedSnapshotSha256, BASIC_GLOBAL_SOURCE_IDS)) return false;
  const codes = new Set<string>();
  for (const country of value.countries) {
    if (!isRecord(country) || !hasExactKeys(country, ["countryCode", "countryDirectory", "runId"]) || typeof country.countryCode !== "string" || !/^[A-Z]{2}$/.test(country.countryCode) || typeof country.countryDirectory !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(country.countryDirectory) || typeof country.runId !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(country.runId) || codes.has(country.countryCode)) return false;
    codes.add(country.countryCode);
  }
  const globalSnapshots = value.globalSnapshots;
  const reviewedSnapshotSha256 = value.reviewedSnapshotSha256;
  if (!isRecord(globalSnapshots) || !isRecord(reviewedSnapshotSha256)) return false;
  return BASIC_GLOBAL_SOURCE_IDS.every((sourceId) =>
    typeof globalSnapshots[sourceId] === "string" && globalSnapshots[sourceId] !== "" &&
    typeof reviewedSnapshotSha256[sourceId] === "string" && /^[0-9a-f]{64}$/.test(reviewedSnapshotSha256[sourceId]),
  );
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function rfc3339(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && /Z$/.test(value); }
function decode(value: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
