import type { BasicSourceTransportV2 } from "../collection/basic-source-v2-contracts.js";
import type { BasicSourceExecutionPlanEntry } from "../collection/basic-source-request-materializer.js";
import { resolveBasicProfileWorldBankAdapter } from "../collection/basic-source-adapter-registry.js";
import { readOptionalBasicBatchGlobalInput } from "./basic-batch-filesystem-cache.js";
import { sha256 } from "./basic-batch-production-input.js";

export function createEmberNoCredentialTabularSnapshot(countries: readonly string[]): Uint8Array {
  try {
    if (
      countries.length < 1 || countries.length > 3 ||
      new Set(countries).size !== countries.length ||
      countries.some((countryCode) => !/^[A-Z]{2}$/.test(countryCode))
    ) throw new Error("invalid countries");
    return new TextEncoder().encode([
      "countryCode,category,key,value,unit,year,locator,reasonZh,reasonEn",
      ...countries.flatMap((countryCode) => [
        [countryCode, "electricityMarket", "totalGeneration", "", "", "", "credential-check:total-generation"],
        [countryCode, "electricityMarket", "electricityConsumption", "", "", "", "credential-check:electricity-consumption"],
        [countryCode, "electricityMarket", "electricityMix", "", "", "", "credential-check:electricity-mix"],
        [countryCode, "electricityMarket", "renewableGenerationShare", "", "", "", "credential-check:renewable-generation-share"],
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

async function readBoundedBody(body: AsyncIterable<Uint8Array>, maximumBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) throw new Error("invalid response body");
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
