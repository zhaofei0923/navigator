import { describe, expect, test } from "vitest";

import { GET } from "./route.js";

describe("GET /api/v1/countries", () => {
  test("returns localized country cards", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries?locale=en"),
    );
    const body = (await response.json()) as {
      success: boolean;
      data: Array<{
        code: string;
        coverageLevel: string;
        name: string;
        signals?: {
          opportunityLevel: string;
          policyFriendliness: string;
          recommendedPriority: string;
          riskLevel: string;
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.map(({ code }) => code)).toEqual([
      "ID",
      "VN",
      "SA",
      "AE",
      "BR",
      "ZA",
    ]);
    expect(body.data[1]).toEqual(
      expect.objectContaining({
        code: "VN",
        coverageLevel: "BASIC",
        name: "Viet Nam",
        signals: expect.objectContaining({
          opportunityLevel: "DATA_BUILDING",
          policyFriendliness: "DATA_BUILDING",
          recommendedPriority: "DATA_BUILDING",
          riskLevel: "DATA_BUILDING",
        }),
      }),
    );
    expect(body.data[1]).not.toHaveProperty("industryTags");
    expect(body.data[1]).not.toHaveProperty("techTags");
    expect(body.data[2]).toEqual(
      expect.objectContaining({
        code: "SA",
        coverageLevel: "BASIC",
        name: "Saudi Arabia",
      }),
    );
    expect(body.data[3]).toEqual(
      expect.objectContaining({
        code: "AE",
        coverageLevel: "BASIC",
        name: "United Arab Emirates",
      }),
    );
    expect(body.data[4]).toEqual(
      expect.objectContaining({
        code: "BR",
        coverageLevel: "BASIC",
        name: "Brazil",
      }),
    );
    expect(body.data[5]).toEqual(
      expect.objectContaining({
        code: "ZA",
        coverageLevel: "BASIC",
        name: "South Africa",
      }),
    );
  });

  test.each([
    ["coverageLevel", "DEEP"],
    ["locale", "fr"],
    ["region", "antarctica"],
    ["industryTags", "solar,bad-tag"],
    ["techTags", "pv-module,bad-tech"],
    ["textMode", "compact"],
    ["page", "0"],
    ["page", "abc"],
    ["pageSize", "0"],
    ["pageSize", "abc"],
  ])("validates %s query values", async (key, value) => {
    const response = await GET(
      new Request(`https://navigator.test/api/v1/countries?${key}=${value}`),
    );
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; details: Record<string, string> };
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[key]).toBe(value);
  });

  test("uses Accept-Language when locale query is absent", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries", {
        headers: { "accept-language": "en-US,en;q=0.9" },
      }),
    );
    const body = (await response.json()) as {
      data: Array<{ name: string }>;
      meta: { locale: string };
    };

    expect(body.meta.locale).toBe("en");
    expect(body.data.map(({ name }) => name)).toEqual([
      "Indonesia",
      "Viet Nam",
      "Saudi Arabia",
      "United Arab Emirates",
      "Brazil",
      "South Africa",
    ]);
  });

  test("returns raw LocalizedText fields when requested", async () => {
    const response = await GET(
      new Request(
        "https://navigator.test/api/v1/countries?locale=en&textMode=raw",
      ),
    );
    const body = (await response.json()) as {
      data: Array<{ name: { zh: string; en: string }; _i18nFallback?: string[] }>;
      meta: { textMode: string };
    };

    expect(body.meta.textMode).toBe("raw");
    expect(body.data[0]?.name).toEqual({
      zh: "印度尼西亚",
      en: "Indonesia",
    });
    expect(body.data[0]?._i18nFallback).toBeUndefined();
    expect(body.data[1]?.name).toEqual({ zh: "越南", en: "Viet Nam" });
    expect(body.data[2]?.name).toEqual({
      zh: "沙特阿拉伯",
      en: "Saudi Arabia",
    });
    expect(body.data[3]?.name).toEqual({
      zh: "阿拉伯联合酋长国",
      en: "United Arab Emirates",
    });
    expect(body.data[4]?.name).toEqual({ zh: "巴西", en: "Brazil" });
    expect(body.data[5]?.name).toEqual({ zh: "南非", en: "South Africa" });
  });

  test("caps pageSize at the documented maximum", async () => {
    const response = await GET(
      new Request("https://navigator.test/api/v1/countries?pageSize=999"),
    );
    const body = (await response.json()) as {
      meta: { pageSize: number };
    };

    expect(body.meta.pageSize).toBe(100);
  });
});
