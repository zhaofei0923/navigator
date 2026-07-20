import { parseBasicProfile } from "@navigator/shared-types/basic-profile";

import type { BasicCollectionAuditBundleV2 } from "./basic-collection-v2-contracts.js";
import type { BasicSourceCheck, BasicSourceRecord } from "./basic-collection-contracts.js";
import { validateBasicCollectionAuditBundleV2 } from "./basic-collection-v2-validator.js";
import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  type BasicCollectionAuditBundleV3,
} from "./basic-collection-v3-contracts.js";
import { validateBasicCollectionAuditBundleV3 } from "./basic-collection-v3-validator.js";
import { materializeBasicProfileFacts } from "./basic-profile-fact-materializer.js";

export interface BasicAuditV3AssemblyInput {
  readonly baseBundle: unknown;
  readonly basicProfile: unknown;
  readonly profileAuditSources?: readonly BasicSourceRecord[];
  readonly profileSourceChecks?: readonly BasicSourceCheck[];
}

export function assembleBasicCollectionAuditBundleV3(
  input: BasicAuditV3AssemblyInput,
): BasicCollectionAuditBundleV3 {
  try {
    const baseValidation = validateBasicCollectionAuditBundleV2(input.baseBundle);
    const profile = parseBasicProfile(input.basicProfile);
    if (!baseValidation.valid || profile === null) invalid();
    const base = baseValidation.data;
    const mergedSources = mergeById(
      base.sourceRegister.sources,
      input.profileAuditSources ?? [],
      (source) => source.sourceId,
    );
    const mergedChecks = mergeById(
      base.reviewReport.sourceChecks,
      input.profileSourceChecks ?? [],
      (check) => check.sourceId,
    );
    requireProfileSources(mergedSources, profile.sources.map(({ id }) => id));
    const sourceRegister = {
      ...base.sourceRegister,
      schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
      sources: mergedSources,
    } as const;
    const profileFacts = materializeBasicProfileFacts({
      profile,
      sourceRegister,
    });
    const candidate = {
      countryDirectory: base.countryDirectory,
      runId: base.runId,
      sourceRegister,
      extractedFacts: {
        ...base.extractedFacts,
        schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
        facts: [...base.extractedFacts.facts, ...profileFacts].sort(
          (left, right) => compareText(left.fieldPath, right.fieldPath),
        ),
      },
      marketOverviewDraft: {
        ...base.marketOverviewDraft,
        basicProfile: profile,
      },
      reviewReport: {
        ...base.reviewReport,
        schemaVersion: BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
        sourceChecks: mergedChecks,
      },
    };
    const validation = validateBasicCollectionAuditBundleV3(candidate);
    if (!validation.valid || !validation.readyForHumanReview) invalid();
    return validation.data;
  } catch {
    throw new Error("Basic audit v3 assembly failed");
  }
}

function requireProfileSources(
  sources: BasicCollectionAuditBundleV2["sourceRegister"]["sources"],
  profileSourceIds: readonly string[],
): void {
  const known = new Set(sources.map(({ sourceId }) => sourceId));
  if (profileSourceIds.some((sourceId) => !known.has(sourceId))) invalid();
}

function mergeById<T>(
  base: readonly T[],
  additional: readonly T[],
  id: (value: T) => string,
): readonly T[] {
  const values = [...base];
  const known = new Set(values.map(id));
  for (const value of additional) {
    if (known.has(id(value))) invalid();
    known.add(id(value));
    values.push(value);
  }
  return values.sort((left, right) => compareText(id(left), id(right)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error("invalid");
}
