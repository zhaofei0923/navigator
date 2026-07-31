from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .baseline import extract_contracts, sha256_file
from .d0_candidates import candidate_payloads, load_research_captures
from .models import CheckResult
from .paths import RepositoryPaths
from .validation import APPROVED_EVIDENCE_STATES

ROLE_APPROVAL_SCOPES: dict[str, str] = {
    "项目批准人": "批准D0阶段结论、例外和升级事项",
    "数据负责人": "批准实体、字段、枚举、单位及映射基线",
    "产品负责人": "批准产品口径、多语言展示及业务枚举",
    "数据质量负责人": "批准试填、质量规则、问题关闭和验收证据",
    "数据工程负责人": "确认模板、采集和标准化规则可执行",
    "国家研究负责人": "复核来源、原件事实和金标准样本",
    "语言审校负责人": "复核术语、原文与译文口径",
    "合规负责人": "批准来源许可、再分发和AI使用边界",
    "后端/数据架构负责人": "确认实体关系、字段类型和技术约束可实现",
}

ACCEPTANCE_REVIEWERS: dict[str, list[str]] = {
    "D0-AC-001": ["数据负责人", "后端/数据架构负责人"],
    "D0-AC-002": ["数据负责人", "数据质量负责人"],
    "D0-AC-003": ["数据负责人", "产品负责人"],
    "D0-AC-004": ["产品负责人", "数据负责人", "语言审校负责人"],
    "D0-AC-005": ["数据质量负责人", "数据工程负责人"],
    "D0-AC-006": ["国家研究负责人", "语言审校负责人"],
    "D0-AC-007": ["项目批准人"],
    "D0-AC-008": ["数据负责人", "合规负责人"],
    "D0-AC-009": ["数据负责人", "项目批准人"],
    "D0-AC-010": ["项目批准人"],
}

REVIEW_ARTIFACTS: tuple[dict[str, Any], ...] = (
    {
        "artifact_id": "D0-ART-CONVENTIONS",
        "candidate": "conventions.json",
        "required_roles": ["产品负责人", "数据负责人", "语言审校负责人"],
    },
    {
        "artifact_id": "D0-ART-FILE-RULES",
        "candidate": "file_rules.json",
        "required_roles": ["数据负责人", "合规负责人"],
    },
    {
        "artifact_id": "D0-ART-TERMINOLOGY",
        "candidate": "terminology_review_queue.json",
        "required_roles": ["国家研究负责人", "语言审校负责人"],
    },
)
ARTIFACT_ACCEPTANCE_IDS = {
    "D0-ART-CONVENTIONS": "D0-AC-004",
    "D0-ART-FILE-RULES": "D0-AC-008",
    "D0-ART-TERMINOLOGY": "D0-AC-006",
}

FINAL_MAPPING_DECISIONS = {
    "replace_target",
    "add_field",
    "model_entity",
    "retire_mapping",
}
FINAL_REVIEW_STATES = {"approved", "rejected"}
FINAL_LICENSE_DECISIONS = {"approved", "limited", "rejected"}
FINAL_PROFESSIONAL_REVIEW_STATES = {"approved", "rejected"}
ADVISORY_ONLY_CANDIDATES = {"core_contract_recommendations.json"}


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(serialized).hexdigest()


