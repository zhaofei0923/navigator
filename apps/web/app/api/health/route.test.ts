import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  BASIC60_PRIVATE_RUNTIME_PROFILE,
  SYNTHETIC_DEMO_RUNTIME_PROFILE,
} from "@/lib/runtime-profile";

afterEach(() => {
  delete process.env.NAVIGATOR_RUNTIME_PROFILE;
  delete process.env.BASIC60_API_BASE_URL;
  delete process.env.BASIC60_API_KEY;
  delete process.env.DEMO_API_BASE_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web health route runtime profile", () => {
  it.each([
    BASIC60_PRIVATE_RUNTIME_PROFILE,
    APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  ])("validates the BASIC60 health contract for %s", async (runtimeProfile) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = runtimeProfile;
    process.env.BASIC60_API_BASE_URL = "http://basic60-api.test:8001";
    process.env.BASIC60_API_KEY = "health-test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      database: "ready",
      release_profile: "basic60_private",
      formal_gate_status: "pending",
      release_id: "BASIC60-PRIVATE-R1",
      release_status: "private_trial_ready",
      country_count: 60,
      external_calls_enabled: false,
      ai_enabled: false,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      api: "ready",
      release_profile: "basic60_private",
      formal_gate_status: "pending",
      release_id: "BASIC60-PRIVATE-R1",
    });
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://basic60-api.test:8001/health");
    expect(new Headers(init.headers).get("X-Private-Trial-Key")).toBe("health-test-key");
  });

  it("fails closed if the BASIC60 backend claims AI is enabled", async () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      release_profile: "basic60_private",
      formal_gate_status: "pending",
      external_calls_enabled: false,
      ai_enabled: true,
    }), { status: 200 })));

    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("unavailable");
  });

  it("preserves the synthetic demo health check", async () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = SYNTHETIC_DEMO_RUNTIME_PROFILE;
    process.env.DEMO_API_BASE_URL = "http://demo-api.test:8000";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", data_origin: "synthetic_demo" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      api: "ready",
      data_origin: "synthetic_demo",
    });
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://demo-api.test:8000/health");
  });

  it("fails closed for an unknown runtime profile", async () => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = "future_profile";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      api: "unavailable",
      runtime_profile: "invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
