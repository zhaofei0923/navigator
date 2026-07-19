import { describe, expect, test } from "vitest";

import {
  createRequestContext,
  getRequestContext,
  runWithRequestContext,
  type RequestContextEntropy,
} from "./request-context.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID = "00f067aa0ba902b7";
const GENERATED_TRACE_ID = "11111111111111111111111111111111";
const GENERATED_SPAN_ID = "2222222222222222";
const GENERATED_REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const entropy: RequestContextEntropy = {
  requestId: () => GENERATED_REQUEST_ID,
  spanId: () => GENERATED_SPAN_ID,
  traceId: () => GENERATED_TRACE_ID,
};

describe("request context", () => {
  test("preserves a valid W3C trace id, creates a child span, and accepts a safe request id", () => {
    const context = createRequestContext(
      {
        requestId: "request_id-123456",
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      },
      entropy,
    );

    expect(context).toEqual({
      requestId: "request_id-123456",
      spanId: GENERATED_SPAN_ID,
      traceFlags: "01",
      traceId: TRACE_ID,
      traceparent: `00-${TRACE_ID}-${GENERATED_SPAN_ID}-01`,
    });
    expect(context.spanId).not.toBe(PARENT_SPAN_ID);
    expect(Object.isFrozen(context)).toBe(true);
  });

  test.each([
    undefined,
    "",
    `00-${"0".repeat(32)}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${"0".repeat(16)}-01`,
    `ff-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID.toUpperCase()}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${PARENT_SPAN_ID}-01-extra`,
    `00-${TRACE_ID}-${PARENT_SPAN_ID}-0g`,
    ` 00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${PARENT_SPAN_ID}-01,00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    [`00-${TRACE_ID}-${PARENT_SPAN_ID}-01`],
  ])("replaces a malformed traceparent without reflecting it: %j", (traceparent) => {
    const context = createRequestContext({ traceparent }, entropy);

    expect(context).toMatchObject({
      spanId: GENERATED_SPAN_ID,
      traceFlags: "00",
      traceId: GENERATED_TRACE_ID,
      traceparent: `00-${GENERATED_TRACE_ID}-${GENERATED_SPAN_ID}-00`,
    });
  });

  test.each(["A".repeat(16), "z".repeat(64), "request_ID-123456"])(
    "accepts a bounded request id containing only the approved alphabet",
    (requestId) => {
      expect(createRequestContext({ requestId }, entropy).requestId).toBe(requestId);
    },
  );

  test.each([
    undefined,
    "",
    "A".repeat(15),
    "A".repeat(65),
    "request.id.12345",
    "request id 12345",
    "request-id-123\nsecret",
    ["request_ID-123456"],
  ])("replaces an unsafe request id without reflecting it: %j", (requestId) => {
    expect(createRequestContext({ requestId }, entropy).requestId).toBe(
      GENERATED_REQUEST_ID,
    );
  });

  test("retries zero and malformed injected entropy before using it", () => {
    const requestIds = ["unsafe", GENERATED_REQUEST_ID];
    const traceIds = ["0".repeat(32), GENERATED_TRACE_ID];
    const spanIds = ["0".repeat(16), GENERATED_SPAN_ID];
    const context = createRequestContext(
      {
        requestId: "invalid",
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01-extra`,
      },
      {
        requestId: () => requestIds.shift() ?? "unsafe",
        spanId: () => spanIds.shift() ?? "0".repeat(16),
        traceId: () => traceIds.shift() ?? "0".repeat(32),
      },
    );

    expect(context).toMatchObject({
      requestId: GENERATED_REQUEST_ID,
      spanId: GENERATED_SPAN_ID,
      traceFlags: "00",
      traceId: GENERATED_TRACE_ID,
    });
    expect(requestIds).toEqual([]);
    expect(traceIds).toEqual([]);
    expect(spanIds).toEqual([]);
  });

  test("retries a generated child span that collides with the valid parent", () => {
    const spanIds = [PARENT_SPAN_ID, GENERATED_SPAN_ID];
    const context = createRequestContext(
      { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
      {
        ...entropy,
        spanId: () => spanIds.shift() ?? "0".repeat(16),
      },
    );

    expect(context.spanId).toBe(GENERATED_SPAN_ID);
    expect(spanIds).toEqual([]);
  });

  test("keeps one context through awaited repository, cache, and logger work", async () => {
    const context = createRequestContext(
      { requestId: "request_id-123456" },
      entropy,
    );
    const observations = await runWithRequestContext(context, async () => {
      const beforeAwait = getRequestContext();
      await Promise.resolve();
      const repository = await observeAfterTimer();
      const cache = await Promise.resolve().then(() => getRequestContext());
      const logger = getRequestContext();
      return { beforeAwait, cache, logger, repository };
    });

    expect(observations).toEqual({
      beforeAwait: context,
      cache: context,
      logger: context,
      repository: context,
    });
    expect(getRequestContext()).toBeUndefined();
  });

  test("isolates concurrent requests and clears rejected work", async () => {
    const first = createRequestContext(
      { requestId: "first_request-123" },
      entropy,
    );
    const second = createRequestContext(
      { requestId: "second_request-12" },
      {
        requestId: () => "44444444-4444-4444-8444-444444444444",
        spanId: () => "5555555555555555",
        traceId: () => "66666666666666666666666666666666",
      },
    );

    const [firstSeen, secondSeen] = await Promise.all([
      runWithRequestContext(first, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        return getRequestContext();
      }),
      runWithRequestContext(second, async () => {
        await Promise.resolve();
        return getRequestContext();
      }),
    ]);

    expect(firstSeen).toBe(first);
    expect(secondSeen).toBe(second);
    await expect(
      runWithRequestContext(first, async () => {
        await Promise.resolve();
        throw new Error("EXPECTED_TEST_FAILURE");
      }),
    ).rejects.toThrow("EXPECTED_TEST_FAILURE");
    expect(getRequestContext()).toBeUndefined();
  });

  test("restores each caller context after a shared single-flight promise", async () => {
    const first = createRequestContext(
      { requestId: "first_request-123" },
      entropy,
    );
    const second = createRequestContext(
      { requestId: "second_request-12" },
      entropy,
    );
    let release: (() => void) | undefined;
    const sharedFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    const firstResult = runWithRequestContext(first, async () => {
      await sharedFlight;
      return getRequestContext();
    });
    const secondResult = runWithRequestContext(second, async () => {
      await sharedFlight;
      return getRequestContext();
    });
    release?.();

    await expect(firstResult).resolves.toBe(first);
    await expect(secondResult).resolves.toBe(second);
    expect(getRequestContext()).toBeUndefined();
  });
});

async function observeAfterTimer() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return getRequestContext();
}
