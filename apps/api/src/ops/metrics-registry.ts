import {
  createProcessMetricSource,
  resolveCapacityEnvironment,
  type CapacityEnvironment,
  type CapacityProbe,
  type ProcessMetricSource,
} from "./metrics-capacity.js";
import {
  addFamily,
  addHistogram,
  addSample,
  FixedCounter,
  FixedHistogram,
  product,
  safeMetricRead,
  safeRead,
  seriesKey,
} from "./metrics-prometheus.js";

export { resolveCapacityEnvironment } from "./metrics-capacity.js";
export type {
  CapacityEnvironment,
  CapacityMetricSource,
  CapacityProbe,
  ProcessMetricSource,
} from "./metrics-capacity.js";

export const METRICS_REGISTRY = Symbol("METRICS_REGISTRY");

const HTTP_METHODS = ["GET", "OTHER"] as const;
const HTTP_ROUTES = [
  "/health/live",
  "/health/ready",
  "/api/v1/countries",
  "/api/v1/countries/:code",
  "/api/v1/countries/:code/modules/:moduleKey",
  "UNMATCHED",
] as const;
const HTTP_STATUSES = ["200", "400", "404", "499", "500", "503", "OTHER"] as const;
const HTTP_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "INTERNAL_ERROR"] as const;
const CACHE_ROUTES = [
  "/api/v1/countries",
  "/api/v1/countries/:code",
  "/api/v1/countries/:code/modules/:moduleKey",
  "UNMATCHED",
] as const;
const CACHE_STATES = ["hit", "miss", "stale"] as const;
const DB_OPERATIONS = [
  "country_list",
  "country_detail",
  "country_module",
  "readiness_ping",
  "OTHER",
] as const;
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
const DB_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

export type HttpMetricMethod = (typeof HTTP_METHODS)[number];
export type HttpMetricRoute = (typeof HTTP_ROUTES)[number];
export type HttpMetricErrorCode = (typeof HTTP_ERROR_CODES)[number];
export type CacheMetricRoute = (typeof CACHE_ROUTES)[number];
export type CacheMetricState = (typeof CACHE_STATES)[number];
export type DbMetricOperation = (typeof DB_OPERATIONS)[number];

export interface HttpRequestMetric {
  readonly durationSeconds: number;
  readonly errorCode?: HttpMetricErrorCode | undefined;
  readonly method: HttpMetricMethod;
  readonly route: HttpMetricRoute;
  readonly status: number;
}

export interface CacheRequestMetric {
  readonly route: CacheMetricRoute;
  readonly state: CacheMetricState;
}

export interface MetricsRegistryOptions {
  readonly capacityProbe?: CapacityProbe | undefined;
  readonly monotonicNowMs?: (() => number) | undefined;
  readonly processMetrics?: ProcessMetricSource | undefined;
}

export interface MetricsRecorder {
  recordCacheRequest(metric: CacheRequestMetric): void;
  recordHttpRequest(metric: HttpRequestMetric): void;
  observeDbOperation<T>(
    operation: DbMetricOperation,
    work: () => Promise<T>,
  ): Promise<T>;
}

export class MetricsRegistry implements MetricsRecorder {
  private readonly cacheRequests = new FixedCounter(
    product(CACHE_ROUTES, CACHE_STATES).map(seriesKey),
  );
  private readonly cacheStaleResponses = new FixedCounter([...CACHE_ROUTES]);
  private readonly capacityEnvironment: CapacityEnvironment;
  private readonly dbDurations = new FixedHistogram(
    [...DB_OPERATIONS],
    DB_DURATION_BUCKETS,
  );
  private readonly dbInFlight = new Map(
    DB_OPERATIONS.map((operation) => [operation, 0]),
  );
  private readonly httpDurations = new FixedHistogram(
    product(HTTP_METHODS, HTTP_ROUTES).map(seriesKey),
    HTTP_DURATION_BUCKETS,
  );
  private readonly httpErrors = new FixedCounter(
    product(HTTP_ROUTES, HTTP_ERROR_CODES).map(seriesKey),
  );
  private readonly httpRequests = new FixedCounter(
    product(HTTP_METHODS, HTTP_ROUTES, HTTP_STATUSES).map(seriesKey),
  );
  private readonly monotonicNowMs: () => number;
  private readonly processMetrics: ProcessMetricSource;
  private closed = false;

  constructor(options: MetricsRegistryOptions = {}) {
    this.monotonicNowMs = options.monotonicNowMs ?? performance.now.bind(performance);
    this.processMetrics = options.processMetrics ?? createProcessMetricSource();
    this.capacityEnvironment = Object.freeze(
      resolveCapacityEnvironment(options.capacityProbe),
    );
  }

  recordHttpRequest(metric: HttpRequestMetric): void {
    const method = normalizeHttpMethod(metric.method);
    const route = normalizeHttpRoute(metric.route);
    const status = normalizeHttpStatus(metric.status);
    this.httpRequests.increment(seriesKey([method, route, status]));
    this.httpDurations.observe(
      seriesKey([method, route]),
      metric.durationSeconds,
    );
    const errorCode = normalizeHttpErrorCode(metric.errorCode);
    if (errorCode !== undefined) {
      this.httpErrors.increment(seriesKey([route, errorCode]));
    }
  }

