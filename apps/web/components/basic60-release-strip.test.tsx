import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Basic60ReleaseStrip } from "@/components/basic60-release-strip";
import type { Basic60Meta } from "@/lib/basic60/types";

const meta: Basic60Meta = {
  release_id: "BASIC60-PRIVATE-R1",
  release_profile: "basic60_private",
  formal_gate_status: "pending",
  coverage_level: "Basic",
  as_of: "2024-12-31",
  result_count: 60,
};

describe("Basic60ReleaseStrip", () => {
  it.each(["zh-CN", "en"] as const)("shows only the data date in %s", (locale) => {
    const { container } = render(<Basic60ReleaseStrip meta={meta} locale={locale} />);

    expect(screen.getByText(locale === "en" ? "Data as of" : "数据截至")).toBeInTheDocument();
    expect(screen.getByText("2024-12-31")).toBeInTheDocument();
    expect(container.querySelectorAll("dl > div")).toHaveLength(1);
    expect(container).not.toHaveTextContent(/BASIC60|Basic|审核|已通过|发布|pending|Approved|Review|Release/i);
  });
});
