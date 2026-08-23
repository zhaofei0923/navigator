import { afterEach, describe, expect, it, vi } from "vitest";
import { demoApi, DemoApiError } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = "zh-CN";
});

describe("demoApi", () => {
  it("returns only a valid synthetic-demo envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: {
            data_origin: "synthetic_demo",
            disclaimer: "演示数据 / 非正式结论",
            locale: "zh-CN",
          },
          data: [{ code: "TST" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await demoApi<Array<{ code: string }>>("countries");

    expect(response.data).toEqual([{ code: "TST" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/demo/countries",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("accepts the complete English synthetic-demo envelope", async () => {
    document.documentElement.lang = "en";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: {
            data_origin: "synthetic_demo",
            disclaimer: "Demo Data / Non-official Conclusions",
            locale: "en",
          },
          data: [{ code: "SAU", name: "Saudi Arabia" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await demoApi<Array<{ code: string; name: string }>>(
      "demo/globe-markers?locale=en",
    );

    expect(response.meta.locale).toBe("en");
    expect(response.meta.disclaimer).toBe("Demo Data / Non-official Conclusions");
    expect(response.data).toEqual([{ code: "SAU", name: "Saudi Arabia" }]);
  });

  it("rejects a successful response without the approved origin marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ meta: { data_origin: "production" }, data: [] }), {
          status: 200,
        }),
      ),
    );

    await expect(demoApi("countries")).rejects.toMatchObject({
      message: "响应未标识为合成演示数据，已停止显示。",
      status: 502,
    });
  });

  it("maps a stable structured API error code to the active language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meta: {
              data_origin: "synthetic_demo",
              disclaimer: "演示数据 / 非正式结论",
              locale: "zh-CN",
            },
            error: { code: "COUNTRY_NOT_FOUND", message: "untrusted upstream text" },
          }),
          { status: 404 },
        ),
      ),
    );

    await expect(demoApi("countries/XXX")).rejects.toEqual(
      expect.objectContaining<Partial<DemoApiError>>({
        message: "未找到请求的合成演示市场。",
        status: 404,
        code: "COUNTRY_NOT_FOUND",
      }),
    );
  });

  it("does not leak a Chinese upstream message into the English UI", async () => {
    document.documentElement.lang = "en";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meta: {
              data_origin: "synthetic_demo",
              disclaimer: "Demo Data / Non-official Conclusions",
              locale: "en",
            },
            error: { code: "VALIDATION_ERROR", message: "请求参数未通过校验。" },
          }),
          { status: 422 },
        ),
      ),
    );

    await expect(demoApi("demo/tools/assistant/preview?locale=en")).rejects.toMatchObject({
      message: "Check the submitted demo fields and try again.",
      status: 422,
      code: "VALIDATION_ERROR",
    });
  });
});
