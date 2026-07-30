from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.d0_review import (
    build_review_packet,
    load_and_validate_review_packet,
    validate_review_packet,
    write_review_template,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _completed_packet(paths: RepositoryPaths) -> dict[str, Any]:
    packet = build_review_packet(paths)
    packet["template_only"] = False

    for item in packet["role_assignments"]:
        role = item["role"]
        item.update(
            {
                "role_holder": f"{role}姓名",
                "alternate": f"{role}替补",
                "escalation_role": "项目批准人",
                "signature_evidence_id": f"EVD-ROLE-{len(role)}",
                "signed_at": "2026-08-01T09:00:00+08:00",
                "status": "signed",
            }
        )

    for item in packet["mapping_decisions"]:
        item.update(
            {
                "decision": "replace_target",
                "final_target": f"approved.{item['mapping_id'].lower()}",
                "rationale": "专业人员已依据冻结模型完成决策",
                "change_request_id": f"CR-{item['mapping_id']}",
                "decided_by": "数据负责人姓名",
                "decided_at": "2026-08-01T10:00:00+08:00",
                "evidence_ids": [f"EVD-{item['mapping_id']}"],
                "review_status": "approved",
            }
        )

    for item in packet["raw_sample_reviews"]:
        item.update(
            {
                "capture_record": item["capture_record"] or f"CAPTURE-{item['raw_id']}",
                "capture_metadata_complete": True,
                "license_decision": "approved",
                "license_snapshot_id": f"LIC-{item['raw_id']}",
                "compliance_reviewer": "合规负责人姓名",
                "compliance_reviewed_at": "2026-08-01T11:00:00+08:00",
                "professional_review_status": "approved",
                "professional_reviewer": "国家研究负责人姓名",
                "professional_reviewed_at": "2026-08-01T12:00:00+08:00",
                "evidence_ids": [f"EVD-{item['raw_id']}"],
            }
        )

    for item in packet["artifact_reviews"]:
        item.update(
            {
                "reviewers": item["required_roles"],
                "reviewed_at": "2026-08-01T13:00:00+08:00",
                "evidence_ids": [f"EVD-{item['artifact_id']}"],
                "review_status": "approved",
            }
        )

    for item in packet["acceptance_items"]:
        item.update(
            {
                "reviewers": item["required_roles"],
                "reviewed_at": "2026-08-01T14:00:00+08:00",
                "evidence_ids": [f"EVD-{item['acceptance_id']}"],
                "comments": "已依据证据完成验收",
                "review_status": "approved",
            }
        )

    packet["final_decision"].update(
        {
            "status": "approved",
            "approved_by": "项目批准人姓名",
            "approved_at": "2026-08-01T15:00:00+08:00",
            "evidence_ids": ["EVD-D0-FINAL"],
            "comments": "批准进入D1",
        }
    )
    return packet


def _paths_with_referenced_evidence(
    tmp_path: Path,
    paths: RepositoryPaths,
    packet: dict[str, Any],
) -> RepositoryPaths:
    evidence_ids = {
        item["signature_evidence_id"]
        for item in packet["role_assignments"]
        if item.get("signature_evidence_id")
    }
    for section in (
        packet["mapping_decisions"],
        packet["raw_sample_reviews"],
        packet["artifact_reviews"],
        packet["acceptance_items"],
    ):
        for item in section:
            evidence_ids.update(item.get("evidence_ids", []))
    evidence_ids.update(packet["final_decision"].get("evidence_ids", []))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "stage": "D0",
                "evidence": [{"evidence_id": evidence_id} for evidence_id in sorted(evidence_ids)],
            }
        ),
        encoding="utf-8",
    )
    return replace(paths, evidence_manifest=manifest)


def _paths_with_complete_research(tmp_path: Path) -> RepositoryPaths:
    paths = discover_repository()
    research_dir = tmp_path / "research"
    research_dir.mkdir()
    for index, raw_id in enumerate(
        ("RAW-EXAMPLE-001", "RAW-EXAMPLE-002", "RAW-EXAMPLE-003"),
        start=1,
    ):
        (research_dir / f"{index}_capture.json").write_text(
            json.dumps(
                {
                    "record_id": f"CAPTURE-{index}",
                    "raw_id": raw_id,
                    "sha256": f"{index}" * 64,
                    "published_at": "2026-01-01",
                    "captured_at": "2026-08-01T08:00:00+08:00",
                    "license_status": "pending_compliance_review",
                }
            ),
            encoding="utf-8",
        )
    return replace(paths, d0_research_dir=research_dir)


