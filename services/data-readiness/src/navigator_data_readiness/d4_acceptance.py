from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, TypeGuard

from .baseline import extract_contracts, sha256_file
from .models import CheckResult
from .paths import RepositoryPaths

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COUNTRIES = ("IDN", "VNM", "SAU", "ZAF", "BRA")
COMPARISON_COUNTRIES = COUNTRIES[1:]
COUNTRY_COVERAGE_TARGETS = {
    "IDN": 90.0,
    "VNM": 70.0,
    "SAU": 70.0,
    "ZAF": 70.0,
    "BRA": 70.0,
}
DOMAIN_TARGETS = {
    "ACTIVE_SOURCE": (20, 8),
    "POLICY": (30, 12),
    "MARKET_METRIC": (25, 12),
    "RISK": (20, 8),
    "PROJECT": (50, 20),
    "TENDER": (20, 8),
    "PARTNER": (80, 30),
    "RAG_DOCUMENT": (60, 20),
}
PUBLISHED_DOMAINS = set(DOMAIN_TARGETS) - {"ACTIVE_SOURCE"}
DIMENSIONS: tuple[tuple[str, str, int], ...] = (
    ("D4-DIM-STANDARD", "标准与模板完整", 10),
    ("D4-DIM-SOURCE", "来源准入与合法使用", 15),
    ("D4-DIM-COVERAGE", "数据覆盖与完整性", 20),
    ("D4-DIM-ACCURACY", "准确性与一致性", 20),
    ("D4-DIM-TRACE", "可追溯性", 15),
    ("D4-DIM-FRESHNESS", "时效性", 10),
    ("D4-DIM-REPLAY", "可重放与可移交", 10),
)
REHEARSALS: tuple[tuple[str, str], ...] = (
    ("D4-DRILL-IMPORT", "隔离环境从空库导入种子包"),
    ("D4-DRILL-REBUILD", "从冻结输入重建结构化种子数据"),
    ("D4-DRILL-ROLLBACK", "回滚当前指针且保留历史版本"),
    ("D4-DRILL-SOURCE-REVOKE", "撤回来源并隔离页面、导出、搜索和AI"),
    ("D4-DRILL-RAG-REBUILD", "仅从已发布且获AI许可的数据重建RAG候选"),
)
SEED_ARTIFACT_TYPES = {
    "seed_data",
    "schema",
    "import_script",
    "rebuild_script",
    "rollback_script",
    "manifest",
}
HANDOVER_ITEMS: tuple[tuple[str, str], ...] = (
    ("D4-HO-D0", "D0数据标准包"),
    ("D4-HO-D1", "D1来源准入包"),
    ("D4-HO-D2", "D2不可变原始包"),
    ("D4-HO-D3", "D3标准化候选包"),
    ("D4-HO-SEED", "D4已审核种子库与回滚说明"),
    ("D4-HO-QUALITY", "数据质量报告与问题关闭清单"),
    ("D4-HO-RAG", "RAG候选、权限、切分、引用与撤权资料"),
    ("D4-HO-SAMPLES", "V0.1真实产品开发样本"),
    ("D4-HO-ACCEPTANCE", "D4评分、证据、批准与交接清单"),
)
APPROVAL_ROLES = {
    "数据负责人",
    "数据质量负责人",
    "合规负责人",
    "技术负责人",
    "项目委员会",
}


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(serialized).hexdigest()


def _baseline(paths: RepositoryPaths, contracts: dict[str, Any]) -> dict[str, Any]:
    relevant = {
        key: contracts[key]
        for key in (
            "fields",
            "enums",
            "quality_rules",
            "review_checklist",
            "d0_d4_roadmap",
        )
    }
    return {
        "version": "V1.0-BASELINE",
        "sources": {
            "d0_workbook": {
                "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
                "sha256": sha256_file(paths.d0_workbook),
            },
            "technical_workbook": {
                "path": paths.technical_workbook.relative_to(paths.root).as_posix(),
                "sha256": sha256_file(paths.technical_workbook),
            },
        },
        "d4_input_sha256": _payload_sha256(relevant),
    }


def build_sampling_plan() -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    for country in COUNTRIES:
        plan.append(
            {
                "sample_id": f"D4-SAMPLE-CORE-{country}",
                "scope": "COUNTRY_CORE",
                "country": country,
                "minimum_sample": None if country == "IDN" else 20,
                "full_population_review": country == "IDN",
                "population_count": None,
                "sampled_count": None,
                "correct_count": None,
                "status": "planned",
                "reviewer_one": None,
                "reviewer_two": None,
                "sample_manifest_sha256": None,
                "evidence_ids": [],
            }
        )
        plan.append(
            {
                "sample_id": f"D4-SAMPLE-POLICY-{country}",
                "scope": "POLICY",
                "country": country,
                "minimum_sample": 20 if country == "IDN" else 8,
                "full_population_review": False,
                "population_count": None,
                "sampled_count": None,
                "correct_count": None,
                "status": "planned",
                "reviewer_one": None,
                "reviewer_two": None,
                "sample_manifest_sha256": None,
                "evidence_ids": [],
            }
        )
        for scope in ("PROJECT_TENDER", "PARTNER", "RAG_DOCUMENT"):
            plan.append(
                {
                    "sample_id": f"D4-SAMPLE-{scope}-{country}",
                    "scope": scope,
                    "country": country,
                    "minimum_sample": 10,
                    "full_population_review": False,
                    "population_count": None,
                    "sampled_count": None,
                    "correct_count": None,
                    "status": "planned",
                    "reviewer_one": None,
                    "reviewer_two": None,
                    "sample_manifest_sha256": None,
                    "evidence_ids": [],
                }
            )
    plan.append(
        {
            "sample_id": "D4-SAMPLE-HIGH-RISK-ALL",
            "scope": "HIGH_RISK_CONFLICT_MERGE",
            "country": "ALL",
            "minimum_sample": None,
            "full_population_review": True,
            "population_count": None,
            "sampled_count": None,
            "correct_count": None,
            "status": "planned",
            "reviewer_one": None,
            "reviewer_two": None,
            "sample_manifest_sha256": None,
            "evidence_ids": [],
        }
    )
    return plan


def _dimension_template(code: str, name: str, weight: int) -> dict[str, Any]:
    return {
        "dimension_code": code,
        "name": name,
        "weight": weight,
        "score": None,
        "metric_version": None,
        "calculation_note": None,
        "reviewer": None,
        "reviewed_at": None,
        "evidence_ids": [],
    }


