import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLoopbackBaseUrl,
  assertLoopbackMetricsUrl,
  assertOutputPath,
  buildRequestMatrix,
  parsePrometheusProcessMetrics,
  parseScenarioFile,
} from "./load-read-only-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const EXPECTED_SCENARIOS = {
  "100k": { targetRps: 6, maxConcurrency: 16, warmupSeconds: 120, measurementSeconds: 600 },
  "1m": { targetRps: 56, maxConcurrency: 128, warmupSeconds: 120, measurementSeconds: 600 },
  "10m": { targetRps: 556, maxConcurrency: 1024, warmupSeconds: 120, measurementSeconds: 600 },
};

describe("load runner loopback contract", () => {
  test("accepts only literal loopback HTTP base URLs with an explicit port", () => {
    assert.equal(assertLoopbackBaseUrl("http://127.0.0.1:3100"), "http://127.0.0.1:3100");
    assert.equal(assertLoopbackBaseUrl("http://[::1]:3100"), "http://[::1]:3100");
    for (const input of [
      "http://localhost:3100", "http://127.0.0.2:3100", "https://127.0.0.1:3100",
      "http://user:password@127.0.0.1:3100", "http://127.0.0.1:3100/path",
      "http://127.0.0.1:3100?query=x", "http://127.0.0.1:3100#hash",
      "http://127.0.0.1", "http://127.0.0.1:0", " http://127.0.0.1:3100",
    ]) assert.throws(() => assertLoopbackBaseUrl(input), { message: "LOAD_BASE_URL_INVALID" });
  });

  test("accepts only the exact metrics path on literal loopback", () => {
    assert.equal(assertLoopbackMetricsUrl("http://127.0.0.1:9464/metrics"), "http://127.0.0.1:9464/metrics");
    assert.equal(assertLoopbackMetricsUrl("http://[::1]:9464/metrics"), "http://[::1]:9464/metrics");
    for (const input of [
      "http://localhost:9464/metrics", "https://127.0.0.1:9464/metrics",
      "http://127.0.0.1:9464", "http://127.0.0.1:9464/metrics/",
      "http://127.0.0.1:9464/metrics?x=y", "http://127.0.0.1:9464/metrics#x",
      "http://user:password@127.0.0.1:9464/metrics",
    ]) assert.throws(() => assertLoopbackMetricsUrl(input), { message: "LOAD_METRICS_URL_INVALID" });
  });
});

describe("fixed read-only request matrix", () => {
  test("is deterministic, 60/30/10, bilingual, and country-balanced", () => {
    const matrix = buildRequestMatrix();
    assert.deepEqual(matrix, buildRequestMatrix());
    assert.equal(matrix.length, 120);
    assert.deepEqual(countBy(matrix, ({ kind }) => kind), { detail: 36, list: 72, module: 12 });
    assert.deepEqual(countBy(matrix, ({ locale }) => locale), { en: 60, "zh-CN": 60 });
    assert.deepEqual(countBy(matrix.filter(({ countryCode }) => countryCode), ({ countryCode }) => countryCode),
      { AE: 8, BR: 8, ID: 8, SA: 8, VN: 8, ZA: 8 });
    assert.deepEqual(countBy(matrix.filter(({ kind }) => kind === "module"), ({ moduleKey }) => moduleKey),
      { "market-overview": 6, policy: 6 });
    for (const request of matrix) {
      assert.match(request.path, /^\/api\/v1\/countries(?:\/|\?)/);
      assert.match(request.path, /[?&]locale=(?:en|zh-CN)(?:&|$)/);
      assert.doesNotMatch(request.path, /ai-advisor|reports|compare|export/i);
    }
  });
});

describe("scenario and metrics contracts", () => {
  test("ships the exact three bounded production scenarios", async () => {
    const raw = await readFile(resolve(scriptDirectory, "read-only-load-scenarios.json"), "utf8");
    assert.deepEqual(parseScenarioFile(raw), EXPECTED_SCENARIOS);
    for (const invalid of [
      { ...EXPECTED_SCENARIOS, external: EXPECTED_SCENARIOS["100k"] },
      { ...EXPECTED_SCENARIOS, "10m": { ...EXPECTED_SCENARIOS["10m"], maxConcurrency: 10_000 } },
      { ...EXPECTED_SCENARIOS, "100k": { ...EXPECTED_SCENARIOS["100k"], targetRps: "6" } },
      { "100k": EXPECTED_SCENARIOS["100k"] },
    ]) assert.throws(() => parseScenarioFile(JSON.stringify(invalid)), { message: "LOAD_SCENARIO_FILE_INVALID" });
  });

  test("parses one finite sample for every required API process metric", () => {
    const metrics = metricsText({ cpu: 12.5, rss: 123_456, lag: 0.004, cores: 2, memory: 1_000_000 });
    assert.deepEqual(parsePrometheusProcessMetrics(metrics), {
      cpuCapacityCores: 2, cpuSecondsTotal: 12.5, eventLoopLagSeconds: 0.004,
      memoryLimitBytes: 1_000_000, residentMemoryBytes: 123_456,
    });
    for (const invalid of [
      "navigator_process_cpu_seconds_total NaN\n",
      metrics.replace("navigator_process_cpu_seconds_total 12.5", "navigator_process_cpu_seconds_total 0x10"),
      metrics.replace("navigator_process_cpu_capacity_cores 2\n", ""),
      `${metrics}navigator_process_cpu_seconds_total 13\n`,
    ]) assert.throws(() => parsePrometheusProcessMetrics(invalid), { message: "LOAD_METRICS_INVALID" });
  });

  test("limits output to the selected scenario JSON in repository artifacts", () => {
    const cwd = resolve(repositoryRoot, "apps/api");
    assert.equal(assertOutputPath("../../artifacts/platform-ops/100k.json", "100k", { cwd, repositoryRoot }),
      resolve(repositoryRoot, "artifacts/platform-ops/100k.json"));
    for (const output of [
      "../../artifacts/platform-ops/1m.json", "../../artifacts/platform-ops/100k.txt",
      "../../artifacts/platform-ops/nested/100k.json", "../../artifacts/platform-ops/../100k.json",
      "/tmp/100k.json", "100k.json",
    ]) assert.throws(() => assertOutputPath(output, "100k", { cwd, repositoryRoot }),
      { message: "LOAD_OUTPUT_PATH_INVALID" });
  });
});

function countBy(items, selector) {
  const counts = {};
  for (const item of items) counts[selector(item)] = (counts[selector(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function metricsText({ cpu, rss, lag, cores, memory }) {
  return [
    `navigator_process_cpu_seconds_total ${cpu}`,
    `navigator_process_resident_memory_bytes ${rss}`,
    `navigator_event_loop_lag_seconds ${lag}`,
    `navigator_process_cpu_capacity_cores ${cores}`,
    `navigator_process_memory_limit_bytes ${memory}`,
    "",
  ].join("\n");
}
