from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

from navigator_data_readiness.baseline import extract_contracts
from navigator_data_readiness.d0_candidates import (
    build_acceptance_assessment,
    build_conventions_candidate,
    build_core_contract_recommendations,
    build_core_contract_resolution_template,
    build_core_contract_review_worksheet,
    build_core_entity_evidence,
    build_core_field_evidence,
    build_enum_migration_evidence,
    build_gold_standard_gap_report,
    build_mapping_resolution_proposal,
    build_raw_sample_review_worksheet,
    build_template_trial,
    build_terminology_review_queue,
    load_license_snapshots,
    load_research_captures,
    write_candidates,
)
from navigator_data_readiness.paths import discover_repository


def test_template_trial_finds_all_unfrozen_mapping_targets() -> None:
    contracts = extract_contracts(discover_repository())

    report = build_template_trial(contracts)
    checks = {item["check_id"]: item for item in report["checks"]}
    mapping_targets = {item["target"] for item in checks["TRIAL-MAPPING-TARGET"]["failures"]}

    assert report["status"] == "fail"
    assert checks["TRIAL-BATCH-COUNTRY"]["status"] == "pass"
    assert checks["TRIAL-BATCH-SOURCE"]["status"] == "pass"
    assert checks["TRIAL-RAW-REFERENCES"]["status"] == "pass"
    assert mapping_targets == {
        "country.name_zh",
        "country.iso3",
        "policy.published_at",
        "project.capacity_mw",
        "tender.budget_original",
        "partner.legal_name",
    }


def test_template_trial_applies_approved_mapping_decisions() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)
    packet = json.loads(
        (paths.d0_review_dir / "d0_review_packet.2026-07-31.json").read_text(encoding="utf-8")
    )

    report = build_template_trial(contracts, packet["mapping_decisions"])
    checks = {item["check_id"]: item for item in report["checks"]}

    assert report["status"] == "pass"
    assert checks["TRIAL-MAPPING-TARGET"]["failures"] == []
    assert len(report["resolved_mappings"]) == 6


def test_gold_standard_gap_report_does_not_promote_examples() -> None:
    contracts = extract_contracts(discover_repository())

    report = build_gold_standard_gap_report(contracts)

    assert report["status"] == "incomplete"
    assert len(report["candidates"]) == 3
    assert all(item["unresolved"] for item in report["candidates"])


def test_verified_capture_only_resolves_observed_metadata() -> None:
    contracts = extract_contracts(discover_repository())
    capture = {
        "record_id": "CAPTURE-1",
        "raw_id": "RAW-EXAMPLE-001",
        "sha256": "a" * 64,
        "published_at": "2025-07-11",
        "captured_at": "2026-07-31T00:50:51+08:00",
        "license_status": "pending_compliance_review",
    }

    report = build_gold_standard_gap_report(contracts, [capture])
    first = report["candidates"][0]

    assert first["verified_capture"] is True
    assert first["capture_record"] == "CAPTURE-1"
    assert first["unresolved"] == ["许可快照", "行类型仍为示例"]
    assert first["license_snapshot_verified"] is False


def test_repository_research_captures_cover_all_verified_gold_standard_samples() -> None:
    paths = discover_repository()

    captures = load_research_captures(paths)
    captures_by_raw_id = {item["raw_id"]: item for item in captures}

    assert set(captures_by_raw_id) == {
        "RAW-EXAMPLE-001",
        "RAW-EXAMPLE-002",
        "RAW-EXAMPLE-003",
    }
    assert all(len(item["sha256"]) == 64 for item in captures)
    assert all(item["license_status"] == "pending_compliance_review" for item in captures)
    assert all(item["local_file_committed"] is False for item in captures)
    assert (
        captures_by_raw_id["RAW-EXAMPLE-003"]["record_id"]
        == "D0-CAPTURE-SAU-PB-ROUND7-QUALIFIED-DEVELOPERS-2025"
    )
    assert captures_by_raw_id["RAW-EXAMPLE-003"]["pdf"]["pages"] == 2


def test_repository_license_snapshots_match_captured_documents() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)
    captures = load_research_captures(paths)
    snapshots = load_license_snapshots(paths)

    report = build_gold_standard_gap_report(
        contracts,
        captures,
        license_snapshots=snapshots,
    )

    assert len(snapshots) == 3
    assert all(item["license_snapshot_verified"] is True for item in report["candidates"])
    assert all("许可快照" not in item["unresolved"] for item in report["candidates"])
    assert all("许可结论待审" in item["unresolved"] for item in report["candidates"])


