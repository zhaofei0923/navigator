import { resolve } from "node:path";

const EXPECTED_SCENARIOS = Object.freeze({
  "100k": Object.freeze({ targetRps: 6, maxConcurrency: 16, warmupSeconds: 120, measurementSeconds: 600 }),
  "1m": Object.freeze({ targetRps: 56, maxConcurrency: 128, warmupSeconds: 120, measurementSeconds: 600 }),
  "10m": Object.freeze({ targetRps: 556, maxConcurrency: 1024, warmupSeconds: 120, measurementSeconds: 600 }),
});
export const SCENARIO_NAMES = Object.freeze(Object.keys(EXPECTED_SCENARIOS));
export const MATRIX_SEED = 0x4e415631;
export const LATENCY_BUCKETS_MS = Object.freeze([5, 10, 25, 50, 100, 150, 300, 500, 1_000, 2_500, 5_000]);

const COUNTRIES = Object.freeze(["ID", "VN", "SA", "AE", "BR", "ZA"]);
const LOCALES = Object.freeze(["en", "zh-CN"]);
const BASE_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/;
const METRICS_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/metrics$/;
const PROCESS_METRICS = Object.freeze({
  cpuSecondsTotal: "navigator_process_cpu_seconds_total",
  residentMemoryBytes: "navigator_process_resident_memory_bytes",
  eventLoopLagSeconds: "navigator_event_loop_lag_seconds",
  cpuCapacityCores: "navigator_process_cpu_capacity_cores",
  memoryLimitBytes: "navigator_process_memory_limit_bytes",
});
const ENVIRONMENT_KEYS = Object.freeze([
  "configuration", "cpu", "gitSha", "imageDigest", "imageId", "memory",
  "scenarioFileSha256", "schemaVersion", "versions",
]);
const FIXED_CONFIGURATION = Object.freeze({
  aiShare: 0,
  apiPort: 3100,
  countryReadSource: "database",
  databaseConnectTimeoutSeconds: 5,
  databasePoolMax: 10,
  databasePort: 55434,
  databasePoolTimeoutSeconds: 5,
  healthReadyTimeoutMs: 1000,
  metricsPort: 9464,
  nodeEnvironment: "production",
  readCacheMaxEntries: 1000,
  readCacheStaleIfErrorSeconds: 300,
  readCacheTtlSeconds: 60,
  readRatio: 1,
  writeRatio: 0,
});

export function assertLoopbackBaseUrl(input) {
  return assertLoopbackUrl(input, BASE_URL_PATTERN, "LOAD_BASE_URL_INVALID");
}

export function assertLoopbackMetricsUrl(input) {
  return assertLoopbackUrl(input, METRICS_URL_PATTERN, "LOAD_METRICS_URL_INVALID");
}

function assertLoopbackUrl(input, pattern, errorCode) {
  const match = typeof input === "string" ? pattern.exec(input) : null;
  const port = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(errorCode);
  return input;
}

export function buildRequestMatrix() {
  const requests = [];
  for (let index = 0; index < 72; index += 1) {
    const locale = LOCALES[index % LOCALES.length];
    requests.push(Object.freeze({ kind: "list", locale, path: `/api/v1/countries?locale=${locale}` }));
  }
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const countryCode of COUNTRIES) for (const locale of LOCALES) {
      requests.push(Object.freeze({
        countryCode, kind: "detail", locale, path: `/api/v1/countries/${countryCode}?locale=${locale}`,
      }));
    }
  }
  for (const [countryIndex, countryCode] of COUNTRIES.entries()) {
    for (const [localeIndex, locale] of LOCALES.entries()) {
      const moduleKey = (countryIndex + localeIndex) % 2 === 0 ? "market-overview" : "policy";
      requests.push(Object.freeze({
        countryCode, kind: "module", locale, moduleKey,
        path: `/api/v1/countries/${countryCode}/modules/${moduleKey}?locale=${locale}`,
      }));
    }
  }
  const random = seededRandom(MATRIX_SEED);
  for (let index = requests.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [requests[index], requests[swapIndex]] = [requests[swapIndex], requests[index]];
  }
  return Object.freeze(requests);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function parseScenarioFile(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !sameKeys(parsed, EXPECTED_SCENARIOS)) throw new Error();
    for (const name of SCENARIO_NAMES) {
      if (!isRecord(parsed[name]) || !sameKeys(parsed[name], EXPECTED_SCENARIOS[name])) throw new Error();
      for (const [key, value] of Object.entries(EXPECTED_SCENARIOS[name])) {
        if (parsed[name][key] !== value) throw new Error();
      }
    }
    return Object.fromEntries(SCENARIO_NAMES.map((name) => [name, { ...EXPECTED_SCENARIOS[name] }]));
  } catch {
    throw new Error("LOAD_SCENARIO_FILE_INVALID");
  }
}

