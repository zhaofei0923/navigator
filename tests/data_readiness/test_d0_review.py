from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.d0_review import (
    ARTIFACT_ACCEPTANCE_IDS,
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
                "escalation_person": f"{role}升级人",
                "signature_evidence_id": f"EVD-ROLE-{role}",
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
                "compliance_reviewer": "合规负责人姓名",
                "compliance_reviewed_at": "2026-08-01T11:00:00+08:00",
                "professional_review_status": "approved",
                "professional_reviewer": "国家研究负责人姓名",
                "professional_reviewed_at": "2026-08-01T12:00:00+08:00",
                "compliance_evidence_ids": [f"EVD-{item['raw_id']}-COMPLIANCE"],
                "professional_evidence_ids": [f"EVD-{item['raw_id']}-PROFESSIONAL"],
            }
        )

    for item in packet["artifact_reviews"]:
        item["review_status"] = "approved"
        for signature in item["reviewer_signatures"]:
            signature.update(
                {
                    "person_name": f"{signature['role']}姓名",
                    "signed_at": "2026-08-01T13:00:00+08:00",
                    "evidence_ids": [f"EVD-{item['artifact_id']}-{signature['role']}"],
                }
            )

    for item in packet["acceptance_items"]:
        item.update(
            {
                "comments": "已依据证据完成验收",
                "review_status": "approved",
            }
        )
        for signature in item["reviewer_signatures"]:
            signature.update(
                {
                    "person_name": f"{signature['role']}姓名",
                    "signed_at": "2026-08-01T14:00:00+08:00",
                    "evidence_ids": [f"EVD-{item['acceptance_id']}-{signature['role']}"],
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
    evidence: dict[str, dict[str, str]] = {}

    def register(evidence_ids: list[str], acceptance_id: str, reviewer: str) -> None:
        for evidence_id in evidence_ids:
            entry = {
                "evidence_id": evidence_id,
                "acceptance_id": acceptance_id,
                "reviewer": reviewer,
                "status": "已批准",
            }
            assert evidence_id not in evidence or evidence[evidence_id] == entry
            evidence[evidence_id] = entry

    for item in packet["role_assignments"]:
        if item.get("signature_evidence_id"):
            register(
                [item["signature_evidence_id"]],
                "D0-AC-007",
                item["role_holder"],
            )
    for item in packet["mapping_decisions"]:
        register(item.get("evidence_ids", []), "D0-AC-005", item["decided_by"])
    for item in packet["raw_sample_reviews"]:
        register(
            item.get("compliance_evidence_ids", []),
            "D0-AC-005",
            item["compliance_reviewer"],
        )
        register(
            item.get("professional_evidence_ids", []),
            "D0-AC-006",
            item["professional_reviewer"],
        )
    for section in (packet["artifact_reviews"], packet["acceptance_items"]):
        for item in section:
            acceptance_id = (
                item.get("acceptance_id") or ARTIFACT_ACCEPTANCE_IDS[item["artifact_id"]]
            )
            for signature in item["reviewer_signatures"]:
                register(
                    signature.get("evidence_ids", []),
                    acceptance_id,
                    signature["person_name"],
                )
    register(
        packet["final_decision"].get("evidence_ids", []),
        "D0-AC-010",
        packet["final_decision"]["approved_by"],
    )
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "stage": "D0",
                "evidence": [evidence[evidence_id] for evidence_id in sorted(evidence)],
            }
        ),
        encoding="utf-8",
    )
    return replace(paths, evidence_manifest=manifest)


