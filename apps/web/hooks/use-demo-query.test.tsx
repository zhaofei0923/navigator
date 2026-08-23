import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoQuery } from "@/hooks/use-demo-query";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import type { DemoEnvelope } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  demoApi: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ demoApi: mocks.demoApi }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function envelope(locale: "zh-CN" | "en", label: string): DemoEnvelope<{ label: string }> {
  return {
    meta: {
      data_origin: "synthetic_demo",
      disclaimer:
        locale === "en"
          ? "Demo Data / Non-official Conclusions"
          : "演示数据 / 非正式结论",
      locale,
    },
    data: { label },
  };
}

function Probe() {
  const { setLocale } = useLocale();
  const query = useDemoQuery<{ label: string }>("countries");
  return (
    <div>
      <button type="button" onClick={() => setLocale("en")}>English</button>
      <output>{query.loading ? "loading" : query.data?.label ?? "empty"}</output>
    </div>
  );
}

describe("useDemoQuery locale isolation", () => {
  beforeEach(() => {
    mocks.demoApi.mockReset();
    mocks.refresh.mockReset();
    document.documentElement.lang = "zh-CN";
  });

  it("never exposes an old-locale response after the locale changes", async () => {
    const chinese = deferred<DemoEnvelope<{ label: string }>>();
    const english = deferred<DemoEnvelope<{ label: string }>>();
    mocks.demoApi.mockImplementation((path: string) =>
      path.includes("locale=en") ? english.promise : chinese.promise,
    );
    const user = userEvent.setup();

    render(
      <LocaleProvider initialLocale="zh-CN">
        <Probe />
      </LocaleProvider>,
    );

    await waitFor(() => expect(mocks.demoApi).toHaveBeenCalledWith(
      "countries?locale=zh-CN",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await user.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(mocks.demoApi).toHaveBeenCalledWith(
      "countries?locale=en",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    await act(async () => chinese.resolve(envelope("zh-CN", "中文旧响应")));
    expect(screen.queryByText("中文旧响应")).not.toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();

    await act(async () => english.resolve(envelope("en", "English response")));
    expect(await screen.findByText("English response")).toBeInTheDocument();
  });
});
