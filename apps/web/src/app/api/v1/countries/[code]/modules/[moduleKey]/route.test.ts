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

describe("GET /api/v1/countries/:code/modules/:moduleKey", () => {
  test("proxies only a shared-validated module path and normalized query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { moduleKey: "policy" }, success: true }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/id/modules/policy?locale=en&page=2",
      ),
      { params: Promise.resolve({ code: "id", moduleKey: "policy" }) },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/v1/countries/ID/modules/policy?locale=en&page=2&pageSize=20&textMode=localized",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { moduleKey: "policy" },
      success: true,
    });
  });

  test("rejects an invalid module key before contacting Nest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/ID/modules/bad-module?locale=en",
      ),
      { params: Promise.resolve({ code: "ID", moduleKey: "bad-module" }) },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        details: { moduleKey: "bad-module" },
        message: "Invalid country module query",
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
