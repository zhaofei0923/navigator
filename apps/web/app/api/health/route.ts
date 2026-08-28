import { NextResponse } from "next/server";
import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  BASIC60_PRIVATE_RUNTIME_PROFILE,
  SYNTHETIC_DEMO_RUNTIME_PROFILE,
  currentRuntimeProfile,
} from "@/lib/runtime-profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeProfile = currentRuntimeProfile();
  if (
    runtimeProfile === BASIC60_PRIVATE_RUNTIME_PROFILE ||
    runtimeProfile === APPROVED_BASIC60_DEMO_RUNTIME_PROFILE
  ) {
    return basic60Health();
  }
  if (runtimeProfile === SYNTHETIC_DEMO_RUNTIME_PROFILE) return demoHealth();
  return NextResponse.json(
    { status: "unavailable", api: "unavailable", runtime_profile: "invalid" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function basic60Health() {
  try {
    const baseUrl = new URL(process.env.BASIC60_API_BASE_URL || "http://localhost:8001");
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error("invalid api url");
    }
    const apiKey = process.env.BASIC60_API_KEY?.trim();
    const response = await fetch(new URL("/health", baseUrl), {
      headers: apiKey ? { "X-Private-Trial-Key": apiKey } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("api unavailable");
    const payload = (await response.json()) as Record<string, unknown>;
    if (
      payload.status !== "ok" ||
      payload.release_profile !== "basic60_private" ||
      payload.formal_gate_status !== "pending" ||
      payload.external_calls_enabled !== false ||
      payload.ai_enabled !== false
    ) {
      throw new Error("unexpected api health response");
    }
    return NextResponse.json(
      {
        status: "ok",
        api: "ready",
        release_profile: "basic60_private",
        formal_gate_status: "pending",
        release_id: typeof payload.release_id === "string" ? payload.release_id : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        api: "unavailable",
        release_profile: "basic60_private",
        formal_gate_status: "pending",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function demoHealth() {
  try {
    const baseUrl = new URL(process.env.DEMO_API_BASE_URL || "http://localhost:8000");
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") throw new Error("invalid api url");
    const response = await fetch(new URL("/health", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("api unavailable");
    const payload = (await response.json()) as { status?: unknown; data_origin?: unknown };
    if (payload.status !== "ok" || payload.data_origin !== "synthetic_demo") {
      throw new Error("unexpected api health response");
    }
    return NextResponse.json(
      { status: "ok", api: "ready", data_origin: "synthetic_demo" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", api: "unavailable", data_origin: "synthetic_demo" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
