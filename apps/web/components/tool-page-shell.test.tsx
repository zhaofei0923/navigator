import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  ResultList,
  ToolPageShell,
  ToolResultState,
} from "@/components/tool-page-shell";
import { LocaleProvider } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("ToolPageShell", () => {
  it("highlights the current step, propagates the market and warns against sensitive inputs", () => {
    render(
      <LocaleProvider initialLocale="zh-CN">
        <ToolPageShell
          eyebrow="受控工具"
          title="光储方案"
          description="形成概念配置。"
          currentStep="solar-storage"
          market={{ code: "IDN", name: "印度尼西亚" }}
          relatedActions={[
            {
              href: "/tools/feasibility?country=IDN",
              label: "继续形成可研草案",
              primary: true,
            },
          ]}
        >
          <p>工具表单</p>
        </ToolPageShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: /返回出海工具/ })).toHaveAttribute(
      "href",
      "/tools?country=IDN",
    );
    expect(screen.getByRole("link", { name: /02.*光储方案/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("navigation", { name: "当前任务流程" })).toHaveTextContent(
      "投标准备",
    );
    expect(screen.getByLabelText("当前演示市场")).toHaveTextContent("IDN · 印度尼西亚");
    expect(screen.getAllByRole("note")[0]).toHaveTextContent("请勿输入真实客户资料");
    expect(screen.getByRole("link", { name: /继续形成可研草案/ })).toHaveAttribute(
      "href",
      "/tools/feasibility?country=IDN",
    );
  });

  it("renders only the English shell labels for an English tool flow", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ToolPageShell
          eyebrow="Controlled tool"
          title="AI Expansion Assistant"
          description="Generate a bounded market preview."
          currentStep="assistant"
          market={{ code: "BRA", name: "Brazil" }}
        >
          <ResultList title="Actions" items={["Validate the target market", "Review risks"]} ordered />
        </ToolPageShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: /Back to expansion tools/ })).toHaveAttribute(
      "href",
      "/tools?country=BRA",
    );
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(
      "Do not enter real client information",
    );
    expect(screen.getByRole("heading", { name: "AI Expansion Assistant" })).toBeInTheDocument();
    expect(screen.getByText("Validate the target market").closest("ol")).toBeInTheDocument();
    expect(screen.queryByText(/返回出海工具/)).not.toBeInTheDocument();
  });

  it("keeps form state while switching the entire journey between languages", async () => {
    const user = userEvent.setup();

    function StatefulTool() {
      const [value, setValue] = useState("synthetic-only");
      return (
        <ToolPageShell
          eyebrow="受控工具"
          title="助手"
          description="受控说明"
          currentStep="assistant"
          market={{ code: "VNM", name: "Vietnam" }}
        >
          <LanguageSwitcher />
          <label>
            Demo field
            <input value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        </ToolPageShell>
      );
    }

    render(
      <LocaleProvider initialLocale="zh-CN">
        <StatefulTool />
      </LocaleProvider>,
    );

    const field = screen.getByRole("textbox", { name: "Demo field" });
    await user.clear(field);
    await user.type(field, "kept synthetic state");
    await user.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(field).toHaveValue("kept synthetic state");
    expect(screen.getByRole("navigation", { name: "Current task journey" })).toBeInTheDocument();
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(
      "Do not enter real client information",
    );
  });

  it("standardizes loading, error and empty result states", () => {
    const { rerender } = render(<ToolResultState status="loading" message="Loading result" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading result");

    rerender(<ToolResultState status="error" message="Result unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Result unavailable");

    rerender(<ToolResultState status="empty" message="No result yet" />);
    expect(screen.getByRole("status")).toHaveTextContent("No result yet");
  });

  it("does not render an empty result section", () => {
    const { container } = render(<ResultList title="Empty" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