def _domain_coverage_template() -> list[dict[str, Any]]:
    return [
        {
            "coverage_id": f"D4-COVERAGE-{country}-{domain}",
            "country": country,
            "domain": domain,
            "minimum_target": targets[0] if country == "IDN" else targets[1],
            "actual_count": None,
            "evidence_ids": [],
        }
        for country in COUNTRIES
        for domain, targets in DOMAIN_TARGETS.items()
    ]


def build_d4_bundle_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    return {
        "schema_version": 1,
        "stage": "D4",
        "template_only": True,
        "append_only": True,
        "warning": "D4模板和机器评分不能代替真实数据、双人复核或项目委员会签署",
        "baseline": _baseline(paths, contracts),
        "dependencies": {
            "d3_gate_status": "pending",
            "d3_gate_evidence_id": None,
        },
        "production_sources": [],
        "publication_records": [],
        "quality_issues": [],
        "dimension_scores": [
            _dimension_template(code, name, weight) for code, name, weight in DIMENSIONS
        ],
        "country_coverage": [
            {
                "country": country,
                "minimum_pct": target,
                "applicable_core_fields": None,
                "available_valid_fields": None,
                "actual_pct": None,
                "evidence_ids": [],
            }
            for country, target in COUNTRY_COVERAGE_TARGETS.items()
        ],
        "domain_coverage": _domain_coverage_template(),
        "sampling_reviews": build_sampling_plan(),
        "hard_gate_metrics": {
            "published_key_facts": None,
            "traceable_key_facts": None,
            "production_sources": None,
            "licensed_production_sources": None,
            "sampled_fields": None,
            "correct_sampled_fields": None,
            "high_risk_sampled": None,
            "high_risk_correct": None,
            "effective_records": None,
            "duplicate_effective_records": None,
            "required_enum_checks": None,
            "passed_required_enum_checks": None,
            "open_p0_issues": None,
            "revoked_source_index_residuals": None,
            "permission_leaks": None,
        },
        "seed_package": {
            "data_version": None,
            "schema_version": None,
            "record_count": None,
            "manifest_sha256": None,
            "artifacts": [],
        },
        "rag_candidates": [],
        "rehearsals": [
            {
                "rehearsal_id": rehearsal_id,
                "name": name,
                "status": "planned",
                "run_id": None,
                "code_version": None,
                "input_sha256": None,
                "output_sha256": None,
                "isolated_environment": None,
                "operator": None,
                "reviewer": None,
                "executed_at": None,
                "history_preserved": None,
                "residual_count": None,
                "evidence_ids": [],
            }
            for rehearsal_id, name in REHEARSALS
        ],
        "handover_items": [
            {
                "handover_id": handover_id,
                "name": name,
                "status": "pending",
                "artifact_sha256": None,
                "owner": None,
                "reviewer": None,
                "reviewed_at": None,
                "evidence_ids": [],
            }
            for handover_id, name in HANDOVER_ITEMS
        ],
        "acceptance": {
            "tasks": [
                {
                    "task_id": task_id,
                    "status": "pending",
                    "evidence_ids": [],
                }
                for task_id in ("D4-01", "D4-02", "D4-03", "D4-04")
            ],
            "reported_total_score": None,
            "decision": "pending",
            "committee_approvals": [],
            "signed_at": None,
            "d4_gate_evidence_id": None,
        },
    }


def build_d4_scorecard() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "stage": "D4",
        "dimensions": [
            {
                "dimension_code": code,
                "name": name,
                "weight": weight,
                "minimum_score": weight * 0.7,
            }
            for code, name, weight in DIMENSIONS
        ],
        "overall_minimum": 85,
        "hard_gates": {
            "open_p0_issues": 0,
            "IDN_core_field_completeness_min_pct": 90,
            "comparison_country_core_field_completeness_min_pct": 70,
            "published_key_fact_traceability_pct": 100,
            "production_source_license_metadata_pct": 100,
            "sample_accuracy_min_pct": 95,
            "high_risk_sample_accuracy_pct": 100,
            "duplicate_effective_record_max_pct": 1,
            "revoked_source_index_residuals": 0,
            "permission_leaks": 0,
        },
        "domain_targets": {
            domain: {
                "IDN": targets[0],
                "comparison_country": targets[1],
            }
            for domain, targets in DOMAIN_TARGETS.items()
        },
    }


def build_d4_assessment(paths: RepositoryPaths) -> dict[str, Any]:
    bundle = build_d4_bundle_template(paths)
    return {
        "schema_version": 1,
        "stage": "D4",
        "overall_status": "not_ready",
        "automated_assessment_only": True,
        "checks": [
            {
                "check_id": "D4-D3-DEPENDENCY",
                "status": "fail",
                "finding": "D3候选处理包尚未通过正式门禁",
            },
            {
                "check_id": "D4-PUBLICATION",
                "status": "fail",
                "finding": "尚无经职责分离审核的发布记录或生产来源",
            },
            {
                "check_id": "D4-QUANTITATIVE",
                "status": "candidate_generated",
                "finding": f"{len(bundle['dimension_scores'])}个维度和硬门已生成",
            },
            {
                "check_id": "D4-SAMPLING",
                "status": "candidate_generated",
                "finding": f"{len(bundle['sampling_reviews'])}条分层双人抽样计划已生成",
            },
            {
                "check_id": "D4-HANDOVER",
                "status": "fail",
                "finding": "种子包、重建/回滚/撤权演练和9项移交物尚未完成",
            },
            {
                "check_id": "D4-SIGNOFF",
                "status": "fail",
                "finding": "项目委员会尚未完成D4正式批准",
            },
        ],
    }


def d4_candidate_payloads(paths: RepositoryPaths) -> dict[str, Any]:
    return {
        "d4_acceptance_assessment.json": build_d4_assessment(paths),
        "d4_acceptance_bundle.template.json": build_d4_bundle_template(paths),
        "d4_sampling_plan.json": {
            "schema_version": 1,
            "stage": "D4",
            "sampling_reviews": build_sampling_plan(),
        },
        "d4_scorecard.json": build_d4_scorecard(),
    }


def write_d4_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d4_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in d4_candidate_payloads(paths).items():
        destination = paths.d4_candidates_dir / filename
        destination.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(destination)
    return written


def _required_text(
    checks: list[CheckResult],
    item: dict[str, Any],
    fields: tuple[str, ...],
    *,
    code: str,
    location: str,
) -> None:
    missing = [field for field in fields if not str(item.get(field) or "").strip()]
    if missing:
        checks.append(
            CheckResult(
                code=code,
                message=f"Missing required fields: {', '.join(missing)}",
                location=location,
            )
        )