def test_gold_standard_requires_review_to_reference_verified_license_snapshot() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)
    capture = next(
        item for item in load_research_captures(paths) if item["raw_id"] == "RAW-EXAMPLE-001"
    )
    snapshot = next(
        item
        for item in load_license_snapshots(paths)
        if item["snapshot_id"] == capture["license_snapshot_id"]
    )
    review = {
        "raw_id": capture["raw_id"],
        "license_decision": "limited",
        "license_snapshot_id": "LIC-TAMPERED",
        "compliance_reviewer": "kevin",
        "compliance_reviewed_at": "2026-07-31",
    }

    report = build_gold_standard_gap_report(contracts, [capture], [review], [snapshot])
    first = report["candidates"][0]

    assert first["license_snapshot_verified"] is True
    assert "许可结论待审" in first["unresolved"]


def test_terminology_and_conventions_are_review_candidates() -> None:
    contracts = extract_contracts(discover_repository())

    terminology = build_terminology_review_queue(contracts)
    conventions = build_conventions_candidate()

    assert terminology["group_count"] == 45
    assert terminology["term_count"] == 251
    assert terminology["status"] == "pending_professional_review"
    assert conventions["status"] == "candidate_pending_approval"
    assert conventions["rules"]["time"]["storage"] == "UTC语义的timestamptz"


def test_acceptance_assessment_separates_machine_and_human_status() -> None:
    contracts = extract_contracts(discover_repository())

    report = build_acceptance_assessment(contracts)
    assessments = {item["acceptance_id"]: item for item in report["assessments"]}

    assert report["overall_status"] == "not_ready"
    assert assessments["D0-AC-001"]["machine_status"] == "fail"
    assert assessments["D0-AC-002"]["machine_status"] == "fail"
    assert assessments["D0-AC-003"]["machine_status"] == "pass"
    assert assessments["D0-AC-005"]["machine_status"] == "fail"
    assert assessments["D0-AC-006"]["machine_status"] == "incomplete"
    assert assessments["D0-AC-007"]["machine_status"] == "fail"
    assert all(item["human_status"] == "pending" for item in assessments.values())


def test_core_entity_evidence_does_not_overstate_primary_key_coverage() -> None:
    contracts = extract_contracts(discover_repository())

    evidence = build_core_entity_evidence(contracts)
    checks = {item["check_id"]: item for item in evidence["checks"]}

    assert evidence["machine_status"] == "fail"
    assert evidence["human_status"] == "pending"
    assert evidence["inventory"]["relationship_count"] == 25
    assert evidence["inventory"]["entity_code_count"] == 34
    assert evidence["inventory"]["primary_key_entity_count"] == 5
    assert checks["ENTITY-PRIMARY-KEY-COVERAGE"]["status"] == "fail"
    assert "country" in checks["ENTITY-PRIMARY-KEY-COVERAGE"]["findings"]
    assert checks["ENTITY-AUTHORITY-PRESENT"]["status"] == "pass"


def test_core_field_evidence_requires_explicit_unit_or_not_applicable() -> None:
    contracts = extract_contracts(discover_repository())

    evidence = build_core_field_evidence(contracts)
    checks = {item["check_id"]: item for item in evidence["checks"]}

    assert evidence["machine_status"] == "fail"
    assert evidence["inventory"]["field_count"] == 92
    assert evidence["inventory"]["unit_metadata_column_present"] is False
    assert evidence["inventory"]["fields_with_explicit_unit_or_not_applicable"] == 0
    assert checks["FIELD-ID-UNIQUE"]["status"] == "pass"
    assert checks["FIELD-METADATA-COMPLETE"]["status"] == "pass"
    assert checks["FIELD-UNIT-METADATA-PRESENT"]["status"] == "fail"
    assert checks["FIELD-UNIT-METADATA-PRESENT"]["findings"][0]["field_count"] == 92


def test_core_field_evidence_rejects_partial_unit_metadata() -> None:
    contracts = deepcopy(extract_contracts(discover_repository()))
    contracts["fields"][0]["单位"] = "不适用"

    evidence = build_core_field_evidence(contracts)
    unit_check = next(
        item for item in evidence["checks"] if item["check_id"] == "FIELD-UNIT-METADATA-PRESENT"
    )

    assert evidence["machine_status"] == "fail"
    assert evidence["inventory"]["unit_metadata_column_present"] is True
    assert evidence["inventory"]["fields_with_explicit_unit_or_not_applicable"] == 1
    assert unit_check["findings"][0]["field_count"] == 91


