from __future__ import annotations

import copy
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.p0_resolution import (
    READY_FOR_CHANGE_REVIEW,
    build_p0_resolution_template,
    load_and_validate_p0_resolution_packet,
    validate_p0_resolution_packet,
    write_p0_resolution_template,
)
from navigator_data_readiness.paths import discover_repository


def _completed_packet() -> dict[str, Any]:
    packet = copy.deepcopy(build_p0_resolution_template(discover_repository()))
    packet["template_only"] = False
    proposed_test_ids = [
        f"TC-P0-GAP-{index:03d}"
        for index, _item in enumerate(packet["requirement_test_resolutions"], start=1)
    ]
    packet["proposed_contract_ids"]["tests"] = proposed_test_ids

    metadata = {
        "resolution_status": "proposed",
        "change_request_id": "CR-P0-TRACE-20260731",
        "rationale": "Proposed for formal semantic review; no baseline mutation is implied.",
        "reviewer": "kevin",
        "reviewed_at": "2026-07-31",
    }
    for item, test_id in zip(
        packet["requirement_test_resolutions"],
        proposed_test_ids,
        strict=True,
    ):
        item.update(metadata)
        item["proposed_test_case_ids"] = [test_id]

    for item in packet["route_mapping_resolutions"]:
        item.update(metadata)
        dimensions = set(item["unresolved_dimensions"])
        if "requirement" in dimensions:
            item["proposed_requirement_ids"] = ["FR-AUTH-001"]
        if "api" in dimensions:
            item["proposed_api_ids"] = ["API-AUTH-001"]
        if "test" in dimensions:
            item["proposed_test_case_ids"] = ["TC-AUTH-001"]

    for item in packet["permission_code_resolutions"]:
        item.update(metadata)
        item["proposed_perm_ids"] = ["PERM-001"]

    packet["final_review"] = {
        "status": READY_FOR_CHANGE_REVIEW,
        "change_set_id": "P0-TRACE-CHANGESET-20260731",
        "reviewed_by": "kevin",
        "reviewed_at": "2026-07-31",
        "evidence_ids": ["EVD-P0-TRACE-20260731"],
    }
    return packet


def test_resolution_template_covers_every_current_gap() -> None:
    packet = build_p0_resolution_template(discover_repository())

    assert packet["template_only"] is True
    assert len(packet["requirement_test_resolutions"]) == 27
    assert len(packet["route_mapping_resolutions"]) == 98
    assert len(packet["permission_code_resolutions"]) == 105
    assert set(packet["baseline"]["candidate_hashes"]) == {
        "p0_traceability_assessment.json",
        "p0_traceability_matrix.json",
    }
    assert all(item["unresolved_dimensions"] for item in packet["route_mapping_resolutions"])


def test_resolution_template_is_not_a_completed_change_proposal() -> None:
    packet = build_p0_resolution_template(discover_repository())

    checks = validate_p0_resolution_packet(discover_repository(), packet)
    codes = {check.code for check in checks}

    assert "P0_RESOLUTION_TEMPLATE_ONLY" in codes
    assert "P0_RESOLUTION_REQUIREMENT_TEST_PENDING" in codes
    assert "P0_RESOLUTION_ROUTE_PENDING" in codes
    assert "P0_RESOLUTION_PERMISSION_PENDING" in codes
    assert "P0_RESOLUTION_FINAL_REVIEW_PENDING" in codes


def test_structurally_complete_change_proposal_passes() -> None:
    assert validate_p0_resolution_packet(discover_repository(), _completed_packet()) == []


def test_undeclared_test_id_and_stale_baseline_are_rejected() -> None:
    packet = _completed_packet()
    packet["requirement_test_resolutions"][0]["proposed_test_case_ids"] = ["TC-UNDECLARED-999"]
    packet["baseline"]["candidate_hashes"]["p0_traceability_matrix.json"] = "0" * 64

    codes = {check.code for check in validate_p0_resolution_packet(discover_repository(), packet)}

    assert "P0_RESOLUTION_TEST_ID_UNKNOWN" in codes
    assert "P0_RESOLUTION_BASELINE_STALE" in codes


def test_write_and_load_resolution_packet(tmp_path: Path) -> None:
    paths = replace(discover_repository(), p0_candidates_dir=tmp_path / "p0")
    written = write_p0_resolution_template(paths)

    assert written.name == "p0_traceability_resolution.template.json"
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["stage"] == "P0"

    invalid = tmp_path / "invalid.json"
    invalid.write_text("[]", encoding="utf-8")
    checks = load_and_validate_p0_resolution_packet(paths, invalid)
    assert [check.code for check in checks] == ["P0_RESOLUTION_PACKET_INVALID"]