def _index(
    checks: list[CheckResult],
    payload: dict[str, Any],
    section: str,
    identifier: str,
) -> dict[str, dict[str, Any]]:
    items = payload.get(section)
    if not isinstance(items, list):
        checks.append(
            CheckResult(
                code="D4_SECTION_INVALID",
                message=f"{section} must be a list",
                location=section,
            )
        )
        return {}
    result: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not str(item.get(identifier) or "").strip():
            checks.append(
                CheckResult(
                    code="D4_ENTRY_INVALID",
                    message=f"{section}[{index}] requires {identifier}",
                    location=section,
                )
            )
            continue
        key = str(item[identifier]).strip()
        if key in result:
            checks.append(
                CheckResult(
                    code="D4_ENTRY_DUPLICATE",
                    message=f"Duplicate {identifier}: {key}",
                    location=section,
                )
            )
            continue
        result[key] = item
    return result


def _percentage(numerator: int | float, denominator: int | float) -> float:
    return 0.0 if denominator == 0 else numerator / denominator * 100


def _is_number(value: Any) -> TypeGuard[int | float]:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _validate_d3_input(
    checks: list[CheckResult],
    d3_bundle: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if d3_bundle.get("schema_version") != 1 or d3_bundle.get("stage") != "D3":
        checks.append(
            CheckResult(
                code="D4_D3_HEADER_INVALID",
                message="Input requires a schema_version 1 D3 bundle",
                location="d3_bundle",
            )
        )
    if d3_bundle.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D4_D3_TEMPLATE_UNCOMPLETED",
                message="D3 input must be a completed bundle, not its template",
                location="d3_bundle.template_only",
            )
        )
    dependencies = d3_bundle.get("dependencies")
    if not isinstance(dependencies, dict) or (
        dependencies.get("d2_gate_status") != "approved"
        or not dependencies.get("d2_gate_evidence_id")
    ):
        checks.append(
            CheckResult(
                code="D4_D3_D2_LINEAGE_INCOMPLETE",
                message="D3 input must retain an approved D2 dependency and evidence",
                location="d3_bundle.dependencies",
            )
        )
    return _index(checks, d3_bundle, "records", "record_id")


def _validate_source(
    checks: list[CheckResult],
    source_id: str,
    item: dict[str, Any],
) -> None:
    location = f"production_sources.{source_id}"
    _required_text(
        checks,
        item,
        (
            "country",
            "terms_snapshot_sha256",
            "license_snapshot_sha256",
            "owner",
            "reviewer",
            "reviewed_at",
        ),
        code="D4_SOURCE_METADATA_INCOMPLETE",
        location=location,
    )
    if item.get("country") not in COUNTRIES or item.get("status") != "active":
        checks.append(
            CheckResult(
                code="D4_SOURCE_NOT_ACTIVE",
                message=f"{source_id} must be active in one frozen country",
                location=location,
            )
        )
    if item.get("license_status") != "approved" or any(
        item.get(field) is not True
        for field in (
            "storage_allowed",
            "display_allowed",
            "export_allowed",
            "ai_use_allowed",
            "permission_metadata_complete",
        )
    ):
        checks.append(
            CheckResult(
                code="D4_SOURCE_USAGE_BOUNDARY_INCOMPLETE",
                message=f"{source_id} lacks approved production usage boundaries",
                location=location,
            )
        )
    for field in ("terms_snapshot_sha256", "license_snapshot_sha256"):
        if not SHA256_PATTERN.fullmatch(str(item.get(field) or "")):
            checks.append(
                CheckResult(
                    code="D4_SOURCE_SNAPSHOT_HASH_INVALID",
                    message=f"{source_id} requires lowercase SHA-256 in {field}",
                    location=location,
                )
            )
    if item.get("owner") == item.get("reviewer"):
        checks.append(
            CheckResult(
                code="D4_SOURCE_REVIEW_NOT_SEPARATED",
                message=f"{source_id} owner and reviewer must differ",
                location=location,
            )
        )
    if not item.get("evidence_ids"):
        checks.append(
            CheckResult(
                code="D4_SOURCE_EVIDENCE_MISSING",
                message=f"{source_id} requires source-admission evidence",
                location=location,
            )
        )


def _validate_publication(
    checks: list[CheckResult],
    publication_id: str,
    item: dict[str, Any],
    d3_records: dict[str, dict[str, Any]],
    sources: dict[str, dict[str, Any]],
) -> None:
    location = f"publication_records.{publication_id}"
    _required_text(
        checks,
        item,
        (
            "record_id",
            "country",
            "domain",
            "source_id",
            "raw_id",
            "source_snapshot_sha256",
            "source_locator",
            "data_version",
            "review_version",
            "editor",
            "reviewer",
            "reviewed_at",
            "published_at",
        ),
        code="D4_PUBLICATION_METADATA_INCOMPLETE",
        location=location,
    )
    record_id = str(item.get("record_id") or "")
    d3_record = d3_records.get(record_id)
    if d3_record is None:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_D3_RECORD_UNKNOWN",
                message=f"{publication_id} references unknown D3 record {record_id}",
                location=location,
            )
        )
    elif (
        d3_record.get("status") != "candidate"
        or any(
            item.get(field) != d3_record.get(field)
            for field in ("country", "source_id", "raw_id", "source_locator")
        )
        or item.get("source_snapshot_sha256") != d3_record.get("source_snapshot_sha256")
    ):
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_D3_LINEAGE_MISMATCH",
                message=f"{publication_id} is not an unchanged approved D3 candidate",
                location=location,
            )
        )
    source = sources.get(str(item.get("source_id") or ""))
    if source is None:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_SOURCE_UNKNOWN",
                message=f"{publication_id} references an unapproved production source",
                location=location,
            )
        )
    elif source.get("country") != item.get("country"):
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_SOURCE_COUNTRY_MISMATCH",
                message=f"{publication_id} source country differs from the record",
                location=location,
            )
        )
    if item.get("country") not in COUNTRIES or item.get("domain") not in PUBLISHED_DOMAINS:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_SCOPE_INVALID",
                message=f"{publication_id} is outside the frozen country/domain scope",
                location=location,
            )
        )
    if item.get("status") != "published" or item.get("quality_gate_passed") is not True:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_GATE_NOT_PASSED",
                message=f"{publication_id} must be quality-approved and published",
                location=location,
            )
        )
    if item.get("freshness_status") not in {"current", "due"}:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_FRESHNESS_INVALID",
                message=f"{publication_id} cannot publish overdue or unknown data",
                location=location,
            )
        )
    if item.get("traceability_complete") is not True:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_TRACEABILITY_INCOMPLETE",
                message=f"{publication_id} lacks complete source-to-review lineage",
                location=location,
            )
        )
    if item.get("editor") == item.get("reviewer"):
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_REVIEW_NOT_SEPARATED",
                message=f"{publication_id} editor cannot approve their own record",
                location=location,
            )
        )
    if item.get("high_risk") is True:
        second_reviewer = str(item.get("second_reviewer") or "")
        if not second_reviewer or second_reviewer in {
            item.get("editor"),
            item.get("reviewer"),
        }:
            checks.append(
                CheckResult(
                    code="D4_PUBLICATION_SECOND_REVIEW_MISSING",
                    message=(
                        f"{publication_id} high-risk data requires an independent second review"
                    ),
                    location=location,
                )
            )
    if item.get("p0_issue_open") is not False:
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_P0_OPEN",
                message=f"{publication_id} cannot publish with a P0 issue",
                location=location,
            )
        )
    if not item.get("transformation_run_ids") or not item.get("evidence_ids"):
        checks.append(
            CheckResult(
                code="D4_PUBLICATION_EVIDENCE_INCOMPLETE",
                message=f"{publication_id} requires transformation and review evidence",
                location=location,
            )
        )


