from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.d0_candidates import candidate_payloads
from navigator_data_readiness.d0_contract_resolution import (
    READY_FOR_BASELINE_CHANGE_REVIEW,
    load_and_validate_d0_contract_resolution,
    validate_d0_contract_resolution,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _completed_packet(paths: RepositoryPaths) -> dict[str, Any]:
    packet = deepcopy(candidate_payloads(paths)["core_contract_resolution.template.json"])
    packet["template_only"] = False
    for index, item in enumerate(packet["entity_primary_key_resolutions"], start=1):
        if item["current_field_ids"]:
            item["action"] = "promote_existing_field"
            item["primary_key_field_ids"] = [item["current_field_ids"][0]]
        else:
            item["action"] = "add_primary_key_field"
            contract = dict.fromkeys(
                packet["proposed_field_contract_schema"]["allowed_fields"], "test"
            )
            contract.update(
                {
                    "字段编号": f"DATA-PK-{index:03d}",
                    "实体": item["entity_code"],
                    "字段名": "id",
                    "中文名称": "主键",
                    "类型": "uuid",
                    "必填": "是",
                    "来源要求": "系统生成",
                    "唯一/索引": "主键",
                    "单位": "不适用",
                }
            )
            item["proposed_field_contract"] = contract
        item.update(
            {
                "change_request_id": f"CR-D0-ENTITY-{index:03d}",
                "rationale": "补齐显式主键合同",
                "proposed_by": "kevin",
                "proposed_at": "2026-07-31",
                "reviewed_by": "kevin",
                "reviewed_at": "2026-07-31T18:00:00+08:00",
                "evidence_ids": [f"EVD-D0-ENTITY-{index:03d}"],
                "status": "proposed",
            }
        )
    for index, item in enumerate(packet["field_unit_resolutions"], start=1):
        item.update(
            {
                "unit_applicability": "not_applicable",
                "change_request_id": f"CR-D0-UNIT-{index:03d}",
                "rationale": "该字段为标识、文本或枚举，不适用计量单位",
                "proposed_by": "kevin",
                "proposed_at": "2026-07-31",
                "reviewed_by": "kevin",
                "reviewed_at": "2026-07-31T18:00:00+08:00",
                "evidence_ids": [f"EVD-D0-UNIT-{index:03d}"],
                "status": "proposed",
            }
        )
    packet["final_review"].update(
        {
            "status": READY_FOR_BASELINE_CHANGE_REVIEW,
            "change_set_id": "CR-D0-CORE-CONTRACT-001",
            "reviewed_by": "kevin",
            "reviewed_at": "2026-07-31T19:00:00+08:00",
            "evidence_ids": ["EVD-D0-CORE-CONTRACT-RESOLUTION"],
        }
    )
    return packet


def test_template_covers_every_machine_gap() -> None:
    paths = discover_repository()
    packet = candidate_payloads(paths)["core_contract_resolution.template.json"]

    assert packet["template_only"] is True
    assert len(packet["entity_primary_key_resolutions"]) == 29
    assert len(packet["field_unit_resolutions"]) == 92
    assert set(packet["baseline"]["evidence_candidate_hashes"]) == {
        "core_entity_evidence.json",
        "core_field_evidence.json",
    }
    assert all(item["status"] == "pending" for item in packet["field_unit_resolutions"])


def test_completed_resolution_is_ready_for_baseline_change_review() -> None:
    paths = discover_repository()

    checks = validate_d0_contract_resolution(paths, _completed_packet(paths))

    assert checks == []


def test_unfilled_template_reports_all_pending_sections() -> None:
    paths = discover_repository()
    packet = candidate_payloads(paths)["core_contract_resolution.template.json"]

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_TEMPLATE_UNCOPIED",
        "D0_CONTRACT_RESOLUTION_ENTITY_PENDING",
        "D0_CONTRACT_RESOLUTION_UNIT_PENDING",
        "D0_CONTRACT_RESOLUTION_FINAL_PENDING",
    } <= codes


def test_resolution_rejects_tampered_baseline_schema_and_sets() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["baseline"]["sources"]["d0_workbook"]["sha256"] = "0" * 64
    packet["allowed_entity_actions"] = []
    packet["entity_primary_key_resolutions"].pop()
    packet["field_unit_resolutions"].append(
        dict(packet["field_unit_resolutions"][0], field_id="DATA-UNKNOWN")
    )

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_BASELINE_STALE",
        "D0_CONTRACT_RESOLUTION_SCHEMA_CHANGED",
        "D0_CONTRACT_RESOLUTION_ENTITY_SET_INVALID",
        "D0_CONTRACT_RESOLUTION_FIELD_SET_INVALID",
    } <= codes


def test_resolution_rejects_invalid_existing_key_actions() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    entries = [
        item for item in packet["entity_primary_key_resolutions"] if item["current_field_ids"]
    ]
    entries[0]["action"] = "model_composite_key"
    entries[0]["primary_key_field_ids"] = [entries[0]["current_field_ids"][0]]
    entries[0]["proposed_field_contract"] = {}
    entries[1]["primary_key_field_ids"] = ["DATA-USER-001"]
    entries[1]["current_field_ids"] = ["DATA-USER-001"]

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert "D0_CONTRACT_RESOLUTION_ENTITY_KEY_INVALID" in codes
    assert "D0_CONTRACT_RESOLUTION_ENTITY_INPUT_CHANGED" in codes
    assert "D0_CONTRACT_RESOLUTION_ENTITY_FIELD_MISMATCH" in codes