def build_review_packet(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    candidates = candidate_payloads(paths)
    captures = {
        str(item["raw_id"]): item for item in load_research_captures(paths) if item.get("raw_id")
    }
    assessments = {
        str(item["acceptance_id"]): item
        for item in candidates["acceptance_assessment.json"]["assessments"]
    }
    proposals = candidates["mapping_resolution_proposal.json"]["proposals"]
    gold_candidates = {
        str(item["raw_id"]): item
        for item in candidates["gold_standard_gap_report.json"]["candidates"]
    }

    return {
        "schema_version": 3,
        "stage": "D0",
        "template_only": True,
        "warning": "复制本模板后由实际责任人填写；机器不得代签、代批或把待审状态改为通过",
        "baseline": {
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
            "candidate_hashes": {
                name: _payload_sha256(payload)
                for name, payload in sorted(candidates.items())
                if name not in ADVISORY_ONLY_CANDIDATES
            },
        },
        "role_assignments": [
            {
                "role": str(item["角色"]),
                "raci": item.get("RACI定位"),
                "approval_scope": ROLE_APPROVAL_SCOPES.get(str(item["角色"])),
                "role_holder": None,
                "alternate": None,
                "escalation_person": None,
                "signature_evidence_id": None,
                "signed_at": None,
                "status": "pending",
            }
            for item in contracts["responsibilities"]
        ],
        "mapping_decisions": [
            {
                **proposal,
                "decision": None,
                "final_target": None,
                "rationale": None,
                "change_request_id": None,
                "decider_role": "数据负责人",
                "decided_by": None,
                "decided_at": None,
                "evidence_ids": [],
                "review_status": "pending",
            }
            for proposal in proposals
        ],
        "raw_sample_reviews": [
            {
                "raw_id": str(item["原始编号"]),
                "country": item.get("国家"),
                "source_id": item.get("来源编号"),
                "capture_record": captures.get(str(item["原始编号"]), {}).get("record_id"),
                "capture_metadata_complete": bool(captures.get(str(item["原始编号"]))),
                "license_decision": "pending",
                "license_snapshot_id": (
                    gold_candidates.get(str(item["原始编号"]), {}).get("license_snapshot_id")
                    if gold_candidates.get(str(item["原始编号"]), {}).get(
                        "license_snapshot_verified"
                    )
                    else None
                ),
                "redistribution_allowed": False,
                "ai_index_allowed": False,
                "compliance_reviewer_role": "合规负责人",
                "compliance_reviewer": None,
                "compliance_reviewed_at": None,
                "professional_review_status": "pending",
                "professional_reviewer_role": "国家研究负责人",
                "professional_reviewer": None,
                "professional_reviewed_at": None,
                "compliance_evidence_ids": [],
                "professional_evidence_ids": [],
            }
            for item in contracts["raw_asset_template"]
        ],
        "artifact_reviews": [
            {
                **artifact,
                "candidate_sha256": _payload_sha256(candidates[str(artifact["candidate"])]),
                "reviewer_signatures": [
                    {
                        "role": role,
                        "person_name": None,
                        "signed_at": None,
                        "evidence_ids": [],
                    }
                    for role in artifact["required_roles"]
                ],
                "review_status": "pending",
            }
            for artifact in REVIEW_ARTIFACTS
        ],
        "acceptance_items": [
            {
                "acceptance_id": str(item["验收编号"]),
                "title": item.get("验收项"),
                "hard_gate": item.get("硬门") == "是",
                "machine_status": assessments[str(item["验收编号"])]["machine_status"],
                "required_roles": ACCEPTANCE_REVIEWERS[str(item["验收编号"])],
                "reviewer_signatures": [
                    {
                        "role": role,
                        "person_name": None,
                        "signed_at": None,
                        "evidence_ids": [],
                    }
                    for role in ACCEPTANCE_REVIEWERS[str(item["验收编号"])]
                ],
                "comments": None,
                "review_status": "pending",
            }
            for item in contracts["d0_acceptance"]
        ],
        "final_decision": {
            "status": "pending",
            "approver_role": "项目批准人",
            "approved_by": None,
            "approved_at": None,
            "evidence_ids": [],
            "comments": None,
        },
    }


def write_review_template(paths: RepositoryPaths) -> Path:
    paths.d0_review_dir.mkdir(parents=True, exist_ok=True)
    destination = paths.d0_review_dir / "d0_review_packet.template.json"
    destination.write_text(
        json.dumps(build_review_packet(paths), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


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


def _temporal_value(
    checks: list[CheckResult],
    item: dict[str, Any],
    field: str,
    *,
    location: str,
) -> None:
    value = str(item.get(field) or "").strip()
    if not value:
        return
    valid = False
    if len(value) == 10:
        try:
            date.fromisoformat(value)
            valid = True
        except ValueError:
            pass
    else:
        normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.fromisoformat(normalized)
            valid = "T" in value and parsed.tzinfo is not None and parsed.utcoffset() is not None
        except ValueError:
            pass
    if not valid:
        checks.append(
            CheckResult(
                code="D0_REVIEW_TEMPORAL_INVALID",
                message=f"{field} must be YYYY-MM-DD or an ISO-8601 datetime with a timezone",
                location=f"{location}.{field}",
            )
        )


def _reviewer_signature_evidence(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    expected_roles: set[str],
    role_holders: dict[str, str],
    evidence_binding_requirements: dict[str, list[tuple[str, str, str]]],
    acceptance_id: str,
    require_complete: bool,
    location: str,
) -> set[str]:
    raw_signatures = item.get("reviewer_signatures")
    if not isinstance(raw_signatures, list):
        checks.append(
            CheckResult(
                code="D0_REVIEW_SIGNATURES_INVALID",
                message="reviewer_signatures must be a list",
                location=location,
            )
        )
        return set()
    signatures: dict[str, dict[str, Any]] = {}
    for index, signature in enumerate(raw_signatures):
        signature_location = f"{location}.reviewer_signatures[{index}]"
        if not isinstance(signature, dict):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_SIGNATURE_INVALID",
                    message="Reviewer signature must be an object",
                    location=signature_location,
                )
            )
            continue
        role = str(signature.get("role") or "").strip()
        if not role:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_SIGNATURE_INVALID",
                    message="Reviewer signature requires role",
                    location=signature_location,
                )
            )
            continue
        if role in signatures:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_SIGNATURE_DUPLICATE",
                    message=f"Duplicate reviewer signature role: {role}",
                    location=location,
                )
            )
            continue
        signatures[role] = signature
    actual_roles = set(signatures)
    if actual_roles != expected_roles:
        checks.append(
            CheckResult(
                code="D0_REVIEW_SIGNATURE_ROLE_SET_INVALID",
                message=(
                    f"Reviewer signature roles differ; "
                    f"missing={sorted(expected_roles - actual_roles)}, "
                    f"unexpected={sorted(actual_roles - expected_roles)}"
                ),
                location=location,
            )
        )
    evidence_ids: set[str] = set()
    if not require_complete:
        return evidence_ids
    for role in sorted(actual_roles & expected_roles):
        signature = signatures[role]
        signature_location = f"{location}.reviewer_signatures.{role}"
        _required_text(
            checks,
            signature,
            ("person_name", "signed_at"),
            code="D0_REVIEW_SIGNATURE_INCOMPLETE",
            location=signature_location,
        )
        _temporal_value(
            checks,
            signature,
            "signed_at",
            location=signature_location,
        )
        person_name = str(signature.get("person_name") or "").strip()
        expected_holder = role_holders.get(role, "")
        if not expected_holder or person_name != expected_holder:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_SIGNER_UNAUTHORIZED",
                    message=f"{person_name or 'Missing signer'} is not the signed holder of {role}",
                    location=signature_location,
                )
            )
        raw_evidence_ids = signature.get("evidence_ids")
        if (
            not isinstance(raw_evidence_ids, list)
            or not raw_evidence_ids
            or any(not str(value).strip() for value in raw_evidence_ids)
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_SIGNATURE_EVIDENCE_MISSING",
                    message=f"{role} signature requires evidence IDs",
                    location=signature_location,
                )
            )
            continue
        signature_evidence_ids = {str(value).strip() for value in raw_evidence_ids}
        evidence_ids.update(signature_evidence_ids)
        _register_evidence_bindings(
            evidence_binding_requirements,
            signature_evidence_ids,
            acceptance_id=acceptance_id,
            reviewer=person_name,
            location=signature_location,
        )
    return evidence_ids


