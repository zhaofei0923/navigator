import { parseBasicProfile } from "@navigator/shared-types/basic-profile";

import type {
  BasicCollectionJsonValue,
  BasicMarketOverviewDraft,
} from "./basic-collection-contracts.js";
import type { BasicMarketOverviewDraftV3 } from "./basic-collection-v3-contracts.js";
import { parseBasicMarketOverviewDraftForAudit } from "./basic-market-overview-draft-parser.js";
import {
  deepFreezeBasicOfflineValue,
  snapshotBasicOfflineValue,
} from "./basic-offline-value.js";

const V2_DRAFT_KEYS = [
  "overview", "population", "gdp", "gdpGrowth", "energyDemand", "renewableTarget",
  "keyIndicators", "source", "sourceUrl", "collectedAt", "updatedAt", "credibility",
  "reviewStatus", "aiUsable", "countryCode", "industryTags", "techTags",
] as const;
const V3_DRAFT_KEYS = [...V2_DRAFT_KEYS, "basicProfile"] as const;

export interface BasicMarketOverviewDraftV3ParseResult {
  readonly data: BasicMarketOverviewDraftV3 | null;
  readonly errors: readonly string[];
}

export function parseBasicMarketOverviewDraftV3(
  value: unknown,
): BasicMarketOverviewDraftV3ParseResult {
  return parseBasicMarketOverviewDraftV3ForAudit(value);
}

export function parseBasicMarketOverviewDraftV3ForAudit(
  value: unknown,
): BasicMarketOverviewDraftV3ParseResult {
  const snapshot = snapshotBasicOfflineValue(value);
  if (!snapshot.valid || !isExactRecord(snapshot.data, V3_DRAFT_KEYS)) {
    return frozen(null, [
      `marketOverviewDraft must have exactly ${V3_DRAFT_KEYS.join(", ")} own keys including required basicProfile`,
    ]);
  }

  const legacyDraft = v2DraftFromRecord(snapshot.data);
  const parsedLegacy = parseBasicMarketOverviewDraftForAudit(legacyDraft);
  const basicProfile = parseBasicProfile(snapshot.data.basicProfile);
  const errors = [...parsedLegacy.errors];
  if (basicProfile === null) {
    errors.push("marketOverviewDraft.basicProfile must be a valid required basic-market-profile/v2 object");
  }
  if (parsedLegacy.data === null || basicProfile === null || errors.length > 0) {
    return frozen(null, errors);
  }
  return frozen({ ...parsedLegacy.data, basicProfile }, []);
}

export function basicMarketOverviewDraftV2FromV3(
  draft: BasicMarketOverviewDraftV3,
): BasicMarketOverviewDraft {
  return {
    overview: { ...draft.overview },
    population: draft.population,
    gdp: draft.gdp,
    gdpGrowth: draft.gdpGrowth,
    energyDemand: { ...draft.energyDemand },
    renewableTarget: { ...draft.renewableTarget },
    keyIndicators: draft.keyIndicators.map((indicator) => ({
      label: { ...indicator.label },
      value: indicator.value,
      unit: indicator.unit,
      year: indicator.year,
    })),
    source: draft.source,
    sourceUrl: draft.sourceUrl,
    collectedAt: draft.collectedAt,
    updatedAt: draft.updatedAt,
    credibility: draft.credibility,
    reviewStatus: draft.reviewStatus,
    aiUsable: draft.aiUsable,
    countryCode: draft.countryCode,
    industryTags: [...draft.industryTags],
    techTags: [...draft.techTags],
  };
}

export function basicMarketOverviewDraftV2ValueFromUnknown(
  value: BasicCollectionJsonValue,
): BasicCollectionJsonValue {
  if (!isRecord(value)) return value;
  const result: Record<string, BasicCollectionJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "basicProfile") result[key] = child;
  }
  return result;
}

function v2DraftFromRecord(
  value: Readonly<Record<string, BasicCollectionJsonValue>>,
): Record<string, BasicCollectionJsonValue> {
  return Object.fromEntries(V2_DRAFT_KEYS.map((key) => [key, value[key]!])) as
    Record<string, BasicCollectionJsonValue>;
}

function isExactRecord<const Keys extends readonly string[]>(
  value: BasicCollectionJsonValue,
  keys: Keys,
): value is Record<Keys[number], BasicCollectionJsonValue> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isRecord(
  value: BasicCollectionJsonValue,
): value is Record<string, BasicCollectionJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frozen(
  data: BasicMarketOverviewDraftV3 | null,
  errors: readonly string[],
): BasicMarketOverviewDraftV3ParseResult {
  return deepFreezeBasicOfflineValue({ data, errors: [...errors] });
}
