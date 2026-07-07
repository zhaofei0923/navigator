import { describe, expect, test } from "vitest";

import { GET } from "./route.js";

describe("GET /api/v1/countries/:code", () => {
  test("returns localized country detail with module coverage", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/ID?locale=en"),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      data: { code: string; name: string; moduleCoverage: unknown[] };
      meta: { locale: string; textMode: string };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: { code: "ID", name: "Indonesia" },
      meta: { locale: "en", textMode: "localized" },
    });
    expect(body.data.moduleCoverage).toHaveLength(10);
    expect(body.data).not.toHaveProperty("industryTags");
    expect(body.data).not.toHaveProperty("techTags");
  });

  test("returns raw LocalizedText detail when requested", async () => {
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/ID?locale=en&textMode=raw",
      ),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      data: { name: { zh: string; en: string }; _i18nFallback?: string[] };
      meta: { textMode: string };
    };

    expect(body.meta.textMode).toBe("raw");
    expect(body.data.name).toEqual({ zh: "印度尼西亚", en: "Indonesia" });
    expect(body.data._i18nFallback).toBeUndefined();
  });

  test.each([
    ["locale", "fr", 400, "VALIDATION_ERROR"],
    ["textMode", "compact", 400, "VALIDATION_ERROR"],
  ])("validates %s query values", async (key, value, status, code) => {
    const response = await GET(
      new Request(
        `https://navigator.test/api/v1/countries/ID?${key}=${value}`,
      ),
      { params: Promise.resolve({ code: "ID" }) },
    );
    const body = (await response.json()) as {
      error: { code: string; details?: Record<string, string> };
      success: boolean;
    };

    expect(response.status).toBe(status);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
  });

  test("returns NOT_FOUND for unknown country code", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries/ZZ?locale=en"),
      { params: Promise.resolve({ code: "ZZ" }) },
    );
    const body = (await response.json()) as {
      error: { code: string };
      success: boolean;
    };

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
