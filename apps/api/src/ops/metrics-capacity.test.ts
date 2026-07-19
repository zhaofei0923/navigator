import { describe, expect, test, vi } from "vitest";

import { createProcessMetricSource } from "./metrics-capacity.js";

describe("event-loop delay window metrics", () => {
  test("publishes a completed one-second-window p99 snapshot without scrape side effects", () => {
    const fixture = createEventLoopFixture();
    const source = createProcessMetricSource(fixture.options);

    expect(fixture.enable).toHaveBeenCalledOnce();
    expect(fixture.samplerFactory).toHaveBeenCalledWith(
      expect.any(Function),
      1_000,
    );
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 0,
      p99Seconds: 0,
      sequence: 0,
      valid: false,
    });

    fixture.count.value = 4;
    fixture.now.value = 2_500;
    fixture.percentile.mockReturnValue(25_000_000);
    fixture.sample();

    const completed = {
      durationSeconds: 2.5,
      p99Seconds: 0.025,
      sequence: 1,
      valid: true,
    };
    expect(source.eventLoopLagWindow()).toEqual(completed);
    expect(source.eventLoopLagWindow()).toEqual(completed);
    expect(Object.isFrozen(source.eventLoopLagWindow())).toBe(true);
    expect(fixture.percentile).toHaveBeenCalledOnce();
    expect(fixture.percentile).toHaveBeenCalledWith(99);
    expect(fixture.reset).toHaveBeenCalledOnce();
  });

  test("marks empty, failed, non-finite, and reset-failed windows invalid", () => {
    const fixture = createEventLoopFixture();
    const source = createProcessMetricSource(fixture.options);

    fixture.now.value = 1_000;
    fixture.sample();
    expect(fixture.percentile).not.toHaveBeenCalled();
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 1,
      p99Seconds: 0,
      sequence: 1,
      valid: false,
    });

    fixture.count.value = 1;
    fixture.now.value = 2_000;
    fixture.percentile.mockImplementationOnce(() => {
      throw new Error("histogram read failed");
    });
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      durationSeconds: 1,
      sequence: 2,
      valid: false,
    });

    fixture.now.value = 3_000;
    fixture.percentile.mockReturnValueOnce(Number.NaN);
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      sequence: 3,
      valid: false,
    });

    fixture.now.value = 4_000;
    fixture.percentile.mockReturnValueOnce(5_000_000);
    fixture.reset.mockImplementationOnce(() => {
      throw new Error("histogram reset failed");
    });
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      sequence: 4,
      valid: false,
    });
    expect(fixture.reset).toHaveBeenCalledTimes(4);
  });

  test("contains count getter failures and recovers after clearing a contaminated window", () => {
    const fixture = createEventLoopFixture();
    const source = createProcessMetricSource(fixture.options);

    fixture.now.value = 1_000;
    fixture.readCount.mockImplementationOnce(() => {
      throw new Error("histogram count failed");
    });
    expect(() => fixture.sample()).not.toThrow();
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 1,
      p99Seconds: 0,
      sequence: 1,
      valid: false,
    });
    expect(fixture.reset).toHaveBeenCalledOnce();

    fixture.count.value = 1;
    fixture.now.value = 2_000;
    fixture.percentile.mockReturnValue(7_000_000);
    fixture.reset.mockImplementationOnce(() => {
      throw new Error("histogram reset failed");
    });
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      sequence: 2,
      valid: false,
    });
    expect(fixture.percentile).toHaveBeenCalledOnce();

    fixture.now.value = 3_000;
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      sequence: 3,
      valid: false,
    });
    expect(fixture.percentile).toHaveBeenCalledOnce();

    fixture.now.value = 4_000;
    fixture.sample();
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 1,
      p99Seconds: 0.007,
      sequence: 4,
      valid: true,
    });
    expect(fixture.percentile).toHaveBeenCalledTimes(2);
    expect(fixture.reset).toHaveBeenCalledTimes(4);
  });

  test("records delayed window duration and closes the sampler and monitor once", () => {
    const fixture = createEventLoopFixture();
    const source = createProcessMetricSource(fixture.options);

    fixture.count.value = 2;
    fixture.now.value = 1_750;
    fixture.percentile.mockReturnValue(40_000_000);
    fixture.sample();
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 1.75,
      p99Seconds: 0.04,
      sequence: 1,
      valid: true,
    });

    source.close();
    source.close();
    expect(fixture.closeSampler).toHaveBeenCalledOnce();
    expect(fixture.disable).toHaveBeenCalledOnce();
  });

  test("fails closed on a broken monotonic clock and recovers after a clean boundary", () => {
    const fixture = createEventLoopFixture();
    const source = createProcessMetricSource(fixture.options);
    fixture.count.value = 1;
    fixture.percentile.mockReturnValue(3_000_000);

    fixture.now.value = Number.NaN;
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      durationSeconds: 0,
      sequence: 1,
      valid: false,
    });

    fixture.now.value = 2_000;
    fixture.sample();
    expect(source.eventLoopLagWindow()).toMatchObject({
      durationSeconds: 0,
      sequence: 2,
      valid: false,
    });

    fixture.now.value = 3_000;
    fixture.sample();
    expect(source.eventLoopLagWindow()).toEqual({
      durationSeconds: 1,
      p99Seconds: 0.003,
      sequence: 3,
      valid: true,
    });
  });

  test.each([500, 1_000])(
    "requires a clean boundary after a finite non-increasing clock value %s",
    (invalidBoundary) => {
      const fixture = createEventLoopFixture();
      fixture.now.value = 1_000;
      const source = createProcessMetricSource(fixture.options);
      fixture.count.value = 1;
      fixture.percentile.mockReturnValue(2_000_000);

      fixture.now.value = invalidBoundary;
      fixture.sample();
      expect(source.eventLoopLagWindow()).toMatchObject({
        durationSeconds: 0,
        sequence: 1,
        valid: false,
      });

      fixture.now.value = 2_000;
      fixture.sample();
      expect(source.eventLoopLagWindow()).toMatchObject({
        durationSeconds: 0,
        sequence: 2,
        valid: false,
      });

      fixture.now.value = 3_000;
      fixture.sample();
      expect(source.eventLoopLagWindow()).toEqual({
        durationSeconds: 1,
        p99Seconds: 0.002,
        sequence: 3,
        valid: true,
      });
    },
  );
});

function createEventLoopFixture() {
  const closeSampler = vi.fn();
  const count = { value: 0 };
  const disable = vi.fn();
  const enable = vi.fn();
  const now = { value: 0 };
  const percentile = vi.fn(() => 0);
  const readCount = vi.fn(() => count.value);
  const reset = vi.fn();
  let sample = (): void => {
    throw new Error("sampler not initialized");
  };
  const samplerFactory = vi.fn(
    (callback: () => void, _intervalMilliseconds: number) => {
      sample = callback;
      return { close: closeSampler };
    },
  );
  const histogram = {
    get count() {
      return readCount();
    },
    disable,
    enable,
    percentile,
    readCount,
    reset,
  };

  return {
    closeSampler,
    count,
    disable,
    enable,
    now,
    options: {
      eventLoopDelayMonitorFactory: () => histogram,
      monotonicNowMs: () => now.value,
      periodicSamplerFactory: samplerFactory,
    },
    percentile,
    readCount,
    reset,
    sample: () => sample(),
    samplerFactory,
  };
}
