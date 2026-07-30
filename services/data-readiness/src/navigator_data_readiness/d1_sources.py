from __future__ import annotations

import hashlib
import json
import re
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
RESEARCH_CATALOG_NAME = "official_source_candidates.json"
RESEARCH_STATUS = "official_candidate_identified"
APPROVED_EVIDENCE_STATES = {"approved"}
SOURCE_EVIDENCE_KINDS = {
    "source_identity",
    "terms_snapshot",
    "license_snapshot",
    "robots_snapshot",
    "access_review",
    "usage_boundary_approval",
    "pilot_result",
    "admission_approval",
}
ASSIGNMENT_EVIDENCE_KIND = "domain_source_approval"
SNAPSHOT_EVIDENCE_FIELDS = {
    "terms_snapshot_id": "terms_snapshot",
    "license_snapshot_id": "license_snapshot",
    "robots_snapshot_id": "robots_snapshot",
}

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


def load_official_source_candidates(paths: RepositoryPaths) -> dict[str, Any]:
    catalog_path = paths.d1_research_dir / RESEARCH_CATALOG_NAME
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError(f"Cannot read D1 official-source research catalog: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError("D1 official-source research catalog root must be an object")
    if (
        payload.get("schema_version") != 1
        or payload.get("stage") != "D1"
        or payload.get("status") != "research_only"
    ):
        raise ValueError(
            "D1 official-source research catalog requires schema_version 1, "
            "stage D1, and research_only status"
        )
    for field in ("captured_on", "warning", "verification_method"):
        if not str(payload.get(field) or "").strip():
            raise ValueError(f"D1 official-source research catalog requires {field}")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("D1 official-source research candidates must be a list")

    required_text = (
        "source_id",
        "organization",
        "country",
        "entry_url",
        "source_type",
        "authority_level",
        "evidence_scope",
        "access_method",
        "suggested_frequency",
        "business_owner_group",
        "research_status",
        "research_notes",
    )
    source_ids: set[str] = set()
    for index, item in enumerate(candidates):
        if not isinstance(item, dict):
            raise ValueError(f"D1 research candidate {index} must be an object")
        missing = [field for field in required_text if not str(item.get(field) or "").strip()]
        if missing:
            raise ValueError(
                f"D1 research candidate {index} missing required fields: {', '.join(missing)}"
            )
        source_id = str(item["source_id"]).strip()
        if source_id in source_ids:
            raise ValueError(f"Duplicate D1 research source_id: {source_id}")
        source_ids.add(source_id)
        country = str(item["country"]).strip()
        if country not in COUNTRY_SOURCE_TARGETS:
            raise ValueError(f"{source_id} has unsupported country: {country}")
        entry_url = urlparse(str(item["entry_url"]).strip())
        if entry_url.scheme != "https" or not entry_url.hostname:
            raise ValueError(f"{source_id} requires an HTTPS official entry URL")
        if item.get("authority_level") not in {"A", "B"}:
            raise ValueError(f"{source_id} research authority_level must be A or B")
        languages = item.get("languages")
        if (
            not isinstance(languages, list)
            or not languages
            or not all(str(value).strip() for value in languages)
        ):
            raise ValueError(f"{source_id} requires one or more research languages")
        if item.get("research_status") != RESEARCH_STATUS:
            raise ValueError(
                f"{source_id} research_status must remain {RESEARCH_STATUS} before admission"
            )
        if item.get("status") == "active":
            raise ValueError(f"{source_id} research catalog cannot mark a source active")
    return payload


def _research_catalog_evidence_baseline(paths: RepositoryPaths) -> dict[str, str]:
    evidence_path = paths.d1_evidence_dir / "research_catalog_baseline.json"
    try:
        payload = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError(f"Cannot read D1 research catalog evidence baseline: {error}") from error
    expected_catalog_path = (
        (paths.d1_research_dir / RESEARCH_CATALOG_NAME).relative_to(paths.root).as_posix()
    )
    expected_catalog_hash = sha256_file(paths.d1_research_dir / RESEARCH_CATALOG_NAME)
    source_catalog = payload.get("source_catalog") if isinstance(payload, dict) else None
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("stage") != "D1"
        or payload.get("status") != "research_only"
        or not isinstance(source_catalog, dict)
        or source_catalog.get("path") != expected_catalog_path
        or source_catalog.get("sha256") != expected_catalog_hash
    ):
        raise ValueError(
            "D1 research catalog evidence baseline does not match the current research catalog"
        )
    return {
        "path": evidence_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(evidence_path),
    }


