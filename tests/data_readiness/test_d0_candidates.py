from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from navigator_data_readiness.baseline import extract_contracts
from navigator_data_readiness.d0_candidates import (
    build_acceptance_assessment,
    build_conventions_candidate,
    build_gold_standard_gap_report,
    build_mapping_resolution_proposal,
    build_template_trial,
    build_terminology_review_queue,
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
    assert assessments["D0-AC-001"]["machine_status"] == "pass"
    assert assessments["D0-AC-002"]["machine_status"] == "pass"
    assert assessments["D0-AC-003"]["machine_status"] == "pass"
    assert assessments["D0-AC-005"]["machine_status"] == "fail"
    assert assessments["D0-AC-006"]["machine_status"] == "incomplete"
    assert assessments["D0-AC-007"]["machine_status"] == "fail"
    assert all(item["human_status"] == "pending" for item in assessments.values())


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

    assert len(written) == 7
    assert assessment["automated_assessment_only"] is True
    assert all(path.is_file() for path in written)
