import { afterEach, describe, expect, it, vi } from "vitest";
import { demoApi, DemoApiError } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demoApi", () => {
  it("returns only a valid synthetic-demo envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: { data_origin: "synthetic_demo", disclaimer: "演示数据 / 非正式结论" },
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

  it("uses the structured API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meta: { data_origin: "synthetic_demo", disclaimer: "演示数据 / 非正式结论" },
            error: { code: "NOT_FOUND", message: "没有这条演示记录。" },
          }),
          { status: 404 },
        ),
      ),
    );

    await expect(demoApi("countries/XXX")).rejects.toEqual(
      expect.objectContaining<Partial<DemoApiError>>({
        message: "没有这条演示记录。",
        status: 404,
        code: "NOT_FOUND",
      }),
    );
  });
});
