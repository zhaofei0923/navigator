import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, test } from "node:test";

import { assertEnvironment } from "./load-read-only-contract.mjs";
import { createMonotonicClock, runLoadScenario } from "./load-read-only-runner.mjs";

describe("fixed-window read-only load runner", () => {
  test("accepts the validated environment projection used by the CLI boundary", async () => {
    const clock = createVirtualClock();
    let metricSequence = 1;
    const environment = assertEnvironment(benchmarkEnvironment(), "a".repeat(64));
    const execution = runLoadScenario(baseOptions({
      clock,
      environment,
      fetch: async (url) => String(url).endsWith("/metrics")
        ? metricsResponse(clock.now() / 1_000, {
          sequence: metricSequence++,
        })
        : new Response("{}", { headers: { "x-navigator-cache": "hit" }, status: 200 }),
    }));

    const result = await clock.run(execution);

    assert.equal(result.count, 1);
    assert.equal(result.gitSha, "b".repeat(40));
    assert.equal(result.schemaVersion, 2);
    assert.deepEqual(Object.keys(result).sort(), [
      "achievedRps", "apiCpu", "apiEventLoopLag", "apiRss", "cache",
      "capacity", "count", "droppedSchedules", "gitSha", "imageDigest",
      "lateCompletions", "latencyMs", "loadGenerator", "matrix",
      "measurementWindow", "metricSynchronization", "requestedCount",
      "requestedRps", "samples", "scenario", "scenarioFileSha256",
      "schemaVersion", "status", "versions",
    ]);
    assert.deepEqual(Object.keys(result.metricSynchronization).sort(), [
      "anchorSequence",
      "baselineSequence",
      "initialValidWaitMilliseconds",
      "synchronizationWaitMilliseconds",
    ]);
  });

  test("rejects malformed runtime projections before any network request", async () => {
    const valid = assertEnvironment(benchmarkEnvironment(), "a".repeat(64));
    const { versions: _versions, ...withoutVersions } = valid;
    const invalid = [
      { ...valid, scenarioFileSha256: "b".repeat(64) },
      { ...valid, configuration: fixedConfiguration() },
      { ...valid, imageId: `sha256:${"d".repeat(64)}` },
      withoutVersions,
      { ...valid, cpu: { ...valid.cpu, source: "unsafe\nsource" } },
    ];
    let fetchCalls = 0;

    for (const environment of invalid) {
      await assert.rejects(runLoadScenario(baseOptions({
        environment,
        fetch: async () => {
          fetchCalls += 1;
          throw new Error("UNEXPECTED_FETCH");
        },
      })), { message: "LOAD_ENVIRONMENT_INVALID" });
    }
    assert.equal(fetchCalls, 0);
  });

  test("keeps request dispatch and one-hertz API metrics sampling independent", async () => {
    const clock = createVirtualClock();
    const calls = [];
    let metricSequence = 1;
    const fetch = async (url, options) => {
      calls.push({ at: clock.now(), options, url: String(url) });
      if (String(url).endsWith("/metrics")) {
        return metricsResponse(clock.now() / 1_000, {
          sequence: metricSequence++,
        });
      }
      return new Response("{}", { headers: { "x-navigator-cache": calls.length % 2 ? "hit" : "miss" }, status: 200 });
    };
    const execution = runLoadScenario(baseOptions({
      clock, fetch, scenario: { targetRps: 4, maxConcurrency: 2, warmupSeconds: 1, measurementSeconds: 2 },
    }));
    const result = await clock.run(execution);

    assert.equal(result.measurementWindow.durationSeconds, 2);
    assert.equal(result.count, 8);
    assert.equal(result.achievedRps, 4);
    assert.equal(result.samples.length, 2);
    assert.deepEqual(result.samples.map(({ achievedRps }) => achievedRps), [4, 4]);
    assert.deepEqual(
      calls.filter(({ url }) => url.endsWith("/metrics")).map(({ at }) => at),
      [0, 0, 1_000, 2_000, 3_000],
    );
    assert.equal(result.apiCpu.p95Cores, 1);
    for (const call of calls) {
      assert.equal(call.options.method, "GET");
      assert.equal(call.options.redirect, "manual");
      assert.match(call.url, /^http:\/\/127\.0\.0\.1:/);
    }
  });

  test("uses a shared semaphore across the fixed window under overload", async () => {
    const clock = createVirtualClock();
    let active = 0;
    let maximumActive = 0;
    const metricTimes = [];
    let metricSequence = 1;
    const fetch = async (url) => {
      if (String(url).endsWith("/metrics")) {
        metricTimes.push(clock.now());
        return metricsResponse(clock.now() / 1_000, {
          sequence: metricSequence++,
        });
      }
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await clock.sleepUntil(clock.now() + 1_500);
      active -= 1;
      return new Response("{}", { headers: { "x-navigator-cache": "miss" }, status: 200 });
    };
    const execution = runLoadScenario(baseOptions({
      clock, fetch, scenario: { targetRps: 4, maxConcurrency: 2, warmupSeconds: 0, measurementSeconds: 1 },
    }));
    const result = await clock.run(execution);

    assert.equal(result.measurementWindow.durationSeconds, 1);
    assert.equal(result.samples[0].windowDurationSeconds, 1);
    assert.equal(result.samples[0].achievedRps, 0);
    assert.equal(result.samples[0].droppedSchedules, 2);
    assert.equal(result.lateCompletions, 2);
    assert.equal(maximumActive, 2);
    assert.deepEqual(metricTimes, [0, 0, 1_000]);
    assert.equal(clock.now(), 1_750);
  });

  test("fails without following API or metrics redirects", async () => {
    const apiClock = createVirtualClock();
    const apiOptions = [];
    let metricSequence = 1;
    const apiExecution = runLoadScenario(baseOptions({
      clock: apiClock,
      fetch: async (url, options) => {
        apiOptions.push(options);
        return String(url).endsWith("/metrics")
          ? metricsResponse(apiClock.now() / 1_000, {
            sequence: metricSequence++,
          })
          : new Response(null, { headers: { location: "https://example.com/private" }, status: 302 });
      },
      scenario: { targetRps: 1, maxConcurrency: 1, warmupSeconds: 0, measurementSeconds: 1 },
    }));
    await assert.rejects(apiClock.run(apiExecution), { message: "LOAD_REDIRECT_REJECTED" });
    assert.ok(apiOptions.every(({ redirect }) => redirect === "manual"));
    assert.equal(apiClock.now(), 0);
    assert.equal(apiOptions.length, 3);

    await assert.rejects(runLoadScenario(baseOptions({
      fetch: async () => new Response(null, { status: 307 }),
      scenario: { targetRps: 1, maxConcurrency: 1, warmupSeconds: 0, measurementSeconds: 1 },
    })), { message: "LOAD_METRICS_REDIRECT_REJECTED" });
  });

  test("fails closed on capacity drift and CPU counter reset", async () => {
    await assert.rejects(runLoadScenario(baseOptions({
      fetch: async () => metricsResponse(0, { cores: 1, sequence: 1 }),
      scenario: { targetRps: 1, maxConcurrency: 1, warmupSeconds: 0, measurementSeconds: 1 },
    })), { message: "LOAD_CAPACITY_MISMATCH" });

    const clock = createVirtualClock();
    let metricsRead = 0;
    const execution = runLoadScenario(baseOptions({
      clock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) return new Response("{}", { status: 200 });
        metricsRead += 1;
        const cpuSeconds = metricsRead < 3 ? 9 + metricsRead : 9;
        return metricsResponse(cpuSeconds, {
          sequence: metricsRead,
        });
      },
      scenario: { targetRps: 1, maxConcurrency: 1, warmupSeconds: 0, measurementSeconds: 1 },
    }));
    await assert.rejects(clock.run(execution), { message: "LOAD_METRICS_COUNTER_RESET" });
  });

  test("retries one duplicate completed window and rejects incomplete sequences", async () => {
    const duplicateClock = createVirtualClock();
    let duplicateRead = 0;
    const duplicateTimes = [];
    const duplicateExecution = runLoadScenario(baseOptions({
      clock: duplicateClock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", {
            headers: { "x-navigator-cache": "hit" },
            status: 200,
          });
        }
        duplicateTimes.push(duplicateClock.now());
        duplicateRead += 1;
        return metricsResponse(duplicateClock.now() / 1_000, {
          sequence: duplicateRead === 1 ? 1 : duplicateRead < 4 ? 2 : 3,
        });
      },
      scenario: {
        targetRps: 1,
        maxConcurrency: 1,
        warmupSeconds: 0,
        measurementSeconds: 1,
      },
    }));
    const duplicateResult = await duplicateClock.run(duplicateExecution);
    assert.deepEqual(duplicateTimes, [0, 0, 1_000, 1_025]);
    assert.equal(
      duplicateResult.samples[0].api.eventLoopLagWindowSequence,
      3,
    );

    for (const [windowSequence, message] of [
      [[1, 2, 4], "LOAD_EVENT_LOOP_WINDOW_GAP"],
      [[2, 3, 2], "LOAD_EVENT_LOOP_WINDOW_ROLLBACK"],
      [[1, 2, { sequence: 3, valid: 0, lag: 0 }], "LOAD_EVENT_LOOP_WINDOW_INVALID"],
    ]) {
      const clock = createVirtualClock();
      let read = 0;
      const execution = runLoadScenario(baseOptions({
        clock,
        fetch: async (url) => {
          if (!String(url).endsWith("/metrics")) {
            return new Response("{}", { status: 200 });
          }
          read += 1;
          const window = windowSequence[Math.min(read - 1, 2)];
          return metricsResponse(read, typeof window === "number"
            ? { sequence: window }
            : window);
        },
        scenario: {
          targetRps: 1,
          maxConcurrency: 1,
          warmupSeconds: 0,
          measurementSeconds: 1,
        },
      }));
      await assert.rejects(clock.run(execution), { message });
    }

    const staleClock = createVirtualClock();
    let staleRead = 0;
    const staleExecution = runLoadScenario(baseOptions({
      clock: staleClock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", { status: 200 });
        }
        staleRead += 1;
        return metricsResponse(staleClock.now() / 1_000, {
          sequence: staleRead === 1 ? 1 : 2,
        });
      },
    }));
    await assert.rejects(staleClock.run(staleExecution), {
      message: "LOAD_EVENT_LOOP_WINDOW_STALE",
    });
  });

  test("waits for the first valid completed window before starting the load window", async () => {
    const clock = createVirtualClock();
    let metricRead = 0;
    const metricTimes = [];
    const execution = runLoadScenario(baseOptions({
      clock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", {
            headers: { "x-navigator-cache": "hit" },
            status: 200,
          });
        }
        metricTimes.push(clock.now());
        const sequence = metricRead;
        metricRead += 1;
        return metricsResponse(metricRead, {
          duration: sequence === 0 ? 0 : 1,
          lag: sequence === 0 ? 0 : 0.001,
          sequence,
          valid: sequence === 0 ? 0 : 1,
        });
      },
    }));
    const result = await clock.run(execution);

    assert.deepEqual(metricTimes, [0, 25, 25, 1_025]);
    assert.equal(result.count, 1);
    assert.equal(result.metricSynchronization.anchorSequence, 1);
    assert.equal(result.metricSynchronization.baselineSequence, 2);
    assert.equal(result.samples[0].api.eventLoopLagWindowSequence, 3);
  });

  test("synchronizes an independently phased sampler before 120 warmup and 600 measurement windows", async () => {
    const clock = createVirtualClock();
    let firstMetricResponse = true;
    const execution = runLoadScenario(baseOptions({
      clock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", {
            headers: { "x-navigator-cache": "hit" },
            status: 200,
          });
        }
        const capturedAt = clock.now();
        const sequence = capturedAt < 5
          ? 10
          : 11 + Math.floor((capturedAt - 5) / 1_000);
        const response = metricsResponse(capturedAt / 1_000, { sequence });
        if (firstMetricResponse) {
          firstMetricResponse = false;
          await clock.sleepUntil(10);
        }
        return response;
      },
      scenario: {
        targetRps: 1,
        maxConcurrency: 1,
        warmupSeconds: 120,
        measurementSeconds: 600,
      },
    }));
    const result = await clock.run(execution);

    assert.deepEqual(result.metricSynchronization, {
      anchorSequence: 10,
      baselineSequence: 11,
      initialValidWaitMilliseconds: 10,
      synchronizationWaitMilliseconds: 0,
    });
    assert.equal(result.samples.length, 600);
    assert.equal(result.apiEventLoopLag.validWindowCount, 600);
    assert.equal(result.apiEventLoopLag.sequenceStart, 132);
    assert.equal(result.apiEventLoopLag.sequenceEnd, 731);
    assert.equal(result.count, 600);
  });

  test("reports p99 of completed one-second p99 windows and enforces a strict threshold", async () => {
    const spikeClock = createVirtualClock();
    let spikeSequence = 1;
    const spikeExecution = runLoadScenario(baseOptions({
      clock: spikeClock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", {
            headers: { "x-navigator-cache": "hit" },
            status: 200,
          });
        }
        const sequence = spikeSequence;
        spikeSequence += 1;
        return metricsResponse(sequence, {
          lag: sequence === 50 || sequence === 75 ? 0.1 : 0.001,
          sequence,
        });
      },
      scenario: {
        targetRps: 1,
        maxConcurrency: 1,
        warmupSeconds: 0,
        measurementSeconds: 100,
      },
    }));
    const spikeResult = await spikeClock.run(spikeExecution);
    assert.equal(
      spikeResult.apiEventLoopLag.statistic,
      "p99-of-one-second-window-p99",
    );
    assert.equal(spikeResult.apiEventLoopLag.p99Seconds, 0.1);
    assert.equal(spikeResult.apiEventLoopLag.validWindowCount, 100);
    assert.equal(spikeResult.apiEventLoopLag.expectedWindowCount, 100);
    assert.equal(spikeResult.apiEventLoopLag.passesThreshold, false);

    const boundaryClock = createVirtualClock();
    let boundarySequence = 1;
    const boundaryExecution = runLoadScenario(baseOptions({
      clock: boundaryClock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", { status: 200 });
        }
        const sequence = boundarySequence;
        boundarySequence += 1;
        return metricsResponse(sequence, { lag: 0.05, sequence });
      },
    }));
    const boundaryResult = await boundaryClock.run(boundaryExecution);
    assert.equal(boundaryResult.apiEventLoopLag.thresholdSeconds, 0.05);
    assert.equal(boundaryResult.apiEventLoopLag.p99Seconds, 0.05);
    assert.equal(boundaryResult.apiEventLoopLag.passesThreshold, false);

    const belowClock = createVirtualClock();
    let belowSequence = 1;
    const belowExecution = runLoadScenario(baseOptions({
      clock: belowClock,
      fetch: async (url) => {
        if (!String(url).endsWith("/metrics")) {
          return new Response("{}", { status: 200 });
        }
        const sequence = belowSequence;
        belowSequence += 1;
        return metricsResponse(sequence, { lag: 0.0499999, sequence });
      },
    }));
    const belowResult = await belowClock.run(belowExecution);
    assert.equal(belowResult.apiEventLoopLag.p99Seconds, 0.0499999);
    assert.equal(belowResult.apiEventLoopLag.passesThreshold, true);
  });

  test("retains only the bounded in-flight Set instead of every scheduled Promise", async () => {
    const source = await readFile(new URL("./load-read-only-runner.mjs", import.meta.url), "utf8");
    assert.match(source, /inFlight\.delete/u);
    assert.doesNotMatch(source, /\bconst tasks = \[\]|\btasks\.push\(/u);
  });

  test("never schedules a negative delay when the deadline passes between monotonic reads", async () => {
    const originalNow = performance.now;
    const readings = [0, 2];
    let cursor = 0;
    performance.now = () => readings[Math.min(cursor++, readings.length - 1)];
    try {
      const warnings = await captureTimeoutNegativeWarnings(() => createMonotonicClock().sleepUntil(1));
      assert.deepEqual(warnings, []);
    } finally {
      performance.now = originalNow;
    }
  });

  test("runs a real-clock one-second 556 RPS smoke without negative timeout warnings", async () => {
    let cpuSeconds = 0;
    let metricSequence = 1;
    const warnings = await captureTimeoutNegativeWarnings(async () => {
      const result = await runLoadScenario(baseOptions({
        fetch: async (url) => {
          if (!String(url).endsWith("/metrics")) {
            return new Response("{}", { headers: { "x-navigator-cache": "hit" }, status: 200 });
          }
          const response = metricsResponse(cpuSeconds, {
            sequence: metricSequence,
          });
          cpuSeconds += 0.1;
          metricSequence += 1;
          return response;
        },
        scenario: { targetRps: 556, maxConcurrency: 1024, warmupSeconds: 0, measurementSeconds: 1 },
      }));
      assert.equal(result.requestedRps, 556);
      assert.equal(result.requestedCount, 556);
    });
    assert.deepEqual(warnings, []);
  });
});

