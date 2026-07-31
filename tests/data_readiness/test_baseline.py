from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from navigator_data_readiness.baseline import extract_contracts, snapshot_manifest, write_snapshot
from navigator_data_readiness.paths import discover_repository
from navigator_data_readiness.validation import validate_structure


def test_frozen_workbooks_have_valid_structure() -> None:
    paths = discover_repository()

    assert validate_structure(paths) == []


def test_contract_snapshot_contains_frozen_scope() -> None:
    paths = discover_repository()
    contracts = extract_contracts(paths)

    assert len(contracts["countries"]) == 5
    assert len(contracts["entities"]) == 25
    assert len(contracts["fields"]) == 92
    assert len(contracts["enums"]) == 251
    assert {record["ISO3"] for record in contracts["countries"]} == {
        "IDN",
        "VNM",
        "SAU",
        "ZAF",
        "BRA",
    }
    assert len(contracts["d0_tasks"]) == 4
    assert len(contracts["d0_acceptance"]) == 10
    assert len(contracts["d0_d4_roadmap"]) == 19
    assert len(contracts["feature_requirements"]) == 103
    assert sum(record["优先级"] == "P0" for record in contracts["feature_requirements"]) == 90
    assert len(contracts["role_permissions"]) == 29
    assert len(contracts["page_routes"]) == 166
    assert len(contracts["api_catalog"]) == 70
    assert len(contracts["test_cases"]) == 92
    assert len(contracts["engineering_acceptance_tests"]) == 17
    assert len(contracts["mvp_acceptance"]) == 11


def test_manifest_hashes_are_repeatable() -> None:
    paths = discover_repository()

    first = snapshot_manifest(paths, generated_at="2026-07-31T00:00:00+00:00")
    second = snapshot_manifest(paths, generated_at="2026-07-31T00:00:00+00:00")

    assert first == second
    assert first["record_counts"] == {}
    assert len(first["sources"]["d0_workbook"]["sha256"]) == 64
    assert len(first["sources"]["technical_workbook"]["sha256"]) == 64


def test_write_snapshot_exports_all_contracts(tmp_path: Path) -> None:
    source_paths = discover_repository()
    paths = replace(source_paths, contracts_dir=tmp_path / "contracts")

    written = write_snapshot(paths)
    manifest = json.loads((paths.contracts_dir / "manifest.json").read_text(encoding="utf-8"))

    assert len(written) == 26
    assert manifest["record_counts"]["fields"] == 92
    assert manifest["record_counts"]["enums"] == 251
    assert manifest["record_counts"]["feature_requirements"] == 103
    assert manifest["record_counts"]["page_routes"] == 166
    assert all(path.is_file() for path in written)
