import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

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
  readonly eventLoopLagSeconds: () => number;
  readonly residentMemoryBytes: () => number;
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

export function createProcessMetricSource(): ProcessMetricSource {
  let lag: ReturnType<typeof monitorEventLoopDelay> | undefined;
  return {
    close: () => lag?.disable(),
    cpuSeconds: () => {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1_000_000;
    },
    eventLoopLagSeconds: () => {
      lag ??= monitorEventLoopDelay({ resolution: 20 });
      lag.enable();
      return lag.mean / 1_000_000_000;
    },
    residentMemoryBytes: () => process.memoryUsage.rss(),
  };
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
