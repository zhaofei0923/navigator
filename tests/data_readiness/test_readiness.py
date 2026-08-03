from __future__ import annotations

from navigator_data_readiness.paths import discover_repository
from navigator_data_readiness.readiness import build_readiness_report, render_markdown


def test_current_d0_gate_fails_honestly() -> None:
    report = build_readiness_report(discover_repository())
    codes = {blocker.code for blocker in report.blockers}

    assert report.ready is False
    assert "D0_REVIEW_BASELINE_STALE" not in codes
    assert "D0_REVIEW_CANDIDATES_STALE" not in codes
    assert "D0_RESPONSIBILITY_UNSIGNED" not in codes
    assert "D0_TASK_INCOMPLETE" not in codes
    assert "D0_ACCEPTANCE_PENDING" in codes
    assert "EVIDENCE_ACCEPTANCE_MISSING" in codes
    assert "D0_ENTITY_PRIMARY_KEY_COVERAGE" not in codes
    assert "D0_FIELD_UNIT_METADATA_PRESENT" not in codes
    assert "D0_ENUM_GROUP_CODE_UNIQUE" not in codes
    assert "D0_TRIAL_MAPPING_TARGET" not in codes
    assert {
        acceptance_id
        for acceptance_id in ("D0-AC-009", "D0-AC-010")
        if any(
            acceptance_id in blocker.message
            for blocker in report.blockers
            if blocker.code == "D0_ACCEPTANCE_PENDING"
        )
    } == {"D0-AC-009", "D0-AC-010"}
    assert not any(
        any(f"D0-AC-{index:03d}" in blocker.message for index in range(1, 9))
        for blocker in report.blockers
        if blocker.code == "D0_ACCEPTANCE_PENDING"
    )
    assert any(warning.code == "D0_REVIEW_PROGRESS_APPLIED" for warning in report.warnings)


def test_report_contains_stage_counts_and_gate_result() -> None:
    report = build_readiness_report(discover_repository())
    markdown = render_markdown(report)

    assert "# D0 数据就绪报告" in markdown
    assert "门禁结论：未通过" in markdown
    assert "| D0 | 已完成 | 4 | 4 |" in markdown
