import { LATENCY_BUCKETS_MS, MATRIX_SEED, assertMetricCapacity } from "./load-read-only-contract.mjs";

const EVENT_LOOP_LAG_THRESHOLD_SECONDS = 0.05;

export function buildLoadResult(input) {
  const buckets = input.buckets;

  for (const sample of input.metricSamples) assertMetricCapacity(sample.metrics, input.environment);
  const samples = buckets.map((bucket, index) => {
    const metricIndex = input.scenario.warmupSeconds + index;
    const api = deriveApiSample(input.metricSamples[metricIndex], input.metricSamples[metricIndex + 1]);
    const count = sumValues(bucket.statusCounts);
    return Object.freeze({
      achievedRps: count,
      api,
      cache: Object.freeze({ ...bucket.cache }),
      droppedSchedules: bucket.droppedSchedules,
      elapsedSecond: index + 1,
      latencyHistogram: buildHistogram(bucket.latenciesMs),
      requestedRps: input.scenario.targetRps,
      statusCounts: Object.freeze(sortStatusCounts(bucket.statusCounts)),
      windowDurationSeconds: 1,
      windowStartOffsetSeconds: index,
    });
  });
  const count = samples.reduce((sum, sample) => sum + sumValues(sample.statusCounts), 0);
  const allLatencies = buckets.flatMap(({ latenciesMs }) => latenciesMs);
  const cache = { hit: 0, miss: 0, stale: 0, unknown: 0 };
  const status = { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  for (const sample of samples) {
    addCounts(cache, sample.cache);
    addCounts(status, categorizeStatuses(sample.statusCounts));
  }
  const droppedSchedules = buckets.reduce((sum, bucket) => sum + bucket.droppedSchedules, 0);
  return Object.freeze({
    achievedRps: round(count / input.scenario.measurementSeconds),
    apiCpu: summarizeCpu(samples, input.environment.cpu),
    apiEventLoopLag: summarizeEventLoopLag(
      samples,
      input.scenario.measurementSeconds,
    ),
    apiRss: summarizeRss(samples, input.environment.memory),
    cache: Object.freeze({ ...cache, hitRatio: count === 0 ? 0 : round(cache.hit / count) }),
    capacity: Object.freeze({ cpu: { ...input.environment.cpu }, memory: { ...input.environment.memory } }),
    count,
    droppedSchedules,
    gitSha: input.environment.gitSha,
    imageDigest: input.environment.imageDigest,
    lateCompletions: input.lateCompletions,
    latencyMs: Object.freeze({ ...percentiles(allLatencies), histogram: buildHistogram(allLatencies) }),
    loadGenerator: Object.freeze({ maxConcurrencyObserved: input.maxConcurrencyObserved }),
    matrix: Object.freeze({ seed: MATRIX_SEED, size: input.requestMatrix.length }),
    measurementWindow: Object.freeze({ durationSeconds: input.scenario.measurementSeconds }),
    metricSynchronization: Object.freeze({
      ...input.metricSynchronization,
    }),
    requestedCount: input.scenario.targetRps * input.scenario.measurementSeconds,
    requestedRps: input.scenario.targetRps,
    samples: Object.freeze(samples),
    scenario: Object.freeze({ name: input.scenarioName, ...input.scenario }),
    scenarioFileSha256: input.scenarioFileSha256,
    schemaVersion: 2,
    status: Object.freeze(status),
    versions: Object.freeze({ ...input.environment.versions }),
  });
}

function deriveApiSample(previous, current) {
  const intervalSeconds = (current.observedAt - previous.observedAt) / 1_000;
  const cpuSecondsDelta = current.metrics.cpuSecondsTotal - previous.metrics.cpuSecondsTotal;
  const previousSequence = previous.metrics.eventLoopLagWindowSequence;
  const currentSequence = current.metrics.eventLoopLagWindowSequence;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error("LOAD_METRICS_TIME_INVALID");
  if (cpuSecondsDelta < 0) throw new Error("LOAD_METRICS_COUNTER_RESET");
  if (currentSequence < previousSequence) throw new Error("LOAD_EVENT_LOOP_WINDOW_ROLLBACK");
  if (currentSequence !== previousSequence + 1) throw new Error("LOAD_EVENT_LOOP_WINDOW_GAP");
  if (current.metrics.eventLoopLagWindowValid !== 1 ||
      current.metrics.eventLoopLagWindowDurationSeconds <= 0) {
    throw new Error("LOAD_EVENT_LOOP_WINDOW_INVALID");
  }
  const cpuCores = cpuSecondsDelta / intervalSeconds;
  return Object.freeze({
    cpuCores: round(cpuCores),
    cpuSecondsDelta,
    cpuUtilizationRatio: round(cpuCores / current.metrics.cpuCapacityCores),
    eventLoopLagWindowDurationSeconds: current.metrics.eventLoopLagWindowDurationSeconds,
    eventLoopLagWindowP99Seconds: current.metrics.eventLoopLagWindowP99Seconds,
    eventLoopLagWindowSequence: currentSequence,
    eventLoopLagWindowValid: true,
    intervalSeconds,
    residentMemoryBytes: current.metrics.residentMemoryBytes,
  });
}

function buildHistogram(values) {
  return Object.freeze([
    ...LATENCY_BUCKETS_MS.map((leMs) => Object.freeze({
      count: values.reduce((sum, value) => sum + Number(value <= leMs), 0), leMs,
    })),
    Object.freeze({ count: values.length, leMs: "Inf" }),
  ]);
}

function percentiles(values) {
  return Object.freeze({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) });
}