def _register_evidence_bindings(
    requirements: dict[str, list[tuple[str, str, str]]],
    evidence_ids: set[str],
    *,
    acceptance_id: str,
    reviewer: str,
    location: str,
) -> None:
    for evidence_id in evidence_ids:
        requirements.setdefault(evidence_id, []).append((acceptance_id, reviewer, location))


def _indexed_items(
    checks: list[CheckResult],
    payload: dict[str, Any],
    key: str,
    identifier: str,
) -> dict[str, dict[str, Any]]:
    items = payload.get(key)
    if not isinstance(items, list):
        checks.append(
            CheckResult(
                code="D0_REVIEW_SECTION_INVALID",
                message=f"{key} must be a list",
                location=key,
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not str(item.get(identifier) or "").strip():
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ENTRY_INVALID",
                    message=f"{key}[{index}] requires {identifier}",
                    location=key,
                )
            )
            continue
        value = str(item[identifier]).strip()
        if value in indexed:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ENTRY_DUPLICATE",
                    message=f"Duplicate {identifier}: {value}",
                    location=key,
                )
            )
            continue
        indexed[value] = item
    return indexed


def _check_expected_ids(
    checks: list[CheckResult],
    *,
    actual: set[str],
    expected: set[str],
    code: str,
    location: str,
) -> None:
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing:
        checks.append(
            CheckResult(
                code=code, message=f"Missing entries: {', '.join(missing)}", location=location
            )
        )
    if unknown:
        checks.append(
            CheckResult(
                code=code,
                message=f"Unknown entries: {', '.join(unknown)}",
                location=location,
            )
        )