def test_core_contract_recommendations_are_complete_conservative_and_unsigned() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)
    source_binding = {
        "baseline_version": "test",
        "d0_workbook": {"path": "d0.xlsx", "sha256": "a" * 64},
        "technical_workbook": {"path": "technical.xlsx", "sha256": "b" * 64},
    }
    entity_evidence = build_core_entity_evidence(contracts, source_binding=source_binding)
    field_evidence = build_core_field_evidence(contracts, source_binding=source_binding)
    template = build_core_contract_resolution_template(
        contracts,
        source_binding=source_binding,
        core_entity_evidence=entity_evidence,
        core_field_evidence=field_evidence,
    )

    recommendations = build_core_contract_recommendations(
        contracts,
        source_binding=source_binding,
        resolution_template=template,
    )

    assert recommendations["advisory_only"] is True
    assert recommendations["human_decision_required"] is True
    assert recommendations["summary"] == {
        "entity_primary_key_recommendation_count": 29,
        "field_unit_recommendation_count": 92,
        "unit_recommendation_counts": {
            "compound_contract_requires_human_analysis": 20,
            "not_applicable_candidate": 69,
            "numeric_semantics_requires_human_analysis": 3,
        },
    }
    primary_keys = recommendations["entity_primary_key_recommendations"]
    assert all(item["recommended_action"] == "add_primary_key_field" for item in primary_keys)
    assert all(item["human_decision_required"] is True for item in primary_keys)
    new_field_ids = [item["recommended_field_contract"]["字段编号"] for item in primary_keys]
    existing_field_ids = {str(item["字段编号"]) for item in contracts["fields"]}
    assert len(new_field_ids) == len(set(new_field_ids)) == 29
    assert not set(new_field_ids) & existing_field_ids
    assert all(item["recommended_field_contract"]["单位"] == "不适用" for item in primary_keys)

    unit_items = recommendations["field_unit_recommendations"]
    by_field_id = {item["field_id"]: item for item in unit_items}
    assert by_field_id["DATA-ENTITLEMENT-001"]["recommended_resolution"] is None
    assert by_field_id["DATA-D4-020"]["recommended_resolution"] is None
    assert by_field_id["DATA-COUNTRY-001"]["recommended_resolution"] == {
        "unit_applicability": "not_applicable",
        "unit_code": None,
        "unit_dimension": None,
        "unit_registry_reference": None,
    }

    signing_keys = {
        "status",
        "change_request_id",
        "proposed_by",
        "proposed_at",
        "reviewed_by",
        "reviewed_at",
        "evidence_ids",
    }

    def keys(value: object) -> set[str]:
        if isinstance(value, dict):
            return set(value) | {key for item in value.values() for key in keys(item)}
        if isinstance(value, list):
            return {key for item in value for key in keys(item)}
        return set()

    assert not keys(recommendations) & signing_keys


