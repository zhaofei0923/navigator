from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from navigator_data_readiness.p0_traceability import (
    build_p0_traceability_report,
    extract_references,
    p0_candidate_payloads,
    write_p0_traceability_candidates,
)
from navigator_data_readiness.paths import discover_repository


def test_extract_references_expands_abbreviated_suffixes() -> None:
    assert extract_references("FR-ARCH-004;007", ("FR-",)) == [
        "FR-ARCH-004",
        "FR-ARCH-007",
    ]
    assert extract_references("NFR-001；002", ("NFR-",)) == ["NFR-001", "NFR-002"]


def test_p0_traceability_report_exposes_baseline_counts_and_gaps() -> None:
    report = build_p0_traceability_report(discover_repository())

    assert report["counts"] == {
        "requirements_total": 103,
        "p0_requirements": 90,
        "role_permission_rows": 29,
        "routes_total": 166,
        "p0_routes": 125,
        "api_contracts_total": 70,
        "p0_api_contracts": 56,
        "test_cases_total": 92,
        "p0_test_cases": 89,
        "p0_engineering_acceptance_tests": 17,
        "mvp_acceptance_criteria": 11,
    }
    assert report["coverage"]["p0_requirements_with_p0_tests"] == 63
    assert report["coverage"]["p0_requirements_without_p0_tests"] == 27
    assert report["coverage"]["p0_permission_codes_total"] == 105
    assert report["coverage"]["p0_permission_codes_mapped"] == 0
    assert report["implementation_evidence"] == {
        "p0_routes_development_ready": 0,
        "p0_apis_implemented": 0,
        "p0_tests_executed": 0,
        "p0_engineering_tests_executed": 0,
        "mvp_acceptance_completed": 0,
    }
    assert report["traceability_ready"] is False
    assert report["delivery_ready"] is False

    blockers = {item["code"]: item for item in report["traceability_blockers"]}
    assert blockers["P0_REQUIREMENT_WITHOUT_P0_TEST"]["count"] == 27
    assert blockers["P0_ROUTE_REQUIREMENT_MAPPING_PENDING"]["count"] == 17
    assert blockers["P0_ROUTE_API_MAPPING_PENDING"]["count"] == 93
    assert blockers["P0_ROUTE_TEST_MAPPING_PENDING"]["count"] == 76
    assert blockers["P0_PERMISSION_CODE_MAPPING_MISSING"]["count"] == 105


def test_p0_matrix_has_one_row_per_p0_requirement() -> None:
    payloads = p0_candidate_payloads(discover_repository())
    matrix = payloads["p0_traceability_matrix.json"]

    assert len(matrix) == 90
    assert len({row["requirement_id"] for row in matrix}) == 90
    assert all(row["priority"] == "P0" for row in matrix)
    auth = next(row for row in matrix if row["requirement_id"] == "FR-AUTH-001")
    assert "TC-AUTH-001" in auth["test_case_ids"]
    assert auth["has_p0_test"] is True


def test_write_p0_traceability_candidates(tmp_path: Path) -> None:
    paths = replace(discover_repository(), p0_candidates_dir=tmp_path / "p0")

    written = write_p0_traceability_candidates(paths)

    assert [path.name for path in written] == [
        "p0_traceability_assessment.json",
        "p0_traceability_matrix.json",
    ]
    assessment = json.loads(written[0].read_text(encoding="utf-8"))
    assert assessment["counts"]["p0_requirements"] == 90