def validate_review_packet(paths: RepositoryPaths, payload: dict[str, Any]) -> list[CheckResult]:
    checks: list[CheckResult] = []
    evidence_binding_requirements: dict[str, list[tuple[str, str, str]]] = {}
    if payload.get("schema_version") != 3 or payload.get("stage") != "D0":
        checks.append(
            CheckResult(
                code="D0_REVIEW_HEADER_INVALID",
                message="Review packet requires schema_version 3 and stage D0",
                location="review_packet",
            )
        )
    if payload.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D0_REVIEW_TEMPLATE_UNCOPIED",
                message="Copy the generated template and set template_only to false before review",
                location="template_only",
            )
        )

    template = build_review_packet(paths)
    baseline = payload.get("baseline")
    if not isinstance(baseline, dict):
        checks.append(
            CheckResult(
                code="D0_REVIEW_BASELINE_INVALID",
                message="Review packet baseline must be an object",
                location="baseline",
            )
        )
    else:
        sources = baseline.get("sources")
        expected_hashes = {
            "d0_workbook": sha256_file(paths.d0_workbook),
            "technical_workbook": sha256_file(paths.technical_workbook),
        }
        if not isinstance(sources, dict):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_BASELINE_INVALID",
                    message="Review packet baseline.sources must be an object",
                    location="baseline.sources",
                )
            )
        else:
            for name, expected_hash in expected_hashes.items():
                source = sources.get(name)
                if not isinstance(source, dict) or source.get("sha256") != expected_hash:
                    checks.append(
                        CheckResult(
                            code="D0_REVIEW_BASELINE_STALE",
                            message=f"{name} hash does not match the current frozen baseline",
                            location=f"baseline.sources.{name}",
                        )
                    )
        candidate_hashes = baseline.get("candidate_hashes")
        current_candidate_hashes = template["baseline"]["candidate_hashes"]
        if not isinstance(candidate_hashes, dict) or candidate_hashes != current_candidate_hashes:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_CANDIDATES_STALE",
                    message="Candidate hashes do not match the current D0 review inputs",
                    location="baseline.candidate_hashes",
                )
            )

    roles = _indexed_items(checks, payload, "role_assignments", "role")
    expected_roles = {str(item["role"]) for item in template["role_assignments"]}
    _check_expected_ids(
        checks,
        actual=set(roles),
        expected=expected_roles,
        code="D0_REVIEW_ROLE_SET_INVALID",
        location="role_assignments",
    )
    role_holders: dict[str, str] = {}
    for role, item in roles.items():
        location = f"role_assignments.{role}"
        if item.get("status") != "signed":
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ROLE_PENDING",
                    message=f"{role} has not signed",
                    location=location,
                )
            )
            continue
        _required_text(
            checks,
            item,
            (
                "role_holder",
                "alternate",
                "escalation_person",
                "signature_evidence_id",
                "signed_at",
            ),
            code="D0_REVIEW_ROLE_INCOMPLETE",
            location=location,
        )
        _temporal_value(checks, item, "signed_at", location=location)
        role_holder = str(item.get("role_holder") or "").strip()
        alternate = str(item.get("alternate") or "").strip()
        escalation_person = str(item.get("escalation_person") or "").strip()
        if role_holder and role_holder in (alternate, escalation_person):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ROLE_SEPARATION_INVALID",
                    message=f"{role} holder cannot be their own alternate or escalation person",
                    location=location,
                )
            )
        if role_holder:
            role_holders[role] = role_holder
            signature_evidence_id = str(item.get("signature_evidence_id") or "").strip()
            if signature_evidence_id:
                _register_evidence_bindings(
                    evidence_binding_requirements,
                    {signature_evidence_id},
                    acceptance_id="D0-AC-007",
                    reviewer=role_holder,
                    location=location,
                )

    mappings = _indexed_items(checks, payload, "mapping_decisions", "mapping_id")
    template_mappings = {str(item["mapping_id"]): item for item in template["mapping_decisions"]}
    expected_mappings = {str(item["mapping_id"]) for item in template["mapping_decisions"]}
    _check_expected_ids(
        checks,
        actual=set(mappings),
        expected=expected_mappings,
        code="D0_REVIEW_MAPPING_SET_INVALID",
        location="mapping_decisions",
    )
    for mapping_id, item in mappings.items():
        location = f"mapping_decisions.{mapping_id}"
        expected_mapping = template_mappings.get(mapping_id)
        if expected_mapping and any(
            item.get(field) != expected_mapping.get(field)
            for field in (
                "current_target",
                "proposed_action",
                "proposed_target",
                "confidence",
                "decider_role",
            )
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_MAPPING_INPUT_CHANGED",
                    message=f"{mapping_id} candidate inputs differ from the current template",
                    location=location,
                )
            )
        decision = item.get("decision")
        if item.get("review_status") != "approved" or decision not in FINAL_MAPPING_DECISIONS:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_MAPPING_PENDING",
                    message=f"{mapping_id} has no approved final decision",
                    location=location,
                )
            )
            continue
        required_fields = [
            "rationale",
            "change_request_id",
            "decided_by",
            "decided_at",
        ]
        if decision != "retire_mapping":
            required_fields.append("final_target")
        _required_text(
            checks,
            item,
            tuple(required_fields),
            code="D0_REVIEW_MAPPING_INCOMPLETE",
            location=location,
        )
        _temporal_value(checks, item, "decided_at", location=location)
        decider_role = str(item.get("decider_role") or "").strip()
        decided_by = str(item.get("decided_by") or "").strip()
        if not decider_role or decided_by != role_holders.get(decider_role):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_MAPPING_DECIDER_UNAUTHORIZED",
                    message=(
                        f"{decided_by or 'Missing decider'} is not the signed holder "
                        f"of {decider_role or 'the required role'}"
                    ),
                    location=location,
                )
            )
        mapping_evidence = item.get("evidence_ids")
        if (
            not isinstance(mapping_evidence, list)
            or not mapping_evidence
            or any(not str(value).strip() for value in mapping_evidence)
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_MAPPING_EVIDENCE_MISSING",
                    message=f"{mapping_id} requires at least one evidence ID",
                    location=location,
                )
            )
        else:
            _register_evidence_bindings(
                evidence_binding_requirements,
                {str(value).strip() for value in mapping_evidence},
                acceptance_id="D0-AC-005",
                reviewer=decided_by,
                location=location,
            )

    raw_reviews = _indexed_items(checks, payload, "raw_sample_reviews", "raw_id")
    template_raw_reviews = {str(item["raw_id"]): item for item in template["raw_sample_reviews"]}
    expected_raw_ids = {str(item["raw_id"]) for item in template["raw_sample_reviews"]}
    _check_expected_ids(
        checks,
        actual=set(raw_reviews),
        expected=expected_raw_ids,
        code="D0_REVIEW_RAW_SET_INVALID",
        location="raw_sample_reviews",
    )
    for raw_id, item in raw_reviews.items():
        location = f"raw_sample_reviews.{raw_id}"
        expected_raw_review = template_raw_reviews.get(raw_id)
        if expected_raw_review and any(
            item.get(field) != expected_raw_review.get(field)
            for field in (
                "country",
                "source_id",
                "capture_record",
                "capture_metadata_complete",
                "license_snapshot_id",
                "compliance_reviewer_role",
                "professional_reviewer_role",
            )
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_RAW_INPUT_CHANGED",
                    message=f"{raw_id} capture inputs differ from the current verified research",
                    location=location,
                )
            )
        if not item.get("capture_record") or item.get("capture_metadata_complete") is not True:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_RAW_CAPTURE_INCOMPLETE",
                    message=f"{raw_id} does not have a complete verified capture",
                    location=location,
                )
            )
        license_decision = item.get("license_decision")
        if license_decision not in FINAL_LICENSE_DECISIONS:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_LICENSE_PENDING",
                    message=f"{raw_id} license decision is pending",
                    location=location,
                )
            )
        else:
            _required_text(
                checks,
                item,
                (
                    "license_snapshot_id",
                    "compliance_reviewer",
                    "compliance_reviewed_at",
                ),
                code="D0_REVIEW_LICENSE_INCOMPLETE",
                location=location,
            )
            _temporal_value(
                checks,
                item,
                "compliance_reviewed_at",
                location=location,
            )
            compliance_role = str(item.get("compliance_reviewer_role") or "").strip()
            compliance_reviewer = str(item.get("compliance_reviewer") or "").strip()
            if not compliance_role or compliance_reviewer != role_holders.get(compliance_role):
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_COMPLIANCE_REVIEWER_UNAUTHORIZED",
                        message=(
                            f"{compliance_reviewer or 'Missing reviewer'} is not the signed "
                            f"holder of {compliance_role or 'the compliance role'}"
                        ),
                        location=location,
                    )
                )
            compliance_evidence = item.get("compliance_evidence_ids")
            if (
                not isinstance(compliance_evidence, list)
                or not compliance_evidence
                or any(not str(value).strip() for value in compliance_evidence)
            ):
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_COMPLIANCE_EVIDENCE_MISSING",
                        message=f"{raw_id} compliance decision requires evidence IDs",
                        location=location,
                    )
                )
            else:
                _register_evidence_bindings(
                    evidence_binding_requirements,
                    {str(value).strip() for value in compliance_evidence},
                    acceptance_id="D0-AC-005",
                    reviewer=compliance_reviewer,
                    location=location,
                )
            if license_decision == "rejected":
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_LICENSE_REJECTED",
                        message=f"{raw_id} must be replaced with an admissible sample",
                        location=location,
                    )
                )
        redistribution_allowed = item.get("redistribution_allowed")
        ai_index_allowed = item.get("ai_index_allowed")
        if (
            not isinstance(redistribution_allowed, bool)
            or not isinstance(ai_index_allowed, bool)
            or (license_decision == "rejected" and (redistribution_allowed or ai_index_allowed))
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_USAGE_BOUNDARY_INVALID",
                    message=(
                        f"{raw_id} requires boolean redistribution/AI boundaries, "
                        "both false when the license is rejected"
                    ),
                    location=location,
                )
            )
        professional_status = item.get("professional_review_status")
        if professional_status not in FINAL_PROFESSIONAL_REVIEW_STATES:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_PROFESSIONAL_PENDING",
                    message=f"{raw_id} professional review is pending",
                    location=location,
                )
            )
        else:
            _required_text(
                checks,
                item,
                ("professional_reviewer", "professional_reviewed_at"),
                code="D0_REVIEW_PROFESSIONAL_INCOMPLETE",
                location=location,
            )
            _temporal_value(
                checks,
                item,
                "professional_reviewed_at",
                location=location,
            )
            professional_role = str(item.get("professional_reviewer_role") or "").strip()
            professional_reviewer = str(item.get("professional_reviewer") or "").strip()
            if not professional_role or professional_reviewer != role_holders.get(
                professional_role
            ):
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_PROFESSIONAL_REVIEWER_UNAUTHORIZED",
                        message=(
                            f"{professional_reviewer or 'Missing reviewer'} is not the signed "
                            f"holder of {professional_role or 'the professional role'}"
                        ),
                        location=location,
                    )
                )
            professional_evidence = item.get("professional_evidence_ids")
            if (
                not isinstance(professional_evidence, list)
                or not professional_evidence
                or any(not str(value).strip() for value in professional_evidence)
            ):
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_PROFESSIONAL_EVIDENCE_MISSING",
                        message=f"{raw_id} professional decision requires evidence IDs",
                        location=location,
                    )
                )
            else:
                _register_evidence_bindings(
                    evidence_binding_requirements,
                    {str(value).strip() for value in professional_evidence},
                    acceptance_id="D0-AC-006",
                    reviewer=professional_reviewer,
                    location=location,
                )
            if professional_status == "rejected":
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_PROFESSIONAL_REJECTED",
                        message=(
                            f"{raw_id} failed professional review and must be replaced or fixed"
                        ),
                        location=location,
                    )
                )
    artifacts = _indexed_items(checks, payload, "artifact_reviews", "artifact_id")
    template_artifacts = {str(item["artifact_id"]): item for item in template["artifact_reviews"]}
    expected_artifacts = {str(item["artifact_id"]) for item in template["artifact_reviews"]}
    _check_expected_ids(
        checks,
        actual=set(artifacts),
        expected=expected_artifacts,
        code="D0_REVIEW_ARTIFACT_SET_INVALID",
        location="artifact_reviews",
    )
    for artifact_id, item in artifacts.items():
        location = f"artifact_reviews.{artifact_id}"
        expected_artifact = template_artifacts.get(artifact_id)
        if expected_artifact and any(
            item.get(field) != expected_artifact.get(field)
            for field in ("candidate", "candidate_sha256", "required_roles")
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ARTIFACT_INPUT_CHANGED",
                    message=f"{artifact_id} inputs differ from the current template",
                    location=location,
                )
            )
        if item.get("review_status") not in FINAL_REVIEW_STATES:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ARTIFACT_PENDING",
                    message=f"{artifact_id} review is pending",
                    location=location,
                )
            )
            continue
        if item.get("review_status") == "rejected":
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ARTIFACT_REJECTED",
                    message=f"{artifact_id} must be revised and re-reviewed",
                    location=location,
                )
            )
            continue
        expected_reviewers = set(
            expected_artifact.get("required_roles", []) if expected_artifact else []
        )
        _reviewer_signature_evidence(
            checks,
            item,
            expected_roles=expected_reviewers,
            role_holders=role_holders,
            evidence_binding_requirements=evidence_binding_requirements,
            acceptance_id=ARTIFACT_ACCEPTANCE_IDS.get(artifact_id, ""),
            require_complete=True,
            location=location,
        )

    acceptance = _indexed_items(checks, payload, "acceptance_items", "acceptance_id")
    template_acceptance = {
        str(item["acceptance_id"]): item for item in template["acceptance_items"]
    }
    expected_acceptance = {str(item["acceptance_id"]) for item in template["acceptance_items"]}
    _check_expected_ids(
        checks,
        actual=set(acceptance),
        expected=expected_acceptance,
        code="D0_REVIEW_ACCEPTANCE_SET_INVALID",
        location="acceptance_items",
    )
    for acceptance_id, item in acceptance.items():
        location = f"acceptance_items.{acceptance_id}"
        expected_acceptance_item = template_acceptance.get(acceptance_id)
        if expected_acceptance_item and any(
            item.get(field) != expected_acceptance_item.get(field)
            for field in (
                "title",
                "hard_gate",
                "machine_status",
                "required_roles",
            )
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ACCEPTANCE_INPUT_CHANGED",
                    message=f"{acceptance_id} inputs differ from the current template",
                    location=location,
                )
            )
        if item.get("review_status") != "approved":
            checks.append(
                CheckResult(
                    code="D0_REVIEW_ACCEPTANCE_PENDING",
                    message=f"{acceptance_id} has not been approved",
                    location=location,
                )
            )
            continue
        expected_reviewers = set(
            expected_acceptance_item.get("required_roles", []) if expected_acceptance_item else []
        )
        _reviewer_signature_evidence(
            checks,
            item,
            expected_roles=expected_reviewers,
            role_holders=role_holders,
            evidence_binding_requirements=evidence_binding_requirements,
            acceptance_id=acceptance_id,
            require_complete=True,
            location=location,
        )

    final_decision = payload.get("final_decision")
    if not isinstance(final_decision, dict) or final_decision.get("status") != "approved":
        checks.append(
            CheckResult(
                code="D0_REVIEW_FINAL_PENDING",
                message="Project approver has not approved the final D0 decision",
                location="final_decision",
            )
        )
    else:
        if final_decision.get("approver_role") != "项目批准人":
            checks.append(
                CheckResult(
                    code="D0_REVIEW_FINAL_ROLE_INVALID",
                    message="Final D0 approval requires the 项目批准人 role",
                    location="final_decision",
                )
            )
        _required_text(
            checks,
            final_decision,
            ("approved_by", "approved_at"),
            code="D0_REVIEW_FINAL_INCOMPLETE",
            location="final_decision",
        )
        _temporal_value(
            checks,
            final_decision,
            "approved_at",
            location="final_decision",
        )
        approved_by = str(final_decision.get("approved_by") or "").strip()
        if approved_by != role_holders.get("项目批准人"):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_FINAL_APPROVER_UNAUTHORIZED",
                    message=(f"{approved_by or 'Missing approver'} is not the signed 项目批准人"),
                    location="final_decision",
                )
            )
        final_evidence = final_decision.get("evidence_ids")
        if (
            not isinstance(final_evidence, list)
            or not final_evidence
            or any(not str(value).strip() for value in final_evidence)
        ):
            checks.append(
                CheckResult(
                    code="D0_REVIEW_FINAL_EVIDENCE_MISSING",
                    message="Final D0 approval requires evidence IDs",
                    location="final_decision",
                )
            )
        else:
            _register_evidence_bindings(
                evidence_binding_requirements,
                {str(value).strip() for value in final_evidence},
                acceptance_id="D0-AC-010",
                reviewer=approved_by,
                location="final_decision",
            )

    evidence_by_id: dict[str, dict[str, Any]] | None = None
    try:
        evidence_payload = json.loads(paths.evidence_manifest.read_text(encoding="utf-8"))
        evidence_entries = evidence_payload.get("evidence")
        if not isinstance(evidence_entries, list):
            raise ValueError("evidence must be a list")
        evidence_by_id = {}
        for item in evidence_entries:
            if not isinstance(item, dict) or not item.get("evidence_id"):
                continue
            evidence_id = str(item["evidence_id"]).strip()
            if evidence_id in evidence_by_id:
                checks.append(
                    CheckResult(
                        code="D0_REVIEW_EVIDENCE_ID_DUPLICATE",
                        message=f"Evidence ID is duplicated: {evidence_id}",
                        location=str(paths.evidence_manifest),
                    )
                )
                continue
            evidence_by_id[evidence_id] = item
    except (json.JSONDecodeError, OSError, ValueError) as error:
        checks.append(
            CheckResult(
                code="D0_REVIEW_EVIDENCE_MANIFEST_INVALID",
                message=f"Cannot load evidence IDs: {error}",
                location=str(paths.evidence_manifest),
            )
        )

    referenced_evidence_ids: set[str] = set()
    referenced_evidence_ids.update(
        str(item["signature_evidence_id"]).strip()
        for item in roles.values()
        if item.get("signature_evidence_id")
    )
    for item in mappings.values():
        references = item.get("evidence_ids")
        if isinstance(references, list):
            referenced_evidence_ids.update(
                str(reference).strip() for reference in references if str(reference).strip()
            )
    for item in raw_reviews.values():
        for field in ("compliance_evidence_ids", "professional_evidence_ids"):
            references = item.get(field)
            if isinstance(references, list):
                referenced_evidence_ids.update(
                    str(reference).strip() for reference in references if str(reference).strip()
                )
    for section in (artifacts, acceptance):
        for item in section.values():
            signatures = item.get("reviewer_signatures")
            if not isinstance(signatures, list):
                continue
            for signature in signatures:
                if not isinstance(signature, dict):
                    continue
                references = signature.get("evidence_ids")
                if isinstance(references, list):
                    referenced_evidence_ids.update(
                        str(reference).strip() for reference in references if str(reference).strip()
                    )
    if isinstance(final_decision, dict):
        references = final_decision.get("evidence_ids")
        if isinstance(references, list):
            referenced_evidence_ids.update(
                str(reference).strip() for reference in references if str(reference).strip()
            )
    if evidence_by_id is not None:
        unknown_evidence_ids = sorted(referenced_evidence_ids - set(evidence_by_id))
        if unknown_evidence_ids:
            checks.append(
                CheckResult(
                    code="D0_REVIEW_EVIDENCE_REFERENCE_UNKNOWN",
                    message=f"Unknown evidence IDs: {', '.join(unknown_evidence_ids)}",
                    location=str(paths.evidence_manifest),
                )
            )
        for evidence_id, requirements in evidence_binding_requirements.items():
            evidence = evidence_by_id.get(evidence_id)
            if evidence is None:
                continue
            actual_acceptance_id = str(evidence.get("acceptance_id") or "").strip()
            actual_reviewer = str(evidence.get("reviewer") or "").strip()
            actual_status = str(evidence.get("status") or "").strip()
            for expected_acceptance_id, expected_reviewer, location in requirements:
                if actual_acceptance_id != expected_acceptance_id:
                    checks.append(
                        CheckResult(
                            code="D0_REVIEW_EVIDENCE_ACCEPTANCE_MISMATCH",
                            message=(
                                f"{evidence_id} belongs to "
                                f"{actual_acceptance_id or 'no acceptance'}; "
                                f"expected {expected_acceptance_id}"
                            ),
                            location=location,
                        )
                    )
                if actual_reviewer != expected_reviewer:
                    checks.append(
                        CheckResult(
                            code="D0_REVIEW_EVIDENCE_REVIEWER_MISMATCH",
                            message=(
                                f"{evidence_id} reviewer is {actual_reviewer or 'missing'}; "
                                f"expected {expected_reviewer or 'missing'}"
                            ),
                            location=location,
                        )
                    )
                if actual_status not in APPROVED_EVIDENCE_STATES:
                    checks.append(
                        CheckResult(
                            code="D0_REVIEW_EVIDENCE_NOT_APPROVED",
                            message=f"{evidence_id} is not approved: {actual_status or 'missing'}",
                            location=location,
                        )
                    )
    return checks


def load_and_validate_review_packet(
    paths: RepositoryPaths,
    packet_path: Path,
) -> list[CheckResult]:
    try:
        payload = json.loads(packet_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return [
            CheckResult(
                code="D0_REVIEW_PACKET_INVALID",
                message=f"Cannot read review packet: {error}",
                location=str(packet_path),
            )
        ]
    if not isinstance(payload, dict):
        return [
            CheckResult(
                code="D0_REVIEW_PACKET_INVALID",
                message="Review packet root must be an object",
                location=str(packet_path),
            )
        ]
    return validate_review_packet(paths, payload)