def test_core_contract_review_worksheet_groups_every_decision_without_signing() -> None:
    paths = discover_repository()
    recommendations = json.loads(
        (paths.d0_candidates_dir / "core_contract_recommendations.json").read_text(encoding="utf-8")
    )

    worksheet = build_core_contract_review_worksheet(recommendations)

    expected_hash = hashlib.sha256(
        (json.dumps(recommendations, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    ).hexdigest()
    assert f"建议文件SHA-256：`{expected_hash}`" in worksheet
    assert "主键建议：29项" in worksheet
    assert "单位不适用候选：69项" in worksheet
    assert "数值语义待审：3项" in worksheet
    assert "复合字段待审：20项" in worksheet
    assert worksheet.count("DATA-D0-PK-") == 29
    assert "DATA-ENTITLEMENT-001" in worksheet
    assert "DATA-D4-020" in worksheet
    assert "reviewed_by" not in worksheet
    assert "evidence_ids" not in worksheet
    assert "本工作表本身不得提交给正式校验器" in worksheet


def test_raw_sample_review_worksheet_binds_verified_metadata_without_document_content() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)
    captures = load_research_captures(paths)
    snapshots = load_license_snapshots(paths)
    gold_gap = build_gold_standard_gap_report(
        contracts,
        captures,
        license_snapshots=snapshots,
    )

    worksheet = build_raw_sample_review_worksheet(captures, snapshots, gold_gap)

    inputs = {
        "captures": sorted(captures, key=lambda item: str(item.get("raw_id") or "")),
        "license_snapshots": sorted(snapshots, key=lambda item: str(item.get("snapshot_id") or "")),
        "gold_candidates": sorted(
            gold_gap["candidates"], key=lambda item: str(item.get("raw_id") or "")
        ),
    }
    expected_hash = hashlib.sha256(
        (json.dumps(inputs, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    ).hexdigest()
    assert f"审核输入SHA-256：`{expected_hash}`" in worksheet
    assert worksheet.count("## 1. RAW-EXAMPLE-001") == 1
    assert worksheet.count("## 2. RAW-EXAMPLE-002") == 1
    assert worksheet.count("## 3. RAW-EXAMPLE-003") == 1
    assert all(str(item["sha256"]) in worksheet for item in captures)
    assert all(str(item["final_url"]) in worksheet for item in captures)
    assert "license_decision`：`approved` / `limited` / `rejected`" in worksheet
    assert "rights_term_scan" not in worksheet
    assert "本工作表本身不得作为批准证据" in worksheet


def test_enum_evidence_checks_structural_migration_contract_without_approving_semantics() -> None:
    contracts = extract_contracts(discover_repository())

    evidence = build_enum_migration_evidence(contracts)

    assert evidence["machine_status"] == "pass"
    assert evidence["human_status"] == "pending"
    assert evidence["inventory"]["enum_count"] == 251
    assert evidence["inventory"]["enum_group_count"] == 45
    assert evidence["inventory"]["migration_count"] == 13
    assert evidence["findings"] == []


def test_mapping_resolution_only_auto_targets_exact_iso_field() -> None:
    proposal = build_mapping_resolution_proposal()
    proposals = {item["mapping_id"]: item for item in proposal["proposals"]}

    assert proposal["status"] == "decision_required"
    assert proposals["MAP-ISO3"]["proposed_target"] == "country.iso_code"
    assert proposals["MAP-ISO3"]["confidence"] == "high"
    assert all(
        item["proposed_target"] is None
        for mapping_id, item in proposals.items()
        if mapping_id != "MAP-ISO3"
    )


def test_write_candidates_exports_review_package(tmp_path: Path) -> None:
    source_paths = discover_repository()
    paths = replace(source_paths, d0_candidates_dir=tmp_path / "candidates")

    written = write_candidates(paths)
    assessment = json.loads(
        (paths.d0_candidates_dir / "acceptance_assessment.json").read_text(encoding="utf-8")
    )

    queue = json.loads(
        (paths.d0_candidates_dir / "machine_evidence_review_queue.json").read_text(encoding="utf-8")
    )

    resolution = json.loads(
        (paths.d0_candidates_dir / "core_contract_resolution.template.json").read_text(
            encoding="utf-8"
        )
    )
    recommendations = json.loads(
        (paths.d0_candidates_dir / "core_contract_recommendations.json").read_text(encoding="utf-8")
    )

    worksheet_path = paths.d0_candidates_dir / "core_contract_review_worksheet.md"
    raw_sample_worksheet_path = paths.d0_candidates_dir / "raw_sample_review_worksheet.md"

    assert len(written) == 15
    assert assessment["automated_assessment_only"] is True
    assert len(resolution["entity_primary_key_resolutions"]) == 29
    assert len(resolution["field_unit_resolutions"]) == 92
    assert recommendations["advisory_only"] is True
    resolution_bytes = (
        json.dumps(resolution, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()
    assert recommendations["source_binding"]["resolution_template"]["sha256"] == (
        hashlib.sha256(resolution_bytes).hexdigest()
    )
    assert worksheet_path.is_file()
    assert "主键建议：29项" in worksheet_path.read_text(encoding="utf-8")
    assert raw_sample_worksheet_path.is_file()
    assert "样本数量：3" in raw_sample_worksheet_path.read_text(encoding="utf-8")
    assert len(queue["items"]) == 3
    assert {item["machine_status"] for item in queue["items"]} == {"fail", "pass"}
    for item in queue["items"]:
        candidate = paths.d0_candidates_dir / Path(item["candidate_path"]).name
        assert candidate.is_file()
        assert hashlib.sha256(candidate.read_bytes()).hexdigest() == item["candidate_sha256"]
        assert item["human_status"] == "pending"
        assert item["manifest_entry_template"]["status"] == "待复核"
    assert all(path.is_file() for path in written)