def _validate_issue(
    checks: list[CheckResult],
    issue_id: str,
    item: dict[str, Any],
) -> None:
    location = f"quality_issues.{issue_id}"
    if item.get("severity") not in {"P0", "P1", "P2", "P3"} or item.get("status") not in {
        "open",
        "assigned",
        "fixing",
        "recheck",
        "resolved",
        "waived",
    }:
        checks.append(
            CheckResult(
                code="D4_ISSUE_STATE_INVALID",
                message=f"{issue_id} has invalid severity or status",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        ("owner", "root_cause", "target_date"),
        code="D4_ISSUE_METADATA_INCOMPLETE",
        location=location,
    )
    if item.get("severity") == "P0":
        if item.get("status") != "resolved":
            checks.append(
                CheckResult(
                    code="D4_P0_ISSUE_OPEN",
                    message=f"{issue_id} P0 issue is not independently resolved",
                    location=location,
                )
            )
        _required_text(
            checks,
            item,
            ("resolved_at", "rechecked_by", "rechecked_at"),
            code="D4_P0_RESOLUTION_INCOMPLETE",
            location=location,
        )
        if not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_P0_EVIDENCE_MISSING",
                    message=f"{issue_id} resolved P0 issue requires evidence",
                    location=location,
                )
            )
    if item.get("status") == "waived":
        _required_text(
            checks,
            item,
            ("waiver_reason", "waiver_approver", "waiver_expires_at"),
            code="D4_WAIVER_INCOMPLETE",
            location=location,
        )


def _validate_dimensions(
    checks: list[CheckResult],
    bundle: dict[str, Any],
) -> float:
    dimensions = _index(checks, bundle, "dimension_scores", "dimension_code")
    expected = {code: (name, weight) for code, name, weight in DIMENSIONS}
    if set(dimensions) != set(expected):
        checks.append(
            CheckResult(
                code="D4_DIMENSION_SET_INVALID",
                message="D4 requires all seven frozen score dimensions",
                location="dimension_scores",
            )
        )
    total = 0.0
    for code, item in dimensions.items():
        location = f"dimension_scores.{code}"
        name_weight = expected.get(code)
        if name_weight and (
            item.get("name") != name_weight[0] or item.get("weight") != name_weight[1]
        ):
            checks.append(
                CheckResult(
                    code="D4_DIMENSION_INPUT_CHANGED",
                    message=f"{code} name or weight was changed",
                    location=location,
                )
            )
        score = item.get("score")
        weight = name_weight[1] if name_weight else item.get("weight")
        if not _is_number(score) or not _is_number(weight) or score < 0 or score > weight:
            checks.append(
                CheckResult(
                    code="D4_DIMENSION_SCORE_INVALID",
                    message=f"{code} score must be between zero and its weight",
                    location=location,
                )
            )
            continue
        total += float(score)
        if score < weight * 0.7:
            checks.append(
                CheckResult(
                    code="D4_DIMENSION_BELOW_MINIMUM",
                    message=f"{code} is below 70% of its dimension weight",
                    location=location,
                )
            )
        _required_text(
            checks,
            item,
            ("metric_version", "calculation_note", "reviewer", "reviewed_at"),
            code="D4_DIMENSION_EVIDENCE_INCOMPLETE",
            location=location,
        )
        if not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_DIMENSION_EVIDENCE_INCOMPLETE",
                    message=f"{code} requires evidence",
                    location=location,
                )
            )
    if total < 85:
        checks.append(
            CheckResult(
                code="D4_TOTAL_SCORE_BELOW_MINIMUM",
                message=f"D4 total score {total:.2f} is below 85",
                location="dimension_scores",
            )
        )
    return total


def _validate_country_coverage(
    checks: list[CheckResult],
    bundle: dict[str, Any],
) -> None:
    coverage = _index(checks, bundle, "country_coverage", "country")
    if set(coverage) != set(COUNTRIES):
        checks.append(
            CheckResult(
                code="D4_COUNTRY_COVERAGE_SET_INVALID",
                message="D4 coverage must contain all five frozen countries",
                location="country_coverage",
            )
        )
    for country, item in coverage.items():
        location = f"country_coverage.{country}"
        expected = COUNTRY_COVERAGE_TARGETS.get(country)
        if expected is None:
            continue
        if item.get("minimum_pct") != expected:
            checks.append(
                CheckResult(
                    code="D4_COUNTRY_TARGET_CHANGED",
                    message=f"{country} coverage target was changed",
                    location=location,
                )
            )
        denominator = item.get("applicable_core_fields")
        numerator = item.get("available_valid_fields")
        actual = item.get("actual_pct")
        if (
            not isinstance(denominator, int)
            or isinstance(denominator, bool)
            or denominator <= 0
            or not isinstance(numerator, int)
            or isinstance(numerator, bool)
            or not 0 <= numerator <= denominator
            or not _is_number(actual)
        ):
            checks.append(
                CheckResult(
                    code="D4_COUNTRY_COVERAGE_INVALID",
                    message=f"{country} coverage counts or percentage are invalid",
                    location=location,
                )
            )
            continue
        calculated = _percentage(numerator, denominator)
        if not math.isclose(float(actual), calculated, abs_tol=0.01):
            checks.append(
                CheckResult(
                    code="D4_COUNTRY_COVERAGE_MISMATCH",
                    message=f"{country} reported coverage does not match its counts",
                    location=location,
                )
            )
        if calculated < expected:
            checks.append(
                CheckResult(
                    code="D4_COUNTRY_COVERAGE_BELOW_TARGET",
                    message=f"{country} core-field coverage is below {expected:.0f}%",
                    location=location,
                )
            )
        if not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_COUNTRY_COVERAGE_EVIDENCE_MISSING",
                    message=f"{country} coverage requires evidence",
                    location=location,
                )
            )


