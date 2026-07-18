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

describe("GET /api/v1/countries/:code", () => {
  test("normalizes the country path through the shared parser before proxying", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { code: "ID" }, success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/id?locale=en"),
      { params: Promise.resolve({ code: " id " }) },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries/ID?locale=en&page=1&pageSize=20&textMode=localized",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { code: "ID" }, success: true });
  });

  test("returns the existing validation envelope without contacting Nest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/ID?textMode=compact"),
      { params: Promise.resolve({ code: "ID" }) },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        details: { textMode: "compact" },
        message: "Invalid country detail query",
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