def _research_source(item: dict[str, Any]) -> dict[str, Any]:
    entry_url = str(item["entry_url"]).strip()
    return {
        "source_id": str(item["source_id"]).strip(),
        "organization": item["organization"],
        "canonical_domain": urlparse(entry_url).hostname,
        "entry_url": entry_url,
        "scope_codes": [str(item["country"]).strip()],
        "source_type": item["source_type"],
        "authority_level": item["authority_level"],
        "evidence_scope": item["evidence_scope"],
        "languages": item["languages"],
        "access_method": item["access_method"],
        "suggested_frequency": item["suggested_frequency"],
        "business_owner_group": item["business_owner_group"],
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
        "review_notes": item["research_notes"],
        "research_provenance": {
            "catalog": f"data/d1/research/{RESEARCH_CATALOG_NAME}",
            "status": item["research_status"],
        },
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


def _validate_research_coverage(
    seed_sources: list[dict[str, Any]],
    research_sources: list[dict[str, Any]],
) -> None:
    seed_counts = _scope_counts(seed_sources, active_only=False)
    research_counts = _scope_counts(research_sources, active_only=False)
    findings: list[str] = []
    for country, target in COUNTRY_SOURCE_TARGETS.items():
        required_research = max(target - seed_counts[country], 0)
        if research_counts[country] != required_research:
            findings.append(
                f"{country} requires {required_research} researched candidates, "
                f"found {research_counts[country]}"
            )
    if findings:
        raise ValueError("D1 research coverage mismatch: " + "; ".join(findings))


def _baseline(
    paths: RepositoryPaths,
    contracts: dict[str, Any],
    research_catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalog = research_catalog or load_official_source_candidates(paths)
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
            "official_source_research_catalog": {
                "path": (paths.d1_research_dir / RESEARCH_CATALOG_NAME)
                .relative_to(paths.root)
                .as_posix(),
                "sha256": sha256_file(paths.d1_research_dir / RESEARCH_CATALOG_NAME),
            },
        },
        "d1_input_sha256": _payload_sha256(
            {
                "frozen_contracts": relevant_inputs,
                "official_source_research_catalog": catalog,
            }
        ),
    }


