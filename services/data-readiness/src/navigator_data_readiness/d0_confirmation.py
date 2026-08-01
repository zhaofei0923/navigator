from __future__ import annotations

import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from .d0_candidates import candidate_payloads
from .d0_contract_resolution import (
    READY_FOR_BASELINE_CHANGE_REVIEW,
    validate_d0_contract_resolution,
)
from .d0_review import build_review_packet, validate_review_packet
from .models import CheckResult
from .paths import RepositoryPaths

_COMPOUND_INDEX_MARKERS: dict[str, list[str]] = {
    "DATA-D4-003": ["联合唯一", "联合唯一", "联合唯一"],
    "DATA-D4-008": ["主键", "索引", "索引"],
    "DATA-D4-011": ["外键", "索引", "索引"],
    "DATA-D4-012": ["索引", "索引"],
    "DATA-D4-013": ["外键", "无", "索引"],
    "DATA-D4-014": ["联合索引", "联合索引", "联合索引"],
    "DATA-D4-015": ["索引", "索引"],
    "DATA-D4-017": ["联合索引", "联合索引", "联合索引"],
    "DATA-D4-018": ["联合唯一", "联合唯一/外键"],
    "DATA-D4-019": ["联合唯一", "联合唯一", "索引"],
    "DATA-D4-020": ["外键/联合唯一", "联合唯一", "无"],
    "DATA-D4-021": ["索引", "索引", "索引"],
    "DATA-D4-022": ["主键", "外键", "唯一"],
    "DATA-D4-023": ["索引", "索引"],
    "DATA-D4-024": ["索引", "索引", "索引"],
    "DATA-D4-025": ["索引", "索引", "索引"],
    "DATA-D4-026": ["索引", "索引", "索引"],
    "DATA-D4-027": ["外键", "无", "索引", "索引"],
    "DATA-D4-028": ["索引", "索引", "索引"],
    "DATA-D4-030": ["联合唯一", "索引", "联合唯一"],
}
_SCORE_POINT_CHILDREN = {"raw_score", "adjusted_score"}


