from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any

from .baseline import extract_contracts, sha256_file
from .d0_candidates import (
    build_gold_standard_gap_report,
    build_template_trial,
    load_research_captures,
)
from .models import CheckResult, ReadinessReport, StageSummary
from .paths import RepositoryPaths
from .validation import validate_evidence, validate_structure

COMPLETE_TASK_STATES = {"已完成", "完成", "通过", "已通过"}
ACCEPTED_STATES = {"已验收", "通过", "已通过"}
SIGNED_STATES = {"已签署", "完成"}


def _stage_summaries(tasks: list[dict[str, Any]]) -> list[StageSummary]:
    grouped: dict[str, list[str]] = {}
    for task in tasks:
        stage = str(task.get("阶段", "D0")).strip()
        grouped.setdefault(stage, []).append(str(task.get("状态", "")).strip())
    result: list[StageSummary] = []
    for stage in ("D0", "D1", "D2", "D3", "D4"):
        states = grouped.get(stage, [])
        completed = sum(state in COMPLETE_TASK_STATES for state in states)
        status = "已完成" if states and completed == len(states) else "未完成"
        result.append(
            StageSummary(stage=stage, status=status, completed=completed, total=len(states))
        )
    return result


def build_readiness_report(paths: RepositoryPaths) -> ReadinessReport:
    contracts = extract_contracts(paths)
    blockers = validate_structure(paths)
    warnings: list[CheckResult] = []

    responsibilities = contracts["responsibilities"]
    for record in responsibilities:
        role = str(record.get("角色", "未知角色")).strip()
        if not record.get("姓名") or str(record.get("状态", "")).strip() not in SIGNED_STATES:
            blockers.append(
                CheckResult(
                    code="D0_RESPONSIBILITY_UNSIGNED",
                    message=f"{role} has no completed named signature",
                    location="D0责任签署",
                )
            )

    d0_tasks = contracts["d0_tasks"]
    for task in d0_tasks:
        state = str(task.get("状态", "")).strip()
        if state not in COMPLETE_TASK_STATES:
            blockers.append(
                CheckResult(
                    code="D0_TASK_INCOMPLETE",
                    message=f"{task.get('任务编号')}: {task.get('任务')} is {state or '未填写'}",
                    location="D0任务计划",
                )
            )

    for acceptance in contracts["d0_acceptance"]:
        state = str(acceptance.get("状态", "")).strip()
        if state not in ACCEPTED_STATES:
            blockers.append(
                CheckResult(
                    code="D0_ACCEPTANCE_PENDING",
                    message=f"{acceptance.get('验收编号')}: {acceptance.get('验收项')} is pending",
                    location="D0验收签署",
                )
            )

    acceptance_ids = {
        str(acceptance["验收编号"]).strip()
        for acceptance in contracts["d0_acceptance"]
        if acceptance.get("验收编号")
    }
    evidence_checks = validate_evidence(paths, required_acceptance_ids=acceptance_ids)
    blockers.extend(evidence_checks)

    template_trial = build_template_trial(contracts)
    for check in template_trial["checks"]:
        if check["status"] == "fail":
            blockers.append(
                CheckResult(
                    code=f"D0_{check['check_id'].replace('-', '_')}",
                    message=(
                        f"{check['description']} failed with {len(check['failures'])} item(s)"
                    ),
                    location="D0模板试填",
                )
            )

    gold_gap = build_gold_standard_gap_report(contracts, load_research_captures(paths))
    if gold_gap["status"] != "candidate_ready_for_review":
        blockers.append(
            CheckResult(
                code="D0_GOLD_STANDARD_INCOMPLETE",
                message="Gold-standard candidates still contain placeholders or example rows",
                location="原始资料登记模板",
            )
        )

    roadmap = contracts["d0_d4_roadmap"]
    state_counts = Counter(str(task.get("状态", "")).strip() for task in roadmap)
    if state_counts.get("进行中", 0):
        warnings.append(
            CheckResult(
                code="ROADMAP_ACTIVE_TASKS",
                message=f"{state_counts['进行中']} roadmap task(s) are in progress",
                severity="warning",
                location="D0-D4任务计划",
            )
        )

    return ReadinessReport(
        baseline_version="V1.0-BASELINE",
        current_stage="D0",
        ready=not blockers,
        generated_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        workbook_hashes={
            "d0_workbook": sha256_file(paths.d0_workbook),
            "technical_workbook": sha256_file(paths.technical_workbook),
        },
        stage_summaries=_stage_summaries(roadmap),
        blockers=blockers,
        warnings=warnings,
    )


def render_markdown(report: ReadinessReport) -> str:
    status = "通过" if report.ready else "未通过"
    lines = [
        "# D0 数据就绪报告",
        "",
        f"- 基线：{report.baseline_version}",
        f"- 当前阶段：{report.current_stage}",
        f"- 门禁结论：{status}",
        f"- 生成时间：{report.generated_at}",
        "",
        "## 阶段任务",
        "",
        "| 阶段 | 状态 | 已完成 | 总数 |",
        "|---|---|---:|---:|",
    ]
    lines.extend(
        f"| {item.stage} | {item.status} | {item.completed} | {item.total} |"
        for item in report.stage_summaries
    )
    lines.extend(["", "## 阻断项", ""])
    if report.blockers:
        lines.extend(f"- `{item.code}` {item.message}" for item in report.blockers)
    else:
        lines.append("- 无")
    if report.warnings:
        lines.extend(["", "## 提醒", ""])
        lines.extend(f"- `{item.code}` {item.message}" for item in report.warnings)
    lines.extend(["", "## 基线哈希", ""])
    lines.extend(f"- `{name}`: `{value}`" for name, value in report.workbook_hashes.items())
    return "\n".join(lines) + "\n"