def build_source_registry_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    research_catalog = load_official_source_candidates(paths)
    seed_sources = [_seed_source(item) for item in contracts["source_registry_seed"]]
    research_sources = [_research_source(item) for item in research_catalog["candidates"]]
    seed_ids = {str(item["source_id"]) for item in seed_sources}
    research_ids = {str(item["source_id"]) for item in research_sources}
    overlap = sorted(seed_ids & research_ids)
    if overlap:
        raise ValueError(f"D1 research source IDs overlap frozen seeds: {', '.join(overlap)}")
    _validate_research_coverage(seed_sources, research_sources)
    return {
        "schema_version": 1,
        "stage": "D1",
        "template_only": True,
        "warning": ("所有来源仅为待复核候选；公开可访问不等于允许批量采集、保存、再分发或AI使用"),
        "baseline": _baseline(paths, contracts, research_catalog),
        "sources": [*seed_sources, *research_sources],
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


def build_d1_evidence_manifest_template(paths: RepositoryPaths) -> dict[str, Any]:
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    return {
        "schema_version": 1,
        "stage": "D1",
        "template_only": True,
        "warning": (
            "证据必须由实际复核人生成并保存；机器不得代签、伪造审批、"
            "用空文件充当快照或把待审来源改为active"
        ),
        "baseline": {
            "registry_baseline": registry["baseline"],
            "registry_template_sha256": _payload_sha256(registry),
            "matrix_template_sha256": _payload_sha256(matrix),
            "research_catalog_evidence": _research_catalog_evidence_baseline(paths),
        },
        "requirements": {
            "source_evidence_kinds": sorted(SOURCE_EVIDENCE_KINDS),
            "assignment_evidence_kind": ASSIGNMENT_EVIDENCE_KIND,
            "evidence_status": sorted(APPROVED_EVIDENCE_STATES),
            "path_rule": "data/d1/evidence内的仓库相对路径；文件必须非空且SHA-256匹配",
        },
        "source_checklists": [
            {
                "source_id": item["source_id"],
                "status": "pending",
                "required_evidence_kinds": sorted(SOURCE_EVIDENCE_KINDS),
                "evidence_ids": [],
            }
            for item in registry["sources"]
        ],
        "assignment_checklists": [
            {
                "assignment_key": f"{item['country']}/{item['domain_id']}",
                "status": "pending",
                "required_evidence_kind": ASSIGNMENT_EVIDENCE_KIND,
                "evidence_ids": [],
            }
            for item in matrix["assignments"]
        ],
        "evidence": [],
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
    contracts = extract_contracts(paths)
    frozen_sources = [_seed_source(item) for item in contracts["source_registry_seed"]]
    research_sources = [
        _research_source(item) for item in load_official_source_candidates(paths)["candidates"]
    ]
    candidate_counts = _scope_counts(sources, active_only=False)
    frozen_counts = _scope_counts(frozen_sources, active_only=False)
    research_counts = _scope_counts(research_sources, active_only=False)
    return {
        "schema_version": 1,
        "stage": "D1",
        "status": "incomplete",
        "purpose": "D1国家来源数量候选缺口；候选数不等于已准入active来源数",
        "candidate_source_count": len(sources),
        "frozen_seed_source_count": len(frozen_sources),
        "researched_candidate_count": len(research_sources),
        "countries": [
            {
                "country": country,
                "target": target,
                "frozen_seed_candidates": frozen_counts[country],
                "researched_candidates": research_counts[country],
                "candidate_sources": candidate_counts[country],
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
    researched_count = gap["researched_candidate_count"]
    frozen_count = gap["frozen_seed_source_count"]
    country_candidates_ready = all(item["candidate_gap"] == 0 for item in gap["countries"])
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
                "finding": (
                    f"{frozen_count}个冻结起始来源和{researched_count}个官方研究候选"
                    f"共{len(registry['sources'])}个，均为under_review"
                ),
            },
            {
                "check_id": "D1-COUNTRY-THRESHOLDS",
                "status": "candidate_generated" if country_candidates_ready else "fail",
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
        "d1_evidence_manifest.template.json": build_d1_evidence_manifest_template(paths),
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


def _string_values(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {str(item).strip() for item in value}


def _validate_d1_evidence_manifest(
    paths: RepositoryPaths,
    evidence_manifest: dict[str, Any],
    sources: dict[str, dict[str, Any]],
    assignments: dict[tuple[str, str], dict[str, Any]],
    current_template: dict[str, Any],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    if evidence_manifest.get("schema_version") != 1 or evidence_manifest.get("stage") != "D1":
        checks.append(
            CheckResult(
                code="D1_EVIDENCE_HEADER_INVALID",
                message="Evidence manifest requires schema_version 1 and stage D1",
                location="evidence",
            )
        )
    if evidence_manifest.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D1_EVIDENCE_TEMPLATE_UNCOPIED",
                message="Copy the evidence template and set template_only to false",
                location="evidence.template_only",
            )
        )
    if evidence_manifest.get("baseline") != current_template["baseline"]:
        checks.append(
            CheckResult(
                code="D1_EVIDENCE_BASELINE_STALE",
                message="Evidence baseline does not match the current D1 candidate templates",
                location="evidence.baseline",
            )
        )

    entries = evidence_manifest.get("evidence")
    if not isinstance(entries, list):
        return [
            *checks,
            CheckResult(
                code="D1_EVIDENCE_LIST_INVALID",
                message="Evidence manifest field 'evidence' must be a list",
                location="evidence.evidence",
            ),
        ]

    root = paths.root.resolve()
    evidence_root = paths.d1_evidence_dir.resolve()
    known_source_ids = set(sources)
    known_assignment_keys = {f"{country}/{domain}" for country, domain in assignments}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(entries):
        location = f"evidence.evidence[{index}]"
        if not isinstance(item, dict):
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_ENTRY_INVALID",
                    message=f"Evidence entry {index} must be an object",
                    location=location,
                )
            )
            continue
        missing = [
            field
            for field in (
                "evidence_id",
                "evidence_kind",
                "path",
                "sha256",
                "reviewer",
                "reviewed_at",
                "status",
            )
            if not str(item.get(field) or "").strip()
        ]
        if missing:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_METADATA_INCOMPLETE",
                    message=f"Missing required fields: {', '.join(missing)}",
                    location=location,
                )
            )
            continue
        evidence_id = str(item["evidence_id"]).strip()
        if evidence_id in indexed:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_ID_DUPLICATE",
                    message=f"Duplicate evidence_id: {evidence_id}",
                    location=location,
                )
            )
            continue
        indexed[evidence_id] = item

        evidence_kind = str(item["evidence_kind"]).strip()
        allowed_kinds = SOURCE_EVIDENCE_KINDS | {ASSIGNMENT_EVIDENCE_KIND}
        if evidence_kind not in allowed_kinds:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_KIND_INVALID",
                    message=f"Unsupported evidence kind: {evidence_kind}",
                    location=location,
                )
            )
        if item.get("status") not in APPROVED_EVIDENCE_STATES:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_STATUS_INVALID",
                    message=f"{evidence_id} is not approved",
                    location=location,
                )
            )

        source_ids = item.get("source_ids", [])
        assignment_keys = item.get("assignment_keys", [])
        if evidence_kind in SOURCE_EVIDENCE_KINDS:
            if (
                not isinstance(source_ids, list)
                or not source_ids
                or assignment_keys not in (None, [])
            ):
                checks.append(
                    CheckResult(
                        code="D1_EVIDENCE_SCOPE_INVALID",
                        message=f"{evidence_id} requires source_ids only",
                        location=location,
                    )
                )
            elif unknown_sources := sorted(_string_values(source_ids) - known_source_ids):
                checks.append(
                    CheckResult(
                        code="D1_EVIDENCE_SOURCE_UNKNOWN",
                        message=f"Unknown source IDs: {', '.join(unknown_sources)}",
                        location=location,
                    )
                )
        elif evidence_kind == ASSIGNMENT_EVIDENCE_KIND:
            if (
                not isinstance(assignment_keys, list)
                or not assignment_keys
                or source_ids not in (None, [])
            ):
                checks.append(
                    CheckResult(
                        code="D1_EVIDENCE_SCOPE_INVALID",
                        message=f"{evidence_id} requires assignment_keys only",
                        location=location,
                    )
                )
            elif unknown_assignments := sorted(
                _string_values(assignment_keys) - known_assignment_keys
            ):
                checks.append(
                    CheckResult(
                        code="D1_EVIDENCE_ASSIGNMENT_UNKNOWN",
                        message=f"Unknown assignment keys: {', '.join(unknown_assignments)}",
                        location=location,
                    )
                )

        relative_path = Path(str(item["path"]))
        if relative_path.is_absolute():
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_PATH_INVALID",
                    message=f"Evidence path must be repository-relative: {relative_path}",
                    location=location,
                )
            )
            continue
        evidence_path = (root / relative_path).resolve()
        try:
            evidence_path.relative_to(root)
        except ValueError:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_PATH_INVALID",
                    message=f"Evidence path escapes repository: {relative_path}",
                    location=location,
                )
            )
            continue
        try:
            evidence_path.relative_to(evidence_root)
        except ValueError:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_PATH_INVALID",
                    message=(f"Evidence path must stay under data/d1/evidence: {relative_path}"),
                    location=location,
                )
            )
            continue
        if evidence_path.name.lower() == "readme.md":
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_PLACEHOLDER_FILE",
                    message="Evidence directory instructions cannot be used as approval evidence",
                    location=location,
                )
            )
            continue
        expected_hash = str(item["sha256"]).strip()
        if re.fullmatch(r"[0-9a-f]{64}", expected_hash) is None:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_HASH_INVALID",
                    message=f"{evidence_id} requires a lowercase SHA-256",
                    location=location,
                )
            )
        if not evidence_path.is_file():
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_FILE_MISSING",
                    message=f"Evidence file does not exist: {relative_path}",
                    location=location,
                )
            )
        elif evidence_path.stat().st_size == 0:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_FILE_EMPTY",
                    message=f"Evidence file is empty: {relative_path}",
                    location=location,
                )
            )
        elif sha256_file(evidence_path) != expected_hash:
            checks.append(
                CheckResult(
                    code="D1_EVIDENCE_HASH_MISMATCH",
                    message=f"Evidence hash does not match: {relative_path}",
                    location=location,
                )
            )

    for source_id, source in sources.items():
        if source.get("status") != "active":
            continue
        location = f"registry.sources.{source_id}"
        evidence_ids = source.get("approval_evidence_ids")
        if not isinstance(evidence_ids, list):
            checks.append(
                CheckResult(
                    code="D1_ACTIVE_EVIDENCE_REFERENCE_INVALID",
                    message=f"{source_id} approval_evidence_ids must be a list",
                    location=location,
                )
            )
            continue
        source_referenced: list[dict[str, Any]] = []
        for evidence_id in {str(value).strip() for value in evidence_ids}:
            entry = indexed.get(evidence_id)
            if entry is None:
                checks.append(
                    CheckResult(
                        code="D1_ACTIVE_EVIDENCE_REFERENCE_UNKNOWN",
                        message=f"{source_id} references unknown evidence: {evidence_id}",
                        location=location,
                    )
                )
            elif source_id not in _string_values(entry.get("source_ids")):
                checks.append(
                    CheckResult(
                        code="D1_ACTIVE_EVIDENCE_SCOPE_MISMATCH",
                        message=f"{evidence_id} is not scoped to {source_id}",
                        location=location,
                    )
                )
            else:
                source_referenced.append(entry)
        referenced_kinds = {str(item.get("evidence_kind") or "") for item in source_referenced}
        missing_kinds = sorted(SOURCE_EVIDENCE_KINDS - referenced_kinds)
        if missing_kinds:
            checks.append(
                CheckResult(
                    code="D1_ACTIVE_EVIDENCE_KIND_MISSING",
                    message=f"{source_id} missing evidence kinds: {', '.join(missing_kinds)}",
                    location=location,
                )
            )
        for snapshot_field, expected_kind in SNAPSHOT_EVIDENCE_FIELDS.items():
            evidence_id = str(source.get(snapshot_field) or "").strip()
            entry = indexed.get(evidence_id)
            if (
                entry is None
                or entry.get("evidence_kind") != expected_kind
                or source_id not in _string_values(entry.get("source_ids"))
            ):
                checks.append(
                    CheckResult(
                        code="D1_SNAPSHOT_EVIDENCE_INVALID",
                        message=(
                            f"{source_id} {snapshot_field} must reference scoped "
                            f"{expected_kind} evidence"
                        ),
                        location=location,
                    )
                )

    for (country, domain), assignment in assignments.items():
        if assignment.get("status") != "approved":
            continue
        assignment_key = f"{country}/{domain}"
        location = f"matrix.assignments.{assignment_key}"
        evidence_ids = assignment.get("evidence_ids")
        if not isinstance(evidence_ids, list):
            checks.append(
                CheckResult(
                    code="D1_MATRIX_EVIDENCE_REFERENCE_INVALID",
                    message=f"{assignment_key} evidence_ids must be a list",
                    location=location,
                )
            )
            continue
        assignment_referenced: list[dict[str, Any]] = []
        for evidence_id in {str(value).strip() for value in evidence_ids}:
            entry = indexed.get(evidence_id)
            if entry is None:
                checks.append(
                    CheckResult(
                        code="D1_MATRIX_EVIDENCE_REFERENCE_UNKNOWN",
                        message=f"{assignment_key} references unknown evidence: {evidence_id}",
                        location=location,
                    )
                )
            elif assignment_key not in _string_values(entry.get("assignment_keys")):
                checks.append(
                    CheckResult(
                        code="D1_MATRIX_EVIDENCE_SCOPE_MISMATCH",
                        message=f"{evidence_id} is not scoped to {assignment_key}",
                        location=location,
                    )
                )
            else:
                assignment_referenced.append(entry)
        if ASSIGNMENT_EVIDENCE_KIND not in {
            str(item.get("evidence_kind") or "") for item in assignment_referenced
        }:
            checks.append(
                CheckResult(
                    code="D1_MATRIX_EVIDENCE_KIND_MISSING",
                    message=f"{assignment_key} requires {ASSIGNMENT_EVIDENCE_KIND} evidence",
                    location=location,
                )
            )
    return checks


def validate_d1_admission(
    paths: RepositoryPaths,
    registry: dict[str, Any],
    matrix: dict[str, Any],
    evidence_manifest: dict[str, Any] | None = None,
    *,
    d0_ready: bool | None = None,
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current_registry = build_source_registry_template(paths)
    current_matrix = build_domain_source_matrix_template(paths)
    current_evidence = build_d1_evidence_manifest_template(paths)

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

    if evidence_manifest is not None:
        checks.extend(
            _validate_d1_evidence_manifest(
                paths,
                evidence_manifest,
                sources,
                assignments,
                current_evidence,
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
    evidence_path: Path,
) -> list[CheckResult]:
    payloads: list[dict[str, Any]] = []
    for label, path in (
        ("registry", registry_path),
        ("matrix", matrix_path),
        ("evidence", evidence_path),
    ):
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
    return validate_d1_admission(paths, payloads[0], payloads[1], payloads[2])
