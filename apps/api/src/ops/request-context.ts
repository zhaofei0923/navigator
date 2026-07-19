import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

const GENERATION_ATTEMPTS = 8;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const TRACEPARENT_PATTERN =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

export interface RequestContext {
  readonly requestId: string;
  readonly spanId: string;
  readonly traceFlags: string;
  readonly traceId: string;
  readonly traceparent: string;
}

export interface RequestContextEntropy {
  readonly requestId: () => string;
  readonly spanId: () => string;
  readonly traceId: () => string;
}

export interface RequestContextHeaders {
  readonly requestId?: unknown;
  readonly traceparent?: unknown;
}

interface ParsedTraceparent {
  readonly parentSpanId: string;
  readonly traceFlags: string;
  readonly traceId: string;
}

const secureEntropy: RequestContextEntropy = Object.freeze({
  requestId: randomUUID,
  spanId: () => randomBytes(8).toString("hex"),
  traceId: () => randomBytes(16).toString("hex"),
});

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  headers: RequestContextHeaders,
  entropy: RequestContextEntropy = secureEntropy,
): RequestContext {
  const parsedTraceparent = parseTraceparent(headers.traceparent);
  const requestId = isSafeRequestId(headers.requestId)
    ? headers.requestId
    : generateSafeValue(
        entropy.requestId,
        secureEntropy.requestId,
        isSafeRequestId,
      );
  const traceId =
    parsedTraceparent?.traceId ??
    generateSafeValue(entropy.traceId, secureEntropy.traceId, isSafeTraceId);
  const spanId = generateSafeValue(
    entropy.spanId,
    secureEntropy.spanId,
    (candidate): candidate is string =>
      isSafeSpanId(candidate) && candidate !== parsedTraceparent?.parentSpanId,
  );
  const traceFlags = parsedTraceparent?.traceFlags ?? "00";

  return Object.freeze({
    requestId,
    spanId,
    traceFlags,
    traceId,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  });
}

export function runWithRequestContext<T>(
  context: RequestContext,
  work: () => T,
): T {
  return requestContextStorage.run(context, work);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

function parseTraceparent(value: unknown): ParsedTraceparent | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = TRACEPARENT_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }

  const traceId = match[1];
  const parentSpanId = match[2];
  const traceFlags = match[3];
  if (
    traceId === undefined ||
    parentSpanId === undefined ||
    traceFlags === undefined ||
    !isSafeTraceId(traceId) ||
    !isSafeSpanId(parentSpanId)
  ) {
    return undefined;
  }

  return { parentSpanId, traceFlags, traceId };
}

function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function isSafeTraceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TRACE_ID_PATTERN.test(value) &&
    value !== ZERO_TRACE_ID
  );
}

function isSafeSpanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SPAN_ID_PATTERN.test(value) &&
    value !== ZERO_SPAN_ID
  );
}

function generateSafeValue(
  requestedGenerator: () => string,
  fallbackGenerator: () => string,
  validate: (candidate: unknown) => candidate is string,
): string {
  const requested = attemptGeneration(requestedGenerator, validate);
  if (requested !== undefined) {
    return requested;
  }

  const fallback = attemptGeneration(fallbackGenerator, validate);
  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error("Unable to generate a safe request context identifier");
}

function attemptGeneration(
  generator: () => string,
  validate: (candidate: unknown) => candidate is string,
): string | undefined {
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const candidate: unknown = generator();
      if (validate(candidate)) {
        return candidate;
      }
    } catch {
      // A custom entropy source is untrusted; secure fallback is attempted below.
    }
  }

  return undefined;
}
