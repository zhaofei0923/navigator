import type { ApiCountryQuery } from "@navigator/shared-types/country-query";
import { validateWebEnv } from "@navigator/shared-types/env";
import type { ModuleKey } from "@navigator/shared-types/schema";

const UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const INTERNAL_ERROR_BODY = {
  error: {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  },
  success: false,
} as const;

type CountryApiProxyTarget =
  | { readonly kind: "list"; readonly query: ApiCountryQuery }
  | {
      readonly kind: "detail";
      readonly code: string;
      readonly query: ApiCountryQuery;
    }
  | {
      readonly kind: "module";
      readonly code: string;
      readonly moduleKey: ModuleKey;
      readonly query: ApiCountryQuery;
    };

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CountryApiProxyOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: Fetcher;
}

export async function proxyCountryApi(
  request: Request,
  target: CountryApiProxyTarget,
  options?: CountryApiProxyOptions,
): Promise<Response> {
  if (request.method !== "GET") {
    return internalErrorResponse();
  }

  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const config = validateWebEnv(options?.environment ?? process.env);
    const fetcher = options?.fetcher ?? globalThis.fetch;
    const url = buildUpstreamUrl(config.apiInternalBaseUrl, target);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error("UPSTREAM_TIMEOUT"));
      }, UPSTREAM_TIMEOUT_MS);
    });

    return await Promise.race([
      fetchAndConvertResponse(fetcher, url, request, abortController.signal),
      timeout,
    ]);
  } catch {
    abortController.abort();
    return internalErrorResponse();
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchAndConvertResponse(
  fetcher: Fetcher,
  url: string,
  request: Request,
  signal: AbortSignal,
): Promise<Response> {
  const upstream = await fetcher(url, {
    headers: forwardedRequestHeaders(request.headers),
    method: "GET",
    redirect: "manual",
    signal,
  });

  if (
    (upstream.status >= 300 && upstream.status < 400) ||
    !isJsonContentType(upstream.headers.get("content-type"))
  ) {
    cancelBodyBestEffort(upstream.body);
    throw new Error("UNSAFE_UPSTREAM_RESPONSE");
  }

  const body = await readBoundedJsonBytes(upstream);
  return new Response(body, {
    status: upstream.status,
    headers: forwardedResponseHeaders(upstream.headers),
  });
}

function forwardedRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  copyHeader(source, headers, "accept-language");
  copyHeader(source, headers, "traceparent");
  return headers;
}

function forwardedResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  copyHeader(source, headers, "content-type");
  copyHeader(source, headers, "traceparent");
  copyHeader(source, headers, "x-request-id");
  copyHeader(source, headers, "x-navigator-cache");
  copyHeader(source, headers, "x-navigator-data-stale");
  return headers;
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value !== null) {
    target.set(name, value);
  }
}

function buildUpstreamUrl(
  baseUrl: string,
  target: CountryApiProxyTarget,
): string {
  const path = targetPath(target).map(encodePathSegment).join("/");
  const searchParams = normalizedSearchParams(target.query);
  return `${baseUrl.replace(/\/+$/, "")}/${path}?${searchParams.toString()}`;
}

function encodePathSegment(value: string): string {
  if (value === "." || value === "..") {
    return value.replaceAll(".", "%252E");
  }
  return encodeURIComponent(value);
}

function targetPath(target: CountryApiProxyTarget): string[] {
  if (target.kind === "list") return ["countries"];
  if (target.kind === "detail") return ["countries", target.code];
  return ["countries", target.code, "modules", target.moduleKey];
}

function normalizedSearchParams(query: ApiCountryQuery): URLSearchParams {
  const { filters } = query;
  const searchParams = new URLSearchParams({
    locale: filters.locale ?? "zh-CN",
    page: String(filters.page ?? 1),
    pageSize: String(filters.pageSize ?? 20),
    textMode: query.textMode,
  });

  if (filters.coverageLevel !== undefined) {
    searchParams.set("coverageLevel", filters.coverageLevel);
  }
  if ((filters.industryTags?.length ?? 0) > 0) {
    searchParams.set("industryTags", filters.industryTags?.join(",") ?? "");
  }
  if (filters.region !== undefined) {
    searchParams.set("region", filters.region);
  }
  if ((filters.techTags?.length ?? 0) > 0) {
    searchParams.set("techTags", filters.techTags?.join(",") ?? "");
  }

  return searchParams;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" ||
    (mediaType?.startsWith("application/") === true && mediaType.endsWith("+json"));
}

async function readBoundedJsonBytes(response: Response): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    cancelBodyBestEffort(response.body);
    throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
  }
  if (response.body === null) {
    throw new Error("UPSTREAM_RESPONSE_MISSING_BODY");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReaderBestEffort(reader);
    throw error;
  }

  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return buffer;
}

function cancelBodyBestEffort(
  body: ReadableStream<Uint8Array> | null,
): void {
  if (body === null || body.locked) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cancellation is cleanup only; the fixed proxy error remains authoritative.
  }
}

function cancelReaderBestEffort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is cleanup only; the fixed proxy error remains authoritative.
  }
}

function internalErrorResponse(): Response {
  return Response.json(INTERNAL_ERROR_BODY, { status: 500 });
}