def test_resolution_rejects_invalid_new_primary_key_contracts() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    additions = [
        item
        for item in packet["entity_primary_key_resolutions"]
        if item["action"] == "add_primary_key_field"
    ]
    assert len(additions) >= 2
    additions[0]["proposed_field_contract"].pop("单位")
    additions[1]["proposed_field_contract"]["字段编号"] = "DATA-USER-001"
    additions[1]["proposed_field_contract"]["实体"] = "wrong_entity"
    additions[1]["proposed_field_contract"]["必填"] = "否"

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_NEW_FIELD_INCOMPLETE",
        "D0_CONTRACT_RESOLUTION_NEW_FIELD_ID_INVALID",
        "D0_CONTRACT_RESOLUTION_NEW_FIELD_CONTRACT_INVALID",
    } <= codes


def test_resolution_rejects_invalid_unit_decisions() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    first, second, third = packet["field_unit_resolutions"][:3]
    first["unit_applicability"] = "unit_code"
    second["unit_code"] = "MW"
    third["unit_applicability"] = "unknown"

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_UNIT_METADATA_INCOMPLETE",
        "D0_CONTRACT_RESOLUTION_UNIT_METADATA_CONFLICT",
        "D0_CONTRACT_RESOLUTION_UNIT_INVALID",
    } <= codes


def test_resolution_accepts_complete_registered_unit_decision() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    item = packet["field_unit_resolutions"][0]
    item.update(
        {
            "unit_applicability": "unit_code",
            "unit_code": "MW",
            "unit_dimension": "power",
            "unit_registry_reference": "UNIT-REGISTRY-SI-POWER",
        }
    )

    checks = validate_d0_contract_resolution(paths, packet)

    assert checks == []


def test_resolution_rejects_metadata_identity_time_and_evidence_gaps() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    item = packet["field_unit_resolutions"][0]
    item["change_request_id"] = None
    item["proposed_by"] = "mallory"
    item["reviewed_at"] = "2026-07-31T12:00:00"
    item["evidence_ids"] = ["EVD-1", "EVD-1"]

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_METADATA_INCOMPLETE",
        "D0_CONTRACT_RESOLUTION_REVIEWER_UNAUTHORIZED",
        "D0_CONTRACT_RESOLUTION_TEMPORAL_INVALID",
        "D0_CONTRACT_RESOLUTION_EVIDENCE_DUPLICATE",
    } <= codes


def test_resolution_rejects_invalid_sections_header_and_final_review() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["schema_version"] = 2
    packet["entity_primary_key_resolutions"] = "invalid"
    packet["field_unit_resolutions"] = [{"field_id": ""}, []]
    packet["final_review"] = []

    codes = {check.code for check in validate_d0_contract_resolution(paths, packet)}

    assert {
        "D0_CONTRACT_RESOLUTION_HEADER_INVALID",
        "D0_CONTRACT_RESOLUTION_SECTION_INVALID",
        "D0_CONTRACT_RESOLUTION_ENTRY_INVALID",
        "D0_CONTRACT_RESOLUTION_FINAL_INVALID",
    } <= codes


def test_resolution_rejects_unauthorized_formal_role_source(tmp_path: Path) -> None:
    source_paths = discover_repository()
    review_dir = tmp_path / "review"
    review_dir.mkdir()
    source_review = source_paths.d0_review_dir / "d0_review_packet.2026-07-31.json"
    review = json.loads(source_review.read_text(encoding="utf-8"))
    review["role_assignments"][0]["alternate"] = review["role_assignments"][0]["role_holder"]
    (review_dir / source_review.name).write_text(json.dumps(review), encoding="utf-8")
    paths = replace(source_paths, d0_review_dir=review_dir)

    codes = {
        check.code for check in validate_d0_contract_resolution(paths, _completed_packet(paths))
    }

    assert "D0_CONTRACT_RESOLUTION_AUTHORITY_INVALID" in codes


def test_resolution_loader_handles_missing_invalid_and_non_object_files(tmp_path: Path) -> None:
    paths = discover_repository()
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{", encoding="utf-8")
    array = tmp_path / "array.json"
    array.write_text("[]", encoding="utf-8")

    missing = load_and_validate_d0_contract_resolution(paths, tmp_path / "missing.json")
    malformed = load_and_validate_d0_contract_resolution(paths, invalid)
    non_object = load_and_validate_d0_contract_resolution(paths, array)

    assert missing[0].code == "D0_CONTRACT_RESOLUTION_PACKET_INVALID"
    assert malformed[0].code == "D0_CONTRACT_RESOLUTION_PACKET_INVALID"
    assert non_object[0].code == "D0_CONTRACT_RESOLUTION_PACKET_INVALID"
