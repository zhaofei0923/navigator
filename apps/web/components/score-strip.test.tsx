import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreStrip } from "@/components/score-strip";

describe("ScoreStrip", () => {
  it("renders all five approved dimensions with data-backed deltas", () => {
    render(
      <ScoreStrip
        scores={{
          market_attractiveness: 78,
          policy_certainty: 65,
          project_activity: 72,
          partner_maturity: 68,
          risk_controllability: 62,
        }}
        deltas={{ market_attractiveness: 6, risk_controllability: -2 }}
      />,
    );

    expect(screen.getByText("市场吸引力")).toBeInTheDocument();
    expect(screen.getByText("政策确定性")).toBeInTheDocument();
    expect(screen.getByText("项目活跃度")).toBeInTheDocument();
    expect(screen.getByText("合作伙伴成熟度")).toBeInTheDocument();
    expect(screen.getByText("风险可控性")).toBeInTheDocument();
    expect(screen.getByText("较上期 +6")).toBeInTheDocument();
    expect(screen.getByText("较上期 -2")).toBeInTheDocument();
  });
});
