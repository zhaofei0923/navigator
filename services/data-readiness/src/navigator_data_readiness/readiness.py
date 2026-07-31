from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .baseline import extract_contracts, sha256_file
from .d0_candidates import (
    build_core_entity_evidence,
    build_core_field_evidence,
    build_enum_migration_evidence,
    build_gold_standard_gap_report,
    build_template_trial,
    load_license_snapshots,
    load_research_captures,
)
from .d0_review import validate_review_packet
from .models import CheckResult, ReadinessReport, StageSummary
from .paths import RepositoryPaths
from .validation import validate_evidence, validate_structure

COMPLETE_TASK_STATES = {"已完成", "完成", "通过", "已通过"}
ACCEPTED_STATES = {"已验收", "通过", "已通过"}
SIGNED_STATES = {"已签署", "完成"}

D0_TASK_ACCEPTANCE_IDS: dict[str, set[str]] = {
    "D0-01": {"D0-AC-001", "D0-AC-002", "D0-AC-003"},
    "D0-02": {"D0-AC-004"},
    "D0-03": {"D0-AC-005", "D0-AC-008"},
    "D0-04": {"D0-AC-006"},
}

REVIEW_GLOBAL_INTEGRITY_CODES = {
    "D0_REVIEW_PACKET_INVALID",
    "D0_REVIEW_HEADER_INVALID",
    "D0_REVIEW_TEMPLATE_UNCOPIED",
    "D0_REVIEW_BASELINE_INVALID",
    "D0_REVIEW_BASELINE_STALE",
    "D0_REVIEW_CANDIDATES_STALE",
    "D0_REVIEW_EVIDENCE_MANIFEST_INVALID",
    "D0_REVIEW_EVIDENCE_ID_DUPLICATE",
    "D0_REVIEW_EVIDENCE_REFERENCE_UNKNOWN",
}


@dataclass(slots=True)
class D0ReviewProgress:
    source_path: str | None = None
    signed_roles: set[str] = field(default_factory=set)
    mapping_decisions: list[dict[str, Any]] = field(default_factory=list)
    raw_sample_reviews: list[dict[str, Any]] = field(default_factory=list)
    approved_acceptance_ids: set[str] = field(default_factory=set)
    blockers: list[CheckResult] = field(default_factory=list)
    warnings: list[CheckResult] = field(default_factory=list)


def _stage_summaries(
    tasks: list[dict[str, Any]],
    *,
    completed_task_ids: set[str] | None = None,
) -> list[StageSummary]:
    grouped: dict[str, list[str]] = {}
    for task in tasks:
        stage = str(task.get("阶段", "D0")).strip()
        task_id = str(task.get("任务编号", "")).strip()
        state = (
            "已完成"
            if completed_task_ids and task_id in completed_task_ids
            else str(task.get("状态", "")).strip()
        )
        grouped.setdefault(stage, []).append(state)
    result: list[StageSummary] = []
    for stage in ("D0", "D1", "D2", "D3", "D4"):
        states = grouped.get(stage, [])
        completed = sum(state in COMPLETE_TASK_STATES for state in states)
        status = "已完成" if states and completed == len(states) else "未完成"
        result.append(
            StageSummary(stage=stage, status=status, completed=completed, total=len(states))
        )
    return result


def _has_review_error(
    checks: list[CheckResult],
    location: str,
) -> bool:
    return any(
        check.code in REVIEW_GLOBAL_INTEGRITY_CODES
        or check.location == location
        or bool(check.location and check.location.startswith(f"{location}."))
        for check in checks
    )


