import { describe, expect, test, vi } from "vitest";

import {
  METRICS_REGISTRY,
  MetricsRegistry,
  type MetricsRecorder,
  type MetricsRegistryOptions,
} from "./metrics-registry.js";

const PROCESS_METRICS = Object.freeze({
  close: vi.fn(),
  cpuSeconds: () => 12.5,
  eventLoopLagSeconds: () => 0.004,
  residentMemoryBytes: () => 64 * 1024 * 1024,
});

const HOST_CAPACITY = Object.freeze({
  availableParallelism: () => 8,
  platform: "linux" as const,
  readFile: (_path: string): string => {
    throw new Error("ENOENT");
  },
  totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
});

describe("bounded metrics registry", () => {
  test("exports the DI token and all twelve planned metric families", () => {
    const registry = createRegistry();
    const recorder: MetricsRecorder = registry;

    recorder.recordHttpRequest({
      durationSeconds: 0.012,
      errorCode: "NOT_FOUND",
      method: "GET",
      route: "/api/v1/countries/:code",
      status: 404,
    });
    registry.recordCacheRequest({
      route: "/api/v1/countries/:code",
      state: "stale",
    });

    const exposition = registry.render();
    expect(typeof METRICS_REGISTRY).toBe("symbol");
    expect(metricFamilies(exposition)).toEqual(
      new Set([
        "navigator_http_requests_total",
        "navigator_http_request_duration_seconds",
        "navigator_http_errors_total",
        "navigator_cache_requests_total",
        "navigator_cache_stale_responses_total",
        "navigator_db_operation_duration_seconds",
        "navigator_db_operations_in_flight",
        "navigator_process_cpu_seconds_total",
        "navigator_process_resident_memory_bytes",
        "navigator_event_loop_lag_seconds",
        "navigator_process_cpu_capacity_cores",
        "navigator_process_memory_limit_bytes",
      ]),
    );
    expect(exposition).toContain(
      'navigator_http_requests_total{method="GET",route="/api/v1/countries/:code",status="404"} 1',
    );
    expect(exposition).toContain(
      'navigator_http_errors_total{route="/api/v1/countries/:code",error_code="NOT_FOUND"} 1',
    );
    expect(exposition).toContain(
      'navigator_cache_requests_total{route="/api/v1/countries/:code",state="stale"} 1',
    );
    expect(exposition).toContain(
      'navigator_cache_stale_responses_total{route="/api/v1/countries/:code"} 1',
    );
    expect(exposition).toContain("navigator_process_cpu_seconds_total 12.5");
    expect(exposition).toContain(
      `navigator_process_resident_memory_bytes ${64 * 1024 * 1024}`,
    );
    expect(exposition).toContain("navigator_event_loop_lag_seconds 0.004");
    expect(exposition.endsWith("\n")).toBe(true);
  });

  test("keeps the complete series identity set fixed under hostile labels", () => {
    const registry = createRegistry();
    const before = seriesIdentities(registry.render());

    for (let index = 0; index < 100; index += 1) {
      registry.recordHttpRequest({
        durationSeconds: index,
        errorCode: `request-${index}-ID-VN`,
        method: `GET /api/v1/countries/ID?query=${index}`,
        requestId: `private-request-${index}`,
        route: `/api/v1/countries/ID?query=${index}`,
        status: 600 + index,
      } as never);
      registry.recordCacheRequest({
        route: `/api/v1/countries/VN?query=${index}`,
        state: `private-state-${index}`,
      } as never);
      void registry.observeDbOperation(`private-operation-${index}` as never, () =>
        Promise.resolve(index),
      );
    }

    const afterExposition = registry.render();
    expect(seriesIdentities(afterExposition)).toEqual(before);
    expect(afterExposition).not.toMatch(
      /private-request|private-state|private-operation|countries\/ID\?|countries\/VN\?|query=/,
    );
  });

  test("uses fixed finite histogram buckets with one positive infinity bound", async () => {
    const registry = createRegistry();
    registry.recordHttpRequest({
      durationSeconds: Number.POSITIVE_INFINITY,
      method: "GET",
      route: "/health/live",
      status: 200,
    });
    await registry.observeDbOperation("country_list", async () => "ok");

    const exposition = registry.render();
    const httpBounds = histogramBounds(
      exposition,
      "navigator_http_request_duration_seconds",
      'method="GET",route="/health/live"',
    );
    const databaseBounds = histogramBounds(
      exposition,
      "navigator_db_operation_duration_seconds",
      'operation="country_list"',
    );

    expect(httpBounds).toEqual([
      "0.005",
      "0.01",
      "0.025",
      "0.05",
      "0.1",
      "0.25",
      "0.5",
      "1",
      "2.5",
      "5",
      "+Inf",
    ]);
    expect(databaseBounds).toEqual([
      "0.001",
      "0.005",
      "0.01",
      "0.025",
      "0.05",
      "0.1",
      "0.25",
      "0.5",
      "1",
      "2.5",
      "5",
      "+Inf",
    ]);
  });

  test("tracks logical database work in flight and always finalizes duration", async () => {
    let nowMs = 1_000;
    const registry = createRegistry({ monotonicNowMs: () => nowMs });
    let rejectWork: ((reason: Error) => void) | undefined;
    const work = new Promise<never>((_resolve, reject) => {
      rejectWork = reject;
    });

    const observed = registry.observeDbOperation("country_detail", () => work);
    expect(registry.render()).toContain(
      'navigator_db_operations_in_flight{operation="country_detail"} 1',
    );

    nowMs = 1_250;
    rejectWork?.(new Error("database unavailable"));
    await expect(observed).rejects.toThrow("database unavailable");
    const exposition = registry.render();
    expect(exposition).toContain(
      'navigator_db_operations_in_flight{operation="country_detail"} 0',
    );
    expect(exposition).toContain(
      'navigator_db_operation_duration_seconds_sum{operation="country_detail"} 0.25',
    );
    expect(exposition).toContain(
      'navigator_db_operation_duration_seconds_count{operation="country_detail"} 1',
    );
  });

  test("keeps readiness ping as a fixed logical database operation", async () => {
    const registry = createRegistry();

    await registry.observeDbOperation("readiness_ping", async () => undefined);

    expect(registry.render()).toContain(
      'navigator_db_operation_duration_seconds_count{operation="readiness_ping"} 1',
    );
    expect(registry.render()).toContain(
      'navigator_db_operations_in_flight{operation="readiness_ping"} 0',
    );
  });

  test("prefers valid cgroup v2 CPU quota and memory limit fixtures", () => {
    const registry = createRegistry({
      capacityProbe: {
        ...HOST_CAPACITY,
        readFile: (path) => {
          if (path.endsWith("cpu.max")) return "150000 100000\n";
          if (path.endsWith("memory.max")) return "1073741824\n";
          throw new Error("unexpected path");
        },
      },
    });

    expect(registry.getCapacityEnvironment()).toEqual({
      cpuCapacityCores: 1.5,
      cpuCapacitySource: "cgroup-v2",
      memoryLimitBytes: 1_073_741_824,
      memoryLimitSource: "cgroup-v2",
    });
    expect(registry.render()).toContain(
      "navigator_process_cpu_capacity_cores 1.5",
    );
    expect(registry.render()).toContain(
      "navigator_process_memory_limit_bytes 1073741824",
    );
  });

  test("does not report a cgroup limit above the available host capacity", () => {
    const registry = createRegistry({
      capacityProbe: {
        ...HOST_CAPACITY,
        readFile: (path) =>
          path.endsWith("cpu.max")
            ? "1600000 100000"
            : String(32 * 1024 * 1024 * 1024),
      },
    });

    expect(registry.getCapacityEnvironment()).toEqual({
      cpuCapacityCores: 8,
      cpuCapacitySource: "host-available-parallelism",
      memoryLimitBytes: 16 * 1024 * 1024 * 1024,
      memoryLimitSource: "host-total-memory",
    });
  });

  test.each([
    ["missing", undefined, undefined],
    ["max", "max 100000", "max"],
    ["zero", "0 100000", "0"],
    ["malformed", "secret quota", "1073741824 trailing"],
    ["overflow", "999999999999999999999 1", "999999999999999999999"],
  ])(
    "falls back to nonzero host capacity for %s cgroup fixtures",
    (_label, cpuFixture, memoryFixture) => {
      const registry = createRegistry({
        capacityProbe: {
          ...HOST_CAPACITY,
          readFile: (path) => {
            const fixture = path.endsWith("cpu.max")
              ? cpuFixture
              : memoryFixture;
            if (fixture === undefined) throw new Error("ENOENT");
            return fixture;
          },
        },
      });

      expect(registry.getCapacityEnvironment()).toEqual({
        cpuCapacityCores: 8,
        cpuCapacitySource: "host-available-parallelism",
        memoryLimitBytes: 17_179_869_184,
        memoryLimitSource: "host-total-memory",
      });
      expect(registry.getCapacityEnvironment().cpuCapacityCores).toBeGreaterThan(0);
      expect(registry.getCapacityEnvironment().memoryLimitBytes).toBeGreaterThan(0);
    },
  );

  test("never reports zero when host fallbacks are invalid", () => {
    const registry = createRegistry({
      capacityProbe: {
        availableParallelism: () => Number.NaN,
        platform: "linux",
        readFile: () => "malformed",
        totalMemoryBytes: () => 0,
      },
    });

    expect(registry.getCapacityEnvironment()).toEqual({
      cpuCapacityCores: 1,
      cpuCapacitySource: "safe-default",
      memoryLimitBytes: 1,
      memoryLimitSource: "safe-default",
    });
  });

  test("closes the injected event-loop source exactly once", () => {
    const close = vi.fn();
    const registry = createRegistry({
      processMetrics: {
        close,
        cpuSeconds: () => Number.NaN,
        eventLoopLagSeconds: () => Number.NEGATIVE_INFINITY,
        residentMemoryBytes: () => -1,
      },
    });

    expect(registry.render()).toContain("navigator_process_cpu_seconds_total 0");
    expect(registry.render()).toContain("navigator_process_resident_memory_bytes 0");
    expect(registry.render()).toContain("navigator_event_loop_lag_seconds 0");
    registry.close();
    registry.close();
    expect(close).toHaveBeenCalledOnce();
  });
});

function createRegistry(
  overrides: Partial<MetricsRegistryOptions> = {},
): MetricsRegistry {
  return new MetricsRegistry({
    capacityProbe: HOST_CAPACITY,
    processMetrics: PROCESS_METRICS,
    ...overrides,
  });
}

function metricFamilies(exposition: string): Set<string> {
  return new Set(
    exposition
      .split("\n")
      .filter((line) => line.startsWith("# TYPE "))
      .map((line) => line.split(" ")[2])
      .filter((name): name is string => name !== undefined),
  );
}

function seriesIdentities(exposition: string): Set<string> {
  return new Set(
    exposition
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.slice(0, line.lastIndexOf(" "))),
  );
}

function histogramBounds(
  exposition: string,
  metricName: string,
  labelPrefix: string,
): string[] {
  const prefix = `${metricName}_bucket{${labelPrefix},le="`;
  return exposition
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length, line.indexOf('"}', prefix.length)));
}