  recordCacheRequest(metric: CacheRequestMetric): void {
    const state = normalizeCacheState(metric.state);
    if (state === undefined) return;
    const route = normalizeCacheRoute(metric.route);
    this.cacheRequests.increment(seriesKey([route, state]));
    if (state === "stale") this.cacheStaleResponses.increment(route);
  }

  async observeDbOperation<T>(
    rawOperation: DbMetricOperation,
    work: () => Promise<T>,
  ): Promise<T> {
    const operation = normalizeDbOperation(rawOperation);
    const startedAt = safeRead(this.monotonicNowMs);
    this.dbInFlight.set(operation, (this.dbInFlight.get(operation) ?? 0) + 1);
    try {
      return await work();
    } finally {
      this.dbInFlight.set(
        operation,
        Math.max(0, (this.dbInFlight.get(operation) ?? 1) - 1),
      );
      const elapsedSeconds = Math.max(
        0,
        (safeRead(this.monotonicNowMs) - startedAt) / 1_000,
      );
      this.dbDurations.observe(operation, elapsedSeconds);
    }
  }

  getCapacityEnvironment(): CapacityEnvironment {
    return this.capacityEnvironment;
  }

  render(): string {
    const lines: string[] = [];
    addFamily(lines, "navigator_http_requests_total", "counter");
    for (const method of HTTP_METHODS) for (const route of HTTP_ROUTES) for (const status of HTTP_STATUSES) {
      addSample(lines, "navigator_http_requests_total", { method, route, status }, this.httpRequests.read(seriesKey([method, route, status])));
    }
    addFamily(lines, "navigator_http_request_duration_seconds", "histogram");
    for (const method of HTTP_METHODS) for (const route of HTTP_ROUTES) {
      addHistogram(lines, "navigator_http_request_duration_seconds", { method, route }, this.httpDurations, seriesKey([method, route]));
    }
    addFamily(lines, "navigator_http_errors_total", "counter");
    for (const route of HTTP_ROUTES) for (const errorCode of HTTP_ERROR_CODES) {
      addSample(lines, "navigator_http_errors_total", { route, error_code: errorCode }, this.httpErrors.read(seriesKey([route, errorCode])));
    }
    addFamily(lines, "navigator_cache_requests_total", "counter");
    for (const route of CACHE_ROUTES) for (const state of CACHE_STATES) {
      addSample(lines, "navigator_cache_requests_total", { route, state }, this.cacheRequests.read(seriesKey([route, state])));
    }
    addFamily(lines, "navigator_cache_stale_responses_total", "counter");
    for (const route of CACHE_ROUTES) addSample(lines, "navigator_cache_stale_responses_total", { route }, this.cacheStaleResponses.read(route));
    addFamily(lines, "navigator_db_operation_duration_seconds", "histogram");
    for (const operation of DB_OPERATIONS) addHistogram(lines, "navigator_db_operation_duration_seconds", { operation }, this.dbDurations, operation);
    addFamily(lines, "navigator_db_operations_in_flight", "gauge");
    for (const operation of DB_OPERATIONS) addSample(lines, "navigator_db_operations_in_flight", { operation }, this.dbInFlight.get(operation) ?? 0);
    addFamily(lines, "navigator_process_cpu_seconds_total", "counter");
    addSample(lines, "navigator_process_cpu_seconds_total", {}, safeMetricRead(this.processMetrics.cpuSeconds));
    addFamily(lines, "navigator_process_resident_memory_bytes", "gauge");
    addSample(lines, "navigator_process_resident_memory_bytes", {}, safeMetricRead(this.processMetrics.residentMemoryBytes));
    addFamily(lines, "navigator_event_loop_lag_seconds", "gauge");
    addSample(lines, "navigator_event_loop_lag_seconds", {}, safeMetricRead(this.processMetrics.eventLoopLagSeconds));
    addFamily(lines, "navigator_process_cpu_capacity_cores", "gauge");
    addSample(lines, "navigator_process_cpu_capacity_cores", {}, this.capacityEnvironment.cpuCapacityCores);
    addFamily(lines, "navigator_process_memory_limit_bytes", "gauge");
    addSample(lines, "navigator_process_memory_limit_bytes", {}, this.capacityEnvironment.memoryLimitBytes);
    return `${lines.join("\n")}\n`;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.processMetrics.close();
    } catch {
      // Metrics teardown must not prevent application shutdown.
    }
  }
}

function normalizeHttpMethod(value: unknown): HttpMetricMethod {
  return value === "GET" ? value : "OTHER";
}

function normalizeHttpRoute(value: unknown): HttpMetricRoute {
  return includes(HTTP_ROUTES, value) ? value : "UNMATCHED";
}

function normalizeHttpStatus(value: unknown): (typeof HTTP_STATUSES)[number] {
  const label = typeof value === "number" && Number.isInteger(value) ? String(value) : "OTHER";
  return includes(HTTP_STATUSES, label) ? label : "OTHER";
}

function normalizeHttpErrorCode(value: unknown): HttpMetricErrorCode | undefined {
  return includes(HTTP_ERROR_CODES, value) ? value : undefined;
}

function normalizeCacheRoute(value: unknown): CacheMetricRoute {
  return includes(CACHE_ROUTES, value) ? value : "UNMATCHED";
}

function normalizeCacheState(value: unknown): CacheMetricState | undefined {
  return includes(CACHE_STATES, value) ? value : undefined;
}

function normalizeDbOperation(value: unknown): DbMetricOperation {
  return includes(DB_OPERATIONS, value) ? value : "OTHER";
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
