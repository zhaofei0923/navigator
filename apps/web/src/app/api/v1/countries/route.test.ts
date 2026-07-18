import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "./route.js";

beforeEach(() => {
  vi.stubEnv("API_INTERNAL_BASE_URL", "http://127.0.0.1:3100/api/v1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/v1/countries", () => {
  test("proxies a shared-parser-normalized query and explicit tracing headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], success: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries?locale=en&pageSize=999&unknown=dropped",
        {
          headers: {
            authorization: "Bearer secret",
            "accept-language": "zh-CN",
            traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
            "x-request-id": "request_1234567890",
          },
        },
      ),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries?locale=en&page=1&pageSize=100&textMode=localized",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], success: true });
  });

  test("returns the existing validation envelope without contacting Nest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries?page=0"),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        details: { page: "0" },
        message: "Invalid countries query",
      },
      success: false,
    });
  });

  test("contains no local country data source imports", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/country-(?:seed-registry|service)/);
    expect(source).not.toMatch(/canonical|\.json["']/);
  });
});
