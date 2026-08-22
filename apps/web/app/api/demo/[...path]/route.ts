import { NextResponse } from "next/server";
import { hasValidDemoSession } from "@/lib/demo-session";

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
const POST_ENDPOINTS = new Set(["country-comparisons", "demo/reset"]);
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
  for (const key of ["country_code", "limit"]) {
    const value = source.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
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
  if (!(await hasValidDemoSession())) {
    return NextResponse.json({ error: "演示会话已失效，请重新进入。" }, { status: 401 });
  }

  const { path } = await context.params;
  const apiPath = resolveApiPath(path, request.method);
  if (!apiPath) {
    return NextResponse.json({ error: "此演示接口不可用。" }, { status: 404 });
  }

  const apiKey = process.env.DEMO_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "演示数据服务尚未配置。" }, { status: 503 });
  }

  const target = new URL(apiPath, apiBaseUrl());
  copyAllowedQuery(new URL(request.url), target);
  const headers = new Headers({
    Accept: "application/json",
    "X-Demo-Key": apiKey,
  });

  let body: string | undefined;
  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 16_384) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
    }
    const limitedBody = await readLimitedBody(request, 16_384);
    if (limitedBody === null) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
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

    if (upstream.ok) {
      try {
        const parsed = JSON.parse(payload) as { meta?: { data_origin?: unknown } };
        if (parsed.meta?.data_origin !== "synthetic_demo") {
          return NextResponse.json(
            { error: "上游响应不是获准的合成演示数据，已拒绝显示。" },
            { status: 502 },
          );
        }
      } catch {
        return NextResponse.json({ error: "演示数据响应格式无效。" }, { status: 502 });
      }
    }

    return new NextResponse(payload, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store, private",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "暂时无法连接演示数据服务，请稍后重试。" },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}
