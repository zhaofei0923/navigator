from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .baseline import extract_contracts, sha256_file
from .models import CheckResult
from .paths import RepositoryPaths
from .readiness import build_readiness_report

SOURCE_STATES = {"under_review", "active", "degraded", "blocked", "retired"}
BOUNDARY_STATES = {"pending", "allowed", "prohibited", "conditional", "not_applicable"}
FINAL_BOUNDARY_STATES = BOUNDARY_STATES - {"pending"}
ACCESS_DECISIONS = {"pending", "allowed", "prohibited", "manual_only", "contract_limited"}
FINAL_ACCESS_DECISIONS = ACCESS_DECISIONS - {"pending"}

USE_BOUNDARIES = (
    "collect_metadata",
    "collect_content",
    "cache_original",
    "store_structured",
    "summarize",
    "translate",
    "display_excerpt",
    "display_original",
    "export",
    "download",
    "ai_index",
    "model_training",
)

COUNTRY_SOURCE_TARGETS = {
    "IDN": 20,
    "VNM": 8,
    "SAU": 8,
    "ZAF": 8,
    "BRA": 8,
}

REGION_CODES = {
    "跨国": "GLOBAL",
    "亚洲": "REGION-ASIA",
    "非洲": "REGION-AFRICA",
}


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(serialized).hexdigest()


def _seed_scope(value: Any) -> list[str]:
    text = str(value or "").strip()
    return [REGION_CODES.get(text, text)] if text else []


def _seed_source(item: dict[str, Any]) -> dict[str, Any]:
    entry_url = str(item.get("入口URL", "")).strip()
    domain = urlparse(entry_url).hostname
    return {
        "source_id": str(item["来源编号"]),
        "organization": item.get("机构"),
        "canonical_domain": domain,
        "entry_url": entry_url,
        "scope_codes": _seed_scope(item.get("国家/区域")),
        "source_type": "pending_classification",
        "authority_level": item.get("等级"),
        "evidence_scope": item.get("主要数据"),
        "languages": [],
        "access_method": item.get("访问方式"),
        "suggested_frequency": item.get("建议频率"),
        "business_owner_group": item.get("责任组"),
        "technical_owner": None,
        "data_owner_reviewer": None,
        "compliance_reviewer": None,
        "reviewed_at": None,
        "next_review_at": None,
        "terms_snapshot_id": None,
        "license_snapshot_id": None,
        "robots_snapshot_id": None,
        "attribution_requirement": None,
        "retention_rule": None,
        "review_notes": item.get("复核备注"),
        "usage_boundaries": dict.fromkeys(USE_BOUNDARIES, "pending"),
        "boundary_conditions": {},
        "access_policy": {
            "automation": "pending",
            "login_required": None,
            "paid_access": None,
            "captcha_observed": None,
            "geo_restricted": None,
            "rate_limit": None,
            "identifiable_user_agent_required": None,
            "access_control_bypass_prohibited": True,
        },
        "approval_evidence_ids": [],
        "status": "under_review",
    }


def _baseline(paths: RepositoryPaths, contracts: dict[str, Any]) -> dict[str, Any]:
    relevant_inputs = {
        key: contracts[key]
        for key in ("countries", "domain_targets", "source_registry_seed", "d0_d4_roadmap")
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
        "d1_input_sha256": _payload_sha256(relevant_inputs),
    }


def build_source_registry_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    return {
        "schema_version": 1,
        "stage": "D1",
        "template_only": True,
        "warning": ("起始来源仅为待复核候选；公开可访问不等于允许批量采集、保存、再分发或AI使用"),
        "baseline": _baseline(paths, contracts),
        "sources": [_seed_source(item) for item in contracts["source_registry_seed"]],
    }


def _matrix_domains(contracts: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "domain_id": str(item["域编号"]),
            "domain_name": str(item["数据域"]),
        }
        for item in contracts["domain_targets"]
        if str(item.get("域编号")) != "DOM-SOURCE"
    ]