def load_confirmation(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("D0 confirmation must be a JSON object")
    return payload


def _confirmed_metadata(
    item: dict[str, Any],
    confirmation: dict[str, Any],
    *,
    change_request_id: str,
    rationale: str,
) -> None:
    reviewer = str(confirmation.get("reviewer") or "").strip()
    reviewed_at = str(confirmation.get("reviewed_at") or "").strip()
    evidence_ids = confirmation.get("contract_evidence_ids")
    item.update(
        {
            "change_request_id": change_request_id,
            "rationale": rationale,
            "proposed_by": reviewer,
            "proposed_at": reviewed_at,
            "reviewed_by": reviewer,
            "reviewed_at": reviewed_at,
            "evidence_ids": list(evidence_ids) if isinstance(evidence_ids, list) else [],
            "status": "proposed",
        }
    )


def _require_confirmed_scope(
    confirmation: dict[str, Any],
    *,
    primary_key_count: int,
    not_applicable_count: int,
    compound_count: int,
) -> None:
    if confirmation.get("schema_version") != 1 or confirmation.get("stage") != "D0":
        raise ValueError("Confirmation requires schema_version 1 and stage D0")
    if confirmation.get("reviewer") != "kevin":
        raise ValueError("This confirmation is bound to reviewer kevin")
    primary_keys = confirmation.get("primary_key_decision")
    if primary_keys != {
        "count": primary_key_count,
        "strategy": "add_uuid_primary_key_field",
    }:
        raise ValueError("Primary-key confirmation does not match the current 29-gap inventory")
    non_measurement = confirmation.get("non_measurement_unit_decision")
    if non_measurement != {
        "count": not_applicable_count,
        "unit_applicability": "not_applicable",
    }:
        raise ValueError("Not-applicable unit confirmation does not match the current inventory")
    compounds = confirmation.get("compound_field_decision")
    if compounds != {"count": compound_count, "strategy": "split_all"}:
        raise ValueError("Compound-field confirmation does not match the current inventory")


def _child_unit(field_name: str) -> dict[str, Any]:
    if field_name in _SCORE_POINT_CHILDREN:
        return {
            "unit_applicability": "unit_code",
            "unit_code": "score_point",
            "unit_dimension": "dimensionless",
            "unit_registry_reference": "NAV-SCORE-0-100-v1",
        }
    return {
        "unit_applicability": "not_applicable",
        "unit_code": None,
        "unit_dimension": None,
        "unit_registry_reference": None,
    }


def _child_contracts(
    item: dict[str, Any],
    allowed_fields: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    source_field_id = str(item["source_field_id"])
    source = item["source_field_contract"]
    names = str(source["字段名"]).split("/")
    data_types = str(source["类型"]).split("/")
    markers = _COMPOUND_INDEX_MARKERS.get(source_field_id, [])
    if len(names) != len(data_types) or len(names) != len(markers):
        raise ValueError(f"No exact atomic split definition is registered for {source_field_id}")
    chinese_parts = str(source.get("中文名称") or "").split("/")
    if len(chinese_parts) != len(names):
        chinese_parts = [f"{source.get('中文名称')} ({name})" for name in names]

    contracts: list[dict[str, Any]] = []
    unit_resolutions: list[dict[str, Any]] = []
    for index, (name, data_type, marker, chinese_name) in enumerate(
        zip(names, data_types, markers, chinese_parts, strict=True),
        start=1,
    ):
        field_id = f"{source_field_id}-{index:02d}"
        unit = _child_unit(name)
        contract = {field: source.get(field) for field in allowed_fields}
        contract.update(
            {
                "字段编号": field_id,
                "字段名": name,
                "中文名称": chinese_name,
                "类型": data_type,
                "唯一/索引": marker,
                "单位": unit["unit_code"]
                if unit["unit_applicability"] == "unit_code"
                else "不适用",
                "备注": (f"由{source_field_id}原子化拆分；保留原合同语义：{source.get('备注')}"),
            }
        )
        contracts.append(contract)
        unit_resolutions.append({"field_id": field_id, **unit})
    return contracts, unit_resolutions


def build_confirmed_contract_resolution(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
) -> dict[str, Any]:
    payloads = candidate_payloads(paths)
    packet = deepcopy(payloads["core_contract_resolution.template.json"])
    recommendations = payloads["core_contract_recommendations.json"]
    key_recommendations = {
        str(item["entity_code"]): item
        for item in recommendations["entity_primary_key_recommendations"]
    }
    unit_recommendations = {
        str(item["field_id"]): item for item in recommendations["field_unit_recommendations"]
    }
    not_applicable_ids = {
        field_id
        for field_id, item in unit_recommendations.items()
        if item["recommendation_kind"] == "not_applicable_candidate"
    }
    _require_confirmed_scope(
        confirmation,
        primary_key_count=len(key_recommendations),
        not_applicable_count=len(not_applicable_ids),
        compound_count=len(packet["compound_field_resolutions"]),
    )
    numeric_decisions = confirmation.get("numeric_unit_decisions")
    if not isinstance(numeric_decisions, dict):
        raise ValueError("numeric_unit_decisions must be an object")
    expected_numeric_ids = {
        field_id
        for field_id, item in unit_recommendations.items()
        if item["recommendation_kind"] == "numeric_semantics_requires_human_analysis"
    }
    if set(numeric_decisions) != expected_numeric_ids:
        raise ValueError("Numeric unit decisions do not match the current three-field inventory")

    packet["template_only"] = False
    for index, item in enumerate(packet["entity_primary_key_resolutions"], start=1):
        recommendation = key_recommendations[str(item["entity_code"])]
        contract = deepcopy(recommendation["recommended_field_contract"])
        if contract.get("类型") != "uuid" or contract.get("单位") != "不适用":
            raise ValueError(f"Unsafe primary-key recommendation for {item['entity_code']}")
        item.update(
            {
                "action": "add_primary_key_field",
                "primary_key_field_ids": [],
                "proposed_field_contract": contract,
            }
        )
        _confirmed_metadata(
            item,
            confirmation,
            change_request_id=f"CR-D0-PK-{index:03d}-20260801",
            rationale="按实名审核结论为缺少显式主键的实体增加UUID主键字段",
        )

    compound_ids = {str(item["source_field_id"]) for item in packet["compound_field_resolutions"]}
    for index, item in enumerate(packet["field_unit_resolutions"], start=1):
        field_id = str(item["field_id"])
        if field_id in not_applicable_ids:
            decision = {
                "unit_applicability": "not_applicable",
                "unit_code": None,
                "unit_dimension": None,
                "unit_registry_reference": None,
            }
        elif field_id in numeric_decisions:
            decision = numeric_decisions[field_id]
        elif field_id in compound_ids:
            decision = {
                "unit_applicability": "replaced_by_split",
                "unit_code": None,
                "unit_dimension": None,
                "unit_registry_reference": None,
            }
        else:
            raise ValueError(f"No confirmed unit decision for {field_id}")
        item.update(deepcopy(decision))
        _confirmed_metadata(
            item,
            confirmation,
            change_request_id=f"CR-D0-UNIT-{index:03d}-20260801",
            rationale=(
                "原复合合同由原子字段及其单位元数据替代"
                if field_id in compound_ids
                else "按实名审核结论登记字段单位或不适用状态"
            ),
        )

    allowed_fields = list(packet["proposed_field_contract_schema"]["allowed_fields"])
    for index, item in enumerate(packet["compound_field_resolutions"], start=1):
        contracts, unit_resolutions = _child_contracts(item, allowed_fields)
        item.update(
            {
                "action": "split_field_contract",
                "proposed_field_contracts": contracts,
                "proposed_field_unit_resolutions": unit_resolutions,
            }
        )
        _confirmed_metadata(
            item,
            confirmation,
            change_request_id=f"CR-D0-SPLIT-{index:03d}-20260801",
            rationale="按实名审核结论将复合字段合同完整拆分为有序原子字段合同",
        )

    packet["final_review"].update(
        {
            "status": READY_FOR_BASELINE_CHANGE_REVIEW,
            "change_set_id": "CR-D0-CORE-CONTRACT-20260801",
            "reviewed_by": confirmation["reviewer"],
            "reviewed_at": confirmation["reviewed_at"],
            "evidence_ids": list(confirmation["contract_evidence_ids"]),
        }
    )
    return packet


def _index(items: list[dict[str, Any]], field: str) -> dict[str, dict[str, Any]]:
    return {str(item[field]): item for item in items}


def build_confirmed_review_packet(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    previous_packet: dict[str, Any],
) -> dict[str, Any]:
    packet = build_review_packet(paths)
    packet["template_only"] = False
    packet["role_assignments"] = deepcopy(previous_packet["role_assignments"])
    packet["mapping_decisions"] = deepcopy(previous_packet["mapping_decisions"])

    previous_artifacts = _index(previous_packet["artifact_reviews"], "artifact_id")
    for index, item in enumerate(packet["artifact_reviews"]):
        previous = previous_artifacts.get(str(item["artifact_id"]))
        if previous and all(
            previous.get(field) == item.get(field)
            for field in ("candidate", "candidate_sha256", "required_roles")
        ):
            packet["artifact_reviews"][index] = deepcopy(previous)

    previous_acceptance = _index(previous_packet["acceptance_items"], "acceptance_id")
    for index, item in enumerate(packet["acceptance_items"]):
        previous = previous_acceptance.get(str(item["acceptance_id"]))
        if (
            previous
            and previous.get("review_status") == "approved"
            and all(
                previous.get(field) == item.get(field)
                for field in ("title", "hard_gate", "machine_status", "required_roles")
            )
        ):
            packet["acceptance_items"][index] = deepcopy(previous)

    sample_decisions = confirmation.get("sample_decisions")
    if not isinstance(sample_decisions, list):
        raise ValueError("sample_decisions must be a list")
    decisions = _index(sample_decisions, "raw_id")
    expected_raw_ids = {str(item["raw_id"]) for item in packet["raw_sample_reviews"]}
    if set(decisions) != expected_raw_ids:
        raise ValueError("Sample decisions do not match the current three-sample inventory")
    for item in packet["raw_sample_reviews"]:
        decision = decisions[str(item["raw_id"])]
        exact = {
            "license_decision": decision.get("license_decision"),
            "redistribution_allowed": decision.get("redistribution_allowed"),
            "ai_index_allowed": decision.get("ai_index_allowed"),
            "professional_review_status": decision.get("professional_review_status"),
        }
        if exact != {
            "license_decision": "limited",
            "redistribution_allowed": False,
            "ai_index_allowed": False,
            "professional_review_status": "approved",
        }:
            raise ValueError(f"Unexpected sample decision for {item['raw_id']}")
        item.update(exact)
        item.update(
            {
                "compliance_reviewer": confirmation["reviewer"],
                "compliance_reviewed_at": confirmation["reviewed_at"],
                "compliance_evidence_ids": list(confirmation["sample_compliance_evidence_ids"]),
                "professional_reviewer": confirmation["reviewer"],
                "professional_reviewed_at": confirmation["reviewed_at"],
                "professional_evidence_ids": list(confirmation["sample_professional_evidence_ids"]),
            }
        )
    return packet


def _unexpected_review_checks(checks: list[CheckResult]) -> list[CheckResult]:
    allowed_prefixes = (
        "D0_REVIEW_ACCEPTANCE_PENDING",
        "D0_REVIEW_FINAL_PENDING",
    )
    return [check for check in checks if check.code not in allowed_prefixes]


def write_confirmed_packets(
    paths: RepositoryPaths,
    confirmation_path: Path,
    previous_review_path: Path,
    resolution_output: Path,
    review_output: Path,
) -> tuple[Path, Path]:
    for output in (resolution_output, review_output):
        if output.exists():
            raise FileExistsError(f"Refusing to overwrite {output}")
    confirmation = load_confirmation(confirmation_path)
    previous = load_confirmation(previous_review_path)
    review_packet = build_confirmed_review_packet(paths, confirmation, previous)
    review_checks = _unexpected_review_checks(validate_review_packet(paths, review_packet))
    if review_checks:
        raise ValueError(
            "Confirmed review packet failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in review_checks)
        )
    resolution_packet = build_confirmed_contract_resolution(paths, confirmation)
    resolution_checks = validate_d0_contract_resolution(
        paths,
        resolution_packet,
        authority_packet=review_packet,
    )
    if resolution_checks:
        raise ValueError(
            "Confirmed resolution failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in resolution_checks)
        )

    temporary_paths: list[Path] = []
    try:
        for output, payload in (
            (review_output, review_packet),
            (resolution_output, resolution_packet),
        ):
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                dir=output.parent,
                prefix=f".{output.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(
                    (
                        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
                    ).encode("utf-8")
                )
            temporary_paths.append(temporary_path)
        os.replace(temporary_paths[0], review_output)
        temporary_paths.pop(0)
        os.replace(temporary_paths[0], resolution_output)
        temporary_paths.pop(0)
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)
    return resolution_output, review_output