async function captureTimeoutNegativeWarnings(operation) {
  const originalEmitWarning = process.emitWarning;
  const warnings = [];
  process.emitWarning = function emitWarning(warning, type, ...arguments_) {
    if (type === "TimeoutNegativeWarning") warnings.push(String(warning));
    else Reflect.apply(originalEmitWarning, this, [warning, type, ...arguments_]);
  };
  try {
    await operation();
    return warnings;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function baseOptions(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:3100",
    environment: assertEnvironment(benchmarkEnvironment(), "a".repeat(64)),
    metricsUrl: "http://127.0.0.1:9464/metrics",
    scenario: { targetRps: 1, maxConcurrency: 1, warmupSeconds: 0, measurementSeconds: 1 },
    scenarioFileSha256: "a".repeat(64),
    scenarioName: "100k",
    ...overrides,
  };
}

function benchmarkEnvironment() {
  return {
    configuration: fixedConfiguration(),
    cpu: { capacityCores: 2, source: "cgroup-v2" },
    gitSha: "b".repeat(40),
    imageDigest: `sha256:${"c".repeat(64)}`,
    imageId: `sha256:${"d".repeat(64)}`,
    memory: { limitBytes: 1_000_000, source: "cgroup-v2" },
    scenarioFileSha256: "a".repeat(64),
    schemaVersion: 1,
    versions: { node: "v24.18.0", postgres: "17.5", prisma: "6.19.3" },
  };
}

function fixedConfiguration() {
  return {
    aiShare: 0, apiPort: 3100, countryReadSource: "database", databaseConnectTimeoutSeconds: 5,
    databasePoolMax: 10, databasePort: 55434, databasePoolTimeoutSeconds: 5,
    healthReadyTimeoutMs: 1000, metricsPort: 9464, nodeEnvironment: "production",
    readCacheMaxEntries: 1000, readCacheStaleIfErrorSeconds: 300, readCacheTtlSeconds: 60,
    readRatio: 1, writeRatio: 0,
  };
}

function metricsResponse(cpu, overrides = {}) {
  const values = {
    cores: 2,
    duration: 1,
    lag: 0.001,
    memory: 1_000_000,
    rss: 250_000,
    sequence: Math.max(1, Math.round(cpu)),
    valid: 1,
    ...overrides,
  };
  return new Response([
    `navigator_process_cpu_seconds_total ${cpu}`,
    `navigator_process_resident_memory_bytes ${values.rss}`,
    `navigator_event_loop_lag_window_p99_seconds ${values.lag}`,
    `navigator_event_loop_lag_window_sequence ${values.sequence}`,
    `navigator_event_loop_lag_window_valid ${values.valid}`,
    `navigator_event_loop_lag_window_duration_seconds ${values.duration}`,
    `navigator_process_cpu_capacity_cores ${values.cores}`,
    `navigator_process_memory_limit_bytes ${values.memory}`,
    "",
  ].join("\n"), { status: 200 });
}

function createVirtualClock() {
  let current = 0;
  let sequence = 0;
  const sleepers = [];
  const clock = {
    now: () => current,
    sleepUntil(deadline, signal) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (deadline <= current) return Promise.resolve();
      return new Promise((resolveSleep, rejectSleep) => {
        const sleeper = { deadline, resolveSleep, sequence: sequence++ };
        const abort = () => {
          const index = sleepers.indexOf(sleeper);
          if (index >= 0) sleepers.splice(index, 1);
          rejectSleep(signal.reason);
        };
        sleeper.resolveSleep = () => {
          signal?.removeEventListener("abort", abort);
          resolveSleep();
        };
        signal?.addEventListener("abort", abort, { once: true });
        sleepers.push(sleeper);
      });
    },
    async run(promise) {
      let outcome;
      void promise.then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
      for (let guard = 0; guard < 100_000 && outcome === undefined; guard += 1) {
        for (let flush = 0; flush < 100; flush += 1) await Promise.resolve();
        if (outcome !== undefined) break;
        sleepers.sort((left, right) => left.deadline - right.deadline || left.sequence - right.sequence);
        const next = sleepers.shift();
        if (next === undefined) throw new Error("VIRTUAL_CLOCK_STALLED");
        current = next.deadline;
        next.resolveSleep();
        while (sleepers[0]?.deadline <= current) sleepers.shift().resolveSleep();
      }
      if (outcome === undefined) throw new Error("VIRTUAL_CLOCK_GUARD_EXCEEDED");
      if (outcome.error !== undefined) throw outcome.error;
      return outcome.value;
    },
  };
  return clock;
}
