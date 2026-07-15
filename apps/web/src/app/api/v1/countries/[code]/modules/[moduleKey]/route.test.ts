import { describe, expect, test } from "vitest";

import { GET } from "./route.js";

const BUILDING_MODULE_KEYS = [
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "entry-strategy",
  "ai-advisor",
  "reports",
] as const;

describe("GET /api/v1/countries/:code/modules/:moduleKey", () => {
  test.each(
    BUILDING_MODULE_KEYS.flatMap((moduleKey) =>
      (["localized", "raw"] as const).map((textMode) => [
        moduleKey,
        textMode,
      ] as const),
    ),
  )("returns a BUILDING placeholder for %s in %s mode", async (moduleKey, textMode) => {
    const response = await GET(
      new Request(
        `https://navigator.test/api/v1/countries/ID/modules/${moduleKey}?locale=en&textMode=${textMode}`,
      ),
      { params: Promise.resolve({ code: "ID", moduleKey }) },
    );
    const body = (await response.json()) as {
      success: boolean;
      data: {
        items: unknown[];
        item?: unknown;
        moduleKey: string;
        status: string;
        _i18nFallback?: string[];
      };
      meta: {
        locale: string;
        page: number;
        pageSize: number;
        textMode: string;
        total: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      moduleKey,
      status: "BUILDING",
    });
    expect(body.meta).toMatchObject({
      locale: "en",
      page: 1,
      pageSize: 20,
      textMode,
      total: 0,
    });
    expect(body.data.items).toEqual([]);
    expect(body.data).not.toHaveProperty("item");
    if (textMode === "localized") {
      expect(body.data._i18nFallback).toEqual([]);
    } else {
      expect(body.data).not.toHaveProperty("_i18nFallback");
    }
    expect(JSON.stringify(body)).not.toContain("id_pol_001");
    expect(JSON.stringify(body)).not.toContain("id_pol_anti_draft_001");
  });

  test("returns raw object module item", async () => {
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/ID/modules/market-overview?locale=en&textMode=raw",
      ),
      { params: Promise.resolve({ code: "ID", moduleKey: "market-overview" }) },
    );
    const body = (await response.json()) as {
      data: {
        item: { overview: { zh: string; en: string } };
        _i18nFallback?: string[];
      };
      meta: { textMode: string };
    };

    expect(response.status).toBe(200);
    expect(body.meta.textMode).toBe("raw");
    expect(body.data.item.overview.en).toContain(
      "Installed renewable capacity reached 15,630 MW",
    );
    expect(body.data._i18nFallback).toBeUndefined();
  });

  test.each([
    ["moduleKey", "bad-module", 400, "VALIDATION_ERROR"],
    ["locale", "fr", 400, "VALIDATION_ERROR"],
    ["page", "0", 400, "VALIDATION_ERROR"],
  ])("validates %s values", async (key, value, status, code) => {
    const moduleKey = key === "moduleKey" ? value : "policy";
    const query = key === "moduleKey" ? "locale=en" : `${key}=${value}`;
    const response = await GET(
      new Request(
        `https://navigator.test/api/v1/countries/ID/modules/${moduleKey}?${query}`,
      ),
      { params: Promise.resolve({ code: "ID", moduleKey }) },
    );
    const body = (await response.json()) as {
      error: { code: string };
      success: boolean;
    };

    expect(response.status).toBe(status);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
  });

  test("returns NOT_FOUND for unknown country code", async () => {
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries/ZZ/modules/policy?locale=en",
      ),
      { params: Promise.resolve({ code: "ZZ", moduleKey: "policy" }) },
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
