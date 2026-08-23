import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/demo/[...path]/route";

vi.mock("@/lib/demo-session", () => ({
  hasValidDemoSession: vi.fn().mockResolvedValue(true),
}));

const englishEnvelope = {
  meta: {
    data_origin: "synthetic_demo",
    disclaimer: "Demo Data / Non-official Conclusions",
    locale: "en",
  },
  data: [],
};

describe("demo API proxy v2 routes", () => {
  beforeEach(() => {
    process.env.DEMO_API_KEY = "unit-test-demo-key";
    process.env.DEMO_API_BASE_URL = "http://demo-api.test:8000";
  });

  afterEach(() => {
    delete process.env.DEMO_API_KEY;
    delete process.env.DEMO_API_BASE_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards locale to the bounded globe-marker endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(englishEnvelope), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/demo/demo/globe-markers?locale=en"),
      { params: Promise.resolve({ path: ["demo", "globe-markers"] }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(englishEnvelope);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://demo-api.test:8000/api/v1/demo/globe-markers?locale=en",
    );
    expect(new Headers(init.headers).get("X-Demo-Key")).toBe("unit-test-demo-key");
  });

  it("forwards controlled assistant previews without opening arbitrary API paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(englishEnvelope), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const requestBody = JSON.stringify({
      country_code: "SAU",
      question_type: "market_entry",
    });

    const response = await POST(
      new Request("http://localhost/api/demo/demo/tools/assistant/preview?locale=en", {
        method: "POST",
        body: requestBody,
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ path: ["demo", "tools", "assistant", "preview"] }) },
    );

    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://demo-api.test:8000/api/v1/demo/tools/assistant/preview?locale=en",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(requestBody);
  });

  it("rejects an unlisted route with an English error before contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/demo/demo/tools/free-chat?locale=en"),
      { params: Promise.resolve({ path: ["demo", "tools", "free-chat"] }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      meta: {
        data_origin: "synthetic_demo",
        disclaimer: "Demo Data / Non-official Conclusions",
        locale: "en",
      },
      error: {
        code: "DEMO_ENDPOINT_NOT_ALLOWED",
        message: "This demo endpoint is unavailable.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