def _paths_with_complete_research(tmp_path: Path) -> RepositoryPaths:
    paths = discover_repository()
    research_dir = tmp_path / "research"
    research_dir.mkdir()
    license_dir = research_dir / "licenses"
    license_dir.mkdir()
    samples = (
        ("RAW-EXAMPLE-001", "SRC-IDN-ESDM"),
        ("RAW-EXAMPLE-002", "SRC-VNM-EVN"),
        ("RAW-EXAMPLE-003", "SRC-SAU-PB"),
    )
    for index, (raw_id, source_id) in enumerate(
        samples,
        start=1,
    ):
        document_url = f"https://example.test/{index}.pdf"
        document_hash = f"{index}" * 64
        snapshot_id = f"LIC-{raw_id}"
        (research_dir / f"{index}_capture.json").write_text(
            json.dumps(
                {
                    "record_id": f"CAPTURE-{index}",
                    "raw_id": raw_id,
                    "source_id": source_id,
                    "final_url": document_url,
                    "sha256": document_hash,
                    "published_at": "2026-01-01",
                    "captured_at": "2026-08-01T08:00:00+08:00",
                    "license_status": "pending_compliance_review",
                    "license_snapshot_id": snapshot_id,
                }
            ),
            encoding="utf-8",
        )
        (license_dir / f"{index}_license.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "snapshot_id": snapshot_id,
                    "raw_id": raw_id,
                    "source_id": source_id,
                    "document_snapshot": {
                        "url": document_url,
                        "sha256": document_hash,
                    },
                }
            ),
            encoding="utf-8",
        )
    return replace(paths, d0_research_dir=research_dir)


def test_review_template_covers_every_hard_gate_and_open_decision() -> None:
    packet = build_review_packet(discover_repository())

    assert packet["template_only"] is True
    assert packet["schema_version"] == 3
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
        "D0_REVIEW_LICENSE_PENDING",
        "D0_REVIEW_PROFESSIONAL_PENDING",
        "D0_REVIEW_ARTIFACT_PENDING",
        "D0_REVIEW_ACCEPTANCE_PENDING",
        "D0_REVIEW_FINAL_PENDING",
    } <= codes
    assert "D0_REVIEW_RAW_CAPTURE_INCOMPLETE" not in codes


def test_structurally_completed_review_packet_passes(tmp_path: Path) -> None:
    source_paths = _paths_with_complete_research(tmp_path)
    packet = _completed_packet(source_paths)
    paths = _paths_with_referenced_evidence(tmp_path, source_paths, packet)

    checks = validate_review_packet(paths, packet)

    assert checks == []


def test_review_validation_binds_evidence_to_subject_reviewer_and_status(
    tmp_path: Path,
) -> None:
    source_paths = _paths_with_complete_research(tmp_path)
    packet = _completed_packet(source_paths)
    paths = _paths_with_referenced_evidence(tmp_path, source_paths, packet)
    manifest = json.loads(paths.evidence_manifest.read_text(encoding="utf-8"))
    evidence = {item["evidence_id"]: item for item in manifest["evidence"]}
    evidence["EVD-MAP-ISO3"]["acceptance_id"] = "D0-AC-004"
    evidence["EVD-D0-ART-CONVENTIONS-产品负责人"]["reviewer"] = "mallory"
    evidence["EVD-D0-FINAL"]["status"] = "pending"
    manifest["evidence"].append(dict(manifest["evidence"][0]))
    paths.evidence_manifest.write_text(json.dumps(manifest), encoding="utf-8")

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_EVIDENCE_ID_DUPLICATE",
        "D0_REVIEW_EVIDENCE_ACCEPTANCE_MISMATCH",
        "D0_REVIEW_EVIDENCE_REVIEWER_MISMATCH",
        "D0_REVIEW_EVIDENCE_NOT_APPROVED",
    } <= codes


def test_review_validation_detects_tampered_immutable_inputs() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["mapping_decisions"][0]["current_target"] = "tampered.field"
    packet["raw_sample_reviews"][0]["source_id"] = "SRC-TAMPERED"
    packet["artifact_reviews"][0]["required_roles"] = []
    packet["artifact_reviews"][0]["reviewer_signatures"] = []
    packet["acceptance_items"][0]["machine_status"] = "fail"

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_MAPPING_INPUT_CHANGED",
        "D0_REVIEW_RAW_INPUT_CHANGED",
        "D0_REVIEW_ARTIFACT_INPUT_CHANGED",
        "D0_REVIEW_ACCEPTANCE_INPUT_CHANGED",
        "D0_REVIEW_SIGNATURE_ROLE_SET_INVALID",
    } <= codes


def test_review_validation_rejects_unverified_license_snapshot_substitution() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["raw_sample_reviews"][0]["license_snapshot_id"] = "LIC-TAMPERED"

    checks = validate_review_packet(paths, packet)

    assert any(
        item.code == "D0_REVIEW_RAW_INPUT_CHANGED"
        and item.location == "raw_sample_reviews.RAW-EXAMPLE-001"
        for item in checks
    )