def test_review_template_covers_every_hard_gate_and_open_decision() -> None:
    packet = build_review_packet(discover_repository())

    assert packet["template_only"] is True
    assert len(packet["role_assignments"]) == 9
    assert len(packet["mapping_decisions"]) == 6
    assert len(packet["raw_sample_reviews"]) == 3
    assert len(packet["artifact_reviews"]) == 3
    assert [item["acceptance_id"] for item in packet["acceptance_items"]] == [
        f"D0-AC-{index:03d}" for index in range(1, 11)
    ]
    assert all(item["hard_gate"] is True for item in packet["acceptance_items"])
    assert packet["baseline"]["sources"]["d0_workbook"]["sha256"]
    assert len(packet["baseline"]["candidate_hashes"]) == 7


def test_unfilled_review_template_reports_all_pending_categories() -> None:
    paths = discover_repository()

    checks = validate_review_packet(paths, build_review_packet(paths))
    codes = {item.code for item in checks}

    assert {
        "D0_REVIEW_TEMPLATE_UNCOPIED",
        "D0_REVIEW_ROLE_PENDING",
        "D0_REVIEW_MAPPING_PENDING",
        "D0_REVIEW_RAW_CAPTURE_INCOMPLETE",
        "D0_REVIEW_LICENSE_PENDING",
        "D0_REVIEW_PROFESSIONAL_PENDING",
        "D0_REVIEW_RAW_EVIDENCE_MISSING",
        "D0_REVIEW_ARTIFACT_PENDING",
        "D0_REVIEW_ACCEPTANCE_PENDING",
        "D0_REVIEW_FINAL_PENDING",
    } <= codes


def test_structurally_completed_review_packet_passes(tmp_path: Path) -> None:
    source_paths = _paths_with_complete_research(tmp_path)
    packet = _completed_packet(source_paths)
    paths = _paths_with_referenced_evidence(tmp_path, source_paths, packet)

    checks = validate_review_packet(paths, packet)

    assert checks == []


def test_review_validation_detects_tampered_immutable_inputs() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["mapping_decisions"][0]["current_target"] = "tampered.field"
    packet["raw_sample_reviews"][0]["source_id"] = "SRC-TAMPERED"
    packet["artifact_reviews"][0]["required_roles"] = []
    packet["artifact_reviews"][0]["reviewers"] = []
    packet["acceptance_items"][0]["machine_status"] = "fail"

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_MAPPING_INPUT_CHANGED",
        "D0_REVIEW_RAW_INPUT_CHANGED",
        "D0_REVIEW_ARTIFACT_INPUT_CHANGED",
        "D0_REVIEW_ACCEPTANCE_INPUT_CHANGED",
        "D0_REVIEW_ARTIFACT_REVIEWERS_INCOMPLETE",
    } <= codes


def test_review_validation_detects_stale_rejected_and_incomplete_approvals() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["baseline"]["sources"]["d0_workbook"]["sha256"] = "0" * 64
    packet["baseline"]["candidate_hashes"] = {}
    packet["raw_sample_reviews"][0]["license_decision"] = "rejected"
    packet["mapping_decisions"][0]["final_target"] = None
    packet["mapping_decisions"][0]["evidence_ids"] = []
    packet["artifact_reviews"][0]["reviewers"] = []
    packet["artifact_reviews"][0]["reviewed_at"] = None
    packet["artifact_reviews"][0]["evidence_ids"] = []
    packet["acceptance_items"][0]["reviewers"] = []
    packet["acceptance_items"][0]["reviewed_at"] = None
    packet["acceptance_items"][0]["evidence_ids"] = []
    packet["final_decision"]["approved_by"] = None
    packet["final_decision"]["evidence_ids"] = []

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_BASELINE_STALE",
        "D0_REVIEW_CANDIDATES_STALE",
        "D0_REVIEW_LICENSE_REJECTED",
        "D0_REVIEW_MAPPING_INCOMPLETE",
        "D0_REVIEW_MAPPING_EVIDENCE_MISSING",
        "D0_REVIEW_ARTIFACT_REVIEWERS_INCOMPLETE",
        "D0_REVIEW_ARTIFACT_INCOMPLETE",
        "D0_REVIEW_ARTIFACT_EVIDENCE_MISSING",
        "D0_REVIEW_ACCEPTANCE_REVIEWERS_INCOMPLETE",
        "D0_REVIEW_ACCEPTANCE_INCOMPLETE",
        "D0_REVIEW_ACCEPTANCE_EVIDENCE_MISSING",
        "D0_REVIEW_FINAL_INCOMPLETE",
        "D0_REVIEW_FINAL_EVIDENCE_MISSING",
        "D0_REVIEW_EVIDENCE_REFERENCE_UNKNOWN",
    } <= codes