def _validate_domain_coverage(
    checks: list[CheckResult],
    bundle: dict[str, Any],
    publication_counts: Counter[tuple[str, str]],
    source_counts: Counter[str],
) -> None:
    coverage = _index(checks, bundle, "domain_coverage", "coverage_id")
    expected = {
        f"D4-COVERAGE-{country}-{domain}": (
            country,
            domain,
            targets[0] if country == "IDN" else targets[1],
        )
        for country in COUNTRIES
        for domain, targets in DOMAIN_TARGETS.items()
    }
    if set(coverage) != set(expected):
        checks.append(
            CheckResult(
                code="D4_DOMAIN_COVERAGE_SET_INVALID",
                message="D4 requires every frozen country and minimum data domain",
                location="domain_coverage",
            )
        )
    for coverage_id, item in coverage.items():
        location = f"domain_coverage.{coverage_id}"
        expectation = expected.get(coverage_id)
        if expectation is None:
            continue
        country, domain, target = expectation
        if (
            item.get("country") != country
            or item.get("domain") != domain
            or item.get("minimum_target") != target
        ):
            checks.append(
                CheckResult(
                    code="D4_DOMAIN_TARGET_CHANGED",
                    message=f"{coverage_id} frozen target was changed",
                    location=location,
                )
            )
        actual = item.get("actual_count")
        observed = (
            source_counts[country]
            if domain == "ACTIVE_SOURCE"
            else publication_counts[(country, domain)]
        )
        if not isinstance(actual, int) or isinstance(actual, bool) or actual != observed:
            checks.append(
                CheckResult(
                    code="D4_DOMAIN_COUNT_MISMATCH",
                    message=f"{coverage_id} count does not match the record manifests",
                    location=location,
                )
            )
        if observed < target:
            checks.append(
                CheckResult(
                    code="D4_DOMAIN_COVERAGE_BELOW_TARGET",
                    message=f"{coverage_id} has {observed}, below target {target}",
                    location=location,
                )
            )
        if not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_DOMAIN_COVERAGE_EVIDENCE_MISSING",
                    message=f"{coverage_id} requires evidence",
                    location=location,
                )
            )


def _validate_sampling(
    checks: list[CheckResult],
    bundle: dict[str, Any],
) -> tuple[int, int, int, int]:
    reviews = _index(checks, bundle, "sampling_reviews", "sample_id")
    expected = {item["sample_id"]: item for item in build_sampling_plan()}
    if set(reviews) != set(expected):
        checks.append(
            CheckResult(
                code="D4_SAMPLING_SET_INVALID",
                message="D4 requires the complete frozen stratified sampling plan",
                location="sampling_reviews",
            )
        )
    sampled_total = 0
    correct_total = 0
    high_risk_sampled = 0
    high_risk_correct = 0
    for sample_id, item in reviews.items():
        location = f"sampling_reviews.{sample_id}"
        frozen = expected.get(sample_id)
        if frozen and any(
            item.get(field) != frozen.get(field)
            for field in (
                "scope",
                "country",
                "minimum_sample",
                "full_population_review",
            )
        ):
            checks.append(
                CheckResult(
                    code="D4_SAMPLING_INPUT_CHANGED",
                    message=f"{sample_id} frozen sampling rule was changed",
                    location=location,
                )
            )
        population = item.get("population_count")
        sampled = item.get("sampled_count")
        correct = item.get("correct_count")
        if (
            item.get("status") != "completed"
            or not isinstance(population, int)
            or isinstance(population, bool)
            or population < 0
            or not isinstance(sampled, int)
            or isinstance(sampled, bool)
            or not 0 <= sampled <= population
            or not isinstance(correct, int)
            or isinstance(correct, bool)
            or not 0 <= correct <= sampled
        ):
            checks.append(
                CheckResult(
                    code="D4_SAMPLING_RESULT_INVALID",
                    message=f"{sample_id} requires completed and consistent sample counts",
                    location=location,
                )
            )
            continue
        minimum = item.get("minimum_sample")
        if item.get("full_population_review") is True and sampled != population:
            checks.append(
                CheckResult(
                    code="D4_SAMPLING_FULL_REVIEW_INCOMPLETE",
                    message=f"{sample_id} requires 100% population review",
                    location=location,
                )
            )
        if isinstance(minimum, int):
            required = (
                min(minimum, population)
                if item.get("scope") == "POLICY" and item.get("country") == "IDN"
                else minimum
            )
            if sampled < required:
                checks.append(
                    CheckResult(
                        code="D4_SAMPLING_MINIMUM_NOT_MET",
                        message=f"{sample_id} sampled {sampled}, below {required}",
                        location=location,
                    )
                )
        reviewer_one = str(item.get("reviewer_one") or "")
        reviewer_two = str(item.get("reviewer_two") or "")
        if not reviewer_one or not reviewer_two or reviewer_one == reviewer_two:
            checks.append(
                CheckResult(
                    code="D4_SAMPLING_REVIEWERS_INVALID",
                    message=f"{sample_id} requires two independent reviewers",
                    location=location,
                )
            )
        if not SHA256_PATTERN.fullmatch(
            str(item.get("sample_manifest_sha256") or "")
        ) or not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_SAMPLING_EVIDENCE_INCOMPLETE",
                    message=f"{sample_id} requires a sample manifest and evidence",
                    location=location,
                )
            )
        sampled_total += sampled
        correct_total += correct
        if item.get("scope") == "HIGH_RISK_CONFLICT_MERGE":
            high_risk_sampled = sampled
            high_risk_correct = correct
            if correct != sampled:
                checks.append(
                    CheckResult(
                        code="D4_HIGH_RISK_ACCURACY_FAILED",
                        message="High-risk, conflict, and merge samples require 100% accuracy",
                        location=location,
                    )
                )
    if sampled_total <= 0 or _percentage(correct_total, sampled_total) < 95:
        checks.append(
            CheckResult(
                code="D4_SAMPLE_ACCURACY_BELOW_TARGET",
                message="Overall sample accuracy must be at least 95%",
                location="sampling_reviews",
            )
        )
    return sampled_total, correct_total, high_risk_sampled, high_risk_correct


