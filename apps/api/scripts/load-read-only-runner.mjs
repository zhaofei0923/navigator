import { performance } from "node:perf_hooks";

import {
  assertEnvironment, assertLoopbackBaseUrl, assertLoopbackMetricsUrl, assertMetricCapacity,
  assertRequestMatrix, assertRuntimeScenario, assertScenarioName, assertSha256, buildRequestMatrix,
} from "./load-read-only-contract.mjs";
import { fetchMetrics, performRead } from "./load-read-only-http.mjs";
import { buildLoadResult } from "./load-read-only-summary.mjs";

export async function runLoadScenario(options) {
  const baseUrl = assertLoopbackBaseUrl(options.baseUrl);
  const metricsUrl = assertLoopbackMetricsUrl(options.metricsUrl);
  const scenario = assertRuntimeScenario(options.scenario);
  const scenarioName = assertScenarioName(options.scenarioName);
  const scenarioFileSha256 = assertSha256(options.scenarioFileSha256);
  const environment = assertEnvironment(options.environment, scenarioFileSha256);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("LOAD_FETCH_UNAVAILABLE");
  const clock = assertClock(options.clock ?? createMonotonicClock());
  const requestMatrix = assertRequestMatrix(options.requestMatrix ?? buildRequestMatrix());
  const baseline = await fetchMetrics(fetchImpl, metricsUrl, clock);
  assertMetricCapacity(baseline.metrics, environment);

  const windowStart = clock.now();
  const measurementStart = windowStart + scenario.warmupSeconds * 1_000;
  const measurementEnd = measurementStart + scenario.measurementSeconds * 1_000;
  const controller = new AbortController();
  const state = {
    active: 0,
    buckets: createBuckets(scenario.measurementSeconds),
    controller,
    cursor: 0,
    fatalError: undefined,
    inFlight: new Set(),
    lateCompletions: 0,
    maxActive: 0,
  };
  const shared = {
    baseUrl, clock, fetchImpl, measurementEnd, measurementStart, requestMatrix, scenario, state, windowStart,
  };
  const requestScheduling = scheduleRequests(shared).then(() => ({}), (error) => ({ error }));
  const metricSampling = sampleMetricBoundaries({
    baseline, clock, fetchImpl, metricsUrl, scenario, state, windowStart,
  }).then((value) => ({ value }), (error) => ({ error }));
  const [requests, metrics] = await Promise.all([requestScheduling, metricSampling]);
  await Promise.all([...state.inFlight]);
  if (requests.error !== undefined) failState(state, requests.error);
  if (metrics.error !== undefined) failState(state, metrics.error);
  if (state.fatalError !== undefined) throw state.fatalError;
  return buildLoadResult({
    buckets: state.buckets,
    environment,
    lateCompletions: state.lateCompletions,
    maxConcurrencyObserved: state.maxActive,
    metricSamples: metrics.value,
    requestMatrix,
    scenario,
    scenarioFileSha256,
    scenarioName,
  });
}

async function scheduleRequests(input) {
  const totalSeconds = input.scenario.warmupSeconds + input.scenario.measurementSeconds;
  const totalSchedules = totalSeconds * input.scenario.targetRps;
  const intervalMs = 1_000 / input.scenario.targetRps;
  for (let index = 0; index < totalSchedules; index += 1) {
    const scheduledAt = input.windowStart + index * intervalMs;
    if (!await waitUntil(input.clock, scheduledAt, input.state)) break;
    if (input.clock.now() >= input.measurementEnd || input.state.fatalError !== undefined) break;
    const phase = scheduledAt < input.measurementStart ? "warmup" : "measurement";
    if (input.state.active >= input.scenario.maxConcurrency) {
      if (phase === "measurement") measurementBucket(input, scheduledAt).droppedSchedules += 1;
      continue;
    }
    const request = input.requestMatrix[input.state.cursor % input.requestMatrix.length];
    input.state.cursor += 1;
    input.state.active += 1;
    input.state.maxActive = Math.max(input.state.maxActive, input.state.active);
    const operation = executeScheduledRead({ ...input, phase, request });
    trackInFlight(input.state.inFlight, operation);
  }
}

async function executeScheduledRead(input) {
  try {
    const result = await performRead(
      input.fetchImpl, `${input.baseUrl}${input.request.path}`, input.clock, input.state.controller.signal,
    );
    if (input.phase !== "measurement") return;
    if (result.completedAt < input.measurementStart || result.completedAt >= input.measurementEnd) {
      input.state.lateCompletions += 1;
      return;
    }
    const bucket = measurementBucket(input, result.completedAt);
    bucket.cache[result.cache] += 1;
    bucket.latenciesMs.push(result.latencyMs);
    bucket.statusCounts[result.status] = (bucket.statusCounts[result.status] ?? 0) + 1;
  } catch (error) {
    failState(input.state, error);
  } finally {
    input.state.active -= 1;
  }
}

async function sampleMetricBoundaries(input) {
  const totalSeconds = input.scenario.warmupSeconds + input.scenario.measurementSeconds;
  const samples = Array.from({ length: totalSeconds + 1 });
  const inFlight = new Set();
  samples[0] = input.baseline;
  for (let second = 1; second <= totalSeconds; second += 1) {
    if (!await waitUntil(input.clock, input.windowStart + second * 1_000, input.state)) break;
    const operation = fetchMetrics(
      input.fetchImpl, input.metricsUrl, input.clock, input.state.controller.signal,
    ).then((value) => { samples[second] = value; }, (error) => { failState(input.state, error); });
    trackInFlight(inFlight, operation);
  }
  await Promise.all([...inFlight]);
  if (input.state.fatalError !== undefined) throw input.state.fatalError;
  if (samples.some((sample) => sample === undefined)) throw new Error("LOAD_METRICS_FETCH_FAILED");
  return Object.freeze(samples);
}

function measurementBucket(input, time) {
  const index = Math.floor((time - input.measurementStart) / 1_000);
  return input.state.buckets[index];
}

function createBuckets(count) {
  return Array.from({ length: count }, () => ({
    cache: { hit: 0, miss: 0, stale: 0, unknown: 0 }, droppedSchedules: 0, latenciesMs: [], statusCounts: {},
  }));
}

function trackInFlight(inFlight, operation) {
  inFlight.add(operation);
  void operation.then(() => inFlight.delete(operation));
}

function failState(state, error) {
  if (state.fatalError !== undefined) return;
  state.fatalError = error instanceof Error ? error : new Error("LOAD_FAILED");
  state.controller.abort(state.fatalError);
}

async function waitUntil(clock, deadline, state) {
  try {
    await clock.sleepUntil(deadline, state.controller.signal);
    return state.fatalError === undefined;
  } catch (error) {
    if (state.fatalError !== undefined) return false;
    throw error;
  }
}

function assertClock(clock) {
  if (typeof clock?.now !== "function" || typeof clock?.sleepUntil !== "function" || !Number.isFinite(clock.now())) {
    throw new Error("LOAD_CLOCK_INVALID");
  }
  return clock;
}

export function createMonotonicClock() {
  return Object.freeze({
    now: performance.now.bind(performance),
    async sleepUntil(deadline, signal) {
      while (true) {
        const remaining = Math.max(0, deadline - performance.now());
        if (remaining <= 0) return;
        await abortableDelay(remaining, signal);
      }
    },
  });
}

function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); cleanup(); rejectDelay(signal.reason); };
    function cleanup() { signal?.removeEventListener("abort", abort); }
    function finish() { cleanup(); resolveDelay(); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
