export type InternalErrorClassification =
  | "database_unavailable"
  | "data_integrity"
  | "http_exception"
  | "unexpected";

export type RequestInternalError =
  | false
  | true
  | InternalErrorClassification;

export type RequestLogMethod = "GET" | "OTHER";

export type RequestLogRoute =
  | "/health/live"
  | "/health/ready"
  | "/api/v1/countries"
  | "/api/v1/countries/:code"
  | "/api/v1/countries/:code/modules/:moduleKey"
  | "UNMATCHED";

export interface RequestLogInput {
  readonly aborted?: boolean | undefined;
  readonly cacheState?: "hit" | "miss" | "stale" | undefined;
  readonly durationMs: number;
  readonly internalError: RequestInternalError;
  readonly method: RequestLogMethod;
  readonly requestId: string;
  readonly route: RequestLogRoute;
  readonly spanId: string;
  readonly status: number;
  readonly traceId: string;
}

export interface JsonLoggerOptions {
  readonly now?: (() => Date) | undefined;
  readonly write?: ((line: string) => unknown) | undefined;
}

const INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

export class JsonLogger {
  private readonly now: () => Date;
  private readonly write: (line: string) => unknown;

  constructor(options: JsonLoggerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  logRequest(input: RequestLogInput): void {
    const aborted = input.aborted === true;
    const internalEvent = aborted
      ? undefined
      : getInternalEvent(input.internalError);
    const errorCode = aborted
      ? undefined
      : getErrorCode(input.status, internalEvent !== undefined);
    const cacheState = normalizeCacheState(input.cacheState);
    const record = {
      timestamp: this.now().toISOString(),
      level: internalEvent === undefined ? "info" : "error",
      event: aborted
        ? "http_request_aborted"
        : internalEvent ?? "http_request_completed",
      requestId: input.requestId,
      traceId: input.traceId,
      spanId: input.spanId,
      method: normalizeMethod(input.method),
      route: normalizeRoute(input.route),
      status: input.status,
      durationMs: input.durationMs,
      ...(cacheState === undefined ? {} : { cacheState }),
      ...(errorCode === undefined ? {} : { errorCode }),
    };

    this.emit(record);
  }

  logBootstrapFailure(): void {
    this.emit({
      timestamp: this.now().toISOString(),
      level: "error",
      event: "api_bootstrap_failed",
    });
  }

  private emit(record: Readonly<Record<string, unknown>>): void {
    try {
      const result = this.write(`${JSON.stringify(record)}\n`);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Logging must never replace the application failure being diagnosed.
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

function getInternalEvent(
  classification: RequestInternalError,
): string | undefined {
  switch (classification) {
    case false:
      return undefined;
    case true:
      return "http_request_internal_error";
    case "database_unavailable":
    case "data_integrity":
    case "http_exception":
    case "unexpected":
      return `http_request_internal_${classification}`;
    default:
      return "http_request_internal_unexpected";
  }
}

function getErrorCode(
  status: number,
  isInternalError: boolean,
): string | undefined {
  if (isInternalError) {
    return INTERNAL_ERROR_CODE;
  }
  if (status === 400) {
    return "VALIDATION_ERROR";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  return undefined;
}

function normalizeCacheState(
  value: unknown,
): "hit" | "miss" | "stale" | undefined {
  return value === "hit" || value === "miss" || value === "stale"
    ? value
    : undefined;
}

function normalizeMethod(value: unknown): RequestLogMethod {
  return value === "GET" ? value : "OTHER";
}

function normalizeRoute(value: unknown): RequestLogRoute {
  switch (value) {
    case "/health/live":
    case "/health/ready":
    case "/api/v1/countries":
    case "/api/v1/countries/:code":
    case "/api/v1/countries/:code/modules/:moduleKey":
      return value;
    default:
      return "UNMATCHED";
  }
}