def test_review_validation_detects_stale_rejected_and_incomplete_approvals() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["baseline"]["sources"]["d0_workbook"]["sha256"] = "0" * 64
    packet["baseline"]["candidate_hashes"] = {}
    packet["raw_sample_reviews"][0]["license_decision"] = "rejected"
    packet["raw_sample_reviews"][0]["ai_index_allowed"] = True
    packet["raw_sample_reviews"][1]["professional_review_status"] = "rejected"
    packet["mapping_decisions"][0]["final_target"] = None
    packet["mapping_decisions"][0]["evidence_ids"] = []
    packet["artifact_reviews"][0]["reviewer_signatures"][0]["person_name"] = None
    packet["artifact_reviews"][0]["reviewer_signatures"][0]["signed_at"] = None
    packet["artifact_reviews"][0]["reviewer_signatures"][0]["evidence_ids"] = []
    packet["acceptance_items"][0]["reviewer_signatures"][0]["person_name"] = None
    packet["acceptance_items"][0]["reviewer_signatures"][0]["signed_at"] = None
    packet["acceptance_items"][0]["reviewer_signatures"][0]["evidence_ids"] = []
    packet["final_decision"]["approved_by"] = None
    packet["final_decision"]["evidence_ids"] = []

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_BASELINE_STALE",
        "D0_REVIEW_CANDIDATES_STALE",
        "D0_REVIEW_LICENSE_REJECTED",
        "D0_REVIEW_USAGE_BOUNDARY_INVALID",
        "D0_REVIEW_PROFESSIONAL_REJECTED",
        "D0_REVIEW_MAPPING_INCOMPLETE",
        "D0_REVIEW_MAPPING_EVIDENCE_MISSING",
        "D0_REVIEW_SIGNATURE_INCOMPLETE",
        "D0_REVIEW_SIGNATURE_EVIDENCE_MISSING",
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
    packet["raw_sample_reviews"][0]["compliance_evidence_ids"] = []
    packet["raw_sample_reviews"][0]["professional_evidence_ids"] = []
    packet["artifact_reviews"][0]["review_status"] = "rejected"

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_ROLE_INCOMPLETE",
        "D0_REVIEW_LICENSE_INCOMPLETE",
        "D0_REVIEW_PROFESSIONAL_INCOMPLETE",
        "D0_REVIEW_COMPLIANCE_EVIDENCE_MISSING",
        "D0_REVIEW_PROFESSIONAL_EVIDENCE_MISSING",
        "D0_REVIEW_ARTIFACT_REJECTED",
    } <= codes


def test_review_validation_binds_every_decision_to_signed_role_holders() -> None:
    paths = discover_repository()
    packet = _completed_packet(paths)
    packet["role_assignments"][0]["alternate"] = packet["role_assignments"][0]["role_holder"]
    packet["role_assignments"][0]["signed_at"] = "2026-08-01T09:00:00"
    packet["mapping_decisions"][0]["decided_by"] = "mallory"
    packet["raw_sample_reviews"][0]["compliance_reviewer"] = "mallory"
    packet["raw_sample_reviews"][0]["professional_reviewer"] = "mallory"
    packet["artifact_reviews"][0]["reviewer_signatures"][0]["person_name"] = "mallory"
    packet["acceptance_items"][0]["reviewer_signatures"][0]["person_name"] = "mallory"
    packet["final_decision"]["approver_role"] = "合规负责人"
    packet["final_decision"]["approved_by"] = "mallory"

    codes = {item.code for item in validate_review_packet(paths, packet)}

    assert {
        "D0_REVIEW_ROLE_SEPARATION_INVALID",
        "D0_REVIEW_TEMPORAL_INVALID",
        "D0_REVIEW_MAPPING_DECIDER_UNAUTHORIZED",
        "D0_REVIEW_COMPLIANCE_REVIEWER_UNAUTHORIZED",
        "D0_REVIEW_PROFESSIONAL_REVIEWER_UNAUTHORIZED",
        "D0_REVIEW_SIGNER_UNAUTHORIZED",
        "D0_REVIEW_FINAL_ROLE_INVALID",
        "D0_REVIEW_FINAL_APPROVER_UNAUTHORIZED",
    } <= codes


def test_review_validation_rejects_invalid_sections_and_sets() -> None:
    paths = discover_repository()
    packet = build_review_packet(paths)
    packet["schema_version"] = 1
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
