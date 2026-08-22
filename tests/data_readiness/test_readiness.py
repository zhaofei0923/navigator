from __future__ import annotations

from navigator_data_readiness.paths import discover_repository
from navigator_data_readiness.readiness import build_readiness_report, render_markdown


def test_current_d0_gate_passes_after_final_approval() -> None:
    report = build_readiness_report(discover_repository())

    assert report.ready is True
    assert report.blockers == []
    assert any(warning.code == "D0_REVIEW_PROGRESS_APPLIED" for warning in report.warnings)


def test_report_contains_stage_counts_and_gate_result() -> None:
    report = build_readiness_report(discover_repository())
    markdown = render_markdown(report)

    assert "# D0 数据就绪报告" in markdown
    assert "门禁结论：通过" in markdown
    assert "| D0 | 已完成 | 4 | 4 |" in markdown