def _validate_hard_gate_metrics(
    checks: list[CheckResult],
    metrics: Any,
    *,
    publication_count: int,
    traceable_count: int,
    source_count: int,
    licensed_source_count: int,
    sampled: tuple[int, int, int, int],
    p0_open_count: int,
) -> None:
    if not isinstance(metrics, dict):
        checks.append(
            CheckResult(
                code="D4_HARD_GATE_METRICS_INVALID",
                message="hard_gate_metrics must be an object",
                location="hard_gate_metrics",
            )
        )
        return
    expected = {
        "published_key_facts": publication_count,
        "traceable_key_facts": traceable_count,
        "production_sources": source_count,
        "licensed_production_sources": licensed_source_count,
        "sampled_fields": sampled[0],
        "correct_sampled_fields": sampled[1],
        "high_risk_sampled": sampled[2],
        "high_risk_correct": sampled[3],
        "effective_records": publication_count,
        "open_p0_issues": p0_open_count,
    }
    if any(metrics.get(field) != value for field, value in expected.items()):
        checks.append(
            CheckResult(
                code="D4_HARD_GATE_METRIC_MISMATCH",
                message="Reported hard-gate metrics do not match source manifests",
                location="hard_gate_metrics",
            )
        )
    numeric_fields = (
        "duplicate_effective_records",
        "required_enum_checks",
        "passed_required_enum_checks",
        "revoked_source_index_residuals",
        "permission_leaks",
    )
    if any(
        not isinstance(metrics.get(field), int)
        or isinstance(metrics.get(field), bool)
        or metrics[field] < 0
        for field in numeric_fields
    ):
        checks.append(
            CheckResult(
                code="D4_HARD_GATE_METRIC_INVALID",
                message="Hard-gate count metrics must be non-negative integers",
                location="hard_gate_metrics",
            )
        )
        return
    if publication_count <= 0 or traceable_count != publication_count:
        checks.append(
            CheckResult(
                code="D4_TRACEABILITY_HARD_GATE_FAILED",
                message="Published key facts require 100% traceability",
                location="hard_gate_metrics",
            )
        )
    if source_count <= 0 or licensed_source_count != source_count:
        checks.append(
            CheckResult(
                code="D4_LICENSE_HARD_GATE_FAILED",
                message="Production source legal-use metadata must be 100% complete",
                location="hard_gate_metrics",
            )
        )
    if (
        metrics["required_enum_checks"] <= 0
        or metrics["passed_required_enum_checks"] != metrics["required_enum_checks"]
    ):
        checks.append(
            CheckResult(
                code="D4_REQUIRED_ENUM_HARD_GATE_FAILED",
                message="Required-field and enum validations must pass 100%",
                location="hard_gate_metrics",
            )
        )
    duplicate_rate = _percentage(
        metrics["duplicate_effective_records"],
        metrics["effective_records"],
    )
    if duplicate_rate > 1:
        checks.append(
            CheckResult(
                code="D4_DUPLICATE_RATE_HARD_GATE_FAILED",
                message=f"Effective duplicate rate {duplicate_rate:.2f}% exceeds 1%",
                location="hard_gate_metrics",
            )
        )
    if metrics["open_p0_issues"] != 0:
        checks.append(
            CheckResult(
                code="D4_P0_HARD_GATE_FAILED",
                message="Open P0 issues must be zero",
                location="hard_gate_metrics",
            )
        )
    if metrics["revoked_source_index_residuals"] != 0:
        checks.append(
            CheckResult(
                code="D4_REVOKED_SOURCE_RESIDUAL_HARD_GATE_FAILED",
                message="Revoked sources must have zero production index residuals",
                location="hard_gate_metrics",
            )
        )
    if metrics["permission_leaks"] != 0:
        checks.append(
            CheckResult(
                code="D4_PERMISSION_LEAK_HARD_GATE_FAILED",
                message="Permission leaks must be zero",
                location="hard_gate_metrics",
            )
        )


def _validate_seed_package(
    checks: list[CheckResult],
    seed_package: Any,
    publication_count: int,
) -> None:
    if not isinstance(seed_package, dict):
        checks.append(
            CheckResult(
                code="D4_SEED_PACKAGE_INVALID",
                message="seed_package must be an object",
                location="seed_package",
            )
        )
        return
    _required_text(
        checks,
        seed_package,
        ("data_version", "schema_version", "manifest_sha256"),
        code="D4_SEED_PACKAGE_INCOMPLETE",
        location="seed_package",
    )
    if seed_package.get("record_count") != publication_count or not SHA256_PATTERN.fullmatch(
        str(seed_package.get("manifest_sha256") or "")
    ):
        checks.append(
            CheckResult(
                code="D4_SEED_MANIFEST_INVALID",
                message="Seed record count or manifest SHA-256 is invalid",
                location="seed_package",
            )
        )
    artifacts = seed_package.get("artifacts")
    if not isinstance(artifacts, list):
        checks.append(
            CheckResult(
                code="D4_SEED_ARTIFACTS_INVALID",
                message="Seed artifacts must be a list",
                location="seed_package.artifacts",
            )
        )
        return
    artifact_types = {
        str(item.get("artifact_type")) for item in artifacts if isinstance(item, dict)
    }
    if artifact_types != SEED_ARTIFACT_TYPES:
        checks.append(
            CheckResult(
                code="D4_SEED_ARTIFACT_SET_INVALID",
                message=(
                    "Seed package requires data, schema, import, rebuild, rollback, and manifest"
                ),
                location="seed_package.artifacts",
            )
        )
    for index, item in enumerate(artifacts):
        location = f"seed_package.artifacts[{index}]"
        if not isinstance(item, dict):
            continue
        _required_text(
            checks,
            item,
            ("artifact_type", "path", "version", "sha256"),
            code="D4_SEED_ARTIFACT_METADATA_INCOMPLETE",
            location=location,
        )
        if (
            not SHA256_PATTERN.fullmatch(str(item.get("sha256") or ""))
            or item.get("contains_plaintext_secrets") is not False
        ):
            checks.append(
                CheckResult(
                    code="D4_SEED_ARTIFACT_UNSAFE",
                    message="Seed artifacts require SHA-256 and must contain no plaintext secrets",
                    location=location,
                )
            )


