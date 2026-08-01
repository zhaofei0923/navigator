from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from navigator_data_readiness.d0_confirmation import (
    build_confirmed_contract_resolution,
    build_confirmed_review_packet,
    load_confirmation,
    write_confirmed_packets,
)
from navigator_data_readiness.d0_contract_resolution import (
    validate_d0_contract_resolution,
)
from navigator_data_readiness.d0_review import validate_review_packet
from navigator_data_readiness.paths import discover_repository


def _confirmation_path() -> Path:
    paths = discover_repository()
    return paths.root / "data/d0/evidence/kevin_confirmation_20260801.json"


def _previous_review_path() -> Path:
    paths = discover_repository()
    return paths.d0_review_dir / "d0_review_packet.2026-07-31.json"


def test_confirmation_expands_every_exact_contract_and_sample_decision() -> None:
    paths = discover_repository()
    confirmation = load_confirmation(_confirmation_path())
    previous = load_confirmation(_previous_review_path())

    resolution = build_confirmed_contract_resolution(paths, confirmation)
    review = build_confirmed_review_packet(paths, confirmation, previous)

    assert len(resolution["entity_primary_key_resolutions"]) == 29
    assert all(
        item["action"] == "add_primary_key_field"
        and item["proposed_field_contract"]["类型"] == "uuid"
        for item in resolution["entity_primary_key_resolutions"]
    )
    assert len(resolution["compound_field_resolutions"]) == 20
    assert (
        sum(
            len(item["proposed_field_contracts"])
            for item in resolution["compound_field_resolutions"]
        )
        == 57
    )
    child_units = {
        unit["field_id"]: unit
        for item in resolution["compound_field_resolutions"]
        for unit in item["proposed_field_unit_resolutions"]
    }
    assert child_units["DATA-D4-024-02"] == {
        "field_id": "DATA-D4-024-02",
        "unit_applicability": "unit_code",
        "unit_code": "score_point",
        "unit_dimension": "dimensionless",
        "unit_registry_reference": "NAV-SCORE-0-100-v1",
    }
    assert validate_d0_contract_resolution(paths, resolution, authority_packet=review) == []
    assert all(item["license_decision"] == "limited" for item in review["raw_sample_reviews"])
    assert all(
        item["redistribution_allowed"] is False
        and item["ai_index_allowed"] is False
        and item["professional_review_status"] == "approved"
        for item in review["raw_sample_reviews"]
    )
    review_codes = {check.code for check in validate_review_packet(paths, review)}
    assert review_codes == {"D0_REVIEW_ACCEPTANCE_PENDING", "D0_REVIEW_FINAL_PENDING"}


def test_confirmation_writer_is_atomic_and_refuses_overwrite(tmp_path: Path) -> None:
    paths = discover_repository()
    resolution_output = tmp_path / "resolution.json"
    review_output = tmp_path / "review.json"

    written = write_confirmed_packets(
        paths,
        _confirmation_path(),
        _previous_review_path(),
        resolution_output,
        review_output,
    )

    assert written == (resolution_output, review_output)
    assert json.loads(resolution_output.read_text(encoding="utf-8"))["template_only"] is False
    assert json.loads(review_output.read_text(encoding="utf-8"))["template_only"] is False
    assert list(tmp_path.glob(".*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_confirmed_packets(
            paths,
            _confirmation_path(),
            _previous_review_path(),
            resolution_output,
            tmp_path / "other-review.json",
        )


def test_confirmation_rejects_scope_or_sample_drift(tmp_path: Path) -> None:
    paths = discover_repository()
    confirmation = load_confirmation(_confirmation_path())
    previous = load_confirmation(_previous_review_path())

    wrong_count = deepcopy(confirmation)
    wrong_count["primary_key_decision"]["count"] = 28
    with pytest.raises(ValueError, match="Primary-key confirmation"):
        build_confirmed_contract_resolution(paths, wrong_count)

    wrong_sample = deepcopy(confirmation)
    wrong_sample["sample_decisions"][0]["license_decision"] = "approved"
    with pytest.raises(ValueError, match="Unexpected sample decision"):
        build_confirmed_review_packet(paths, wrong_sample, previous)

    non_object = tmp_path / "non-object.json"
    non_object.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="must be a JSON object"):
        load_confirmation(non_object)
