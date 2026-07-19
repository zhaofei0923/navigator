import { EventEmitter } from "node:events";

import {
  Controller,
  Get,
  HttpException,
  type ExecutionContext,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DatabaseUnavailableError,
  DataIntegrityError,
} from "@navigator/db/country-read-runtime";
import { defer, lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, test } from "vitest";

import { ContractExceptionFilter } from "../common/contract-exception.filter.js";
import { JsonLogger } from "./json-logger.js";
import { ObservabilityInterceptor } from "./observability.interceptor.js";
import {
  getRequestContext,
  type RequestContextEntropy,
} from "./request-context.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID = "00f067aa0ba902b7";
const SPAN_ID = "2222222222222222";
const GENERATED_TRACE_ID = "11111111111111111111111111111111";
const GENERATED_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-19T08:00:00.000Z");

const entropy: RequestContextEntropy = {
  requestId: () => GENERATED_REQUEST_ID,
  spanId: () => SPAN_ID,
  traceId: () => GENERATED_TRACE_ID,
};

describe("observability middleware and interceptor", () => {
  test("sets safe trace headers before work and emits exactly one template-only log", async () => {
    const lines: string[] = [];
    const response = new FakeResponse();
    const request = requestFixture({
      headers: {
        authorization: "Bearer private-token",
        cookie: "session=private",
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
        "user-agent": "private-agent",
        "x-request-id": "request_id-123456",
      },
      method: "GET",
      route: { path: "/api/v1/countries/:code" },
      url: "/api/v1/countries/ID?email=person@example.com",
    });
    const observability = createObservability(lines, [100, 112.25]);
    let contextDuringWork: ReturnType<typeof getRequestContext>;

    await runThroughMiddleware(observability, request, response, async () => {
      const body = await lastValueFrom(
        observability.intercept(
          executionContext(request, response),
          {
            handle: () => defer(async () => {
              expect(response.getHeader("x-request-id")).toBe(
                "request_id-123456",
              );
              expect(response.getHeader("traceparent")).toBe(
                `00-${TRACE_ID}-${SPAN_ID}-01`,
              );
              await Promise.resolve();
              contextDuringWork = getRequestContext();
              response.setHeader("X-Navigator-Cache", "hit");
              return { ok: true };
            }),
          },
        ),
      );
      expect(body).toEqual({ ok: true });
      response.statusCode = 200;
      response.emit("finish");
      response.emit("close");
    });

    expect(contextDuringWork).toMatchObject({
      requestId: "request_id-123456",
      spanId: SPAN_ID,
      traceId: TRACE_ID,
    });
    expect(getRequestContext()).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      timestamp: NOW.toISOString(),
      level: "info",
      event: "http_request_completed",
      requestId: "request_id-123456",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      method: "GET",
      route: "/api/v1/countries/:code",
      status: 200,
      durationMs: 12.25,
      cacheState: "hit",
    });
    expect(lines[0]).not.toMatch(
      /\/ID|email|person@|private|authorization|cookie|user-agent|Bearer/i,
    );
  });

  test.each([
    [new DatabaseUnavailableError(), "http_request_internal_database_unavailable"],
    [new DataIntegrityError(), "http_request_internal_data_integrity"],
    [new HttpException("postgresql://user:secret@db.internal", 503), "http_request_internal_http_exception"],
    [new Error("SELECT secret FROM country /home/kevin/navigator"), "http_request_internal_unexpected"],
  ] as const)(
    "classifies a 500 without serializing the exception: %s",
    async (failure, expectedEvent) => {
      const lines: string[] = [];
      const response = new FakeResponse();
      const request = requestFixture({
        headers: {},
        method: "GET",
        route: { path: "/countries/:code/modules/:moduleKey" },
        url: "/api/v1/countries/VN/modules/policy?token=private",
      });
      const observability = createObservability(lines, [10, 18]);

      await runThroughMiddleware(observability, request, response, async () => {
        await expect(
          lastValueFrom(
            observability.intercept(
              executionContext(request, response),
              { handle: () => throwError(() => failure) },
            ),
          ),
        ).rejects.toBe(failure);
        expect(response.getHeader("x-request-id")).toBe(GENERATED_REQUEST_ID);
        expect(response.getHeader("traceparent")).toBe(
          `00-${GENERATED_TRACE_ID}-${SPAN_ID}-00`,
        );
        response.statusCode = 500;
        response.emit("finish");
      });

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "null")).toEqual({
        timestamp: NOW.toISOString(),
        level: "error",
        event: expectedEvent,
        requestId: GENERATED_REQUEST_ID,
        traceId: GENERATED_TRACE_ID,
        spanId: SPAN_ID,
        method: "GET",
        route: "/api/v1/countries/:code/modules/:moduleKey",
        status: 500,
        durationMs: 8,
        errorCode: "INTERNAL_ERROR",
      });
      expect(lines[0]).not.toMatch(
        /postgresql|secret|db\.internal|SELECT|\/home\/|token|private|policy|VN/i,
      );
    },
  );

  test("logs unmatched requests from middleware without reflecting path, query, or invalid headers", async () => {
    const lines: string[] = [];
    const response = new FakeResponse();
    const request = requestFixture({
      headers: {
        traceparent: [`00-${TRACE_ID}-${PARENT_SPAN_ID}-01`],
        "x-request-id": "attacker@example.com",
      },
      method: "BREW",
      url: "/api/v1/health/live/postgresql:user:secret?phone=13800138000",
    });
    const observability = createObservability(lines, [40, 43]);

    await runThroughMiddleware(observability, request, response, async () => {
      expect(response.getHeader("x-request-id")).toBe(GENERATED_REQUEST_ID);
      expect(response.getHeader("traceparent")).toBe(
        `00-${GENERATED_TRACE_ID}-${SPAN_ID}-00`,
      );
      response.statusCode = 404;
      response.writableFinished = true;
      response.emit("close");
      response.emit("finish");
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      errorCode: "NOT_FOUND",
      event: "http_request_completed",
      method: "OTHER",
      requestId: GENERATED_REQUEST_ID,
      route: "UNMATCHED",
      status: 404,
    });
    expect(lines[0]).not.toMatch(
      /health|postgresql|secret|phone|13800138000|attacker|example\.com|BREW/i,
    );
  });

  test("records an early close as one fixed aborted outcome instead of a success", async () => {
    const lines: string[] = [];
    const response = new FakeResponse();
    const request = requestFixture({
      headers: {},
      method: "GET",
      route: { path: "/countries" },
      url: "/api/v1/countries?country=ID",
    });
    const observability = createObservability(lines, [20, 24]);

    await runThroughMiddleware(observability, request, response, async () => {
      await lastValueFrom(
        observability.intercept(
          executionContext(request, response),
          { handle: () => of({ success: true }) },
        ),
      );
      response.statusCode = 200;
      response.writableFinished = false;
      response.emit("close");
      response.writableFinished = true;
      response.emit("finish");
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      event: "http_request_aborted",
      level: "info",
      route: "/api/v1/countries",
      status: 499,
    });
    expect(lines[0]).not.toContain("INTERNAL_ERROR");
  });

  test("does not classify an ordinary readiness 503 as an internal exception", async () => {
    const lines: string[] = [];
    const response = new FakeResponse();
    const request = requestFixture({
      headers: {},
      method: "GET",
      route: { path: "/health/ready" },
      url: "/health/ready",
    });
    const observability = createObservability(lines, [0, 1]);

    await runThroughMiddleware(observability, request, response, async () => {
      await lastValueFrom(
        observability.intercept(
          executionContext(request, response),
          { handle: () => of({ status: "not_ready" }) },
        ),
      );
      response.statusCode = 503;
      response.emit("finish");
    });

    const record = JSON.parse(lines[0] ?? "null") as Record<string, unknown>;
    expect(record).toMatchObject({
      event: "http_request_completed",
      level: "info",
      route: "/health/ready",
      status: 503,
    });
    expect(record).not.toHaveProperty("cacheState");
    expect(record).not.toHaveProperty("errorCode");
  });

  test("keeps the fixed 500 contract and classification through the real Nest lifecycle", async () => {
    const lines: string[] = [];
    const observability = createObservability(lines, [5, 7]);
    const module = await Test.createTestingModule({
      controllers: [FailingCountriesController],
    }).compile();
    const application = module.createNestApplication({ logger: false });
    application.setGlobalPrefix("api/v1");
    application.use(observability.middleware);
    application.useGlobalInterceptors(observability);
    application.useGlobalFilters(new ContractExceptionFilter());
    await application.listen(0, "127.0.0.1");

    try {
      const response = await fetch(`${httpOrigin(application)}/api/v1/countries`);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
        success: false,
      });
      expect(response.headers.get("x-request-id")).toBe(GENERATED_REQUEST_ID);
      expect(response.headers.get("traceparent")).toBe(
        `00-${GENERATED_TRACE_ID}-${SPAN_ID}-00`,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
        errorCode: "INTERNAL_ERROR",
        event: "http_request_internal_database_unavailable",
        route: "/api/v1/countries",
        status: 500,
      });
      expect(lines[0]).not.toMatch(
        /postgresql|private|db\.internal|SELECT|stack|cause/i,
      );
    } finally {
      await application.close();
    }
  });
});