def _load_review_progress(paths: RepositoryPaths) -> D0ReviewProgress:
    progress = D0ReviewProgress()
    packet_paths = sorted(
        path
        for path in paths.d0_review_dir.glob("d0_review_packet.*.json")
        if path.name != "d0_review_packet.template.json"
    )
    if not packet_paths:
        return progress
    packet_path = packet_paths[-1]
    if len(packet_paths) > 1:
        progress.warnings.append(
            CheckResult(
                code="D0_REVIEW_MULTIPLE_PACKETS",
                message=(
                    f"{len(packet_paths)} review packets exist; using latest {packet_path.name}"
                ),
                severity="warning",
                location=str(paths.d0_review_dir),
            )
        )
    progress.source_path = packet_path.relative_to(paths.root).as_posix()
    try:
        payload = json.loads(packet_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        progress.blockers.append(
            CheckResult(
                code="D0_REVIEW_PACKET_INVALID",
                message=f"Cannot read current review packet: {error}",
                location=str(packet_path),
            )
        )
        return progress
    if not isinstance(payload, dict):
        progress.blockers.append(
            CheckResult(
                code="D0_REVIEW_PACKET_INVALID",
                message="Current review packet root must be an object",
                location=str(packet_path),
            )
        )
        return progress

    checks = validate_review_packet(paths, payload)
    integrity_checks = [check for check in checks if check.code in REVIEW_GLOBAL_INTEGRITY_CODES]
    if integrity_checks:
        progress.blockers.extend(integrity_checks)
        return progress

    for item in payload.get("role_assignments", []):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        location = f"role_assignments.{role}"
        if role and item.get("status") == "signed" and not _has_review_error(checks, location):
            progress.signed_roles.add(role)

    for item in payload.get("mapping_decisions", []):
        if not isinstance(item, dict):
            continue
        mapping_id = str(item.get("mapping_id", "")).strip()
        location = f"mapping_decisions.{mapping_id}"
        if (
            mapping_id
            and item.get("review_status") == "approved"
            and not _has_review_error(checks, location)
        ):
            progress.mapping_decisions.append(item)

    for item in payload.get("raw_sample_reviews", []):
        if not isinstance(item, dict):
            continue
        raw_id = str(item.get("raw_id", "")).strip()
        location = f"raw_sample_reviews.{raw_id}"
        if raw_id and not _has_review_error(checks, location):
            progress.raw_sample_reviews.append(item)

    for item in payload.get("acceptance_items", []):
        if not isinstance(item, dict):
            continue
        acceptance_id = str(item.get("acceptance_id", "")).strip()
        location = f"acceptance_items.{acceptance_id}"
        if (
            acceptance_id
            and item.get("review_status") == "approved"
            and not _has_review_error(checks, location)
        ):
            progress.approved_acceptance_ids.add(acceptance_id)

    final_decision = payload.get("final_decision")
    if "D0-AC-010" in progress.approved_acceptance_ids and (
        not isinstance(final_decision, dict)
        or final_decision.get("status") != "approved"
        or _has_review_error(checks, "final_decision")
    ):
        progress.approved_acceptance_ids.remove("D0-AC-010")

    progress.warnings.append(
        CheckResult(
            code="D0_REVIEW_PROGRESS_APPLIED",
            message=(
                f"Applied {len(progress.signed_roles)} signed roles, "
                f"{len(progress.mapping_decisions)} mapping decisions, and "
                f"{len(progress.approved_acceptance_ids)} acceptance approvals from "
                f"{progress.source_path}"
            ),
            severity="info",
            location=progress.source_path,
        )
    )
    return progress


def build_readiness_report(paths: RepositoryPaths) -> ReadinessReport:
    contracts = extract_contracts(paths)
    blockers = validate_structure(paths)
    warnings: list[CheckResult] = []
    review = _load_review_progress(paths)
    blockers.extend(review.blockers)
    warnings.extend(review.warnings)

    responsibilities = contracts["responsibilities"]
    for record in responsibilities:
        role = str(record.get("角色", "未知角色")).strip()
        workbook_signed = bool(record.get("姓名")) and (
            str(record.get("状态", "")).strip() in SIGNED_STATES
        )
        if not workbook_signed and role not in review.signed_roles:
            blockers.append(
                CheckResult(
                    code="D0_RESPONSIBILITY_UNSIGNED",
                    message=f"{role} has no completed named signature",
                    location="D0责任签署",
                )
            )

    completed_task_ids = {
        task_id
        for task_id, acceptance_ids in D0_TASK_ACCEPTANCE_IDS.items()
        if acceptance_ids <= review.approved_acceptance_ids
    }
    d0_tasks = contracts["d0_tasks"]
    for task in d0_tasks:
        state = str(task.get("状态", "")).strip()
        task_id = str(task.get("任务编号", "")).strip()
        if state not in COMPLETE_TASK_STATES and task_id not in completed_task_ids:
            blockers.append(
                CheckResult(
                    code="D0_TASK_INCOMPLETE",
                    message=f"{task.get('任务编号')}: {task.get('任务')} is {state or '未填写'}",
                    location="D0任务计划",
                )
            )

    for acceptance in contracts["d0_acceptance"]:
        state = str(acceptance.get("状态", "")).strip()
        acceptance_id = str(acceptance.get("验收编号", "")).strip()
        if state not in ACCEPTED_STATES and acceptance_id not in review.approved_acceptance_ids:
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

    for evidence in (
        build_core_entity_evidence(contracts),
        build_core_field_evidence(contracts),
        build_enum_migration_evidence(contracts),
    ):
        for check in evidence["checks"]:
            if check["status"] == "fail":
                blockers.append(
                    CheckResult(
                        code=f"D0_{check['check_id'].replace('-', '_')}",
                        message=(
                            f"{check['description']} failed with "
                            f"{len(check['findings'])} finding(s)"
                        ),
                        location=str(evidence["acceptance_id"]),
                    )
                )

    template_trial = build_template_trial(
        contracts,
        review.mapping_decisions or None,
    )
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

    gold_gap = build_gold_standard_gap_report(
        contracts,
        load_research_captures(paths),
        review.raw_sample_reviews or None,
        load_license_snapshots(paths),
    )
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
        stage_summaries=_stage_summaries(
            roadmap,
            completed_task_ids=completed_task_ids,
        ),
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
