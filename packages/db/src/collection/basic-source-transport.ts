import {
  BASIC_SOURCE_MAX_REDIRECTS,
  type BasicSourceRequest,
  type BasicSourceTransport,
  type BasicSourceTransportResponse,
} from "./basic-source-adapter-contracts.js";
import { snapshotBasicSourceRequest, snapshotBasicSourceTransportResponse } from "./basic-source-metadata.js";

export interface BasicSourceFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type BasicSourceFetch = (
  url: string,
  init: { method: "GET"; headers: { Accept: string }; redirect: "manual" },
) => Promise<BasicSourceFetchResponse>;

export function createBasicSourceTransport(
  fetchImpl: BasicSourceFetch,
  now: () => Date = () => new Date(),
): BasicSourceTransport {
  return {
    async execute(value): Promise<BasicSourceTransportResponse> {
      const request = snapshotRequestForTransport(value);
      if (!isRequestSnapshotAllowed(request)) {
        throw new Error("source request URL is not allowed");
      }
      let currentUrl = validateUrl(request.url, request, "request");
      const redirectChain: string[] = [];
      for (;;) {
        const response = await executeFetch(fetchImpl, currentUrl.href, request);
        const status = readResponseStatus(response);
        if (isRedirect(status)) {
          if (redirectChain.length >= BASIC_SOURCE_MAX_REDIRECTS) {
            throw new Error("source redirect limit exceeded");
          }
          const location = readResponseHeader(
            response,
            "location",
            "source redirect URL is not allowed",
          );
          if (location === null) {
            throw new Error("source redirect URL is not allowed");
          }
          currentUrl = validateRedirectUrl(location, currentUrl, request);
          redirectChain.push(currentUrl.href);
          continue;
        }
        if (!isSuccessfulHttpStatus(status)) {
          throw new Error("source response status is not allowed");
        }
        const contentType = readResponseHeader(
          response,
          "content-type",
          "source response content type is not allowed",
        );
        if (contentType === null || !isJsonContentType(contentType)) {
          throw new Error("source response content type is not allowed");
        }
        const body = readResponseBody(response);
        try {
          return snapshotBasicSourceTransportResponse({
            status,
            finalUrl: currentUrl.href,
            contentType,
            retrievedAt: readCurrentTimestamp(now),
            redirectChain,
            body: streamBody(body),
          });
        } catch {
          throw new Error("source response metadata is invalid");
        }
      }
    },
  };
}

export function isBasicSourceRequestAllowed(value: BasicSourceRequest): boolean {
  try {
    return isRequestSnapshotAllowed(snapshotBasicSourceRequest(value));
  } catch {
    return false;
  }
}

export function isBasicSourceResponseAllowed(
  response: Pick<
    BasicSourceTransportResponse,
    "status" | "finalUrl" | "contentType" | "redirectChain"
  >,
  request: BasicSourceRequest,
): boolean {
  const expectedFinalUrl = response.redirectChain.at(-1) ?? request.url;
  return (
    isSuccessfulHttpStatus(response.status) &&
    isJsonContentType(response.contentType) &&
    response.redirectChain.length <= BASIC_SOURCE_MAX_REDIRECTS &&
    sameCanonicalUrl(response.finalUrl, expectedFinalUrl) &&
    isAllowedUrlString(response.finalUrl, request) &&
    response.redirectChain.every((url) => isAllowedUrlString(url, request))
  );
}

function snapshotRequestForTransport(value: unknown): BasicSourceRequest {
  try {
    return snapshotBasicSourceRequest(value);
  } catch {
    throw new Error("source request URL is not allowed");
  }
}

async function executeFetch(
  fetchImpl: BasicSourceFetch,
  url: string,
  request: BasicSourceRequest,
): Promise<BasicSourceFetchResponse> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { Accept: request.accept },
      redirect: "manual",
    });
  } catch {
    throw new Error("source fetch failed");
  }
}

function readResponseStatus(response: BasicSourceFetchResponse): number {
  try {
    const status: unknown = response.status;
    if (typeof status !== "number") throw new Error("invalid status");
    return status;
  } catch {
    throw new Error("source response status is not allowed");
  }
}

function readResponseHeader(
  response: BasicSourceFetchResponse,
  name: string,
  errorMessage: string,
): string | null {
  try {
    const headers: unknown = response.headers;
    if ((typeof headers !== "object" && typeof headers !== "function") || headers === null) {
      throw new Error("invalid headers");
    }
    const get: unknown = Reflect.get(headers, "get");
    if (typeof get !== "function") throw new Error("invalid headers");
    const value: unknown = Reflect.apply(get, headers, [name]);
    if (value !== null && typeof value !== "string") {
      throw new Error("invalid header");
    }
    return value;
  } catch {
    throw new Error(errorMessage);
  }
}

function readResponseBody(response: BasicSourceFetchResponse): ReadableStream<Uint8Array> | null {
  try {
    const body: unknown = response.body;
    if (body !== null && typeof body !== "object") {
      throw new Error("invalid body");
    }
    return body as ReadableStream<Uint8Array> | null;
  } catch {
    throw new Error("source response body read failed");
  }
}

function readCurrentTimestamp(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    throw new Error("source response timestamp is invalid");
  }
}

function isRequestSnapshotAllowed(request: BasicSourceRequest): boolean {
  return (
    request.method === "GET" &&
    request.accept === "application/json" &&
    new Set(request.allowedOrigins).size === request.allowedOrigins.length &&
    new Set(request.allowedQueryParameters).size ===
      request.allowedQueryParameters.length &&
    request.allowedOrigins.every(isHttpsOrigin) &&
    request.allowedQueryParameters.every(isSafeQueryName) &&
    isAllowedUrlString(request.url, request)
  );
}

function validateUrl(
  value: string,
  request: BasicSourceRequest,
  phase: "request" | "redirect",
): URL {
  try {
    const url = new URL(value);
    if (!isAllowedUrl(url, request)) throw new Error("invalid source URL");
    return url;
  } catch {
    throw new Error(`source ${phase} URL is not allowed`);
  }
}

function validateRedirectUrl(
  location: string,
  currentUrl: URL,
  request: BasicSourceRequest,
): URL {
  try {
    return validateUrl(new URL(location, currentUrl).href, request, "redirect");
  } catch {
    throw new Error("source redirect URL is not allowed");
  }
}

function isAllowedUrl(url: URL, request: BasicSourceRequest): boolean {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !request.allowedOrigins.includes(url.origin)
  ) {
    return false;
  }
  const names = new Set<string>();
  for (const [name] of url.searchParams) {
    if (!request.allowedQueryParameters.includes(name) || names.has(name)) {
      return false;
    }
    names.add(name);
  }
  return true;
}

function isAllowedUrlString(value: string, request: BasicSourceRequest): boolean {
  try {
    return isAllowedUrl(new URL(value), request);
  } catch {
    return false;
  }
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isSafeQueryName(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value); }
function isRedirect(status: number): boolean { return [301, 302, 303, 307, 308].includes(status); }
function isSuccessfulHttpStatus(status: number): boolean { return Number.isInteger(status) && status >= 200 && status <= 299; }

function sameCanonicalUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

async function* streamBody(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<Uint8Array> {
  if (body === null) return;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } catch {
    throw new Error("source response body read failed");
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Lower-layer reader errors must never replace the redacted boundary error.
    }
  }
}
