import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Basic60ComparisonSelector } from "@/components/basic60-comparison-selector";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const options = [
  { code: "IDN", label: "印度尼西亚" },
  { code: "VNM", label: "越南" },
  { code: "ZAF", label: "南非" },
];

describe("Basic60ComparisonSelector", () => {
  beforeEach(() => push.mockReset());

  it("requires two distinct countries before navigating", async () => {
    const user = userEvent.setup();
    render(<Basic60ComparisonSelector options={options} initialCodes={["IDN"]} locale="zh-CN" />);
    await user.click(screen.getByRole("button", { name: /生成指标比较/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择2—4个不同国家");
    expect(push).not.toHaveBeenCalled();
  });

  it("preserves the selected country order in the query", async () => {
    const user = userEvent.setup();
    render(<Basic60ComparisonSelector options={options} initialCodes={["IDN", "VNM"]} locale="zh-CN" />);
    await user.click(screen.getByRole("button", { name: /生成指标比较/ }));
    expect(push).toHaveBeenCalledWith("/basic60/compare?countries=IDN&countries=VNM");
  });

  it("uses an optional public comparison path", async () => {
    const user = userEvent.setup();
    render(
      <Basic60ComparisonSelector
        options={options}
        initialCodes={["IDN", "VNM"]}
        locale="zh-CN"
        comparisonPath="/compare"
      />,
    );
    await user.click(screen.getByRole("button", { name: /生成指标比较/ }));
    expect(push).toHaveBeenCalledWith("/compare?countries=IDN&countries=VNM");
  });

  it("does not offer or submit China from legacy options and bookmarked selections", async () => {
    const user = userEvent.setup();
    render(
      <Basic60ComparisonSelector
        options={[{ code: "CHN", label: "中国" }, ...options]}
        initialCodes={["CHN", "IDN"]}
        locale="zh-CN"
        comparisonPath="/compare"
      />,
    );

    expect(screen.queryByRole("option", { name: /CHN/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "国家 A" })).toHaveValue("IDN");
    expect(screen.getByRole("combobox", { name: "国家 B" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /生成指标比较/ }));
    expect(push).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox", { name: "国家 B" }), "VNM");
    await user.click(screen.getByRole("button", { name: /生成指标比较/ }));
    expect(push).toHaveBeenCalledWith("/compare?countries=IDN&countries=VNM");
  });

  it("keeps ordinary English product labels and selection behavior", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Basic60ComparisonSelector options={options} initialCodes={["IDN"]} locale="en" comparisonPath="/compare" />,
    );

    expect(screen.getByRole("combobox", { name: "Country A" })).toHaveValue("IDN");
    await user.selectOptions(screen.getByRole("combobox", { name: "Country B" }), "VNM");
    await user.click(screen.getByRole("button", { name: "Compare indicators" }));
    expect(push).toHaveBeenCalledWith("/compare?countries=IDN&countries=VNM");
    expect(container).not.toHaveTextContent(/BASIC60|Basic|private.?trial|review|release/i);
  });
});
