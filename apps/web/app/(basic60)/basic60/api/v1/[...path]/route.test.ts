import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/basic60/session", () => ({
  hasValidBasic60Session: vi.fn().mockResolvedValue(true),
}));

const validEnvelope = {
  meta: {
    release_id: "BASIC60-PRIVATE-R1",
    release_profile: "basic60_private",
    formal_gate_status: "pending",
    coverage_level: "Basic",
    as_of: "2026-08-25",
    result_count: 0,
    next_cursor: null,
  },
  data: [],
};

describe("BASIC60 private API proxy", () => {
  beforeEach(() => {
    process.env.BASIC60_API_KEY = "basic60-unit-test-key";
    process.env.BASIC60_API_BASE_URL = "http://basic60-api.test:8001";
  });

  afterEach(() => {
    delete process.env.BASIC60_API_KEY;
    delete process.env.BASIC60_API_BASE_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards only admitted country-list query fields with the private key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validEnvelope), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request("http://localhost/basic60/api/v1/countries?q=Indonesia&limit=24&unsafe=1"),
      { params: Promise.resolve({ path: ["countries"] }) },
    );
    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://basic60-api.test:8001/api/v1/countries?q=Indonesia&limit=24");
    expect(new Headers(init.headers).get("X-Private-Trial-Key")).toBe("basic60-unit-test-key");
  });

  it.each([
    ["GET", ["policies"]],
    ["GET", ["search"]],
    ["POST", ["ai", "chat"]],
    ["POST", ["country-comparisons"]],
    ["GET", ["country-comparisons"]],
  ])("blocks %s /api/v1/%s without contacting upstream", async (method, path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(`http://localhost/basic60/api/v1/${path.join("/")}`, { method });
    const response = method === "POST"
      ? await POST(request, { params: Promise.resolve({ path }) })
      : await GET(request, { params: Promise.resolve({ path }) });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an upstream demo envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ meta: { data_origin: "synthetic_demo" }, data: [] }), { status: 200 })));
    const response = await GET(
      new Request("http://localhost/basic60/api/v1/countries"),
      { params: Promise.resolve({ path: ["countries"] }) },
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("BASIC60_RELEASE_REJECTED");
  });
});
