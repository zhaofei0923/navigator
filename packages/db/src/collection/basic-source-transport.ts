import {
  BASIC_SOURCE_MAX_REDIRECTS,
  type BasicSourceRequest,
  type BasicSourceTransport,
  type BasicSourceTransportResponse,
} from "./basic-source-adapter-contracts.js";

export interface BasicSourceFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type BasicSourceFetch = (
  url: string,
  init: {
    method: "GET";
    headers: { Accept: string };
    redirect: "manual";
  },
) => Promise<BasicSourceFetchResponse>;

export function createBasicSourceTransport(
  fetchImpl: BasicSourceFetch,
  now: () => Date = () => new Date(),
): BasicSourceTransport {
  return {
    async execute(request): Promise<BasicSourceTransportResponse> {
      validateRequestPolicy(request);
      let currentUrl = validateUrl(request.url, request, "request");
      const redirectChain: string[] = [];

      for (;;) {
        const response = await fetchImpl(currentUrl.href, {
          method: "GET",
          headers: { Accept: request.accept },
          redirect: "manual",
        });
        if (isRedirect(response.status)) {
          if (redirectChain.length >= BASIC_SOURCE_MAX_REDIRECTS) {
            throw new Error("source redirect limit exceeded");
          }
          const location = response.headers.get("location");
          if (location === null) {
            throw new Error("source redirect URL is not allowed");
          }
          currentUrl = validateRedirectUrl(location, currentUrl, request);
          redirectChain.push(currentUrl.href);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error("source response status is not allowed");
        }
        const contentType = response.headers.get("content-type");
        if (contentType === null || !isJsonContentType(contentType)) {
          throw new Error("source response content type is not allowed");
        }
        return {
          status: response.status,
          finalUrl: currentUrl.href,
          contentType,
          retrievedAt: now().toISOString(),
          redirectChain,
          body: streamBody(response.body),
        };
      }
    },
  };
}

function validateRequestPolicy(request: BasicSourceRequest): void {
  if (
    request.method !== "GET" ||
    request.accept !== "application/json" ||
    !isUniqueStringList(request.allowedOrigins) ||
    !isUniqueStringList(request.allowedQueryParameters) ||
    !request.allowedOrigins.every(isHttpsOrigin) ||
    !request.allowedQueryParameters.every(isSafeQueryName)
  ) {
    throw new Error("source request URL is not allowed");
  }
}

function validateUrl(
  value: string,
  request: BasicSourceRequest,
  phase: "request" | "redirect",
): URL {
  try {
    const url = new URL(value);
    if (!isAllowedUrl(url, request)) {
      throw new Error("invalid source URL");
    }
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

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isSafeQueryName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function isUniqueStringList(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

async function* streamBody(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<Uint8Array> {
  if (body === null) {
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      if (value !== undefined) {
        yield value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