def test_review_validation_detects_incomplete_signed_role_and_approved_reviews() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["role_assignments"][0]["alternate"] = None
    packet["raw_sample_reviews"][0]["license_snapshot_id"] = None
    packet["raw_sample_reviews"][0]["professional_reviewer"] = None
    packet["artifact_reviews"][0]["review_status"] = "rejected"

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_ROLE_INCOMPLETE",
        "D0_REVIEW_LICENSE_INCOMPLETE",
        "D0_REVIEW_PROFESSIONAL_INCOMPLETE",
        "D0_REVIEW_ARTIFACT_REJECTED",
    } <= codes


def test_review_validation_rejects_invalid_sections_and_sets() -> None:
    paths = discover_repository()
    packet = build_review_packet(paths)
    packet["schema_version"] = 2
    packet["baseline"] = []
    packet["role_assignments"] = "invalid"
    packet["mapping_decisions"] = [{"mapping_id": "UNKNOWN"}, {"mapping_id": "UNKNOWN"}, {}]
    packet["raw_sample_reviews"] = []
    packet["artifact_reviews"] = []
    packet["acceptance_items"] = []
    packet["final_decision"] = []

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_HEADER_INVALID",
        "D0_REVIEW_BASELINE_INVALID",
        "D0_REVIEW_SECTION_INVALID",
        "D0_REVIEW_ENTRY_INVALID",
        "D0_REVIEW_ENTRY_DUPLICATE",
        "D0_REVIEW_ROLE_SET_INVALID",
        "D0_REVIEW_MAPPING_SET_INVALID",
        "D0_REVIEW_RAW_SET_INVALID",
        "D0_REVIEW_ARTIFACT_SET_INVALID",
        "D0_REVIEW_ACCEPTANCE_SET_INVALID",
        "D0_REVIEW_FINAL_PENDING",
    } <= codes


def test_review_validation_rejects_invalid_baseline_sources() -> None:
    paths = discover_repository()
    packet = build_review_packet(paths)
    packet["baseline"]["sources"] = []

    checks = validate_review_packet(paths, packet)

    assert any(item.code == "D0_REVIEW_BASELINE_INVALID" for item in checks)


def test_review_validation_rejects_invalid_evidence_manifest(tmp_path: Path) -> None:
    source_paths = discover_repository()
    manifest = tmp_path / "manifest.json"
    manifest.write_text("{", encoding="utf-8")
    paths = replace(source_paths, evidence_manifest=manifest)
    packet = build_review_packet(paths)
    packet["template_only"] = False

    checks = validate_review_packet(paths, packet)

    assert any(item.code == "D0_REVIEW_EVIDENCE_MANIFEST_INVALID" for item in checks)


def test_write_and_load_review_packet(tmp_path: Path) -> None:
    source_paths = discover_repository()
    paths = replace(source_paths, d0_review_dir=tmp_path / "review")

    written = write_review_template(paths)
    payload = json.loads(written.read_text(encoding="utf-8"))
    checks = load_and_validate_review_packet(paths, written)

    assert written.name == "d0_review_packet.template.json"
    assert payload["stage"] == "D0"
    assert any(item.code == "D0_REVIEW_FINAL_PENDING" for item in checks)


def test_load_review_packet_handles_missing_invalid_and_non_object_files(tmp_path: Path) -> None:
    paths = discover_repository()
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{", encoding="utf-8")
    array = tmp_path / "array.json"
    array.write_text("[]", encoding="utf-8")

    missing_checks = load_and_validate_review_packet(paths, tmp_path / "missing.json")
    invalid_checks = load_and_validate_review_packet(paths, invalid)
    array_checks = load_and_validate_review_packet(paths, array)

    assert missing_checks[0].code == "D0_REVIEW_PACKET_INVALID"
    assert invalid_checks[0].code == "D0_REVIEW_PACKET_INVALID"
    assert array_checks[0].code == "D0_REVIEW_PACKET_INVALID"