export function assertOutputPath(input, scenarioName, options) {
  if (typeof options?.repositoryRoot !== "string" || typeof options?.cwd !== "string") {
    throw new Error("LOAD_OUTPUT_PATH_INVALID");
  }
  const repositoryRoot = resolve(options.repositoryRoot);
  const cwd = resolve(options.cwd);
  const expected = resolve(repositoryRoot, `artifacts/platform-ops/${scenarioName}.json`);
  const actual = typeof input === "string" ? resolve(cwd, input) : "";
  if (!SCENARIO_NAMES.includes(scenarioName) || actual !== expected) throw new Error("LOAD_OUTPUT_PATH_INVALID");
  return expected;
}

export function parsePrometheusProcessMetrics(text) {
  if (typeof text !== "string" || text.length > 1_048_576) throw new Error("LOAD_METRICS_INVALID");
  const values = {};
  const numberToken = "(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?";
  for (const [field, metricName] of Object.entries(PROCESS_METRICS)) {
    const pattern = new RegExp(`^${metricName}[ \\t]+(${numberToken})[ \\t]*$`);
    const matches = text.split(/\r?\n/).flatMap((line) => pattern.exec(line)?.[1] ?? []);
    const value = matches.length === 1 ? Number(matches[0]) : Number.NaN;
    if (!Number.isFinite(value) || value < 0) throw new Error("LOAD_METRICS_INVALID");
    values[field] = value;
  }
  if (values.cpuCapacityCores <= 0 || values.memoryLimitBytes <= 0) throw new Error("LOAD_METRICS_INVALID");
  return Object.freeze(values);
}

export function assertRuntimeScenario(value) {
  if (!isRecord(value)) throw new Error("LOAD_SCENARIO_INVALID");
  const rules = [
    ["targetRps", 1, 1_000], ["maxConcurrency", 1, 1_024],
    ["warmupSeconds", 0, 600], ["measurementSeconds", 1, 3_600],
  ];
  for (const [key, minimum, maximum] of rules) {
    if (!Number.isInteger(value[key]) || value[key] < minimum || value[key] > maximum) {
      throw new Error("LOAD_SCENARIO_INVALID");
    }
  }
  return Object.freeze(Object.fromEntries(rules.map(([key]) => [key, value[key]])));
}

export function assertScenarioName(value) {
  if (!SCENARIO_NAMES.includes(value)) throw new Error("LOAD_SCENARIO_INVALID");
  return value;
}

export function assertRequestMatrix(value) {
  const expected = buildRequestMatrix();
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error("LOAD_MATRIX_INVALID");
  return expected;
}

export function assertEnvironment(value, expectedScenarioSha) {
  if (!isRecord(value) || !sameKeys(value, Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, true]))) ||
      !/^[0-9a-f]{40}$/.test(value.gitSha ?? "") || !/^sha256:[0-9a-f]{64}$/.test(value.imageDigest ?? "") ||
      !/^sha256:[0-9a-f]{64}$/.test(value.imageId ?? "") || value.schemaVersion !== 1 ||
      value.scenarioFileSha256 !== expectedScenarioSha || !isRecord(value.versions) ||
      !sameKeys(value.versions, { node: true, postgres: true, prisma: true }) ||
      !isRecord(value.cpu) || !sameKeys(value.cpu, { capacityCores: true, source: true }) ||
      !isRecord(value.memory) || !sameKeys(value.memory, { limitBytes: true, source: true }) ||
      !matchesFixedConfiguration(value.configuration)) {
    throw new Error("LOAD_ENVIRONMENT_INVALID");
  }
  for (const version of Object.values(value.versions)) {
    if (typeof version !== "string" || !/^[\x20-\x7e]{1,128}$/.test(version)) throw new Error("LOAD_ENVIRONMENT_INVALID");
  }
  if (!positiveFinite(value.cpu.capacityCores) || !Number.isSafeInteger(value.memory.limitBytes) || value.memory.limitBytes <= 0 ||
      !safeSource(value.cpu.source) || !safeSource(value.memory.source)) throw new Error("LOAD_ENVIRONMENT_INVALID");
  return Object.freeze({
    cpu: Object.freeze({ ...value.cpu }), gitSha: value.gitSha, imageDigest: value.imageDigest,
    memory: Object.freeze({ ...value.memory }), versions: Object.freeze({ ...value.versions }),
  });
}

function matchesFixedConfiguration(value) {
  if (!isRecord(value) || !sameKeys(value, FIXED_CONFIGURATION)) return false;
  return Object.entries(FIXED_CONFIGURATION).every(([key, expected]) => value[key] === expected);
}

export function assertMetricCapacity(metrics, environment) {
  if (Math.abs(metrics.cpuCapacityCores - environment.cpu.capacityCores) > 1e-9 ||
      metrics.memoryLimitBytes !== environment.memory.limitBytes) throw new Error("LOAD_CAPACITY_MISMATCH");
}

export function assertSha256(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("LOAD_SCENARIO_SHA_INVALID");
  return value;
}

function sameKeys(left, right) {
  return JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort());
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function safeSource(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}