def build_domain_source_matrix_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    domains = _matrix_domains(contracts)
    countries = [str(item["ISO3"]) for item in contracts["countries"]]
    return {
        "schema_version": 1,
        "stage": "D1",
        "template_only": True,
        "baseline": _baseline(paths, contracts),
        "requirements": {
            "country_source_targets": COUNTRY_SOURCE_TARGETS,
            "domain_count": len(domains),
            "rule": "每个国家和核心数据域必须绑定一个active优先来源和一个不同的active替代来源",
        },
        "assignments": [
            {
                "country": country,
                **domain,
                "primary_source_id": None,
                "alternative_source_id": None,
                "approved_by": None,
                "approved_at": None,
                "evidence_ids": [],
                "status": "pending",
            }
            for country in countries
            for domain in domains
        ],
    }


def _scope_counts(sources: list[dict[str, Any]], *, active_only: bool) -> Counter[str]:
    counts: Counter[str] = Counter()
    for item in sources:
        if active_only and item.get("status") != "active":
            continue
        scopes = item.get("scope_codes")
        if isinstance(scopes, list):
            counts.update({str(scope) for scope in scopes})
    return counts


def build_source_coverage_gap_report(paths: RepositoryPaths) -> dict[str, Any]:
    registry = build_source_registry_template(paths)
    sources = registry["sources"]
    candidate_counts = _scope_counts(sources, active_only=False)
    return {
        "schema_version": 1,
        "stage": "D1",
        "status": "incomplete",
        "purpose": "D1国家来源数量候选缺口；候选数不等于已准入active来源数",
        "seed_source_count": len(sources),
        "countries": [
            {
                "country": country,
                "target": target,
                "seed_candidates": candidate_counts[country],
                "active_sources": 0,
                "candidate_gap": max(target - candidate_counts[country], 0),
                "active_gap": target,
            }
            for country, target in COUNTRY_SOURCE_TARGETS.items()
        ],
        "regional_or_global_seed_count": sum(
            candidate_counts[scope] for scope in ("GLOBAL", "REGION-ASIA", "REGION-AFRICA")
        ),
    }


def build_d1_assessment(paths: RepositoryPaths) -> dict[str, Any]:
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    gap = build_source_coverage_gap_report(paths)
    return {
        "schema_version": 1,
        "stage": "D1",
        "overall_status": "not_ready",
        "automated_assessment_only": True,
        "d0_dependency_ready": build_readiness_report(paths).ready,
        "checks": [
            {
                "check_id": "D1-SEED-REGISTRY",
                "status": "candidate_generated",
                "finding": f"{len(registry['sources'])}个起始候选均为under_review",
            },
            {
                "check_id": "D1-COUNTRY-THRESHOLDS",
                "status": "fail",
                "finding": gap["countries"],
            },
            {
                "check_id": "D1-DOMAIN-ALTERNATIVES",
                "status": "fail",
                "finding": f"{len(matrix['assignments'])}个国家/数据域组合尚未绑定优先和替代来源",
            },
            {
                "check_id": "D1-COMPLIANCE-APPROVAL",
                "status": "fail",
                "finding": "所有候选仍缺条款、许可、robots、用途边界和数据/合规批准",
            },
        ],
    }


def d1_candidate_payloads(paths: RepositoryPaths) -> dict[str, dict[str, Any]]:
    return {
        "d1_acceptance_assessment.json": build_d1_assessment(paths),
        "domain_source_matrix.template.json": build_domain_source_matrix_template(paths),
        "source_admission_registry.template.json": build_source_registry_template(paths),
        "source_coverage_gap_report.json": build_source_coverage_gap_report(paths),
    }


def write_d1_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d1_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in d1_candidate_payloads(paths).items():
        destination = paths.d1_candidates_dir / filename
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


