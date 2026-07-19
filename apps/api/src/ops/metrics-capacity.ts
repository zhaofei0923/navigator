import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const CPU_MAX_PATH = "/sys/fs/cgroup/cpu.max";
const MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";

export interface CapacityProbe {
  readonly availableParallelism: () => number;
  readonly platform: NodeJS.Platform;
  readonly readFile: (path: string) => string;
  readonly totalMemoryBytes: () => number;
}

export interface ProcessMetricSource {
  readonly close: () => void;
  readonly cpuSeconds: () => number;
  readonly eventLoopLagWindow: () => EventLoopLagWindow;
  readonly residentMemoryBytes: () => number;
}

export interface EventLoopLagWindow {
  readonly durationSeconds: number;
  readonly p99Seconds: number;
  readonly sequence: number;
  readonly valid: boolean;
}

export interface EventLoopDelayMonitor {
  readonly count: number;
  disable(): boolean;
  enable(): boolean;
  percentile(percentile: number): number;
  reset(): void;
}

export interface PeriodicSampler {
  close(): void;
}

export interface ProcessMetricSourceOptions {
  readonly eventLoopDelayMonitorFactory?:
    | (() => EventLoopDelayMonitor)
    | undefined;
  readonly monotonicNowMs?: (() => number) | undefined;
  readonly periodicSamplerFactory?:
    | ((sample: () => void, intervalMilliseconds: number) => PeriodicSampler)
    | undefined;
}

export type CapacityMetricSource =
  | "cgroup-v2"
  | "host-available-parallelism"
  | "host-total-memory"
  | "safe-default";

export interface CapacityEnvironment {
  readonly cpuCapacityCores: number;
  readonly cpuCapacitySource: CapacityMetricSource;
  readonly memoryLimitBytes: number;
  readonly memoryLimitSource: CapacityMetricSource;
}

const DEFAULT_CAPACITY_PROBE: CapacityProbe = Object.freeze({
  availableParallelism,
  platform: process.platform,
  readFile: (path: string) => readFileSync(path, "utf8"),
  totalMemoryBytes: totalmem,
});

export function createProcessMetricSource(
  options: ProcessMetricSourceOptions = {},
): ProcessMetricSource {
  const lag = (
    options.eventLoopDelayMonitorFactory ??
    (() => monitorEventLoopDelay({ resolution: 20 }))
  )();
  const monotonicNowMs = options.monotonicNowMs ?? performance.now.bind(performance);
  let closed = false;
  let sequence = 0;
  let windowClean = true;
  let windowStartedAtMs = readMonotonicNow(monotonicNowMs);
  let eventLoopLagWindow = freezeEventLoopLagWindow({
    durationSeconds: 0,
    p99Seconds: 0,
    sequence,
    valid: false,
  });

  lag.enable();
  const sampler = (
    options.periodicSamplerFactory ?? createPeriodicSampler
  )(() => {
    const windowEndedAtMs = readMonotonicNow(monotonicNowMs);
    const startedAtWasFinite = Number.isFinite(windowStartedAtMs);
    const endedAtIsFinite = Number.isFinite(windowEndedAtMs);
    const boundaryValid =
      startedAtWasFinite &&
      endedAtIsFinite &&
      windowEndedAtMs > windowStartedAtMs;
    const durationSeconds = boundaryValid
        ? (windowEndedAtMs - windowStartedAtMs) / 1_000
        : 0;
    let p99Seconds = 0;
    let measurementValid = false;
    let observationCount = 0;

    if (windowClean) {
      try {
        observationCount = lag.count;
      } catch {
        // A broken monitor must produce an invalid window, not escape the timer.
      }
    }

    if (
      windowClean &&
      Number.isFinite(observationCount) &&
      observationCount > 0
    ) {
      try {
        const p99Nanoseconds = lag.percentile(99);
        if (Number.isFinite(p99Nanoseconds) && p99Nanoseconds >= 0) {
          p99Seconds = p99Nanoseconds / 1_000_000_000;
          measurementValid = durationSeconds > 0;
        }
      } catch {
        // The validity gauge distinguishes a failed sample from a healthy zero.
      }
    }

    let resetSucceeded = false;
    try {
      lag.reset();
      resetSucceeded = true;
    } catch {
      // The next window remains contaminated until a reset succeeds.
    }

    sequence += 1;
    eventLoopLagWindow = freezeEventLoopLagWindow({
      durationSeconds,
      p99Seconds: measurementValid ? p99Seconds : 0,
      sequence,
      valid: measurementValid && resetSucceeded,
    });
    windowClean = resetSucceeded;
    windowStartedAtMs = boundaryValid
      ? windowEndedAtMs
      : !startedAtWasFinite && endedAtIsFinite
        ? windowEndedAtMs
        : Number.NaN;
  }, 1_000);

  return {
    close: () => {
      if (closed) return;
      closed = true;
      try {
        sampler.close();
      } finally {
        lag.disable();
      }
    },
    cpuSeconds: () => {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1_000_000;
    },
    eventLoopLagWindow: () => eventLoopLagWindow,
    residentMemoryBytes: () => process.memoryUsage.rss(),
  };
}

function createPeriodicSampler(
  sample: () => void,
  intervalMilliseconds: number,
): PeriodicSampler {
  const timer = setInterval(sample, intervalMilliseconds);
  timer.unref();
  return { close: () => clearInterval(timer) };
}

function freezeEventLoopLagWindow(
  window: EventLoopLagWindow,
): EventLoopLagWindow {
  return Object.freeze({ ...window });
}

function readMonotonicNow(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function resolveCapacityEnvironment(
  probe: CapacityProbe = DEFAULT_CAPACITY_PROBE,
): CapacityEnvironment {
  const cpuQuota =
    probe.platform === "linux"
      ? parseCpuMax(readFixture(probe, CPU_MAX_PATH))
      : undefined;
  const memoryLimit =
    probe.platform === "linux"
      ? parsePositiveInteger(readFixture(probe, MEMORY_MAX_PATH))
      : undefined;
  const hostCpu = safeRead(probe.availableParallelism);
  const hostMemory = safeRead(probe.totalMemoryBytes);
  const useCgroupCpu =
    cpuQuota !== undefined && (hostCpu <= 0 || cpuQuota <= hostCpu);
  const useCgroupMemory =
    memoryLimit !== undefined &&
    (hostMemory <= 0 || memoryLimit <= hostMemory);

  return {
    cpuCapacityCores: useCgroupCpu ? cpuQuota : hostCpu > 0 ? hostCpu : 1,
    cpuCapacitySource: useCgroupCpu
      ? "cgroup-v2"
      : hostCpu > 0
        ? "host-available-parallelism"
        : "safe-default",
    memoryLimitBytes: useCgroupMemory
      ? memoryLimit
      : hostMemory > 0
        ? hostMemory
        : 1,
    memoryLimitSource: useCgroupMemory
      ? "cgroup-v2"
      : hostMemory > 0
        ? "host-total-memory"
        : "safe-default",
  };
}

function readFixture(probe: CapacityProbe, path: string): string | undefined {
  try {
    return probe.readFile(path);
  } catch {
    return undefined;
  }
}

function parseCpuMax(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parts = value.trim().split(/\s+/u);
  if (parts.length !== 2 || parts[0] === "max") return undefined;
  const quota = parsePositiveInteger(parts[0]);
  const period = parsePositiveInteger(parts[1]);
  if (quota === undefined || period === undefined) return undefined;
  const cores = quota / period;
  return Number.isFinite(cores) && cores > 0 ? cores : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d*$/u.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function safeRead(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
