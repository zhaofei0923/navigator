import { describe, expect, test, vi } from "vitest";

import { JsonLogger } from "./json-logger.js";

const REQUEST_ID = "request_id-123456";
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "2222222222222222";
const NOW = new Date("2026-07-19T08:00:00.000Z");

describe("JSON logger", () => {
  test("writes one newline-delimited request record with only allowlisted fields", () => {
    const write = vi.fn<(line: string) => void>();
    const logger = new JsonLogger({ now: () => NOW, write });

    logger.logRequest({
      cacheState: "hit",
      durationMs: 12.25,
      internalError: false,
      method: "GET",
      requestId: REQUEST_ID,
      route: "/api/v1/countries/:code",
      spanId: SPAN_ID,
      status: 200,
      traceId: TRACE_ID,
    });

    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]?.[0];
    expect(line?.endsWith("\n")).toBe(true);
    expect(JSON.parse(line ?? "null")).toEqual({
      timestamp: NOW.toISOString(),
      level: "info",
      event: "http_request_completed",
      requestId: REQUEST_ID,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      method: "GET",
      route: "/api/v1/countries/:code",
      status: 200,
      durationMs: 12.25,
      cacheState: "hit",
    });
    expect(Object.keys(JSON.parse(line ?? "null"))).toEqual([
      "timestamp",
      "level",
      "event",
      "requestId",
      "traceId",
      "spanId",
      "method",
      "route",
      "status",
      "durationMs",
      "cacheState",
    ]);
  });

  test("classifies a 500 with fixed enums and never serializes exception details or extra input", () => {
    const write = vi.fn<(line: string) => void>();
    const logger = new JsonLogger({ now: () => NOW, write });
    const unsafe = {
      authorization: "Bearer private-token",
      cacheState: undefined,
      contact: "person@example.com",
      cookie: "session=private",
      databaseUrl: "postgresql://user:secret@db.internal/navigator",
      durationMs: 8,
      exceptionMessage: "SELECT secret FROM country",
      internalError: true as const,
      ip: "203.0.113.9",
      method: "GET" as const,
      path: "/api/v1/countries/ID?email=person@example.com",
      requestId: REQUEST_ID,
      route: "/api/v1/countries/:code" as const,
      spanId: SPAN_ID,
      stack: "Error: private stack",
      status: 500,
      traceId: TRACE_ID,
      userAgent: "private-agent",
    };

    logger.logRequest(unsafe);

    const line = write.mock.calls[0]?.[0] ?? "";
    expect(JSON.parse(line)).toEqual({
      timestamp: NOW.toISOString(),
      level: "error",
      event: "http_request_internal_error",
      requestId: REQUEST_ID,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      method: "GET",
      route: "/api/v1/countries/:code",
      status: 500,
      durationMs: 8,
      errorCode: "INTERNAL_ERROR",
    });
    expect(line).not.toMatch(
      /private|secret|postgresql|db\.internal|SELECT|person@|203\.0\.113|stack|authorization|cookie|userAgent|databaseUrl|exceptionMessage|path/i,
    );
  });

  test("keeps health not-ready distinct from an internal exception", () => {
    const write = vi.fn<(line: string) => void>();
    const logger = new JsonLogger({ now: () => NOW, write });

    logger.logRequest({
      durationMs: 1,
      internalError: false,
      method: "GET",
      requestId: REQUEST_ID,
      route: "/health/ready",
      spanId: SPAN_ID,
      status: 503,
      traceId: TRACE_ID,
    });

    expect(JSON.parse(write.mock.calls[0]?.[0] ?? "null")).toMatchObject({
      event: "http_request_completed",
      level: "info",
      route: "/health/ready",
      status: 503,
    });
    expect(write.mock.calls[0]?.[0]).not.toContain("errorCode");
  });

  test("fails closed when runtime callers bypass fixed enum types", () => {
    const write = vi.fn<(line: string) => void>();
    const logger = new JsonLogger({ now: () => NOW, write });

    logger.logRequest({
      cacheState: "ID",
      durationMs: 1,
      internalError: "postgresql://user:secret@db.internal",
      method: "GET /api/v1/countries/ID?email=person@example.com",
      requestId: REQUEST_ID,
      route: "/api/v1/countries/ID",
      spanId: SPAN_ID,
      status: 500,
      traceId: TRACE_ID,
    } as unknown as Parameters<JsonLogger["logRequest"]>[0]);

    const line = write.mock.calls[0]?.[0] ?? "";
    expect(JSON.parse(line)).toMatchObject({
      errorCode: "INTERNAL_ERROR",
      event: "http_request_internal_unexpected",
      method: "OTHER",
      route: "UNMATCHED",
    });
    expect(JSON.parse(line)).not.toHaveProperty("cacheState");
    expect(line).not.toMatch(/postgresql|secret|db\.internal|person@|\/ID/);
  });

  test("uses the public validation code for a safe 400 record", () => {
    const write = vi.fn<(line: string) => void>();
    const logger = new JsonLogger({ now: () => NOW, write });

    logger.logRequest({
      durationMs: 1,
      internalError: false,
      method: "GET",
      requestId: REQUEST_ID,
      route: "/api/v1/countries",
      spanId: SPAN_ID,
      status: 400,
      traceId: TRACE_ID,
    });

    expect(JSON.parse(write.mock.calls[0]?.[0] ?? "null")).toMatchObject({
      errorCode: "VALIDATION_ERROR",
      status: 400,
    });
  });

  test("emits a fixed JSON bootstrap event and suppresses sink failures", () => {
    const lines: string[] = [];
    const logger = new JsonLogger({
      now: () => NOW,
      write: (line) => lines.push(line),
    });

    logger.logBootstrapFailure();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      timestamp: NOW.toISOString(),
      level: "error",
      event: "api_bootstrap_failed",
    });
    expect(() =>
      new JsonLogger({
        now: () => NOW,
        write: () => {
          throw new Error("SINK_PRIVATE_FAILURE");
        },
      }).logBootstrapFailure(),
    ).not.toThrow();
  });

  test("absorbs an asynchronous sink rejection", async () => {
    const logger = new JsonLogger({
      now: () => NOW,
      write: () => Promise.reject(new Error("ASYNC_SINK_PRIVATE_FAILURE")),
    });

    expect(() => logger.logBootstrapFailure()).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