function percentile(values, ratio) {
  return round(percentileValue(values, ratio));
}

function percentileValue(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarizeCpu(samples, cpu) {
  const values = samples.map(({ api }) => api.cpuCores);
  const summary = percentiles(values);
  const totalCpu = samples.reduce((sum, { api }) => sum + api.cpuSecondsDelta, 0);
  const totalSeconds = samples.reduce((sum, { api }) => sum + api.intervalSeconds, 0);
  return Object.freeze({
    averageCores: totalSeconds === 0 ? 0 : round(totalCpu / totalSeconds),
    capacityCores: cpu.capacityCores, p50Cores: summary.p50, p95Cores: summary.p95,
    p95UtilizationRatio: round(summary.p95 / cpu.capacityCores), p99Cores: summary.p99, source: cpu.source,
  });
}

function summarizeRss(samples, memory) {
  const values = samples.map(({ api }) => api.residentMemoryBytes);
  const summary = percentiles(values);
  return Object.freeze({
    maxBytes: values.length === 0 ? 0 : Math.max(...values), memoryLimitBytes: memory.limitBytes,
    p50Bytes: summary.p50, p95Bytes: summary.p95, p95LimitRatio: round(summary.p95 / memory.limitBytes),
    p99Bytes: summary.p99, source: memory.source,
  });
}

function summarizeEventLoopLag(samples, expectedWindowCount) {
  if (samples.length !== expectedWindowCount) {
    throw new Error("LOAD_EVENT_LOOP_WINDOW_COUNT_INVALID");
  }
  const values = samples.map(({ api }) => api.eventLoopLagWindowP99Seconds);
  const durations = samples.map(
    ({ api }) => api.eventLoopLagWindowDurationSeconds,
  );
  const rawP50 = percentileValue(values, 0.5);
  const rawP95 = percentileValue(values, 0.95);
  const rawP99 = percentileValue(values, 0.99);
  const first = samples[0];
  const last = samples.at(-1);
  return Object.freeze({
    expectedWindowCount,
    maxSeconds: values.length === 0 ? 0 : Math.max(...values),
    p50Seconds: roundSeconds(rawP50),
    p95Seconds: roundSeconds(rawP95),
    p99Seconds: roundSeconds(rawP99),
    passesThreshold: rawP99 < EVENT_LOOP_LAG_THRESHOLD_SECONDS,
    sequenceEnd: last?.api.eventLoopLagWindowSequence ?? 0,
    sequenceStart: first?.api.eventLoopLagWindowSequence ?? 0,
    statistic: "p99-of-one-second-window-p99",
    thresholdSeconds: EVENT_LOOP_LAG_THRESHOLD_SECONDS,
    validWindowCount: samples.filter(
      ({ api }) => api.eventLoopLagWindowValid,
    ).length,
    windowDurationSeconds: Object.freeze({
      max: durations.length === 0 ? 0 : Math.max(...durations),
      min: durations.length === 0 ? 0 : Math.min(...durations),
      total: round(durations.reduce((sum, duration) => sum + duration, 0)),
    }),
  });
}

function categorizeStatuses(statusCounts) {
  const counts = { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  for (const [statusText, count] of Object.entries(statusCounts)) {
    const status = Number(statusText);
    if (status >= 200 && status < 300) counts["2xx"] += count;
    else if (status >= 400 && status < 500) counts["4xx"] += count;
    else if (status >= 500 && status < 600) counts["5xx"] += count;
    else counts.other += count;
  }
  return counts;
}

function sortStatusCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right)));
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] += value;
}

function sumValues(value) {
  return Object.values(value).reduce((sum, item) => sum + item, 0);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundSeconds(value) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
