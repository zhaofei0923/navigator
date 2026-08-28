import { NextResponse } from "next/server";
import { isBasic60Envelope } from "@/lib/basic60/contract";
import { hasValidBasic60Session } from "@/lib/basic60/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };
const SAFE_COUNTRY_CODE = /^[A-Za-z]{3}$/;
const ALLOWED_QUERY = new Set([
  "q",
  "region",
  "coverage_level",
  "as_of",
  "cursor",
  "limit",
  "expand",
  "locale",
]);

function resolveApiPath(path: string[], method: string): string | null {
  if (method === "GET" && path.length === 1 && path[0] === "countries") {
    return "/api/v1/countries";
  }
  if (
    method === "GET" &&
    path.length === 2 &&
    path[0] === "countries" &&
    SAFE_COUNTRY_CODE.test(path[1])
  ) {
    return `/api/v1/countries/${path[1].toUpperCase()}`;
  }
  return null;
}

function apiBaseUrl(): URL {
  const url = new URL(process.env.BASIC60_API_BASE_URL || "http://localhost:8001");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BASIC60_API_BASE_URL must use http or https");
  }
  return url;
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      meta: {
        release_id: null,
        release_profile: "basic60_private",
        formal_gate_status: "pending",
        coverage_level: "Basic",
        as_of: null,
      },
      error: { code, message },
    },
    { status, headers: { "Cache-Control": "no-store, private" } },
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
  if (!(await hasValidBasic60Session())) {
    return errorResponse(401, "BASIC60_SESSION_EXPIRED", "BASIC60 私有试用会话已结束。");
  }

  const { path } = await context.params;
  const apiPath = resolveApiPath(path, request.method);
  if (!apiPath) {
    return errorResponse(404, "BASIC60_ENDPOINT_NOT_ALLOWED", "此 BASIC60 接口不可用。");
  }

  const apiKey = process.env.BASIC60_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(503, "BASIC60_NOT_CONFIGURED", "BASIC60 私有数据服务尚未配置。");
  }

  let target: URL;
  try {
    target = new URL(apiPath, apiBaseUrl());
  } catch {
    return errorResponse(503, "BASIC60_NOT_CONFIGURED", "BASIC60 私有数据服务尚未配置。");
  }

  const source = new URL(request.url);
  for (const [key, value] of source.searchParams) {
    if (ALLOWED_QUERY.has(key) && value.length <= 240) target.searchParams.append(key, value);
  }

  const headers = new Headers({
    Accept: "application/json",
    "X-Private-Trial-Key": apiKey,
  });
  let body: string | undefined;
  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 16_384) {
      return errorResponse(413, "BASIC60_REQUEST_TOO_LARGE", "请求内容过大。");
    }
    const limitedBody = await readLimitedBody(request, 16_384);
    if (limitedBody === null) {
      return errorResponse(413, "BASIC60_REQUEST_TOO_LARGE", "请求内容过大。");
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
    const payload = (await upstream.json()) as unknown;
    if (upstream.ok && !isBasic60Envelope(payload)) {
      return errorResponse(
        502,
        "BASIC60_RELEASE_REJECTED",
        "已阻止不属于获准 BASIC60 私有试用版本的响应。",
      );
    }
    if (!upstream.ok) {
      const code =
        typeof payload === "object" && payload !== null &&
        "error" in payload && typeof payload.error === "object" && payload.error !== null &&
        "code" in payload.error && typeof payload.error.code === "string"
          ? payload.error.code
          : "BASIC60_UPSTREAM_INVALID";
      return errorResponse(upstream.status, code, "BASIC60 私有数据请求未完成。");
    }
    return NextResponse.json(payload, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return errorResponse(502, "BASIC60_UPSTREAM_UNAVAILABLE", "BASIC60 私有数据服务暂时不可用。");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}
