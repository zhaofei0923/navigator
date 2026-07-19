import {
  HttpException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import {
  DatabaseUnavailableError,
  DataIntegrityError,
} from "@navigator/db/country-read-runtime";
import { catchError, type Observable, throwError } from "rxjs";

import {
  JsonLogger,
  type InternalErrorClassification,
} from "./json-logger.js";
import type {
  HttpMetricErrorCode,
  MetricsRecorder,
} from "./metrics-registry.js";
import {
  createRequestContext,
  runWithRequestContext,
  type RequestContextEntropy,
} from "./request-context.js";

const REQUEST_OBSERVATION = Symbol("REQUEST_OBSERVATION");

type HttpMethod = "GET" | "OTHER";
type HttpRoute =
  | "/health/live"
  | "/health/ready"
  | "/api/v1/countries"
  | "/api/v1/countries/:code"
  | "/api/v1/countries/:code/modules/:moduleKey"
  | "UNMATCHED";

interface RequestObservation {
  internalError: InternalErrorClassification | null;
  route: HttpRoute;
}

interface ObservableHttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly method?: unknown;
  readonly route?: { readonly path?: unknown } | undefined;
  [REQUEST_OBSERVATION]?: RequestObservation;
}

interface ObservableHttpResponse {
  readonly statusCode?: unknown;
  readonly writableFinished?: unknown;
  getHeader(name: string): unknown;
  once(event: "close" | "finish", listener: () => void): unknown;
  setHeader(name: string, value: string): unknown;
}

export interface ObservabilityInterceptorOptions {
  readonly entropy?: RequestContextEntropy | undefined;
  readonly logger?: JsonLogger | undefined;
  readonly metrics?: MetricsRecorder | undefined;
  readonly monotonicNow?: (() => number) | undefined;
}

export class ObservabilityInterceptor implements NestInterceptor {
  private readonly entropy: RequestContextEntropy | undefined;
  private readonly logger: JsonLogger;
  private readonly metrics: MetricsRecorder | undefined;
  private readonly monotonicNow: () => number;

  constructor(options: ObservabilityInterceptorOptions = {}) {
    this.entropy = options.entropy;
    this.logger = options.logger ?? new JsonLogger();
    this.metrics = options.metrics;
    this.monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  }

  readonly middleware = (
    request: ObservableHttpRequest,
    response: ObservableHttpResponse,
    next: () => void,
  ): void => {
    const context = createRequestContext(
      {
        requestId: request.headers["x-request-id"],
        traceparent: request.headers.traceparent,
      },
      this.entropy,
    );
    const observation: RequestObservation = {
      internalError: null,
      route: "UNMATCHED",
    };
    Object.defineProperty(request, REQUEST_OBSERVATION, {
      configurable: false,
      enumerable: false,
      value: observation,
      writable: false,
    });

    response.setHeader("x-request-id", context.requestId);
    response.setHeader("traceparent", context.traceparent);
    const startedAt = this.readMonotonicClock();
    let logged = false;
    const logOnce = (terminalEvent: "close" | "finish"): void => {
      if (logged) return;
      logged = true;
      const aborted =
        terminalEvent === "close" && response.writableFinished !== true;
      const status = aborted ? 499 : normalizeStatus(response.statusCode);
      const internalError =
        !aborted && status === 500
          ? observation.internalError ?? "unexpected"
          : false;
      const durationMs = Math.max(
        0,
        this.readMonotonicClock() - startedAt,
      );
      const method = normalizeMethod(request.method);
      this.recordHttpMetric({
        durationMs,
        errorCode: errorCodeForStatus(status),
        method,
        route: observation.route,
        status,
      });
      runWithRequestContext(context, () => {
        this.logger.logRequest({
          aborted,
          cacheState: normalizeCacheState(
            response.getHeader("x-navigator-cache"),
          ),
          durationMs,
          internalError,
          method,
          requestId: context.requestId,
          route: observation.route,
          spanId: context.spanId,
          status,
          traceId: context.traceId,
        });
      });
    };
    response.once("finish", () => logOnce("finish"));
    response.once("close", () => logOnce("close"));

    try {
      runWithRequestContext(context, next);
    } catch (error) {
      observation.internalError = classifyInternalError(error);
      throw error;
    }
  };

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = executionContext
      .switchToHttp()
      .getRequest<ObservableHttpRequest>();
    const observation = request[REQUEST_OBSERVATION];
    if (observation !== undefined) {
      observation.route = normalizeRoute(request.route?.path);
    }

    let result: Observable<unknown>;
    try {
      result = next.handle();
    } catch (error) {
      if (observation !== undefined) {
        observation.internalError = classifyInternalError(error);
      }
      throw error;
    }
    return result.pipe(
      catchError((error: unknown) => {
        if (observation !== undefined) {
          observation.internalError = classifyInternalError(error);
        }
        return throwError(() => error);
      }),
    );
  }

  private readMonotonicClock(): number {
    const value = this.monotonicNow();
    return Number.isFinite(value) ? value : 0;
  }

  private recordHttpMetric(metric: {
    readonly durationMs: number;
    readonly errorCode: HttpMetricErrorCode | undefined;
    readonly method: HttpMethod;
    readonly route: HttpRoute;
    readonly status: number;
  }): void {
    if (this.metrics === undefined) return;
    try {
      const common = {
        durationSeconds: metric.durationMs / 1_000,
        method: metric.method,
        route: metric.route,
        status: metric.status,
      } as const;
      this.metrics.recordHttpRequest(
        metric.errorCode === undefined
          ? common
          : { ...common, errorCode: metric.errorCode },
      );
    } catch {
      // Observability must never change the request outcome.
    }
  }
}

function errorCodeForStatus(
  status: number,
): HttpMetricErrorCode | undefined {
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 404) return "NOT_FOUND";
  if (status === 500) return "INTERNAL_ERROR";
  return undefined;
}

function classifyInternalError(error: unknown): InternalErrorClassification {
  if (error instanceof DatabaseUnavailableError) return "database_unavailable";
  if (error instanceof DataIntegrityError) return "data_integrity";
  if (error instanceof HttpException) return "http_exception";
  return "unexpected";
}

function normalizeRoute(value: unknown): HttpRoute {
  switch (value) {
    case "/health/live":
    case "/health/ready":
    case "/api/v1/countries":
    case "/api/v1/countries/:code":
    case "/api/v1/countries/:code/modules/:moduleKey":
      return value;
    case "/countries":
      return "/api/v1/countries";
    case "/countries/:code":
      return "/api/v1/countries/:code";
    case "/countries/:code/modules/:moduleKey":
      return "/api/v1/countries/:code/modules/:moduleKey";
    default:
      return "UNMATCHED";
  }
}

function normalizeMethod(value: unknown): HttpMethod {
  return value === "GET" ? value : "OTHER";
}

function normalizeStatus(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  ) {
    return value;
  }
  return 500;
}

function normalizeCacheState(
  value: unknown,
): "hit" | "miss" | "stale" | undefined {
  return value === "hit" || value === "miss" || value === "stale"
    ? value
    : undefined;
}