def _validate_rag_candidates(
    checks: list[CheckResult],
    bundle: dict[str, Any],
    publications: dict[str, dict[str, Any]],
    sources: dict[str, dict[str, Any]],
) -> None:
    candidates = _index(checks, bundle, "rag_candidates", "knowledge_id")
    eligible_counts: Counter[str] = Counter()
    for knowledge_id, item in candidates.items():
        location = f"rag_candidates.{knowledge_id}"
        publication = publications.get(str(item.get("publication_id") or ""))
        source = sources.get(str(item.get("source_id") or ""))
        if publication is None or publication.get("domain") != "RAG_DOCUMENT":
            checks.append(
                CheckResult(
                    code="D4_RAG_PUBLICATION_INVALID",
                    message=f"{knowledge_id} must reference a published RAG document",
                    location=location,
                )
            )
        if source is None or source.get("ai_use_allowed") is not True:
            checks.append(
                CheckResult(
                    code="D4_RAG_SOURCE_NOT_ALLOWED",
                    message=f"{knowledge_id} source is not approved for AI use",
                    location=location,
                )
            )
        if item.get("status") != "eligible" or any(
            item.get(field) is not True
            for field in (
                "permission_metadata_complete",
                "citation_locator_complete",
                "revocation_supported",
                "index_eligible",
            )
        ):
            checks.append(
                CheckResult(
                    code="D4_RAG_ELIGIBILITY_INCOMPLETE",
                    message=f"{knowledge_id} is not a complete RAG candidate",
                    location=location,
                )
            )
        _required_text(
            checks,
            item,
            ("publication_id", "source_id", "country", "version", "revocation_test_id"),
            code="D4_RAG_METADATA_INCOMPLETE",
            location=location,
        )
        if publication and item.get("country") != publication.get("country"):
            checks.append(
                CheckResult(
                    code="D4_RAG_COUNTRY_MISMATCH",
                    message=f"{knowledge_id} country differs from its publication",
                    location=location,
                )
            )
        if item.get("status") == "eligible" and item.get("country") in COUNTRIES:
            eligible_counts[str(item["country"])] += 1
    for country in COUNTRIES:
        target = DOMAIN_TARGETS["RAG_DOCUMENT"][0 if country == "IDN" else 1]
        if eligible_counts[country] < target:
            checks.append(
                CheckResult(
                    code="D4_RAG_COVERAGE_BELOW_TARGET",
                    message=(
                        f"{country} has {eligible_counts[country]} eligible RAG documents; "
                        f"needs {target}"
                    ),
                    location="rag_candidates",
                )
            )


def _validate_rehearsals(
    checks: list[CheckResult],
    bundle: dict[str, Any],
) -> None:
    rehearsals = _index(checks, bundle, "rehearsals", "rehearsal_id")
    expected = dict(REHEARSALS)
    if set(rehearsals) != set(expected):
        checks.append(
            CheckResult(
                code="D4_REHEARSAL_SET_INVALID",
                message="D4 requires import, rebuild, rollback, revoke, and RAG rehearsals",
                location="rehearsals",
            )
        )
    for rehearsal_id, item in rehearsals.items():
        location = f"rehearsals.{rehearsal_id}"
        if rehearsal_id in expected and item.get("name") != expected[rehearsal_id]:
            checks.append(
                CheckResult(
                    code="D4_REHEARSAL_INPUT_CHANGED",
                    message=f"{rehearsal_id} frozen rehearsal name was changed",
                    location=location,
                )
            )
        _required_text(
            checks,
            item,
            (
                "run_id",
                "code_version",
                "input_sha256",
                "output_sha256",
                "operator",
                "reviewer",
                "executed_at",
            ),
            code="D4_REHEARSAL_METADATA_INCOMPLETE",
            location=location,
        )
        if item.get("status") != "passed" or item.get("isolated_environment") is not True:
            checks.append(
                CheckResult(
                    code="D4_REHEARSAL_NOT_PASSED",
                    message=f"{rehearsal_id} must pass in an isolated environment",
                    location=location,
                )
            )
        if item.get("operator") == item.get("reviewer"):
            checks.append(
                CheckResult(
                    code="D4_REHEARSAL_REVIEW_NOT_SEPARATED",
                    message=f"{rehearsal_id} operator and reviewer must differ",
                    location=location,
                )
            )
        if any(
            not SHA256_PATTERN.fullmatch(str(item.get(field) or ""))
            for field in ("input_sha256", "output_sha256")
        ) or not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D4_REHEARSAL_EVIDENCE_INCOMPLETE",
                    message=f"{rehearsal_id} requires hashes and evidence",
                    location=location,
                )
            )
        if (
            rehearsal_id in {"D4-DRILL-ROLLBACK", "D4-DRILL-SOURCE-REVOKE"}
            and item.get("history_preserved") is not True
        ):
            checks.append(
                CheckResult(
                    code="D4_REHEARSAL_HISTORY_NOT_PRESERVED",
                    message=f"{rehearsal_id} must preserve historical evidence",
                    location=location,
                )
            )
        if rehearsal_id == "D4-DRILL-SOURCE-REVOKE" and item.get("residual_count") != 0:
            checks.append(
                CheckResult(
                    code="D4_REVOKE_REHEARSAL_RESIDUAL",
                    message="Source revocation rehearsal must leave zero production residuals",
                    location=location,
                )
            )


def _validate_handover(
    checks: list[CheckResult],
    bundle: dict[str, Any],
) -> None:
    items = _index(checks, bundle, "handover_items", "handover_id")
    expected = dict(HANDOVER_ITEMS)
    if set(items) != set(expected):
        checks.append(
            CheckResult(
                code="D4_HANDOVER_SET_INVALID",
                message="D4 requires all nine frozen handover packages",
                location="handover_items",
            )
        )
    for handover_id, item in items.items():
        location = f"handover_items.{handover_id}"
        if handover_id in expected and item.get("name") != expected[handover_id]:
            checks.append(
                CheckResult(
                    code="D4_HANDOVER_INPUT_CHANGED",
                    message=f"{handover_id} frozen handover item was changed",
                    location=location,
                )
            )
        _required_text(
            checks,
            item,
            ("artifact_sha256", "owner", "reviewer", "reviewed_at"),
            code="D4_HANDOVER_METADATA_INCOMPLETE",
            location=location,
        )
        if (
            item.get("status") != "accepted"
            or item.get("owner") == item.get("reviewer")
            or not SHA256_PATTERN.fullmatch(str(item.get("artifact_sha256") or ""))
            or not item.get("evidence_ids")
        ):
            checks.append(
                CheckResult(
                    code="D4_HANDOVER_NOT_ACCEPTED",
                    message=f"{handover_id} is not independently accepted with evidence",
                    location=location,
                )
            )


