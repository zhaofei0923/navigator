import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
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
