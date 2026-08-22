import { NextResponse } from "next/server";
import {
  createSessionToken,
  DEMO_COOKIE_NAME,
  DEMO_SESSION_MAX_AGE_SECONDS,
  isConfigured,
  secureDemoCookieEnabled,
  verifyPassphrase,
} from "@/lib/demo-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "演示访问尚未配置，请联系演示负责人。" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const passphrase =
    typeof body === "object" && body !== null && "passphrase" in body
      ? String(body.passphrase)
      : "";
  if (!verifyPassphrase(passphrase)) {
    return NextResponse.json({ error: "演示口令不正确。" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: DEMO_COOKIE_NAME,
    value: createSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoCookieEnabled(),
    path: "/",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: DEMO_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoCookieEnabled(),
    path: "/",
    maxAge: 0,
  });
  return response;
}
