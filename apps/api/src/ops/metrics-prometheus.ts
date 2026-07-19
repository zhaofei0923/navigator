interface HistogramValue {
  readonly bucketCounts: number[];
  count: number;
  sum: number;
}

export class FixedCounter {
  private readonly values: Map<string, number>;

  constructor(keys: readonly string[]) {
    this.values = new Map(keys.map((key) => [key, 0]));
  }

  increment(key: string): void {
    const current = this.values.get(key);
    if (current !== undefined) this.values.set(key, current + 1);
  }

  read(key: string): number {
    return this.values.get(key) ?? 0;
  }
}

export class FixedHistogram {
  private readonly values: Map<string, HistogramValue>;

  constructor(
    keys: readonly string[],
    readonly buckets: readonly number[],
  ) {
    this.values = new Map(
      keys.map((key) => [
        key,
        { bucketCounts: buckets.map(() => 0), count: 0, sum: 0 },
      ]),
    );
  }

  observe(key: string, rawValue: number): void {
    const histogram = this.values.get(key);
    if (histogram === undefined) return;
    const value = finiteNonnegative(rawValue);
    histogram.count += 1;
    histogram.sum += value;
    for (let index = 0; index < this.buckets.length; index += 1) {
      const bucket = this.buckets[index];
      if (bucket !== undefined && value <= bucket) {
        histogram.bucketCounts[index] =
          (histogram.bucketCounts[index] ?? 0) + 1;
      }
    }
  }

  read(key: string): HistogramValue {
    return this.values.get(key) ?? {
      bucketCounts: this.buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
  }
}

export function addFamily(
  lines: string[],
  name: string,
  type: "counter" | "gauge" | "histogram",
): void {
  const help = name.slice("navigator_".length).replaceAll("_", " ");
  lines.push(`# HELP ${name} Navigator ${help}.`);
  lines.push(`# TYPE ${name} ${type}`);
}

export function addHistogram(
  lines: string[],
  name: string,
  labels: Readonly<Record<string, string>>,
  histogram: FixedHistogram,
  key: string,
): void {
  const value = histogram.read(key);
  histogram.buckets.forEach((bound, index) => {
    addSample(
      lines,
      `${name}_bucket`,
      { ...labels, le: String(bound) },
      value.bucketCounts[index] ?? 0,
    );
  });
  addSample(lines, `${name}_bucket`, { ...labels, le: "+Inf" }, value.count);
  addSample(lines, `${name}_sum`, labels, value.sum);
  addSample(lines, `${name}_count`, labels, value.count);
}

export function addSample(
  lines: string[],
  name: string,
  labels: Readonly<Record<string, string>>,
  value: number,
): void {
  const renderedLabels = Object.entries(labels)
    .map(([key, label]) => `${key}="${escapeLabel(label)}"`)
    .join(",");
  const suffix = renderedLabels.length > 0 ? `{${renderedLabels}}` : "";
  lines.push(`${name}${suffix} ${formatNumber(value)}`);
}

export function product(
  ...dimensions: readonly (readonly string[])[]
): string[][] {
  return dimensions.reduce<string[][]>(
    (rows, dimension) =>
      rows.flatMap((row) => dimension.map((value) => [...row, value])),
    [[]],
  );
}

export function safeMetricRead(read: () => number): number {
  return finiteNonnegative(safeRead(read));
}

export function safeRead(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function seriesKey(labels: readonly string[]): string {
  return labels.join("\u0000");
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatNumber(value: number): string {
  return String(finiteNonnegative(value));
}