def _validate_baseline(
    checks: list[CheckResult],
    current: dict[str, Any],
    submitted: Any,
    *,
    location: str,
) -> None:
    if not isinstance(submitted, dict) or submitted != current:
        checks.append(
            CheckResult(
                code="D1_BASELINE_STALE",
                message="D1 artifact baseline does not match the current frozen inputs",
                location=location,
            )
        )


def _index_sources(
    checks: list[CheckResult],
    registry: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    sources = registry.get("sources")
    if not isinstance(sources, list):
        checks.append(
            CheckResult(
                code="D1_SOURCE_LIST_INVALID",
                message="Registry sources must be a list",
                location="registry.sources",
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(sources):
        if not isinstance(item, dict) or not str(item.get("source_id") or "").strip():
            checks.append(
                CheckResult(
                    code="D1_SOURCE_ENTRY_INVALID",
                    message=f"Source entry {index} requires source_id",
                    location="registry.sources",
                )
            )
            continue
        source_id = str(item["source_id"]).strip()
        if source_id in indexed:
            checks.append(
                CheckResult(
                    code="D1_SOURCE_ID_DUPLICATE",
                    message=f"Duplicate source_id: {source_id}",
                    location="registry.sources",
                )
            )
            continue
        indexed[source_id] = item
    return indexed


def _validate_source(
    checks: list[CheckResult],
    source_id: str,
    item: dict[str, Any],
) -> None:
    location = f"registry.sources.{source_id}"
    _required_text(
        checks,
        item,
        (
            "organization",
            "canonical_domain",
            "entry_url",
            "source_type",
            "authority_level",
            "evidence_scope",
            "access_method",
            "business_owner_group",
        ),
        code="D1_SOURCE_METADATA_INCOMPLETE",
        location=location,
    )
    source_scopes = item.get("scope_codes")
    if not isinstance(source_scopes, list) or not source_scopes:
        checks.append(
            CheckResult(
                code="D1_SOURCE_SCOPE_MISSING",
                message=f"{source_id} requires at least one explicit scope code",
                location=location,
            )
        )
    if item.get("authority_level") not in {"A", "B", "C", "D"}:
        checks.append(
            CheckResult(
                code="D1_SOURCE_AUTHORITY_INVALID",
                message=f"{source_id} authority_level must be A, B, C, or D",
                location=location,
            )
        )
    entry_url = urlparse(str(item.get("entry_url") or ""))
    if (
        entry_url.scheme not in {"http", "https"}
        or not entry_url.hostname
        or entry_url.hostname != item.get("canonical_domain")
    ):
        checks.append(
            CheckResult(
                code="D1_SOURCE_URL_INVALID",
                message=f"{source_id} entry URL and canonical domain are inconsistent",
                location=location,
            )
        )
    if item.get("status") not in SOURCE_STATES:
        checks.append(
            CheckResult(
                code="D1_SOURCE_STATUS_INVALID",
                message=f"{source_id} has invalid status: {item.get('status')}",
                location=location,
            )
        )
    access_policy = item.get("access_policy")
    if not isinstance(access_policy, dict):
        checks.append(
            CheckResult(
                code="D1_ACCESS_POLICY_INVALID",
                message=f"{source_id} access_policy must be an object",
                location=location,
            )
        )
    elif access_policy.get("access_control_bypass_prohibited") is not True:
        checks.append(
            CheckResult(
                code="D1_BYPASS_PROHIBITION_MISSING",
                message=f"{source_id} must explicitly prohibit bypassing access controls",
                location=location,
            )
        )
    if item.get("status") != "active":
        return

    if item.get("source_type") == "pending_classification":
        checks.append(
            CheckResult(
                code="D1_ACTIVE_CLASSIFICATION_PENDING",
                message=f"{source_id} source_type must be classified before activation",
                location=location,
            )
        )
    languages = item.get("languages")
    if not isinstance(languages, list) or not languages:
        checks.append(
            CheckResult(
                code="D1_ACTIVE_LANGUAGES_MISSING",
                message=f"{source_id} requires at least one reviewed source language",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "technical_owner",
            "data_owner_reviewer",
            "compliance_reviewer",
            "reviewed_at",
            "next_review_at",
            "terms_snapshot_id",
            "license_snapshot_id",
            "robots_snapshot_id",
            "attribution_requirement",
            "retention_rule",
        ),
        code="D1_ACTIVE_APPROVAL_INCOMPLETE",
        location=location,
    )
    if not item.get("approval_evidence_ids"):
        checks.append(
            CheckResult(
                code="D1_ACTIVE_EVIDENCE_MISSING",
                message=f"{source_id} requires approval evidence IDs",
                location=location,
            )
        )

    boundaries = item.get("usage_boundaries")
    if not isinstance(boundaries, dict):
        checks.append(
            CheckResult(
                code="D1_USAGE_BOUNDARIES_INVALID",
                message=f"{source_id} usage_boundaries must be an object",
                location=location,
            )
        )
    else:
        missing = sorted(set(USE_BOUNDARIES) - set(boundaries))
        invalid = sorted(
            name
            for name in USE_BOUNDARIES
            if name in boundaries and boundaries[name] not in FINAL_BOUNDARY_STATES
        )
        if missing or invalid:
            checks.append(
                CheckResult(
                    code="D1_USAGE_BOUNDARIES_INCOMPLETE",
                    message=(
                        f"{source_id} missing boundaries {missing} or has unresolved boundaries "
                        f"{invalid}"
                    ),
                    location=location,
                )
            )
        conditional = {name for name, value in boundaries.items() if value == "conditional"}
        conditions = item.get("boundary_conditions")
        if conditional and (
            not isinstance(conditions, dict)
            or any(not str(conditions.get(name) or "").strip() for name in conditional)
        ):
            checks.append(
                CheckResult(
                    code="D1_BOUNDARY_CONDITIONS_MISSING",
                    message=f"{source_id} conditional uses require written conditions",
                    location=location,
                )
            )

    if not isinstance(access_policy, dict):
        return
    automation = access_policy.get("automation")
    if automation not in FINAL_ACCESS_DECISIONS:
        checks.append(
            CheckResult(
                code="D1_AUTOMATION_DECISION_PENDING",
                message=f"{source_id} requires a final automation decision",
                location=location,
            )
        )
    boolean_fields = (
        "login_required",
        "paid_access",
        "captcha_observed",
        "geo_restricted",
        "identifiable_user_agent_required",
    )
    unresolved_access_fields = [
        field for field in boolean_fields if not isinstance(access_policy.get(field), bool)
    ]
    if unresolved_access_fields:
        checks.append(
            CheckResult(
                code="D1_ACCESS_POLICY_INCOMPLETE",
                message=(
                    f"{source_id} requires explicit boolean access decisions: "
                    f"{', '.join(unresolved_access_fields)}"
                ),
                location=location,
            )
        )
    if (
        automation in {"allowed", "contract_limited"}
        and not str(access_policy.get("rate_limit") or "").strip()
    ):
        checks.append(
            CheckResult(
                code="D1_RATE_LIMIT_MISSING",
                message=f"{source_id} automated access requires a written rate limit",
                location=location,
            )
        )
    if automation == "allowed" and any(
        access_policy.get(flag) is True for flag in ("captcha_observed", "geo_restricted")
    ):
        checks.append(
            CheckResult(
                code="D1_AUTOMATION_CONFLICT",
                message=f"{source_id} cannot allow automation through captcha or geo restrictions",
                location=location,
            )
        )
    if access_policy.get("paid_access") is True and automation == "allowed":
        checks.append(
            CheckResult(
                code="D1_PAID_ACCESS_AUTOMATION_UNSCOPED",
                message=f"{source_id} paid access must use contract_limited or manual_only",
                location=location,
            )
        )
    if access_policy.get("login_required") is True and automation == "allowed":
        checks.append(
            CheckResult(
                code="D1_LOGIN_AUTOMATION_UNSCOPED",
                message=f"{source_id} login automation must be contract_limited or manual_only",
                location=location,
            )
        )


def _index_assignments(
    checks: list[CheckResult],
    matrix: dict[str, Any],
) -> dict[tuple[str, str], dict[str, Any]]:
    assignments = matrix.get("assignments")
    if not isinstance(assignments, list):
        checks.append(
            CheckResult(
                code="D1_MATRIX_LIST_INVALID",
                message="Matrix assignments must be a list",
                location="matrix.assignments",
            )
        )
        return {}
    indexed: dict[tuple[str, str], dict[str, Any]] = {}
    for index, item in enumerate(assignments):
        if not isinstance(item, dict):
            checks.append(
                CheckResult(
                    code="D1_MATRIX_ENTRY_INVALID",
                    message=f"Matrix entry {index} must be an object",
                    location="matrix.assignments",
                )
            )
            continue
        key = (str(item.get("country") or ""), str(item.get("domain_id") or ""))
        if not all(key):
            checks.append(
                CheckResult(
                    code="D1_MATRIX_ENTRY_INVALID",
                    message=f"Matrix entry {index} requires country and domain_id",
                    location="matrix.assignments",
                )
            )
            continue
        if key in indexed:
            checks.append(
                CheckResult(
                    code="D1_MATRIX_ENTRY_DUPLICATE",
                    message=f"Duplicate matrix entry: {key[0]}/{key[1]}",
                    location="matrix.assignments",
                )
            )
            continue
        indexed[key] = item
    return indexed


def validate_d1_admission(
    paths: RepositoryPaths,
    registry: dict[str, Any],
    matrix: dict[str, Any],
    *,
    d0_ready: bool | None = None,
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current_registry = build_source_registry_template(paths)
    current_matrix = build_domain_source_matrix_template(paths)

    if registry.get("schema_version") != 1 or registry.get("stage") != "D1":
        checks.append(
            CheckResult(
                code="D1_REGISTRY_HEADER_INVALID",
                message="Registry requires schema_version 1 and stage D1",
                location="registry",
            )
        )
    if matrix.get("schema_version") != 1 or matrix.get("stage") != "D1":
        checks.append(
            CheckResult(
                code="D1_MATRIX_HEADER_INVALID",
                message="Matrix requires schema_version 1 and stage D1",
                location="matrix",
            )
        )
    if registry.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D1_REGISTRY_TEMPLATE_UNCOPIED",
                message="Copy the registry template and set template_only to false",
                location="registry.template_only",
            )
        )
    if matrix.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D1_MATRIX_TEMPLATE_UNCOPIED",
                message="Copy the matrix template and set template_only to false",
                location="matrix.template_only",
            )
        )

    _validate_baseline(
        checks,
        current_registry["baseline"],
        registry.get("baseline"),
        location="registry.baseline",
    )
    _validate_baseline(
        checks,
        current_matrix["baseline"],
        matrix.get("baseline"),
        location="matrix.baseline",
    )

    sources = _index_sources(checks, registry)
    expected_seed_ids = {str(item["source_id"]) for item in current_registry["sources"]}
    missing_seed_ids = sorted(expected_seed_ids - set(sources))
    if missing_seed_ids:
        checks.append(
            CheckResult(
                code="D1_SEED_SOURCE_MISSING",
                message=f"Missing frozen seed sources: {', '.join(missing_seed_ids)}",
                location="registry.sources",
            )
        )
    for source_id, item in sources.items():
        _validate_source(checks, source_id, item)

    active_counts = _scope_counts(list(sources.values()), active_only=True)
    for country, target in COUNTRY_SOURCE_TARGETS.items():
        if active_counts[country] < target:
            checks.append(
                CheckResult(
                    code="D1_COUNTRY_SOURCE_TARGET_UNMET",
                    message=(
                        f"{country} has {active_counts[country]} active sources; requires {target}"
                    ),
                    location="registry.sources",
                )
            )

    assignments = _index_assignments(checks, matrix)
    expected_assignment_keys = {
        (str(item["country"]), str(item["domain_id"])) for item in current_matrix["assignments"]
    }
    missing_assignments = sorted(expected_assignment_keys - set(assignments))
    unknown_assignments = sorted(set(assignments) - expected_assignment_keys)
    if missing_assignments or unknown_assignments:
        checks.append(
            CheckResult(
                code="D1_MATRIX_SET_INVALID",
                message=(
                    f"Missing assignments: {missing_assignments}; "
                    f"unknown assignments: {unknown_assignments}"
                ),
                location="matrix.assignments",
            )
        )
    for key, item in assignments.items():
        location = f"matrix.assignments.{key[0]}/{key[1]}"
        primary = str(item.get("primary_source_id") or "").strip()
        alternative = str(item.get("alternative_source_id") or "").strip()
        if not primary or not alternative or primary == alternative:
            checks.append(
                CheckResult(
                    code="D1_MATRIX_SOURCES_INCOMPLETE",
                    message=f"{key[0]}/{key[1]} requires distinct primary and alternative sources",
                    location=location,
                )
            )
        else:
            for source_id in (primary, alternative):
                source = sources.get(source_id)
                if source is None or source.get("status") != "active":
                    checks.append(
                        CheckResult(
                            code="D1_MATRIX_SOURCE_NOT_ACTIVE",
                            message=f"{source_id} is not an active registered source",
                            location=location,
                        )
                    )
                elif key[0] not in source.get("scope_codes", []):
                    checks.append(
                        CheckResult(
                            code="D1_MATRIX_SOURCE_SCOPE_MISMATCH",
                            message=f"{source_id} does not cover {key[0]}",
                            location=location,
                        )
                    )
        if item.get("status") != "approved":
            checks.append(
                CheckResult(
                    code="D1_MATRIX_APPROVAL_PENDING",
                    message=f"{key[0]}/{key[1]} assignment is not approved",
                    location=location,
                )
            )
        else:
            _required_text(
                checks,
                item,
                ("approved_by", "approved_at"),
                code="D1_MATRIX_APPROVAL_INCOMPLETE",
                location=location,
            )
            if not item.get("evidence_ids"):
                checks.append(
                    CheckResult(
                        code="D1_MATRIX_EVIDENCE_MISSING",
                        message=f"{key[0]}/{key[1]} requires evidence IDs",
                        location=location,
                    )
                )

    dependency_ready = build_readiness_report(paths).ready if d0_ready is None else d0_ready
    if not dependency_ready:
        checks.append(
            CheckResult(
                code="D1_D0_DEPENDENCY_PENDING",
                message="D0 formal gate must pass before D1 sources can be activated",
                location="D0",
            )
        )
    return checks


def load_and_validate_d1_admission(
    paths: RepositoryPaths,
    registry_path: Path,
    matrix_path: Path,
) -> list[CheckResult]:
    payloads: list[dict[str, Any]] = []
    for label, path in (("registry", registry_path), ("matrix", matrix_path)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            return [
                CheckResult(
                    code="D1_ARTIFACT_INVALID",
                    message=f"Cannot read {label}: {error}",
                    location=str(path),
                )
            ]
        if not isinstance(payload, dict):
            return [
                CheckResult(
                    code="D1_ARTIFACT_INVALID",
                    message=f"{label} root must be an object",
                    location=str(path),
                )
            ]
        payloads.append(payload)
    return validate_d1_admission(paths, payloads[0], payloads[1])
