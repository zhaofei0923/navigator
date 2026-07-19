import { parsePrometheusProcessMetrics } from "./load-read-only-contract.mjs";

export async function performRead(fetchImpl, url, clock, abortSignal) {
  const startedAt = clock.now();
  let response;
  try {
    response = await fetchImpl(url, readOnlyFetchOptions(5_000, abortSignal));
  } catch {
    return Object.freeze({
      cache: "unknown", completedAt: clock.now(), latencyMs: Math.max(0, clock.now() - startedAt), status: 0,
    });
  }
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response);
    throw new Error("LOAD_REDIRECT_REJECTED");
  }
  try {
    await response.arrayBuffer();
  } catch {
    return Object.freeze({
      cache: "unknown", completedAt: clock.now(), latencyMs: Math.max(0, clock.now() - startedAt), status: 0,
    });
  }
  const completedAt = clock.now();
  return Object.freeze({
    cache: normalizeCache(response.headers.get("x-navigator-cache")), completedAt,
    latencyMs: Math.max(0, completedAt - startedAt), status: response.status,
  });
}

export async function fetchMetrics(fetchImpl, metricsUrl, clock, abortSignal) {
  let response;
  try {
    response = await fetchImpl(metricsUrl, readOnlyFetchOptions(2_000, abortSignal));
  } catch {
    throw new Error("LOAD_METRICS_FETCH_FAILED");
  }
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response);
    throw new Error("LOAD_METRICS_REDIRECT_REJECTED");
  }
  if (response.status !== 200) {
    await cancelBody(response);
    throw new Error("LOAD_METRICS_STATUS_INVALID");
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error("LOAD_METRICS_FETCH_FAILED");
  }
  return Object.freeze({ metrics: parsePrometheusProcessMetrics(text), observedAt: clock.now() });
}

function readOnlyFetchOptions(timeoutMilliseconds, abortSignal) {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return Object.freeze({
    headers: Object.freeze({ accept: "application/json, text/plain;q=0.9" }),
    method: "GET",
    redirect: "manual",
    signal: abortSignal === undefined ? timeout : AbortSignal.any([timeout, abortSignal]),
  });
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A rejected body must not mask the fixed redirect/status failure code.
  }
}

function normalizeCache(value) {
  return value === "hit" || value === "miss" || value === "stale" ? value : "unknown";
}
