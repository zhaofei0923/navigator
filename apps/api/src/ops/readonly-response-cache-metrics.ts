import type { JsonValue } from "@navigator/shared-types/country-runtime";

import { getCountryCacheKeyOwnership } from "./cache-key.js";
import type {
  CacheMetricRoute,
  CacheMetricState,
  MetricsRecorder,
} from "./metrics-registry.js";
import { cloneReadonlyCacheValue } from "./readonly-response-cache-json.js";

interface CacheLoadOutcome {
  readonly serialized: string;
  readonly state: "miss" | "stale";
}

export async function resolveCacheOutcome<T extends JsonValue>(
  key: string,
  promise: Promise<CacheLoadOutcome>,
  metrics: MetricsRecorder | undefined,
): Promise<{ readonly state: "miss" | "stale"; readonly value: T }> {
  try {
    const outcome = await promise;
    recordCacheRequest(metrics, key, outcome.state);
    return {
      state: outcome.state,
      value: cloneReadonlyCacheValue<T>(outcome.serialized),
    };
  } catch (error) {
    recordCacheRequest(metrics, key, "miss");
    throw error;
  }
}

export function recordCacheRequest(
  metrics: MetricsRecorder | undefined,
  key: string,
  state: CacheMetricState,
): void {
  if (metrics === undefined) return;
  try {
    metrics.recordCacheRequest({ route: cacheMetricRoute(key), state });
  } catch {
    // Metrics failures must not change cache behavior.
  }
}

function cacheMetricRoute(key: string): CacheMetricRoute {
  const ownership = getCountryCacheKeyOwnership(key);
  if (ownership?.route === "list") return "/api/v1/countries";
  if (ownership?.route === "detail") return "/api/v1/countries/:code";
  if (ownership?.route === "module") {
    return "/api/v1/countries/:code/modules/:moduleKey";
  }
  return "UNMATCHED";
}
