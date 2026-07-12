import {
  snapshotBasicSourceRequestV2,
  snapshotBasicSourceTransportResponseV2,
} from "./basic-source-metadata-v2.js";
import {
  BASIC_SOURCE_MAX_REDIRECTS_V2,
  type BasicSourceAcceptV2,
  type BasicSourceRequestV2,
  type BasicSourceTransportResponseV2,
  type BasicSourceTransportV2,
} from "./basic-source-v2-contracts.js";

export interface BasicSourceFetchResponseV2 {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type BasicSourceFetchV2 = (
  url: string,
  init: {
    method: "GET";
    headers: { Accept: BasicSourceAcceptV2 };
    redirect: "manual";
  },
) => Promise<BasicSourceFetchResponseV2>;

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUOTED_STRING = /^"(?:[\t !#-\[\]-~]|\\[\t !-~])*"$/;
const ALLOWED_CONTENT_TYPES: Readonly<
  Record<BasicSourceAcceptV2, (mediaType: string) => boolean>
> = Object.freeze({
  "application/json": (value) =>
    value === "application/json" ||
    /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(value),
  "text/csv": (value) => value === "text/csv",
  "text/html": (value) => value === "text/html",
  "application/pdf": (value) => value === "application/pdf",
});

export function createBasicSourceTransportV2(
  fetchImpl: BasicSourceFetchV2,
  now: () => Date = () => new Date(),
): BasicSourceTransportV2 {
  return Object.freeze({
    async execute(
      value: BasicSourceRequestV2,
    ): Promise<BasicSourceTransportResponseV2> {
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
          if (redirectChain.length >= BASIC_SOURCE_MAX_REDIRECTS_V2) {
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
        if (
          contentType === null ||
          !isAllowedContentType(contentType, request.accept)
        ) {
          throw new Error("source response content type is not allowed");
        }
        const body = readResponseBody(response);
        const retrievedAt = readCurrentTimestamp(now);
        try {
          return snapshotBasicSourceTransportResponseV2({
            status,
            finalUrl: currentUrl.href,
            contentType,
            retrievedAt,
            redirectChain,
            body: streamBody(body),
          });
        } catch {
          throw new Error("source response metadata is invalid");
        }
      }
    },
  });
}

export function isBasicSourceRequestAllowedV2(
  value: BasicSourceRequestV2,
): boolean {
  try {
    return isRequestSnapshotAllowed(snapshotBasicSourceRequestV2(value));
  } catch {
    return false;
  }
}

export function isBasicSourceResponseAllowedV2(
  response: Pick<
    BasicSourceTransportResponseV2,
    "status" | "finalUrl" | "contentType" | "redirectChain"
  >,
  request: BasicSourceRequestV2,
): boolean {
  try {
    const safeRequest = snapshotBasicSourceRequestV2(request);
    const expectedFinalUrl = response.redirectChain.at(-1) ?? safeRequest.url;
    return (
      isRequestSnapshotAllowed(safeRequest) &&
      isSuccessfulHttpStatus(response.status) &&
      isAllowedContentType(response.contentType, safeRequest.accept) &&
      response.redirectChain.length <= BASIC_SOURCE_MAX_REDIRECTS_V2 &&
      sameCanonicalUrl(response.finalUrl, expectedFinalUrl) &&
      isAllowedUrlString(response.finalUrl, safeRequest) &&
      response.redirectChain.every((url) =>
        isAllowedUrlString(url, safeRequest))
    );
  } catch {
    return false;
  }
}

function snapshotRequestForTransport(value: unknown): BasicSourceRequestV2 {
  try {
    return snapshotBasicSourceRequestV2(value);
  } catch {
    throw new Error("source request URL is not allowed");
  }
}

async function executeFetch(
  fetchImpl: BasicSourceFetchV2,
  url: string,
  request: BasicSourceRequestV2,
): Promise<BasicSourceFetchResponseV2> {
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

function readResponseStatus(response: BasicSourceFetchResponseV2): number {
  try {
    const status: unknown = response.status;
    if (typeof status !== "number") throw new Error("invalid status");
    return status;
  } catch {
    throw new Error("source response status is not allowed");
  }
}

function readResponseHeader(
  response: BasicSourceFetchResponseV2,
  name: string,
  errorMessage: string,
): string | null {
  try {
    const headers: unknown = response.headers;
    if (
      (typeof headers !== "object" && typeof headers !== "function") ||
      headers === null
    ) throw new Error("invalid headers");
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

function readResponseBody(
  response: BasicSourceFetchResponseV2,
): ReadableStream<Uint8Array> | null {
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

function isRequestSnapshotAllowed(request: BasicSourceRequestV2): boolean {
  return (
    request.method === "GET" &&
    Object.hasOwn(ALLOWED_CONTENT_TYPES, request.accept) &&
    new Set(request.allowedOrigins).size === request.allowedOrigins.length &&
    new Set(request.allowedQueryParameters).size ===
      request.allowedQueryParameters.length &&
    request.allowedOrigins.every(isHttpsOrigin) &&
    isAllowedUrlString(request.url, request)
  );
}

function validateUrl(
  value: string,
  request: BasicSourceRequestV2,
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
  request: BasicSourceRequestV2,
): URL {
  try {
    if (location !== location.trim()) throw new Error("invalid source URL");
    return validateUrl(new URL(location, currentUrl).href, request, "redirect");
  } catch {
    throw new Error("source redirect URL is not allowed");
  }
}

function isAllowedUrl(url: URL, request: BasicSourceRequestV2): boolean {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !request.allowedOrigins.includes(url.origin)
  ) return false;
  const names = new Set<string>();
  for (const [name] of url.searchParams) {
    if (!request.allowedQueryParameters.includes(name) || names.has(name)) {
      return false;
    }
    names.add(name);
  }
  return true;
}

function isAllowedUrlString(
  value: string,
  request: BasicSourceRequestV2,
): boolean {
  try {
    return value === value.trim() && isAllowedUrl(new URL(value), request);
  } catch {
    return false;
  }
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return value === value.trim() &&
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === "";
  } catch {
    return false;
  }
}

function isAllowedContentType(
  value: unknown,
  accept: BasicSourceAcceptV2,
): value is string {
  const mediaType = normalizedMediaType(value);
  return mediaType !== null && ALLOWED_CONTENT_TYPES[accept](mediaType);
}

function normalizedMediaType(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.includes(",")
  ) return null;
  const parts = value.split(";");
  const mediaType = parts.shift();
  if (mediaType === undefined) return null;
  const slash = mediaType.indexOf("/");
  if (slash <= 0 || slash !== mediaType.lastIndexOf("/")) return null;
  const type = mediaType.slice(0, slash);
  const subtype = mediaType.slice(slash + 1);
  if (
    !TOKEN.test(type) ||
    !TOKEN.test(subtype) ||
    !parts.every(isParameter)
  ) return null;
  return `${type.toLowerCase()}/${subtype.toLowerCase()}`;
}

function isParameter(value: string): boolean {
  const parameter = value.trim();
  const equals = parameter.indexOf("=");
  if (equals <= 0) return false;
  const name = parameter.slice(0, equals);
  const parameterValue = parameter.slice(equals + 1);
  return TOKEN.test(name) &&
    (TOKEN.test(parameterValue) || QUOTED_STRING.test(parameterValue));
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isSuccessfulHttpStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status <= 299;
}

function sameCanonicalUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
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
      // Reader cleanup must not replace the stable boundary error.
    }
  }
}