@Controller("countries")
class FailingCountriesController {
  @Get()
  read(): never {
    const failure = new DatabaseUnavailableError() as DatabaseUnavailableError & {
      cause?: unknown;
    };
    failure.cause = new Error(
      "postgresql://user:private@db.internal SELECT secret stack",
    );
    throw failure;
  }
}

function createObservability(lines: string[], times: number[]) {
  return new ObservabilityInterceptor({
    entropy,
    logger: new JsonLogger({ now: () => NOW, write: (line) => lines.push(line) }),
    monotonicNow: () => times.shift() ?? 0,
  });
}

async function runThroughMiddleware(
  observability: ObservabilityInterceptor,
  request: FakeRequest,
  response: FakeResponse,
  work: () => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    observability.middleware(request, response, () => {
      void work().then(resolve, reject);
    });
  });
}

function executionContext(
  request: FakeRequest,
  response: FakeResponse,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getNext: () => undefined,
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function requestFixture(overrides: Partial<FakeRequest>): FakeRequest {
  return {
    headers: {},
    method: "GET",
    url: "/",
    ...overrides,
  };
}

function httpOrigin(application: INestApplication): string {
  const address = application.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
  }
  return `http://127.0.0.1:${address.port}`;
}

interface FakeRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method: string;
  readonly route?: { readonly path: unknown };
  readonly url: string;
}

class FakeResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  statusCode = 200;
  writableFinished = false;

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}
