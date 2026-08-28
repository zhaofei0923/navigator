import { NextResponse } from "next/server";
import {
  BASIC60_COOKIE_NAME,
  BASIC60_COOKIE_PATH,
  BASIC60_SESSION_MAX_AGE_SECONDS,
  createBasic60SessionToken,
  isBasic60SessionConfigured,
  secureBasic60CookieEnabled,
  verifyBasic60Passphrase,
} from "@/lib/basic60/session";
import {
  basic60LoginRetryAfter,
  recordBasic60LoginFailure,
  resetBasic60LoginRateLimit,
} from "@/lib/basic60/login-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isBasic60SessionConfigured()) {
    return NextResponse.json(
      { error: "BASIC60 私有试用访问尚未配置，请联系项目负责人。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式无效。" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const passphrase =
    typeof body === "object" && body !== null && "passphrase" in body
      ? String(body.passphrase)
      : "";
  const nowMs = Date.now();
  const retryAfter = basic60LoginRetryAfter(nowMs);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "BASIC60 私有试用登录尝试过多，请稍后重试。" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  if (!verifyBasic60Passphrase(passphrase)) {
    recordBasic60LoginFailure(nowMs);
    return NextResponse.json(
      { error: "BASIC60 私有试用口令不正确。" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  resetBasic60LoginRateLimit();

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set({
    name: BASIC60_COOKIE_NAME,
    value: createBasic60SessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: secureBasic60CookieEnabled(),
    path: BASIC60_COOKIE_PATH,
    maxAge: BASIC60_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set({
    name: BASIC60_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureBasic60CookieEnabled(),
    path: BASIC60_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}