def _validate_acceptance(
    checks: list[CheckResult],
    acceptance: Any,
    total_score: float,
) -> None:
    if not isinstance(acceptance, dict):
        checks.append(
            CheckResult(
                code="D4_ACCEPTANCE_INVALID",
                message="acceptance must be an object",
                location="acceptance",
            )
        )
        return
    tasks_payload = acceptance.get("tasks")
    if not isinstance(tasks_payload, list):
        checks.append(
            CheckResult(
                code="D4_ACCEPTANCE_TASKS_INVALID",
                message="D4 acceptance tasks must be a list",
                location="acceptance.tasks",
            )
        )
    else:
        tasks = {
            str(item.get("task_id")): item
            for item in tasks_payload
            if isinstance(item, dict) and item.get("task_id")
        }
        if set(tasks) != {"D4-01", "D4-02", "D4-03", "D4-04"} or any(
            item.get("status") != "completed" or not item.get("evidence_ids")
            for item in tasks.values()
        ):
            checks.append(
                CheckResult(
                    code="D4_ACCEPTANCE_TASKS_INCOMPLETE",
                    message="D4-01 through D4-04 require completed evidence",
                    location="acceptance.tasks",
                )
            )
    reported = acceptance.get("reported_total_score")
    if not _is_number(reported) or not math.isclose(float(reported), total_score, abs_tol=0.01):
        checks.append(
            CheckResult(
                code="D4_ACCEPTANCE_SCORE_MISMATCH",
                message="Reported total score does not match dimension scores",
                location="acceptance.reported_total_score",
            )
        )
    approvals = acceptance.get("committee_approvals")
    if not isinstance(approvals, list):
        checks.append(
            CheckResult(
                code="D4_APPROVALS_INVALID",
                message="committee_approvals must be a list",
                location="acceptance.committee_approvals",
            )
        )
    else:
        roles = {
            str(item.get("role"))
            for item in approvals
            if isinstance(item, dict) and item.get("role")
        }
        if roles != APPROVAL_ROLES:
            checks.append(
                CheckResult(
                    code="D4_APPROVAL_ROLE_SET_INVALID",
                    message=(
                        "D4 requires data, quality, compliance, technical, and committee approvals"
                    ),
                    location="acceptance.committee_approvals",
                )
            )
        for index, item in enumerate(approvals):
            if not isinstance(item, dict):
                continue
            location = f"acceptance.committee_approvals[{index}]"
            _required_text(
                checks,
                item,
                ("role", "person_name", "signed_at", "evidence_id"),
                code="D4_APPROVAL_INCOMPLETE",
                location=location,
            )
            if item.get("decision") != "approved":
                checks.append(
                    CheckResult(
                        code="D4_APPROVAL_NOT_APPROVED",
                        message="Every required D4 approval must be approved",
                        location=location,
                    )
                )
    _required_text(
        checks,
        acceptance,
        ("signed_at", "d4_gate_evidence_id"),
        code="D4_FINAL_SIGNOFF_INCOMPLETE",
        location="acceptance",
    )
    if acceptance.get("decision") != "approved":
        checks.append(
            CheckResult(
                code="D4_FINAL_DECISION_NOT_APPROVED",
                message="Project committee has not approved D4",
                location="acceptance.decision",
            )
        )


def validate_d4_bundle(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d3_bundle: dict[str, Any],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current = build_d4_bundle_template(paths)
    if bundle.get("schema_version") != 1 or bundle.get("stage") != "D4":
        checks.append(
            CheckResult(
                code="D4_HEADER_INVALID",
                message="Bundle requires schema_version 1 and stage D4",
                location="bundle",
            )
        )
    if bundle.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D4_TEMPLATE_UNCOPIED",
                message="Copy the D4 template and set template_only to false",
                location="template_only",
            )
        )
    if bundle.get("append_only") is not True:
        checks.append(
            CheckResult(
                code="D4_APPEND_ONLY_MISSING",
                message="D4 evidence bundle must be append-only",
                location="append_only",
            )
        )
    if bundle.get("baseline") != current["baseline"]:
        checks.append(
            CheckResult(
                code="D4_BASELINE_STALE",
                message="D4 baseline does not match current frozen inputs",
                location="baseline",
            )
        )
    dependencies = bundle.get("dependencies")
    if not isinstance(dependencies, dict) or (
        dependencies.get("d3_gate_status") != "approved"
        or not dependencies.get("d3_gate_evidence_id")
    ):
        checks.append(
            CheckResult(
                code="D4_D3_DEPENDENCY_PENDING",
                message="D3 approval and evidence are required before D4",
                location="dependencies",
            )
        )

    d3_records = _validate_d3_input(checks, d3_bundle)
    sources = _index(checks, bundle, "production_sources", "source_id")
    publications = _index(checks, bundle, "publication_records", "publication_id")
    issues = _index(checks, bundle, "quality_issues", "issue_id")
    for source_id, item in sources.items():
        _validate_source(checks, source_id, item)
    for publication_id, item in publications.items():
        _validate_publication(checks, publication_id, item, d3_records, sources)
    for issue_id, item in issues.items():
        _validate_issue(checks, issue_id, item)

    publication_counts: Counter[tuple[str, str]] = Counter(
        (str(item.get("country")), str(item.get("domain")))
        for item in publications.values()
        if item.get("status") == "published"
    )
    source_counts: Counter[str] = Counter(
        str(item.get("country")) for item in sources.values() if item.get("status") == "active"
    )
    _validate_country_coverage(checks, bundle)
    _validate_domain_coverage(
        checks,
        bundle,
        publication_counts,
        source_counts,
    )
    sampled = _validate_sampling(checks, bundle)
    traceable_count = sum(
        item.get("traceability_complete") is True for item in publications.values()
    )
    licensed_source_count = sum(
        item.get("license_status") == "approved"
        and item.get("permission_metadata_complete") is True
        for item in sources.values()
    )
    p0_open_count = sum(
        item.get("severity") == "P0" and item.get("status") != "resolved"
        for item in issues.values()
    )
    _validate_hard_gate_metrics(
        checks,
        bundle.get("hard_gate_metrics"),
        publication_count=len(publications),
        traceable_count=traceable_count,
        source_count=len(sources),
        licensed_source_count=licensed_source_count,
        sampled=sampled,
        p0_open_count=p0_open_count,
    )
    _validate_seed_package(checks, bundle.get("seed_package"), len(publications))
    _validate_rag_candidates(checks, bundle, publications, sources)
    _validate_rehearsals(checks, bundle)
    _validate_handover(checks, bundle)
    total_score = _validate_dimensions(checks, bundle)
    _validate_acceptance(checks, bundle.get("acceptance"), total_score)
    return checks


def load_and_validate_d4_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
    d3_bundle_path: Path,
) -> list[CheckResult]:
    payloads: list[dict[str, Any]] = []
    for label, path in (("bundle", bundle_path), ("D3 bundle", d3_bundle_path)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            return [
                CheckResult(
                    code="D4_ARTIFACT_INVALID",
                    message=f"Cannot read {label}: {error}",
                    location=str(path),
                )
            ]
        if not isinstance(payload, dict):
            return [
                CheckResult(
                    code="D4_ARTIFACT_INVALID",
                    message=f"{label} root must be an object",
                    location=str(path),
                )
            ]
        payloads.append(payload)
    return validate_d4_bundle(paths, payloads[0], payloads[1])
