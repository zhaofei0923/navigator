import {
  BASIC_PROFILE_CATEGORY_KEYS,
  parseBasicProfile,
  type BasicProfile,
  type BasicProfileCategoryKey,
  type BasicProfileField,
  type BasicProfileSource,
} from "@navigator/shared-types/basic-profile";

import {
  BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION,
  BASIC_V3_PROFILE_CATEGORY_KEYS,
  basicV3ProfileFactPath,
  type BasicExtractedFactV3,
  type BasicSourceRegisterV3,
} from "./basic-collection-v3-contracts.js";
import { deepFreezeBasicOfflineValue } from "./basic-offline-value.js";
import { snapshotBasicBoundedJsonValue } from "./basic-bounded-json.js";

export interface BasicProfileFactMaterializerInput {
  readonly profile: unknown;
  readonly sourceRegister: BasicSourceRegisterV3;
}

export interface BasicProfileMaterializerInput {
  readonly sources: readonly BasicProfileSource[];
  readonly updatedAt: string;
  readonly fields: readonly Readonly<{
    category: BasicProfileCategoryKey;
    field: BasicProfileField;
  }>[];
}

export function materializeBasicProfile(
  input: BasicProfileMaterializerInput,
): BasicProfile {
  try {
    const categories = Object.fromEntries(BASIC_PROFILE_CATEGORY_KEYS.map((category) => [
      category,
      { fields: input.fields.filter((entry) => entry.category === category)
        .map(({ field }) => field) },
    ]));
    const profile = parseBasicProfile({
      schemaVersion: "basic-market-profile/v2",
      categories,
      sources: input.sources,
      updatedAt: input.updatedAt,
    });
    if (profile === null) invalid();
    return deepFreezeBasicOfflineValue(profile);
  } catch {
    throw new Error("basic profile materialization failed");
  }
}

export function materializeBasicProfileFacts(
  input: BasicProfileFactMaterializerInput,
): readonly BasicExtractedFactV3[] {
  try {
    const profile = parseBasicProfile(input.profile);
    if (profile === null) invalid();
    const sources = new Map(
      input.sourceRegister.sources.map((source) => [source.sourceId, source]),
    );
    if (
      input.sourceRegister.schemaVersion !== BASIC_COLLECTION_AUDIT_V3_SCHEMA_VERSION
    ) invalid();

    const facts: BasicExtractedFactV3[] = [];
    for (const category of BASIC_V3_PROFILE_CATEGORY_KEYS) {
      for (const field of profile.categories[category].fields) {
        const fieldSnapshot = snapshotBasicBoundedJsonValue(field, () => undefined);
        if (!fieldSnapshot.valid) invalid();
        const evidence = [...field.sourceIds].sort(compareText).map((sourceId) => {
          const source = sources.get(sourceId);
          const locators = source?.evidenceLocators ?? [];
          const locator = locators.find((value) =>
            /^(?:table|grid|json:|csv:)/.test(value)
          ) ?? locators.find((value) =>
            !value.startsWith("capture:/") && !value.startsWith("metadata:/")
          ) ?? locators[0];
          if (source === undefined || locator === undefined) invalid();
          return {
            sourceId,
            locator,
            rawValue: fieldSnapshot.data,
            normalizedValue: fieldSnapshot.data,
            unit: null,
            year: null,
          };
        });
        facts.push({
          factId: `fact-profile-${category}-${field.key}`,
          fieldPath: basicV3ProfileFactPath(category, field.key),
          status: "candidate",
          evidence,
          extractionMethod: "manual",
          uncertainty: null,
        });
      }
    }
    return deepFreezeBasicOfflineValue(
      facts.sort((left, right) => compareText(left.fieldPath, right.fieldPath)),
    );
  } catch {
    throw new Error("basic profile fact materialization failed");
  }
}

export function requireBasicProfile(value: unknown): BasicProfile {
  const profile = parseBasicProfile(value);
  if (profile === null) {
    throw new Error("basic profile materialization failed");
  }
  return profile;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(): never {
  throw new Error("invalid");
}
