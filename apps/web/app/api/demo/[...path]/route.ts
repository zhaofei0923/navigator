import { NextResponse } from "next/server";
import { hasValidDemoSession } from "@/lib/demo-session";
import { normalizeLocale, type SupportedLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

const COLLECTIONS = new Set([
  "meta",
  "countries",
  "policies",
  "risks",
  "opportunities",
  "tenders",
  "partners",
]);
const POST_ENDPOINTS = new Set([
  "country-comparisons",
  "demo/reset",
  "demo/country-comparisons",
  "demo/tools/assistant/preview",
  "demo/tools/solar-storage/preview",
  "demo/tools/feasibility-report/preview",
]);
const DEMO_GET_ENDPOINTS = new Set(["demo/globe-markers", "demo/tools/tenders"]);
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function resolveApiPath(path: string[], method: string): string | null {
  if (path.length === 1 && method === "GET" && COLLECTIONS.has(path[0])) {
    return `/api/v1/${path[0]}`;
  }
  if (
    path.length === 2 &&
    method === "GET" &&
    path[0] === "countries" &&
    SAFE_SEGMENT.test(path[1])
  ) {
    return `/api/v1/countries/${path[1]}`;
  }
  const joined = path.join("/");
  if (method === "GET" && DEMO_GET_ENDPOINTS.has(joined)) {
    return `/api/v1/${joined}`;
  }
  if (
    method === "GET" &&
    path.length === 4 &&
    path[0] === "demo" &&
    path[1] === "tools" &&
    path[2] === "tenders" &&
    SAFE_SEGMENT.test(path[3])
  ) {
    return `/api/v1/${joined}`;
  }
  if (method === "POST" && POST_ENDPOINTS.has(joined)) {
    return `/api/v1/${joined}`;
  }
  return null;
}

function apiBaseUrl(): URL {
  const url = new URL(process.env.DEMO_API_BASE_URL || "http://localhost:8000");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DEMO_API_BASE_URL must use http or https");
  }
  return url;
}

function copyAllowedQuery(source: URL, target: URL) {
  for (const key of ["country_code", "limit", "locale", "sector", "stage", "keyword"]) {
    const value = source.searchParams.get(key);
    if (value && value.length <= 120) target.searchParams.set(key, value);
  }
}

function proxyCopy(locale: SupportedLocale) {
  return locale === "en"
    ? {
        session: "The demo session has expired. Please sign in again.",
        unavailable: "This demo endpoint is unavailable.",
        configuration: "The synthetic-data service is not configured.",
        tooLarge: "The request is too large.",
        rejected: "The upstream response is not approved synthetic demo data and was blocked.",
        invalid: "The synthetic demo response is invalid.",
        connection: "The synthetic-data service is temporarily unavailable. Please try again.",
      }
    : {
        session: "演示会话已失效，请重新进入。",
        unavailable: "此演示接口不可用。",
        configuration: "演示数据服务尚未配置。",
        tooLarge: "请求内容过大。",
        rejected: "上游响应不是获准的合成演示数据，已拒绝显示。",
        invalid: "演示数据响应格式无效。",
        connection: "暂时无法连接演示数据服务，请稍后重试。",
      };
}

function proxyError(
  locale: SupportedLocale,
  status: number,
  code: string,
  message: string,
) {
  return NextResponse.json(
    {
      meta: {
        data_origin: "synthetic_demo",
        disclaimer:
          locale === "en"
            ? "Demo Data / Non-official Conclusions"
            : "演示数据 / 非正式结论",
        locale,
      },
      error: { code, message },
    },
    {
      status,
      headers: { "Cache-Control": "no-store, private" },
    },
  );
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

async function proxyRequest(request: Request, context: RouteContext) {
  const sourceUrl = new URL(request.url);
  const locale = normalizeLocale(sourceUrl.searchParams.get("locale"));
  const copy = proxyCopy(locale);
  if (!(await hasValidDemoSession())) {
    return proxyError(locale, 401, "DEMO_SESSION_EXPIRED", copy.session);
  }

  const { path } = await context.params;
  const apiPath = resolveApiPath(path, request.method);
  if (!apiPath) {
    return proxyError(locale, 404, "DEMO_ENDPOINT_NOT_ALLOWED", copy.unavailable);
  }

  const apiKey = process.env.DEMO_API_KEY?.trim();
  if (!apiKey) {
    return proxyError(locale, 503, "DEMO_API_NOT_CONFIGURED", copy.configuration);
  }

  let target: URL;
  try {
    target = new URL(apiPath, apiBaseUrl());
  } catch {
    return proxyError(locale, 503, "DEMO_API_NOT_CONFIGURED", copy.configuration);
  }
  copyAllowedQuery(sourceUrl, target);
  const headers = new Headers({
    Accept: "application/json",
    "X-Demo-Key": apiKey,
  });

  let body: string | undefined;
  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 16_384) {
      return proxyError(locale, 413, "DEMO_REQUEST_TOO_LARGE", copy.tooLarge);
    }
    const limitedBody = await readLimitedBody(request, 16_384);
    if (limitedBody === null) {
      return proxyError(locale, 413, "DEMO_REQUEST_TOO_LARGE", copy.tooLarge);
    }
    body = limitedBody;
    headers.set("Content-Type", "application/json");
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await upstream.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return proxyError(locale, 502, "DEMO_UPSTREAM_INVALID", copy.invalid);
    }

    if (upstream.ok) {
      const candidate = parsed as { meta?: { data_origin?: unknown } };
      if (candidate.meta?.data_origin !== "synthetic_demo") {
        return proxyError(locale, 502, "DEMO_UPSTREAM_NOT_SYNTHETIC", copy.rejected);
      }
    } else {
      const candidate = parsed as {
        meta?: { data_origin?: unknown };
        error?: { code?: unknown };
      };
      if (
        candidate.meta?.data_origin !== "synthetic_demo" ||
        typeof candidate.error?.code !== "string"
      ) {
        return proxyError(locale, 502, "DEMO_UPSTREAM_INVALID", copy.invalid);
      }
    }

    return NextResponse.json(parsed, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store, private",
      },
    });
  } catch {
    return proxyError(locale, 502, "DEMO_UPSTREAM_UNAVAILABLE", copy.connection);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}
